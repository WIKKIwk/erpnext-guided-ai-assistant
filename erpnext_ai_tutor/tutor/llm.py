from __future__ import annotations

import json
from typing import Any, Dict, List
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

import frappe

from erpnext_ai_tutor.erpnext_ai_tutor.doctype.ai_tutor_settings.ai_tutor_settings import (
	AITutorSettings,
	default_ai_model,
	normalize_ai_provider,
)


def _extract_error_message(raw_text: str) -> str:
	text = str(raw_text or "").strip()
	if not text:
		return "Noma'lum xatolik."
	try:
		payload = json.loads(text)
	except Exception:
		return text[:500]

	if isinstance(payload, dict):
		err = payload.get("error")
		if isinstance(err, dict):
			msg = err.get("message") or err.get("status") or err.get("code")
			if msg:
				return str(msg)
		if isinstance(err, str) and err:
			return err
		msg = payload.get("message")
		if msg:
			return str(msg)
	return text[:500]


def _http_post_json(*, url: str, payload: Dict[str, Any], headers: Dict[str, str], timeout: int = 60) -> Dict[str, Any]:
	data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
	req_headers = {"Content-Type": "application/json", **(headers or {})}
	req = Request(url=url, data=data, headers=req_headers, method="POST")
	try:
		with urlopen(req, timeout=timeout) as resp:
			raw = (resp.read() or b"").decode("utf-8", errors="ignore")
	except HTTPError as exc:
		raw = ""
		try:
			raw = (exc.read() or b"").decode("utf-8", errors="ignore")
		except Exception:
			raw = ""
		msg = _extract_error_message(raw) or str(exc)
		raise frappe.ValidationError(f"AI provider xatoligi: {msg}")
	except URLError as exc:
		raise frappe.ValidationError(f"AI providerga ulanib bo'lmadi: {exc}")

	if not raw:
		return {}
	try:
		return json.loads(raw)
	except Exception:
		raise frappe.ValidationError("AI provider noto'g'ri JSON javob qaytardi.")


def _extract_openai_text(resp: Dict[str, Any]) -> str:
	out = str(resp.get("output_text") or "").strip()
	if out:
		return out

	output = resp.get("output")
	if not isinstance(output, list):
		return ""

	parts: List[str] = []
	for item in output:
		if not isinstance(item, dict):
			continue
		content = item.get("content")
		if not isinstance(content, list):
			continue
		for block in content:
			if not isinstance(block, dict):
				continue
			text = str(block.get("text") or "").strip()
			if text:
				parts.append(text)
	return "\n".join(parts).strip()


def _extract_gemini_text(resp: Dict[str, Any]) -> str:
	candidates = resp.get("candidates")
	if not isinstance(candidates, list):
		return ""

	parts: List[str] = []
	for cand in candidates:
		if not isinstance(cand, dict):
			continue
		content = cand.get("content")
		if not isinstance(content, dict):
			continue
		cand_parts = content.get("parts")
		if not isinstance(cand_parts, list):
			continue
		for p in cand_parts:
			if not isinstance(p, dict):
				continue
			text = str(p.get("text") or "").strip()
			if text:
				parts.append(text)
	return "\n".join(parts).strip()


def _call_openai_direct(*, api_key: str, model: str, messages: List[dict], token_cap: int | None) -> str:
	input_messages: List[Dict[str, Any]] = []
	for item in messages:
		if not isinstance(item, dict):
			continue
		role = str(item.get("role") or "").strip().lower()
		content = str(item.get("content") or "").strip()
		if role not in {"system", "user", "assistant"} or not content:
			continue
		input_messages.append(
			{
				"role": role,
				"content": [{"type": "input_text", "text": content}],
			}
		)

	payload: Dict[str, Any] = {
		"model": str(model or "").strip() or "gpt-5-mini",
		"input": input_messages,
		"temperature": 0.2,
	}
	if token_cap and int(token_cap) > 0:
		payload["max_output_tokens"] = int(token_cap)

	resp = _http_post_json(
		url="https://api.openai.com/v1/responses",
		payload=payload,
		headers={"Authorization": f"Bearer {api_key}"},
		timeout=60,
	)
	text = _extract_openai_text(resp)
	if text:
		return text
	raise frappe.ValidationError("OpenAI javobidan matn olinmadi.")


