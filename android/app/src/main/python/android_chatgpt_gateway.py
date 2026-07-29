"""Minimal ChatGPT web image client bundled with the Android application.

This module deliberately exposes one synchronous function to Kotlin. Queueing,
task persistence and the local OpenAI-compatible HTTP surface stay in Dart.
Tokens are passed for a single call and are never written by Python.
"""

from __future__ import annotations

import base64
import hashlib
import json
import random
import re
import time
import uuid
from datetime import datetime, timedelta, timezone
from io import BytesIO
from typing import Any

import requests
from PIL import Image, ImageOps


BASE_URL = "https://chatgpt.com"
DEFAULT_SCRIPT = "https://chatgpt.com/backend-api/sentinel/sdk.js"
USER_AGENT = (
    "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/143.0.0.0 Mobile Safari/537.36"
)
FILE_POINTER_RE = re.compile(r"file-service://([A-Za-z0-9_-]+)")
SEDIMENT_POINTER_RE = re.compile(r"sediment://([A-Za-z0-9_-]+)")
CONVERSATION_RE = re.compile(r'"conversation_id"\s*:\s*"([^"]+)"')


class GatewayError(RuntimeError):
    def __init__(self, message: str, status: int = 502, code: str = "upstream_error"):
        super().__init__(message)
        self.status = status
        self.code = code


def _uuid() -> str:
    return str(uuid.uuid4())


def _legacy_time() -> str:
    now = datetime.now(timezone(timedelta(hours=-5)))
    return now.strftime("%a %b %d %Y %H:%M:%S") + " GMT-0500 (Eastern Standard Time)"


def _pow_config(script_sources: list[str], data_build: str) -> list[Any]:
    return [
        random.choice((1920 + 1080, 1440 + 900, 2560 + 1440)),
        _legacy_time(),
        4294705152,
        1,
        USER_AGENT,
        random.choice(script_sources or [DEFAULT_SCRIPT]),
        data_build,
        "zh-CN",
        "zh-CN,zh,en-US,en",
        random.random(),
        "vendor\u2212Google Inc.",
        "location",
        "window",
        time.perf_counter() * 1000,
        _uuid(),
        "",
        random.choice((8, 16, 24, 32)),
        time.time() * 1000 - time.perf_counter() * 1000,
        0, 0, 0, 0, 0, 0, 0,
    ]


