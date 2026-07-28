from __future__ import annotations

import base64
import json
import os
import threading
import time
from dataclasses import dataclass
from typing import Any


def _decode_jwt_payload(token: str) -> dict[str, Any]:
    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        value = json.loads(base64.urlsafe_b64decode(payload.encode("ascii")).decode("utf-8"))
        return value if isinstance(value, dict) else {}
    except Exception:
        return {}


@dataclass(frozen=True)
class BrowserSessionSnapshot:
    available: bool
    expires_at: int
    updated_at: float
    account_id_present: bool


class BrowserSessionService:
    """Keeps the browser access token in process memory only."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._sessions: dict[str, tuple[str, int, float, bool]] = {}
        self._active_account_id = ""
        self._updated_at = 0.0

    @property
    def bridge_secret(self) -> str:
        return str(os.environ.get("LANGBAI_WEB_BRIDGE_SECRET") or "").strip()

    def check_bridge_secret(self, value: str) -> bool:
        expected = self.bridge_secret
        return bool(expected) and bool(value) and value == expected

    def set_token(self, token: str, account_id: str = "default") -> BrowserSessionSnapshot:
        value = str(token or "").strip()
        local_account_id = str(account_id or "default").strip()[:128] or "default"
        payload = _decode_jwt_payload(value)
        expires_at = int(payload.get("exp") or 0)
        if not value or value.count(".") < 2 or expires_at <= int(time.time()) + 30:
            raise ValueError("ChatGPT browser session token is missing, malformed, or expired")
        auth_claim = payload.get("https://api.openai.com/auth") or {}
        account_id = ""
        if isinstance(auth_claim, dict):
            account_id = str(auth_claim.get("chatgpt_account_id") or auth_claim.get("user_id") or "")
        with self._lock:
            updated_at = time.time()
            self._sessions[local_account_id] = (
                value,
                expires_at,
                updated_at,
                bool(account_id),
            )
            self._active_account_id = local_account_id
            self._updated_at = updated_at
            return self.snapshot(local_account_id)

    def get_token(self, account_id: str = "") -> str:
        with self._lock:
            local_account_id = str(account_id or self._active_account_id).strip()
            session = self._sessions.get(local_account_id)
            if not session or session[1] <= int(time.time()) + 30:
                self._sessions.pop(local_account_id, None)
                raise RuntimeError("ChatGPT browser session is unavailable; open ChatGPT in Edge and stay signed in")
            return session[0]

    def clear(self, account_id: str = "") -> None:
        with self._lock:
            local_account_id = str(account_id or self._active_account_id).strip()
            self._sessions.pop(local_account_id, None)
            if self._active_account_id == local_account_id:
                self._active_account_id = next(iter(self._sessions), "")

    def snapshot(self, account_id: str = "") -> BrowserSessionSnapshot:
        with self._lock:
            local_account_id = str(account_id or self._active_account_id).strip()
            session = self._sessions.get(local_account_id)
            available = bool(session) and session[1] > int(time.time()) + 30
            return BrowserSessionSnapshot(
                available=available,
                expires_at=session[1] if available else 0,
                updated_at=session[2] if available else 0.0,
                account_id_present=session[3] if available else False,
            )


browser_session_service = BrowserSessionService()
