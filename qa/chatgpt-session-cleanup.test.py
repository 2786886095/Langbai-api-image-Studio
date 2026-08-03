from __future__ import annotations

import importlib.util
import sys
import tempfile
import threading
import time
import types
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VENDOR = ROOT / "embedded_gateway" / "vendor" / "chatgpt2api"
sys.path.insert(0, str(VENDOR))


def install_task_service_stubs() -> None:
    config_module = types.ModuleType("services.config")
    config_module.DATA_DIR = Path(tempfile.gettempdir())
    config_module.config = types.SimpleNamespace(
        image_retention_days=1,
        image_account_concurrency=3,
    )
    sys.modules["services.config"] = config_module

    content_filter = types.ModuleType("services.content_filter")
    content_filter.request_text = lambda value: str(value or "")
    sys.modules["services.content_filter"] = content_filter

    log_module = types.ModuleType("services.log_service")
    log_module.LOG_TYPE_CALL = "call"
    log_module.log_service = types.SimpleNamespace(add=lambda *args, **kwargs: None)
    sys.modules["services.log_service"] = log_module

    browser_service = types.ModuleType("services.browser_image_service")
    browser_service.handle_generation = lambda body: {"data": [{"b64_json": "x"}]}
    browser_service.handle_edit = browser_service.handle_generation
    sys.modules["services.browser_image_service"] = browser_service


def load_browser_service():
    session_module = types.ModuleType("services.browser_session_service")
    session_module.browser_session_service = types.SimpleNamespace(
        get_token=lambda account_id: "token"
    )
    sys.modules["services.browser_session_service"] = session_module

    backend_module = types.ModuleType("services.openai_backend_api")

    class FakeBackend:
        instances = []

        def __init__(self, access_token: str):
            self.deleted = []
            self.closed = False
            self.__class__.instances.append(self)

        def delete_conversation(self, conversation_id: str):
            self.deleted.append(conversation_id)

        def close(self):
            self.closed = True

    backend_module.OpenAIBackendAPI = FakeBackend
    sys.modules["services.openai_backend_api"] = backend_module

    protocol_package = types.ModuleType("services.protocol")
    protocol_package.__path__ = []
    sys.modules["services.protocol"] = protocol_package
    conversation = types.ModuleType("services.protocol.conversation")

    class ImageGenerationError(Exception):
        def __init__(self, message: str, **kwargs):
            super().__init__(message)
            self.conversation_id = kwargs.get("conversation_id", "")

    class ConversationRequest:
        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)

    conversation.ConversationRequest = ConversationRequest
    conversation.ImageGenerationError = ImageGenerationError
    conversation.collect_image_outputs = lambda outputs: {
        "data": [{"b64_json": "already-local"}]
    }
    conversation.encode_images = lambda images: list(images)
    conversation.stream_image_outputs = lambda *args, **kwargs: iter(())
    sys.modules["services.protocol.conversation"] = conversation

    edit_module = types.ModuleType("services.protocol.openai_v1_image_edit")
    edit_module._composite_mask = lambda images, masks: images
    sys.modules["services.protocol.openai_v1_image_edit"] = edit_module

    module_path = VENDOR / "services" / "browser_image_service.py"
    spec = importlib.util.spec_from_file_location(
        "browser_image_service_under_test", module_path
    )
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    module._apply_dimension_mode = lambda result, body: []
    return module, conversation, FakeBackend


class SessionCleanupTests(unittest.TestCase):
    def test_task_cancel_stops_handler_and_persists_cancelled_state(self):
        install_task_service_stubs()
        sys.modules.pop("services.image_task_service", None)
        from services.image_task_service import ImageTaskService

        started = threading.Event()

        def handler(body):
            started.set()
            while True:
                body["raise_if_cancelled"]()
                time.sleep(0.005)

        with tempfile.TemporaryDirectory() as directory:
            service = ImageTaskService(
                Path(directory) / "tasks.json",
                generation_handler=handler,
                edit_handler=handler,
                concurrency_getter=lambda: 70,
            )
            identity = {"id": "owner"}
            service.submit_generation(
                identity,
                client_task_id="task-one",
                prompt="prompt",
                model="gpt-image-2",
                size="1024x1024",
            )
            self.assertTrue(started.wait(2))
            cancelled = service.cancel_task(identity, "task-one")
            self.assertEqual(cancelled["status"], "cancelled")
            deadline = time.time() + 2
            while time.time() < deadline:
                state = service.list_tasks(identity, ["task-one"])["items"][0]
                if (
                    state["status"] == "cancelled"
                    and "owner:task-one" not in service._cancel_events
                ):
                    break
                time.sleep(0.01)
            self.assertEqual(state["status"], "cancelled")
            self.assertNotIn("owner:task-one", service._cancel_events)
            self.assertEqual(service.max_concurrency, 70)

    def test_desktop_cleanup_runs_after_success_failure_and_cancel(self):
        module, conversation, backend = load_browser_service()
        output = types.SimpleNamespace(
            kind="result", conversation_id="conversation-success", text=""
        )
        conversation.stream_image_outputs = lambda *args, **kwargs: iter([output])
        module.stream_image_outputs = conversation.stream_image_outputs
        module._run({"prompt": "success"}, edit=False)
        self.assertEqual(backend.instances[-1].deleted, ["conversation-success"])
        self.assertTrue(backend.instances[-1].closed)

        class Failure(Exception):
            conversation_id = "conversation-failure"

        def fail(*args, **kwargs):
            raise Failure("failed")
            yield

        module.stream_image_outputs = fail
        with self.assertRaises(Failure):
            module._run({"prompt": "failure"}, edit=False)
        self.assertEqual(backend.instances[-1].deleted, ["conversation-failure"])

        module.stream_image_outputs = lambda *args, **kwargs: iter([output])

        class Cancelled(Exception):
            pass

        checks = 0

        def cancel_after_conversation_seen():
            nonlocal checks
            checks += 1
            if checks > 1:
                raise Cancelled("cancelled")

        with self.assertRaises(Cancelled):
            module._run(
                {"prompt": "cancel", "raise_if_cancelled": cancel_after_conversation_seen},
                edit=False,
            )
        self.assertEqual(backend.instances[-1].deleted, ["conversation-success"])

    def test_android_gateway_hides_the_last_conversation_in_finally(self):
        source = (
            ROOT / "android" / "app" / "src" / "main" / "python" /
            "android_chatgpt_gateway.py"
        ).read_text(encoding="utf-8")
        self.assertIn('json={"is_visible": False}', source)
        self.assertIn("client.delete_conversation()", source)
        self.assertRegex(source, r"finally:\s+if client is not None:")


if __name__ == "__main__":
    unittest.main()