def _call_gemini_direct(*, api_key: str, model: str, messages: List[dict], token_cap: int | None) -> str:
	system_parts: List[Dict[str, str]] = []
	contents: List[Dict[str, Any]] = []

	for item in messages:
		if not isinstance(item, dict):
			continue
		role = str(item.get("role") or "").strip().lower()
		content = str(item.get("content") or "").strip()
		if not content:
			continue
		if role == "system":
			system_parts.append({"text": content})
			continue
		if role == "assistant":
			contents.append({"role": "model", "parts": [{"text": content}]})
			continue
		if role == "user":
			contents.append({"role": "user", "parts": [{"text": content}]})

	model_path = str(model or "").strip()
	if not model_path:
		model_path = "gemini-3-flash-preview"
	if not model_path.startswith("models/"):
		model_path = f"models/{model_path}"

	payload: Dict[str, Any] = {"contents": contents or [{"role": "user", "parts": [{"text": "Hello"}]}]}
	if system_parts:
		payload["systemInstruction"] = {"parts": system_parts}

	generation_config: Dict[str, Any] = {"temperature": 0.2}
	if token_cap and int(token_cap) > 0:
		generation_config["maxOutputTokens"] = int(token_cap)
	payload["generationConfig"] = generation_config

	url = (
		f"https://generativelanguage.googleapis.com/v1beta/{quote(model_path, safe='/')}:generateContent"
		f"?key={api_key}"
	)
	resp = _http_post_json(url=url, payload=payload, headers={}, timeout=60)
	text = _extract_gemini_text(resp)
	if text:
		return text

	prompt_feedback = resp.get("promptFeedback")
	if isinstance(prompt_feedback, dict):
		block_reason = str(prompt_feedback.get("blockReason") or "").strip()
		if block_reason:
			raise frappe.ValidationError(f"Gemini so'rovi bloklandi: {block_reason}")
	raise frappe.ValidationError("Gemini javobidan matn olinmadi.")


def _generate_completion_direct(
	*, provider: str, api_key: str, model: str, messages: List[dict], max_completion_tokens: int | None = None
) -> str:
	provider = normalize_ai_provider(provider)
	if provider == "gemini":
		return _call_gemini_direct(api_key=api_key, model=model, messages=messages, token_cap=max_completion_tokens)
	return _call_openai_direct(api_key=api_key, model=model, messages=messages, token_cap=max_completion_tokens)


def _get_local_tutor_provider_config() -> Dict[str, str]:
	"""Prefer provider settings from AI Tutor Settings when present."""
	try:
		doc = AITutorSettings.get_settings()
	except Exception:
		return {}

	provider = normalize_ai_provider(getattr(doc, "ai_provider", "openai"))
	model = str(getattr(doc, "ai_model", "") or "").strip() or default_ai_model(provider)
	language = str(getattr(doc, "language", "uz") or "uz")

	api_key = ""
	try:
		api_key = str(doc.get_password("api_key", raise_exception=False) or "").strip()
	except Exception:
		api_key = ""

	if not api_key:
		return {}

	return {
		"provider": provider,
		"model": model,
		"api_key": api_key,
		"language": language,
	}


def get_ai_provider_config() -> Dict[str, str]:
	"""Reuse ERPNext AI's provider/key settings when available."""
	local_cfg = _get_local_tutor_provider_config()
	if local_cfg:
		return local_cfg

	try:
		from erpnext_ai.erpnext_ai.doctype.ai_settings.ai_settings import AISettings

		doc = AISettings.get_settings()
		api_key = getattr(doc, "_resolved_api_key", None)
		if not api_key:
			raise ValueError("Missing API key")
		return {
			"provider": doc.api_provider,
			"model": doc.openai_model,
			"api_key": api_key,
			"language": getattr(doc, "language", "uz") or "uz",
		}
	except Exception as exc:
		frappe.throw(
			"AI sozlamalari topilmadi yoki API key yo'q. "
			"Desk → AI Tutor Admin → AI Tutor Settings ichida provider/model/API key kiriting, "
			"keyin Save bosing va sahifani yangilang."
		)
		raise exc


def call_llm(*, messages: List[dict], max_tokens: int | None = None) -> str:
	cfg = get_ai_provider_config()
	try:
		from erpnext_ai.erpnext_ai.services.llm_client import generate_completion
	except Exception:
		generate_completion = None  # type: ignore[assignment]

	def call_with(token_cap: int | None) -> str:
		if generate_completion:
			payload = dict(
				provider=cfg["provider"],
				api_key=cfg["api_key"],
				model=cfg["model"],
				messages=messages,
				temperature=0.2,
				timeout=60,
			)
			if token_cap and int(token_cap) > 0:
				payload["max_completion_tokens"] = int(token_cap)
			return generate_completion(**payload)

		return _generate_completion_direct(
			provider=cfg["provider"],
			api_key=cfg["api_key"],
			model=cfg["model"],
			messages=messages,
			max_completion_tokens=token_cap,
		)

	if max_tokens is None:
		caps: List[int | None] = [None, 16384, 8192, 4096, 2048]
	else:
		try:
			requested = int(max_tokens)
		except Exception:
			requested = 0
		if requested <= 0:
			caps = [None, 16384, 8192, 4096, 2048]
		else:
			caps = [requested, 16384, 8192, 4096, 2048]

	# Keep ordering, remove duplicates.
	seen = set()
	ordered_caps: List[int | None] = []
	for cap in caps:
		key = "none" if cap is None else str(cap)
		if key in seen:
			continue
		seen.add(key)
		ordered_caps.append(cap)

	for cap in ordered_caps:
		try:
			return call_with(cap)
		except Exception as exc:
			msg = str(exc).lower()
			token_related = (
				"maxoutputtokens",
				"max_completion_tokens",
				"max tokens",
				"output tokens",
				"token limit",
				"too large",
				"exceeds",
				"invalid argument",
			)
			if not any(p in msg for p in token_related):
				raise
	return call_with(2048)
