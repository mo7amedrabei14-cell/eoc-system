import json
import os
from pathlib import Path

from locust import HttpUser, between, events, task


ROOT = Path(__file__).resolve().parents[1]
SPEC = json.loads((ROOT / "openapi_spec.json").read_text(encoding="utf-8"))
GET_PATHS = []
PARAMETERIZED_PATHS = []
for path, operations in SPEC.get("paths", {}).items():
    operation = operations.get("get")
    if not operation:
        continue
    parameters = operation.get("parameters", [])
    if any(p.get("in") == "path" for p in parameters) or "{" in path:
        PARAMETERIZED_PATHS.append(path)
    else:
        GET_PATHS.append(path)


class EocReadUser(HttpUser):
    wait_time = between(0.05, 0.15)

    def on_start(self):
        username = os.environ.get("EOC_TEST_USERNAME")
        password = os.environ.get("EOC_TEST_PASSWORD")
        if not username or not password:
            raise RuntimeError("Set EOC_TEST_USERNAME and EOC_TEST_PASSWORD for a local test user")
        response = self.client.post("/token", data={"username": username, "password": password})
        response.raise_for_status()
        self.client.headers["Authorization"] = f"Bearer {response.json()['access_token']}"
        self.read_paths = list(GET_PATHS)
        ids = json.loads(os.environ.get("EOC_TEST_IDS_JSON", "{}"))
        for path in PARAMETERIZED_PATHS[:5]:
            resolved = path
            for name in __import__("re").findall(r"{([^}]+)}", path):
                if name not in ids:
                    break
                resolved = resolved.replace("{" + name + "}", str(ids[name]))
            else:
                self.read_paths.append(resolved)

    @task
    def read_next(self):
        if not self.read_paths:
            return
        index = getattr(self, "next_index", 0)
        path = self.read_paths[index % len(self.read_paths)]
        self.next_index = index + 1
        self.client.get(path, name=path)


@events.init_command_line_parser.add_listener
def add_snapshot_argument(parser):
    parser.add_argument("--snapshot-dir", default="", help="Save each GET JSON response once")


@events.test_start.add_listener
def configure_snapshots(environment, **_kwargs):
    snapshot_dir = environment.parsed_options.snapshot_dir
    if not snapshot_dir:
        return
    output = Path(snapshot_dir)
    output.mkdir(parents=True, exist_ok=True)
    saved = set()

    def save_response(request, response, **_kwargs):
        if request.method != "GET" or not response.ok:
            return
        name = request.name
        if name in saved:
            return
        saved.add(name)
        target = output / (name.strip("/").replace("/", "__") or "root")
        target = target.with_suffix(".json")
        target.write_text(response.text, encoding="utf-8")

    environment.events.request.add_listener(save_response)
