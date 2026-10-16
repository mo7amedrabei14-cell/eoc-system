"""Source-level regression checks for the auth/cache hardening patch.

These checks use only the Python standard library and do not import the application,
connect to PostgreSQL, contact external services, or mutate live data.
"""
import ast
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parent


def read_source(path):
    return (ROOT / path).read_text(encoding="utf-8")


def section(source, start, end):
    first = source.index(start)
    last = source.index(end, first + len(start))
    return source[first:last]


class SecurityHardeningSourceTests(unittest.TestCase):
    def test_changed_python_files_parse(self):
        for path in ("main.py", "auth.py", "routers/users.py"):
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
        self.assertIn("SELECT is_active FROM users WHERE user_id = %s LIMIT 1;", function)
        self.assertIn("if not active_row or not bool(active_row[0]):", function)

    def test_idempotency_is_scoped_and_validated_before_cache_replay(self):
        source = read_source("main.py")
        helper = section(source, "def _scoped_idempotency_key(", '@app.middleware("http")')
        self.assertIn("get_current_user_id(bearer_token)", helper)
        self.assertIn("request.method.upper()", helper)
        self.assertIn("request.url.path", helper)
        self.assertIn("request.url.query", helper)
        middleware = section(source, "async def idempotency_middleware(", "app.include_router(users.router)")
        self.assertLess(middleware.index("scoped_key = _scoped_idempotency_key"), middleware.index("SELECT response, original_status"))
        self.assertIn("if not resolved_user_id:", helper)

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
