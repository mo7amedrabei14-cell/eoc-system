"""Focused regression tests for cancelled requests in the idempotency middleware."""
import ast
import unittest
from pathlib import Path


SOURCE = (Path(__file__).resolve().parent / "main.py").read_text(encoding="utf-8")


class FakeURL:
    path = "/api/health"


class FakeRequest:
    method = "GET"
    url = FakeURL()
    headers = {}

    def __init__(self, disconnected):
        self.disconnected = disconnected
        self.disconnect_checks = 0

    async def is_disconnected(self):
        self.disconnect_checks += 1
        return self.disconnected


class FakeResponse:
    def __init__(self, status_code=200):
        self.status_code = status_code


def load_middleware():
    module = ast.parse(SOURCE, filename="main.py")
    function = next(
        node for node in module.body
        if isinstance(node, ast.AsyncFunctionDef)
        and node.name == "idempotency_middleware"
    )
    # Execute the actual function body without registering it on a FastAPI app.
    function.decorator_list = []
    isolated = ast.Module(body=[function], type_ignores=[])
    namespace = {"Request": FakeRequest, "Response": FakeResponse}
    exec(compile(ast.fix_missing_locations(isolated), "main.py", "exec"), namespace)
    return namespace["idempotency_middleware"]


class IdempotencyDisconnectTests(unittest.IsolatedAsyncioTestCase):
    async def test_confirmed_client_disconnect_returns_499(self):
        middleware = load_middleware()
        request = FakeRequest(disconnected=True)

        async def downstream(_request):
            raise RuntimeError("No response returned.")

        result = await middleware(request, downstream)
        self.assertEqual(result.status_code, 499)
        self.assertEqual(request.disconnect_checks, 1)

    async def test_no_response_without_confirmed_disconnect_still_raises(self):
        middleware = load_middleware()
        request = FakeRequest(disconnected=False)

        async def downstream(_request):
            raise RuntimeError("No response returned.")

        with self.assertRaisesRegex(RuntimeError, "^No response returned\\.$"):
            await middleware(request, downstream)
        self.assertEqual(request.disconnect_checks, 1)

    async def test_unrelated_runtime_error_is_not_swallowed(self):
        middleware = load_middleware()
        request = FakeRequest(disconnected=True)

        async def downstream(_request):
            raise RuntimeError("database/application failure")

        with self.assertRaisesRegex(RuntimeError, "database/application failure"):
            await middleware(request, downstream)
        self.assertEqual(request.disconnect_checks, 0)

    async def test_normal_response_is_unchanged(self):
        middleware = load_middleware()
        request = FakeRequest(disconnected=False)
        expected = FakeResponse(200)

        async def downstream(_request):
            return expected

        result = await middleware(request, downstream)
        self.assertIs(result, expected)
        self.assertEqual(request.disconnect_checks, 0)


if __name__ == "__main__":
    unittest.main()