def _legacy_requirements_token(script_sources: list[str], data_build: str) -> str:
    raw = json.dumps(
        _pow_config(script_sources, data_build),
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode()
    return "gAAAAAC" + base64.b64encode(raw).decode()


def _proof_token(
    seed: str,
    difficulty: str,
    script_sources: list[str],
    data_build: str,
) -> str:
    config = _pow_config(script_sources, data_build)
    target = bytes.fromhex(str(difficulty))
    diff_len = len(str(difficulty)) // 2
    seed_bytes = str(seed).encode()
    static_1 = (
        json.dumps(config[:3], separators=(",", ":"), ensure_ascii=False)[:-1] + ","
    ).encode()
    static_2 = (
        "," + json.dumps(config[4:9], separators=(",", ":"), ensure_ascii=False)[1:-1] + ","
    ).encode()
    static_3 = (
        "," + json.dumps(config[10:], separators=(",", ":"), ensure_ascii=False)[1:]
    ).encode()
    for index in range(500000):
        value = static_1 + str(index).encode() + static_2 + str(index >> 1).encode() + static_3
        encoded = base64.b64encode(value)
        if hashlib.sha3_512(seed_bytes + encoded).digest()[:diff_len] <= target:
            return "gAAAAAB" + encoded.decode()
    raise GatewayError("ChatGPT proof-of-work challenge could not be solved", 403, "proof_failed")


class Client:
    def __init__(self, token: str):
        token = str(token or "").strip()
        if not token:
            raise GatewayError("ChatGPT account token is missing", 401, "authentication_failed")
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Authorization": f"Bearer {token}",
                "User-Agent": USER_AGENT,
                "Origin": BASE_URL,
                "Referer": BASE_URL + "/",
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7",
                "OAI-Device-Id": _uuid(),
                "OAI-Session-Id": _uuid(),
                "OAI-Language": "zh-CN",
            }
        )
        self.scripts = [DEFAULT_SCRIPT]
        self.data_build = ""

    def close(self) -> None:
        self.session.close()

    def _headers(self, path: str, extra: dict[str, str] | None = None) -> dict[str, str]:
        result = {
            "X-OpenAI-Target-Path": path,
            "X-OpenAI-Target-Route": path,
        }
        if extra:
            result.update(extra)
        return result

    def _check(self, response: requests.Response, path: str) -> requests.Response:
        if 200 <= response.status_code < 300:
            return response
        body = response.text[:1000]
        status = response.status_code
        code = "authentication_failed" if status == 401 else (
            "rate_limited" if status == 429 else "upstream_error"
        )
        try:
            payload = response.json()
            detail = payload.get("detail") if isinstance(payload, dict) else None
            error = payload.get("error") if isinstance(payload, dict) else None
            if isinstance(error, dict):
                body = str(error.get("message") or body)
                code = str(error.get("code") or error.get("type") or code)
            elif detail:
                body = str(detail)
        except Exception:
            pass
        raise GatewayError(f"{path}: HTTP {status}: {body}", status, code)

    def bootstrap(self) -> None:
        response = self._check(
            self.session.get(BASE_URL + "/", timeout=30),
            "bootstrap",
        )
        self.scripts = re.findall(r'<script[^>]+src="([^"]+)"', response.text) or [DEFAULT_SCRIPT]
        match = re.search(r'<html[^>]*data-build="([^"]*)"', response.text)
        self.data_build = match.group(1) if match else ""

    def requirements(self) -> tuple[str, str]:
        base = "/backend-api/sentinel/chat-requirements"
        p_token = _legacy_requirements_token(self.scripts, self.data_build)
        prepare_path = base + "/prepare"
        prepared = self._check(
            self.session.post(
                BASE_URL + prepare_path,
                headers=self._headers(prepare_path, {"Content-Type": "application/json"}),
                json={"p": p_token},
                timeout=30,
            ),
            prepare_path,
        ).json()
        if (prepared.get("arkose") or {}).get("required"):
            raise GatewayError(
                "ChatGPT requested an interactive Arkose verification. Open the built-in login page and retry.",
                403,
                "interactive_verification_required",
            )
        turnstile = prepared.get("turnstile") or {}
        if turnstile.get("required"):
            raise GatewayError(
                "ChatGPT requested an interactive Turnstile verification. Open the built-in login page and retry.",
                403,
                "interactive_verification_required",
            )
        proof = ""
        proof_info = prepared.get("proofofwork") or {}
        if proof_info.get("required"):
            proof = _proof_token(
                proof_info.get("seed", ""),
                proof_info.get("difficulty", ""),
                self.scripts,
                self.data_build,
            )
        finalize_path = base + "/finalize"
        finalized = self._check(
            self.session.post(
                BASE_URL + finalize_path,
                headers=self._headers(finalize_path, {"Content-Type": "application/json"}),
                json={
                    "prepare_token": prepared.get("prepare_token", ""),
                    "proof_token": proof,
                    "turnstile_token": "",
                },
                timeout=30,
            ),
            finalize_path,
        ).json()
        requirements = str(finalized.get("token") or "")
        if not requirements:
            raise GatewayError("ChatGPT did not return a requirements token", 502, "protocol_changed")
        return requirements, proof

    def upload(self, data_url: str, index: int) -> dict[str, Any]:
        match = re.match(r"^data:(image/(?:png|jpe?g|webp));base64,(.+)$", data_url, re.I | re.S)
        if not match:
            raise GatewayError(f"Reference {index} is not a local image Data URL", 400, "invalid_reference")
        raw = base64.b64decode(match.group(2), validate=True)
        mime = match.group(1).lower().replace("image/jpg", "image/jpeg")
        with Image.open(BytesIO(raw)) as image:
            width, height = image.size
        extension = "jpg" if mime == "image/jpeg" else mime.split("/", 1)[1]
        file_name = f"reference-{index}.{extension}"
        path = "/backend-api/files"
        metadata = self._check(
            self.session.post(
                BASE_URL + path,
                headers=self._headers(path, {"Content-Type": "application/json"}),
                json={
                    "file_name": file_name,
                    "file_size": len(raw),
                    "use_case": "multimodal",
                    "width": width,
                    "height": height,
                },
                timeout=60,
            ),
            path,
        ).json()
        upload_url = str(metadata.get("upload_url") or "")
        file_id = str(metadata.get("file_id") or "")
        if not upload_url or not file_id:
            raise GatewayError("ChatGPT reference upload metadata is incomplete", 502, "protocol_changed")
        self._check(
            requests.put(
                upload_url,
                headers={
                    "Content-Type": mime,
                    "x-ms-blob-type": "BlockBlob",
                    "x-ms-version": "2020-04-08",
                },
                data=raw,
                timeout=120,
            ),
            "image_upload",
        )
        uploaded_path = f"/backend-api/files/{file_id}/uploaded"
        self._check(
            self.session.post(
                BASE_URL + uploaded_path,
                headers=self._headers(uploaded_path, {"Content-Type": "application/json"}),
                data="{}",
                timeout=60,
            ),
            uploaded_path,
        )
        return {
            "file_id": file_id,
            "file_name": file_name,
            "file_size": len(raw),
            "mime_type": mime,
            "width": width,
            "height": height,
        }

    def create(self, prompt: str, size: str, quality: str, references: list[dict[str, Any]]) -> tuple[str, set[str], set[str]]:
        self.bootstrap()
        requirements, proof = self.requirements()
        common_headers = {
            "Content-Type": "application/json",
            "OpenAI-Sentinel-Chat-Requirements-Token": requirements,
        }
        if proof:
            common_headers["OpenAI-Sentinel-Proof-Token"] = proof
        parent_id = _uuid()
        prepared_path = "/backend-api/f/conversation/prepare"
        prepared_body = {
            "action": "next",
            "fork_from_shared_post": False,
            "parent_message_id": parent_id,
            "model": "gpt-5-5",
            "client_prepare_state": "success",
            "timezone_offset_min": -480,
            "timezone": "Asia/Shanghai",
            "conversation_mode": {"kind": "primary_assistant"},
            "system_hints": ["picture_v2"],
            "partial_query": {
                "id": _uuid(),
                "author": {"role": "user"},
                "content": {"content_type": "text", "parts": [prompt]},
            },
            "supports_buffering": True,
            "supported_encodings": ["v1"],
            "client_contextual_info": {"app_name": "chatgpt.com"},
        }
        prepared = self._check(
            self.session.post(
                BASE_URL + prepared_path,
                headers=self._headers(prepared_path, common_headers),
                json=prepared_body,
                timeout=60,
            ),
            prepared_path,
        ).json()
        conduit = str(prepared.get("conduit_token") or "")
        if not conduit:
            raise GatewayError("ChatGPT prepare response has no conduit token", 502, "protocol_changed")

        parts: list[Any] = [
            {
                "content_type": "image_asset_pointer",
                "asset_pointer": f"file-service://{item['file_id']}",
                "width": item["width"],
                "height": item["height"],
                "size_bytes": item["file_size"],
            }
            for item in references
        ]
        parts.append(prompt)
        content = (
            {"content_type": "multimodal_text", "parts": parts}
            if references
            else {"content_type": "text", "parts": [prompt]}
        )
        metadata: dict[str, Any] = {
            "system_hints": ["picture_v2"],
            "serialization_metadata": {"custom_symbol_offsets": []},
        }
        if references:
            metadata["attachments"] = [
                {
                    "id": item["file_id"],
                    "mimeType": item["mime_type"],
                    "name": item["file_name"],
                    "size": item["file_size"],
                    "width": item["width"],
                    "height": item["height"],
                }
                for item in references
            ]
        path = "/backend-api/f/conversation"
        headers = dict(common_headers)
        headers.update(
            {
                "Accept": "text/event-stream",
                "X-Conduit-Token": conduit,
                "X-Oai-Turn-Trace-Id": _uuid(),
            }
        )
        body = {
            "action": "next",
            "messages": [
                {
                    "id": _uuid(),
                    "author": {"role": "user"},
                    "create_time": time.time(),
                    "content": content,
                    "metadata": metadata,
                }
            ],
            "parent_message_id": parent_id,
            "model": "gpt-5-5",
            "client_prepare_state": "sent",
            "timezone_offset_min": -480,
            "timezone": "Asia/Shanghai",
            "conversation_mode": {"kind": "primary_assistant"},
            "enable_message_followups": True,
            "system_hints": ["picture_v2"],
            "supports_buffering": True,
            "supported_encodings": ["v1"],
            "client_contextual_info": {"app_name": "chatgpt.com"},
        }
        response = self._check(
            self.session.post(
                BASE_URL + path,
                headers=self._headers(path, headers),
                json=body,
                timeout=600,
                stream=True,
            ),
            path,
        )
        conversation_id = ""
        file_ids: set[str] = set()
        sediment_ids: set[str] = set()
        for line in response.iter_lines(decode_unicode=True):
            if not line or not str(line).startswith("data:"):
                continue
            value = str(line)[5:].strip()
            if not value or value == "[DONE]":
                continue
            conversation_id, file_ids, sediment_ids = _collect_ids(
                value, conversation_id, file_ids, sediment_ids
            )
        return conversation_id, file_ids, sediment_ids

    def resolve(self, conversation_id: str, file_ids: set[str], sediment_ids: set[str]) -> list[bytes]:
        deadline = time.monotonic() + 600
        while time.monotonic() < deadline:
            if conversation_id:
                path = f"/backend-api/conversation/{conversation_id}"
                response = self.session.get(
                    BASE_URL + path,
                    headers=self._headers(path, {"Accept": "application/json"}),
                    timeout=60,
                )
                if response.status_code == 200:
                    conversation_id, file_ids, sediment_ids = _collect_ids(
                        response.text, conversation_id, file_ids, sediment_ids
                    )
            urls: list[str] = []
            for file_id in sorted(file_ids):
                path = f"/backend-api/files/{file_id}/download"
                response = self.session.get(
                    BASE_URL + path,
                    headers=self._headers(path, {"Accept": "application/json"}),
                    timeout=60,
                )
                if response.status_code == 200:
                    payload = response.json()
                    url = str(payload.get("download_url") or payload.get("url") or "")
                    if url:
                        urls.append(url)
            for item in sorted(sediment_ids):
                if not conversation_id:
                    continue
                path = f"/backend-api/conversation/{conversation_id}/attachment/{item}/download"
                response = self.session.get(
                    BASE_URL + path,
                    headers=self._headers(path, {"Accept": "application/json"}),
                    timeout=60,
                )
                if response.status_code == 200:
                    payload = response.json()
                    url = str(payload.get("download_url") or payload.get("url") or "")
                    if url:
                        urls.append(url)
            images: list[bytes] = []
            for url in dict.fromkeys(urls):
                response = requests.get(url, timeout=120)
                if response.status_code == 200 and response.content:
                    images.append(response.content)
            if images:
                return images

            task_path = "/backend-api/tasks"
            task_response = self.session.get(
                BASE_URL + task_path,
                headers=self._headers(task_path, {"Accept": "application/json"}),
                timeout=30,
            )
            if task_response.status_code == 200:
                for task in task_response.json().get("tasks", []):
                    if conversation_id and task.get("conversation_id") != conversation_id:
                        continue
                    message = task.get("image_gen_message") or {}
                    metadata = message.get("metadata") or {}
                    if metadata.get("is_error"):
                        parts = (message.get("content") or {}).get("parts") or []
                        text = "".join(item for item in parts if isinstance(item, str))
                        raise GatewayError(text or "ChatGPT rejected the image task", 400, "content_policy_violation")
            time.sleep(3)
        raise GatewayError("ChatGPT image task timed out after 600 seconds", 504, "task_timeout")


