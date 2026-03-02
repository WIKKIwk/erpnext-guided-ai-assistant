from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Dict

import frappe
from frappe.model.document import Document


@dataclass(frozen=True)
class TutorConfig:
	enabled: bool
	advanced_mode: bool
	auto_open_on_error: bool
	auto_open_on_warning: bool
	include_form_context: bool
	include_doc_values: bool
	max_context_kb: int
	ai_provider: str
	ai_model: str
	max_completion_tokens: int
	language: str
	emoji_style: str
	system_prompt: str


DEFAULT_SYSTEM_PROMPT = """You are an ERPNext tutor assistant.

Goal:
- Help the user understand what is happening on the current ERPNext page.
- When an error/warning happens, explain it clearly and propose safe, step-by-step fixes.

Language:
- Reply in the same language as the user's message.
- If the message language is unclear, default to Uzbek (uz).

Style:
- Be concise by default.
- For greetings/thanks/small talk: reply in 1–2 short sentences.
- For simple questions: answer briefly (max 6 short sentences OR max 5 bullet points).
- Keep a warm, respectful, and supportive tone.
- When the user reports a problem, start with a short empathetic acknowledgement, then give practical help.
- Do not use excessive flattery, roleplay, or too many emojis.
- Only use the troubleshooting template when:
  a) There is an error/warning, OR
  b) The user explicitly asks for troubleshooting / step-by-step help.

Troubleshooting template (use only when applicable):
1) Nima bo'ldi
2) Nega bo'ldi
3) Qanday tuzatamiz (kamida 5 ta aniq qadam)
4) Tekshiruv ro'yxati (qisqa)

Safety:
- Never ask for passwords, API keys, tokens, or secrets.
- Be practical and safe: focus on what the user can do on the current page.
- If a fix requires a permission the user might not have, say so.
- Do not fabricate field names/values; if missing, ask 1 clarifying question.
"""


def _coerce_bool(value: Any) -> bool:
	try:
		return bool(int(value))
	except Exception:
		return bool(value)


def _coerce_int(value: Any, default: int) -> int:
	try:
		return int(value)
	except Exception:
		return default


def normalize_emoji_style(value: Any) -> str:
	raw = str(value or "").strip().lower()
	if raw in {"off", "soft", "warm"}:
		return raw
	return "soft"


def normalize_ai_provider(value: Any) -> str:
	raw = str(value or "").strip().lower()
	if raw in {"openai", "gemini"}:
		return raw
	return "openai"


def default_ai_model(provider: str) -> str:
	if normalize_ai_provider(provider) == "gemini":
		return "gemini-3-flash-preview"
	return "gpt-5-mini"


def resolve_ai_model(doc: Any, provider: str) -> str:
	custom = str(getattr(doc, "custom_ai_model", "") or "").strip()
	if custom:
		return custom
	chosen = str(getattr(doc, "ai_model", "") or "").strip()
	if chosen:
		return chosen
	return default_ai_model(provider)


