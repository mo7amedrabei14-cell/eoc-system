"""Source-level regression checks for the auth/cache hardening patch.

These checks use only the Python standard library and do not import the application,
connect to PostgreSQL, contact external services, or mutate live data.
"""
import ast
from pathlib import Path
import unittest

from idempotency import build_idempotency_scope
from security_limits import build_login_rate_limit_key

ROOT = Path(__file__).resolve().parent


def read_source(path):
    return (ROOT / path).read_text(encoding="utf-8")


def section(source, start, end):
    first = source.index(start)
    last = source.index(end, first + len(start))
    return source[first:last]


class SecurityHardeningSourceTests(unittest.TestCase):
    def test_changed_python_files_parse(self):
        for path in ("main.py", "auth.py", "routers/users.py", "idempotency.py", "security_limits.py"):
            with self.subTest(path=path):
                ast.parse(read_source(path), filename=path)

    def test_local_news_authenticates_before_shared_cache(self):
        source = read_source("main.py")
        route = section(source, '@app.get("/api/local-news")', '@app.post("/api/local-news")')
        self.assertLess(route.index("get_current_user_id(token)"), route.index('_cache_read("local_news")'))
        self.assertIn("if has_shared_news_cache:", route)
        self.assertIn("if has_shared_news_cache:\n                _cache_write(\"local_news\", result)", route)

    def test_global_disasters_authenticates_before_cache(self):
        source = read_source("main.py")
        route = section(source, '@app.get("/api/global-disasters")', '@app.post("/api/global-disasters")')
        self.assertLess(route.index("get_current_user_id(token)"), route.index('_cache_read("global_disasters")'))

    def test_ai_news_checks_user_or_system_token_before_cache(self):
        source = read_source("main.py")
        route = section(source, '@app.get("/api/ai-news")', '@app.post("/api/ai-news")')
        self.assertLess(route.index('if system_token and token.strip() == system_token:'), route.index('_cache_read("ai_news", 120.0)'))
        self.assertLess(route.index("get_current_user_id(token)"), route.index('_cache_read("ai_news", 120.0)'))

    def test_inactive_user_is_rejected_during_jwt_validation(self):
        source = read_source("auth.py")
        function = section(source, "def get_current_user_id(token: str):", "def explain_token_failure(token: str)")
        active_check = section(source, "def _is_user_active(user_id: int):", "def authenticate_user(username: str, password: str):")
        self.assertIn("_is_user_active(resolved_user_id) is not True", function)
        self.assertIn("SELECT is_active FROM users WHERE user_id = %s LIMIT 1;", active_check)
        self.assertIn("USER_ACTIVE_CACHE_TTL = 1.5", source)
        self.assertIn("return None", active_check)

    def test_idempotency_scope_partitions_identity_method_route_query_and_key(self):
        base = build_idempotency_scope(
            identity="user:17",
            method="post",
            route_path="/api/missions",
            query_string="source=web",
            client_key="client-key-123",
        )
        self.assertIsNotNone(base)
        variations = [
            {"identity": "user:18"},
            {"method": "PUT"},
            {"route_path": "/api/missions/22"},
            {"query_string": "source=mobile"},
            {"client_key": "client-key-124"},
        ]
        base_args = {
            "identity": "user:17",
            "method": "POST",
            "route_path": "/api/missions",
            "query_string": "source=web",
            "client_key": "client-key-123",
        }
        for change in variations:
            with self.subTest(change=change):
                candidate_args = {**base_args, **change}
                self.assertNotEqual(
                    base,
                    build_idempotency_scope(**candidate_args),
                )

    def test_idempotency_scope_does_not_store_raw_identity_query_or_key(self):
        identity = "user:secret-account-id"
        query = "search=private-value"
        client_key = "secret-client-key"
        scope = build_idempotency_scope(
            identity=identity,
            method="POST",
            route_path="/api/missions",
            query_string=query,
            client_key=client_key,
        )
        self.assertNotIn(identity, str(scope))
        self.assertNotIn(query, str(scope))
        self.assertNotIn(client_key, str(scope))
        self.assertEqual(len(scope["identity_hash"]), 64)
        self.assertEqual(len(scope["query_hash"]), 64)
        self.assertEqual(len(scope["client_key_hash"]), 64)

    def test_idempotency_scope_rejects_missing_identity_key_or_invalid_path(self):
        self.assertIsNone(build_idempotency_scope("", "POST", "/api/missions", "", "k"))
        self.assertIsNone(build_idempotency_scope("user:1", "POST", "/api/missions", "", " "))
        self.assertIsNone(build_idempotency_scope("user:1", "POST", "/" + "x" * 255, "", "k"))

    def test_idempotency_uses_separate_scoped_schema_and_validates_before_replay(self):
        source = read_source("main.py")
        schema = section(source, "def ensure_idempotency_v2_schema() -> bool:", "def _bootstrap_schema_in_background():")
        self.assertIn("CREATE TABLE IF NOT EXISTS idempotency_keys_v2", schema)
        for column in (
            "identity_hash", "method", "route_path", "query_hash", "client_key_hash",
        ):
            self.assertIn(column, schema)
        self.assertIn("ensure_idempotency_v2_schema()", source[source.index("def _bootstrap_schema_in_background"):])

        auth_gate = section(source, "def _idempotency_request_identity(", '@app.middleware("http")')
        self.assertIn('parts[0].lower() != "bearer"', auth_gate)
        self.assertIn("get_current_user_id(bearer_token)", auth_gate)
        self.assertIn("hmac.compare_digest(bearer_token, system_token)", auth_gate)

        middleware = section(source, "async def idempotency_middleware(", "app.include_router(users.router)")
        self.assertIn("build_idempotency_scope(", middleware)
        self.assertLess(
            middleware.index("_idempotency_request_identity(request)"),
            middleware.index("FROM idempotency_keys_v2"),
        )
        self.assertIn("INSERT INTO idempotency_keys_v2", middleware)
        self.assertNotIn("FROM idempotency_keys WHERE", middleware)
        self.assertIn("idempotency_keys_v2", middleware)
        # The old table is still ensured by the legacy bootstrap but its ambiguous rows
        # are never read into the identity-scoped cache.
        legacy_ddl = section(source, "def ensure_schema():", "def ensure_workspace_schema():")
        self.assertIn("CREATE TABLE IF NOT EXISTS idempotency_keys", legacy_ddl)

    def test_login_rate_limit_key_is_hashed_and_username_normalized(self):
        key_a = build_login_rate_limit_key("203.0.113.10", "Operation.Upper")
        key_b = build_login_rate_limit_key("203.0.113.10", " operation.upper ")
        key_other_ip = build_login_rate_limit_key("203.0.113.11", "operation.upper")
        key_other_user = build_login_rate_limit_key("203.0.113.10", "operation.canal")
        self.assertEqual(key_a, key_b)
        self.assertNotEqual(key_a, key_other_ip)
        self.assertNotEqual(key_a, key_other_user)
        self.assertEqual(len(key_a), 64)
        self.assertNotIn("203.0.113.10", key_a)
        self.assertNotIn("operation.upper", key_a)

    def test_login_rate_limit_uses_shared_database_and_fails_closed(self):
        source = read_source("main.py")
        schema = section(
            source,
            "def ensure_login_rate_limit_schema() -> bool:",
            "def _bootstrap_schema_in_background():",
        )
        self.assertIn("CREATE TABLE IF NOT EXISTS login_rate_limits", schema)
        self.assertIn("CREATE INDEX IF NOT EXISTS idx_login_rate_limits_updated_at", schema)
        bootstrap = section(source, "def _bootstrap_schema_in_background():", "threading.Thread(")
        self.assertIn("ensure_login_rate_limit_schema()", bootstrap)

        limiter = section(source, "# 🔒 حدّ محاولات الدخول مشترك", '@app.post("/token")')
        self.assertIn("SELECT failure_count", limiter)
        self.assertIn("INSERT INTO login_rate_limits", limiter)
        self.assertIn("ON CONFLICT (key_hash) DO UPDATE", limiter)
        self.assertIn("login_rate_limits.window_started_at", limiter)
        self.assertIn("def _login_clear_failures(key: str):", limiter)
        self.assertNotIn("_login_failures", source)
        self.assertIn("login rate-limit check failed closed", source)
        self.assertIn("status_code=503", source[source.indexOf('@app.post("/token")'):])

        login_route = section(source, '@app.post("/token")', '@app.post("',)
        self.assertIn("_login_note_failure(login_key)", login_route)
        self.assertIn("_login_clear_failures(login_key)", login_route)

    def test_only_owner_can_assign_or_change_owner_roles(self):
        source = read_source("routers/users.py")
        create_route = section(source, "def create_user(", "# 3. تعديل بيانات مستخدم")
        role_route = section(source, "def update_user_role(", "# 6. تغيير فروع المستخدم")
        self.assertIn("_is_owner_role(role[0]) and not _actor_is_owner(cursor, current_user_id)", create_route)
        guard = "if not actor_is_owner and (requested_is_owner or target_is_owner):"
        self.assertIn(guard, role_route)
        self.assertLess(role_route.index(guard), role_route.index('cursor.execute("DELETE FROM user_roles'))

    def test_test_password_helper_is_removed_from_current_tree(self):
        self.assertFalse((ROOT / "create_test_users.py").exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
