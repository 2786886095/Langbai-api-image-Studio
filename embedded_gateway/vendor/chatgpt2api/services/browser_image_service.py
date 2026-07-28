from __future__ import annotations

import base64
from io import BytesIO
from typing import Any

from PIL import Image, ImageOps

from services.browser_session_service import browser_session_service
from services.openai_backend_api import OpenAIBackendAPI
from services.protocol.conversation import (
    ConversationRequest,
    ImageGenerationError,
    collect_image_outputs,
    encode_images,
    stream_image_outputs,
)
from services.protocol.openai_v1_image_edit import _composite_mask


def _target_size(value: Any) -> tuple[int, int] | None:
    try:
        width, height = [int(part) for part in str(value).lower().split("x", 1)]
        return (width, height) if width > 0 and height > 0 else None
    except Exception:
        return None


def _apply_dimension_mode(result: dict[str, Any], body: dict[str, Any]) -> list[dict[str, str]]:
    target = _target_size(body.get("size"))
    mode = str(body.get("dimension_mode") or "native")
    dimensions: list[dict[str, str]] = []
    for item in result.get("data") or []:
        encoded = str(item.get("b64_json") or "")
        if not encoded:
            continue
        with Image.open(BytesIO(base64.b64decode(encoded))) as source:
            native = source.convert("RGBA") if source.mode not in {"RGB", "RGBA"} else source.copy()
        native_size = native.size
        final = native
        action = "native_preserved"
        if target and native_size != target:
            if mode == "strict_native":
                raise ImageGenerationError(
                    f"strict native size mismatch: requested {target[0]}x{target[1]}, got {native_size[0]}x{native_size[1]}",
                    status_code=422,
                    error_type="invalid_request_error",
                    code="dimension_mismatch",
                )
            if mode == "exact_output":
                final = ImageOps.fit(native, target, method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))
                action = "smart_cover_crop_and_resize"
        if final is not native:
            buffer = BytesIO()
            final.save(buffer, format="PNG")
            item["b64_json"] = base64.b64encode(buffer.getvalue()).decode("ascii")
            item.pop("url", None)
        dimensions.append({
            "requested_size": f"{target[0]}x{target[1]}" if target else "",
            "native_size": f"{native_size[0]}x{native_size[1]}",
            "final_size": f"{final.size[0]}x{final.size[1]}",
            "dimension_action": action,
        })
    return dimensions


def _run(body: dict[str, Any], *, edit: bool) -> dict[str, Any]:
    token = browser_session_service.get_token(str(body.get("account_id") or ""))
    prompt = str(body.get("prompt") or "").strip()
    model = str(body.get("model") or "gpt-image-2")
    n = int(body.get("n") or 1)
    if n != 1:
        raise ImageGenerationError("ChatGPT web image gateway accepts n=1; submit separate resumable tasks")
    images: list[str] = []
    if edit:
        source_images = list(body.get("images") or [])
        masks = list(body.get("mask") or [])
        if masks:
            source_images = _composite_mask(source_images, masks)
        images = encode_images(source_images)
        if not images:
            raise ImageGenerationError("image is required")

    request = ConversationRequest(
        prompt=prompt,
        model=model,
        n=1,
        size=body.get("size"),
        quality=str(body.get("quality") or "auto"),
        response_format=str(body.get("response_format") or "b64_json"),
        base_url=str(body.get("base_url") or "") or None,
        images=images,
        message_as_error=True,
        progress_callback=body.get("progress_callback"),
    )
    backend = OpenAIBackendAPI(access_token=token)
    conversation_id = ""
    succeeded = False
    try:
        outputs = []
        for output in stream_image_outputs(backend, request, 1, 1):
            conversation_id = output.conversation_id or conversation_id
            if output.kind == "message":
                raise ImageGenerationError(
                    output.text or "Image generation was rejected by the upstream service",
                    status_code=400,
                    error_type="invalid_request_error",
                    code="content_policy_violation",
                    conversation_id=conversation_id,
                )
            outputs.append(output)
        result = collect_image_outputs(outputs)
        if not result.get("data"):
            raise ImageGenerationError("ChatGPT web completed without an image", conversation_id=conversation_id)
        dimensions = _apply_dimension_mode(result, body)
        result["langbai"] = {
            "provider": "chatgpt-web",
            "model": "gpt-image-2",
            "operation": "edit" if edit else "generation",
            "requested_size": body.get("size"),
            "requested_quality": body.get("quality"),
            "browser_session_memory_only": True,
            "reference_images_received": len(images),
            "reference_images_forwarded": len(images),
            "reference_boards_compiled": False,
            "dimensions": dimensions,
        }
        succeeded = True
        return result
    finally:
        if succeeded and conversation_id:
            try:
                backend.delete_conversation(conversation_id)
            except Exception:
                pass
        backend.close()


def handle_generation(body: dict[str, Any]) -> dict[str, Any]:
    return _run(body, edit=False)


def handle_edit(body: dict[str, Any]) -> dict[str, Any]:
    return _run(body, edit=True)