def _collect_ids(
    value: Any,
    conversation_id: str,
    file_ids: set[str],
    sediment_ids: set[str],
) -> tuple[str, set[str], set[str]]:
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    try:
        payload = json.loads(text)
    except Exception:
        payload = None

    def walk(item: Any) -> None:
        nonlocal conversation_id
        if isinstance(item, dict):
            possible = item.get("conversation_id")
            if possible:
                conversation_id = str(possible)
            for child in item.values():
                walk(child)
        elif isinstance(item, list):
            for child in item:
                walk(child)
        elif isinstance(item, str):
            file_ids.update(FILE_POINTER_RE.findall(item))
            sediment_ids.update(SEDIMENT_POINTER_RE.findall(item))

    if payload is not None:
        walk(payload)
    else:
        match = CONVERSATION_RE.search(text)
        if match:
            conversation_id = match.group(1)
        file_ids.update(FILE_POINTER_RE.findall(text))
        sediment_ids.update(SEDIMENT_POINTER_RE.findall(text))
    return conversation_id, file_ids, sediment_ids


def _fit_image(raw: bytes, size: str, dimension_mode: str) -> tuple[bytes, dict[str, str]]:
    requested = re.match(r"^(\d+)x(\d+)$", str(size or ""))
    with Image.open(BytesIO(raw)) as source:
        image = source.convert("RGBA") if source.mode not in ("RGB", "RGBA") else source.copy()
    native = image.size
    action = "native_preserved"
    if requested:
        target = (int(requested.group(1)), int(requested.group(2)))
        if target != native and dimension_mode == "strict_native":
            raise GatewayError(
                f"Strict native size mismatch: requested {target[0]}x{target[1]}, got {native[0]}x{native[1]}",
                422,
                "dimension_mismatch",
            )
        if target != native and dimension_mode == "exact_output":
            image = ImageOps.fit(image, target, method=Image.Resampling.LANCZOS)
            action = "smart_cover_crop_and_resize"
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    final = image.size
    return buffer.getvalue(), {
        "requested_size": str(size or ""),
        "native_size": f"{native[0]}x{native[1]}",
        "final_size": f"{final[0]}x{final[1]}",
        "dimension_action": action,
    }


