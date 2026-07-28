from __future__ import annotations

import ipaddress
from dataclasses import asdict

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field

from services.browser_session_service import browser_session_service


class BrowserTokenRequest(BaseModel):
    access_token: str = Field(..., min_length=32)
    account_id: str = Field(default="default", min_length=1, max_length=128)


def _require_local_bridge(request: Request, bridge_secret: str) -> None:
    host = str(request.client.host if request.client else "")
    try:
        is_loopback = ipaddress.ip_address(host).is_loopback
    except ValueError:
        is_loopback = host.lower() == "localhost"
    if not is_loopback:
        raise HTTPException(status_code=403, detail={"error": "browser session bridge is local-only"})
    if not browser_session_service.check_bridge_secret(bridge_secret):
        raise HTTPException(status_code=401, detail={"error": "invalid browser session bridge secret"})


def create_router() -> APIRouter:
    router = APIRouter()

    @router.get("/session-bridge/v1/status")
    async def bridge_status(
        request: Request,
        x_langbai_bridge_secret: str = Header(default="", alias="X-Langbai-Bridge-Secret"),
    ):
        _require_local_bridge(request, x_langbai_bridge_secret)
        return {"status": "ok", "session": asdict(browser_session_service.snapshot())}

    @router.post("/session-bridge/v1/token")
    async def update_browser_token(
        body: BrowserTokenRequest,
        request: Request,
        x_langbai_bridge_secret: str = Header(default="", alias="X-Langbai-Bridge-Secret"),
    ):
        _require_local_bridge(request, x_langbai_bridge_secret)
        try:
            snapshot = browser_session_service.set_token(body.access_token, body.account_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
        return {"status": "ok", "session": asdict(snapshot)}

    @router.delete("/session-bridge/v1/token")
    async def clear_browser_token(
        request: Request,
        account_id: str = "default",
        x_langbai_bridge_secret: str = Header(default="", alias="X-Langbai-Bridge-Secret"),
    ):
        _require_local_bridge(request, x_langbai_bridge_secret)
        browser_session_service.clear(account_id)
        return {"status": "ok"}

    return router