class AITutorSettings(Document):
	def validate(self) -> None:
		if not hasattr(self, "advanced_mode") or getattr(self, "advanced_mode", None) in {None, ""}:
			self.advanced_mode = 1

		self.max_context_kb = _coerce_int(getattr(self, "max_context_kb", None), 24)
		if self.max_context_kb < 4:
			self.max_context_kb = 4
		if self.max_context_kb > 256:
			self.max_context_kb = 256

		self.ai_provider = normalize_ai_provider(getattr(self, "ai_provider", "openai"))
		self.ai_model = resolve_ai_model(self, self.ai_provider)
		self.max_completion_tokens = _coerce_int(getattr(self, "max_completion_tokens", None), 0)
		if self.max_completion_tokens < 0:
			self.max_completion_tokens = 0
		if self.max_completion_tokens > 131072:
			self.max_completion_tokens = 131072

		# Persist API key immediately into encrypted store when user enters plaintext.
		# This prevents losing the key if another field validation fails later.
		raw_api_key = str(getattr(self, "api_key", "") or "").strip()
		if raw_api_key and not self.is_dummy_password(raw_api_key):
			from frappe.utils.password import set_encrypted_password

			target_name = str(getattr(self, "name", "") or self.doctype)
			set_encrypted_password(self.doctype, target_name, raw_api_key, "api_key")
			self.api_key = "*" * len(raw_api_key)

		if not getattr(self, "language", None):
			self.language = "uz"
		self.emoji_style = normalize_emoji_style(getattr(self, "emoji_style", "soft"))

		if not getattr(self, "system_prompt", None):
			self.system_prompt = DEFAULT_SYSTEM_PROMPT

	@staticmethod
	def get_settings() -> "AITutorSettings":
		doc = frappe.get_single("AI Tutor Settings")
		if not hasattr(doc, "advanced_mode") or getattr(doc, "advanced_mode", None) in {None, ""}:
			doc.advanced_mode = 1
		doc.max_context_kb = _coerce_int(getattr(doc, "max_context_kb", None), 24)
		doc.ai_provider = normalize_ai_provider(getattr(doc, "ai_provider", "openai"))
		doc.ai_model = resolve_ai_model(doc, doc.ai_provider)
		doc.max_completion_tokens = _coerce_int(getattr(doc, "max_completion_tokens", None), 0)
		if doc.max_completion_tokens < 0:
			doc.max_completion_tokens = 0
		if doc.max_completion_tokens > 131072:
			doc.max_completion_tokens = 131072
		if not getattr(doc, "language", None):
			doc.language = "uz"
		doc.emoji_style = normalize_emoji_style(getattr(doc, "emoji_style", "soft"))
		if not getattr(doc, "system_prompt", None):
			doc.system_prompt = DEFAULT_SYSTEM_PROMPT
		return doc

	@staticmethod
	def get_config() -> TutorConfig:
		doc = AITutorSettings.get_settings()
		return TutorConfig(
			enabled=_coerce_bool(getattr(doc, "enabled", 1)),
			advanced_mode=_coerce_bool(getattr(doc, "advanced_mode", 1)),
			auto_open_on_error=_coerce_bool(getattr(doc, "auto_open_on_error", 1)),
			auto_open_on_warning=_coerce_bool(getattr(doc, "auto_open_on_warning", 1)),
			include_form_context=_coerce_bool(getattr(doc, "include_form_context", 1)),
			include_doc_values=_coerce_bool(getattr(doc, "include_doc_values", 1)),
			max_context_kb=_coerce_int(getattr(doc, "max_context_kb", None), 24),
			ai_provider=normalize_ai_provider(getattr(doc, "ai_provider", "openai")),
			ai_model=resolve_ai_model(doc, normalize_ai_provider(getattr(doc, "ai_provider", "openai"))),
			max_completion_tokens=_coerce_int(getattr(doc, "max_completion_tokens", None), 0),
			language=str(getattr(doc, "language", "uz") or "uz"),
			emoji_style=normalize_emoji_style(getattr(doc, "emoji_style", "soft")),
			system_prompt=str(getattr(doc, "system_prompt", DEFAULT_SYSTEM_PROMPT) or DEFAULT_SYSTEM_PROMPT),
		)

	@staticmethod
	def safe_public_config() -> Dict[str, Any]:
		"""Safe subset for clients (no secrets)."""
		cfg = AITutorSettings.get_config()
		return {
			"enabled": cfg.enabled,
			"advanced_mode": cfg.advanced_mode,
			"auto_open_on_error": cfg.auto_open_on_error,
			"auto_open_on_warning": cfg.auto_open_on_warning,
			"include_form_context": cfg.include_form_context,
			"include_doc_values": cfg.include_doc_values,
			"max_context_kb": cfg.max_context_kb,
			"ai_provider": cfg.ai_provider,
			"ai_model": cfg.ai_model,
			"max_completion_tokens": cfg.max_completion_tokens,
			"language": cfg.language,
			"emoji_style": cfg.emoji_style,
		}


def truncate_json(obj: Any, max_kb: int) -> str:
	"""Serialize and cap payload size. Returns JSON string."""
	limit = max(1, int(max_kb)) * 1024
	try:
		raw = json.dumps(obj, ensure_ascii=False, default=str)
	except Exception:
		raw = json.dumps({"error": "context_serialization_failed"}, ensure_ascii=False)
	if len(raw.encode("utf-8")) <= limit:
		return raw
	# Rough trim: progressively remove large keys
	if isinstance(obj, dict):
		trimmed = dict(obj)
		for key in ("doc", "doc_values", "meta", "traceback", "server_messages"):
			if key in trimmed:
				trimmed[key] = "[truncated]"
				try:
					raw2 = json.dumps(trimmed, ensure_ascii=False, default=str)
					if len(raw2.encode("utf-8")) <= limit:
						return raw2
					raw = raw2
				except Exception:
					continue
	# Final: hard truncate
	data = raw.encode("utf-8")[:limit]
	try:
		return data.decode("utf-8", errors="ignore")
	except Exception:
		return "{\"error\":\"context_too_large\"}"