def generate(access_token: str, body_json: str) -> str:
    client: Client | None = None
    try:
        body = json.loads(body_json)
        prompt = str(body.get("prompt") or "").strip()
        if not prompt:
            raise GatewayError("Prompt is required", 400, "invalid_request")
        if int(body.get("n") or 1) != 1:
            raise GatewayError("Android ChatGPT web image tasks require n=1", 400, "invalid_request")
        images = list(body.get("images") or [])
        if len(images) > 20:
            raise GatewayError("At most 20 reference images are accepted", 400, "too_many_references")
        size = str(body.get("size") or "1024x1024")
        quality = str(body.get("quality") or "medium")
        dimension_mode = str(body.get("dimension_mode") or "exact_output")
        enriched_prompt = (
            f"{prompt}\n\nGenerate exactly one image. Requested output size: {size}. "
            f"Quality preference: {quality}."
        )
        client = Client(access_token)
        references = [
            client.upload(str(item.get("image_url") or item.get("url") or ""), index)
            for index, item in enumerate(images, start=1)
        ]
        conversation_id, file_ids, sediment_ids = client.create(
            enriched_prompt, size, quality, references
        )
        raw_images = client.resolve(conversation_id, file_ids, sediment_ids)
        data = []
        dimensions = []
        for raw in raw_images[:1]:
            processed, audit = _fit_image(raw, size, dimension_mode)
            data.append({"b64_json": base64.b64encode(processed).decode(), "mime_type": "image/png"})
            dimensions.append(audit)
        return json.dumps(
            {
                "created": int(time.time()),
                "data": data,
                "langbai": {
                    "provider": "chatgpt-web-android",
                    "model": "gpt-image-2",
                    "operation": "edit" if references else "generation",
                    "requested_size": size,
                    "requested_quality": quality,
                    "browser_session_memory_only": True,
                    "reference_images_received": len(references),
                    "reference_images_forwarded": len(references),
                    "reference_boards_compiled": False,
                    "dimensions": dimensions,
                },
            },
            ensure_ascii=False,
        )
    except GatewayError as error:
        return json.dumps(
            {
                "__error__": {
                    "status": error.status,
                    "code": error.code,
                    "type": "api_error",
                    "message": str(error),
                }
            },
            ensure_ascii=False,
        )
    except Exception as error:
        return json.dumps(
            {
                "__error__": {
                    "status": 502,
                    "code": "android_gateway_error",
                    "type": "api_error",
                    "message": str(error),
                }
            },
            ensure_ascii=False,
        )
    finally:
        if client is not None:
            client.close()
