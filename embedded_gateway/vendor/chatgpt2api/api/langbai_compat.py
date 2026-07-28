from __future__ import annotations

import base64
import re
import secrets
from typing import Any

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field

from api.support import require_identity
from services.browser_session_service import browser_session_service
from services.image_task_service import image_task_service


DATA_URL_RE = re.compile(r"^data:(image/(?:png|jpeg|jpg|webp));base64,(.+)$", re.I | re.S)


class CompatImageRequest(BaseModel):
    model: str = "gpt-image-2"
    prompt: str = Field(..., min_length=1)
    size: str | None = None
    quality: str = "medium"
    n: int = Field(default=1, ge=1, le=1)
    response_format: str = "b64_json"
    output_format: str = "png"
    dimension_mode: str = "native"
    images: list[dict[str, Any]] = Field(default_factory=list)
    account_id: str = Field(default="", max_length=128)


def _decode_images(items: list[dict[str, Any]]) -> list[tuple[bytes, str, str]]:
    if len(items) > 20:
        raise HTTPException(status_code=400, detail={"error": "at most 20 reference images are accepted"})
    result = []
    for index, item in enumerate(items, start=1):
        value = str(item.get("image_url") or item.get("url") or "")
        match = DATA_URL_RE.match(value)
        if not match:
            raise HTTPException(status_code=400, detail={"error": f"reference {index} must be a PNG, JPEG, or WebP Data URL"})
        try:
            data = base64.b64decode(match.group(2), validate=True)
        except Exception as exc:
            raise HTTPException(status_code=400, detail={"error": f"reference {index} has invalid Base64"}) from exc
        mime = match.group(1).lower().replace("image/jpg", "image/jpeg")
        extension = "jpg" if mime == "image/jpeg" else mime.split("/", 1)[1]
        result.append((data, f"reference-{index}.{extension}", mime))
    return result


def _compat_task(task: dict[str, Any]) -> dict[str, Any]:
    status = str(task.get("status") or "")
    mapped = {
        "queued": "queued",
        "running": "running",
        "success": "succeeded",
        "error": "failed",
    }.get(status, status)
    payload: dict[str, Any] = {
        "id": task.get("id"),
        "status": mapped,
        "created_at": task.get("created_at"),
        "updated_at": task.get("updated_at"),
    }
    if mapped == "succeeded":
        payload["result"] = {
            "created": task.get("updated_at"),
            "data": task.get("data") or [],
            "langbai": task.get("langbai") or {},
        }
    if mapped == "failed":
        payload["error"] = {
            "status": int(task.get("error_status") or 502),
            "type": str(task.get("error_type") or "api_error"),
            "code": str(task.get("error_code") or "upstream_error"),
            "message": str(task.get("error") or "ChatGPT web image task failed"),
        }
    return payload


def create_router() -> APIRouter:
    router = APIRouter()

    @router.get("/healthz")
    async def healthz():
        snapshot = browser_session_service.snapshot()
        return {
            "status": "ok",
            "service": "langbai-chatgpt-web-image-gateway",
            "session_available": snapshot.available,
        }

    @router.get("/v1/image-capabilities")
    async def capabilities(authorization: str | None = Header(default=None)):
        require_identity(authorization)
        return {
            "image_only": True,
            "generations": True,
            "edits": True,
            "async_tasks": True,
            "models": ["gpt-image-2"],
            "max_reference_images": 20,
            "default_concurrency": 10,
            "max_concurrency": 100,
            "dimension_modes": ["native", "strict_native", "exact_output"],
            "quality_modes": ["low", "medium", "high"],
            "session_provider": "chatgpt-web",
            "native_resolution": "upstream-selected",
            "postprocessed_resolution": "up-to-4K-exact-output",
        }

    @router.post("/v1/image-tasks")
    async def create_task(
        body: CompatImageRequest,
        request: Request,
        authorization: str | None = Header(default=None),
    ):
        identity = require_identity(authorization)
        if not browser_session_service.snapshot().available:
            raise HTTPException(status_code=503, detail={"error": "ChatGPT browser session is not connected"})
        task_id = f"webimg_{secrets.token_hex(16)}"
        common = {
            "client_task_id": task_id,
            "prompt": body.prompt,
            "model": "gpt-image-2",
            "size": body.size,
            "quality": body.quality,
            "base_url": str(request.base_url).rstrip("/"),
            "response_format": "b64_json",
            "dimension_mode": body.dimension_mode,
            "account_id": body.account_id,
        }
        if body.images:
            task = image_task_service.submit_edit(identity, images=_decode_images(body.images), **common)
        else:
            task = image_task_service.submit_generation(identity, **common)
        return _compat_task(task)

    @router.get("/v1/image-tasks/{task_id}")
    async def get_task(task_id: str, authorization: str | None = Header(default=None)):
        identity = require_identity(authorization)
        result = image_task_service.list_tasks(identity, [task_id])
        items = result.get("items") or []
        if not items:
            raise HTTPException(status_code=404, detail={"error": "image task not found"})
        return _compat_task(items[0])

    @router.post("/v1/image-tasks/{task_id}/cancel")
    async def cancel_task(task_id: str, authorization: str | None = Header(default=None)):
        identity = require_identity(authorization)
        result = image_task_service.list_tasks(identity, [task_id])
        if not result.get("items"):
            raise HTTPException(status_code=404, detail={"error": "image task not found"})
        return {"id": task_id, "status": "running", "message": "upstream browser task continues; result remains resumable"}

    return router
