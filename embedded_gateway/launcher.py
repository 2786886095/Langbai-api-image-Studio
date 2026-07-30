"""Minimal loopback-only launcher for Langbai's bundled ChatGPT image gateway."""

from __future__ import annotations

import ctypes
import os
from pathlib import Path
import sys
import threading
import time
import traceback


def _install_runtime_streams() -> Path:
    """Give --noconsole builds valid streams before third-party imports."""
    data_dir = Path(
        os.environ.get("CHATGPT2API_DATA_DIR")
        or (Path.home() / "AppData" / "Local" / "LangbaiImageStudio" / "EmbeddedChatGptGateway")
    )
    data_dir.mkdir(parents=True, exist_ok=True)
    log_path = data_dir / "gateway-runtime.log"
    if sys.stdout is None or sys.stderr is None:
        stream = log_path.open("a", encoding="utf-8", buffering=1)
        if sys.stdout is None:
            sys.stdout = stream
        if sys.stderr is None:
            sys.stderr = stream
    return log_path


RUNTIME_LOG_PATH = _install_runtime_streams()


def _parent_is_running(parent_pid: int) -> bool:
    if parent_pid <= 0:
        return True
    if os.name == "nt":
        process_query_limited_information = 0x1000
        handle = ctypes.windll.kernel32.OpenProcess(
            process_query_limited_information,
            False,
            parent_pid,
        )
        if handle:
            ctypes.windll.kernel32.CloseHandle(handle)
            return True
        return False
    try:
        os.kill(parent_pid, 0)
        return True
    except OSError:
        return False


def _watch_parent(parent_pid: int) -> None:
    while _parent_is_running(parent_pid):
        time.sleep(2)
    os._exit(0)


def create_app():
    # Imports stay below _install_runtime_streams because PyInstaller's
    # windowed bootloader sets stdout/stderr to None. Uvicorn/Rich and some
    # optional hooks inspect those streams during import.
    from fastapi import FastAPI

    from api import browser_session, langbai_compat
    from api.errors import install_exception_handlers
    from services.image_service import get_image_response, get_thumbnail_response

    app = FastAPI(
        title="Langbai Embedded ChatGPT Image Gateway",
        version="1.6.14",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    install_exception_handlers(app)
    app.include_router(browser_session.create_router())
    app.include_router(langbai_compat.create_router())

    # Generated results are persisted below CHATGPT2API_DATA_DIR/images and
    # returned as loopback /images/... URLs. The bundled image-only launcher
    # deliberately does not include the full administration router, so expose
    # only the two read-only image routes needed by preview, reload and save.
    @app.get("/images/{image_path:path}", include_in_schema=False)
    async def get_image(image_path: str):
        return get_image_response(image_path)

    @app.get("/image-thumbnails/{image_path:path}", include_in_schema=False)
    async def get_image_thumbnail(image_path: str):
        return get_thumbnail_response(image_path)

    return app


def main() -> None:
    import uvicorn

    host = "127.0.0.1"
    port = int(os.environ.get("LANGBAI_GATEWAY_PORT", "18081"))
    parent_pid = int(os.environ.get("LANGBAI_PARENT_PID", "0"))
    if parent_pid > 0:
        threading.Thread(
            target=_watch_parent,
            args=(parent_pid,),
            daemon=True,
            name="langbai-parent-watch",
        ).start()
    uvicorn.run(
        create_app(),
        host=host,
        port=port,
        access_log=False,
        log_level="warning",
        server_header=False,
    )


if __name__ == "__main__":
    try:
        main()
    except BaseException:
        try:
            with RUNTIME_LOG_PATH.open("a", encoding="utf-8") as stream:
                stream.write(traceback.format_exc())
                stream.write("\n")
        finally:
            raise
