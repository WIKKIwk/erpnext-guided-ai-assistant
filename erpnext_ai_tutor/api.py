from __future__ import annotations

from typing import Any, Dict, List

import frappe

from erpnext_ai_tutor.erpnext_ai_tutor.doctype.ai_tutor_settings.ai_tutor_settings import (
	AITutorSettings,
	TutorConfig,
	truncate_json,
)
from erpnext_ai_tutor.tutor.common import parse_json_arg, sanitize
from erpnext_ai_tutor.tutor.context import (
	context_summary,
	derived_hints_system_message,
	location_reply,
	looks_truncated,
	next_step_reply,
	shrink_doc,
	which_field_reply,
)
from erpnext_ai_tutor.tutor.intents import (
	DISMISSIVE_RE,
	WHAT_NEXT_RE,
	WHERE_AM_I_RE,
	WHICH_FIELD_RE,
	is_auto_help,
	is_greeting_only,
	wants_troubleshooting,
)
from erpnext_ai_tutor.tutor.language import (
	detect_requested_lang,
	detect_user_lang,
	language_for_response_system_message,
	language_policy_system_message,
	normalize_emoji_style,
	normalize_lang,
	reply_text,
)
from erpnext_ai_tutor.tutor.llm import call_llm, get_ai_provider_config
from erpnext_ai_tutor.tutor.ui import (
	enforce_primary_action_label,
	ui_guidance_system_message,
	ui_snapshot_system_message,
)


def _tone_system_message(*, advanced_mode: bool, emoji_style: str) -> str:
	"""Unified response tone for assistant replies."""
	emoji_style = normalize_emoji_style(emoji_style)
	if emoji_style == "off":
		emoji_rule = "- Do not use emojis."
	elif emoji_style == "warm":
		emoji_rule = "- Emojis are allowed: use at most 2 subtle emojis in short, friendly replies."
	else:
		emoji_rule = "- Emojis are optional: use at most 1 subtle emoji in a short reply when it feels natural."

	if advanced_mode:
		return (
			"TONE POLICY:\n"
			"- Be warm, respectful, and supportive.\n"
			"- Use calm, practical language and avoid robotic wording.\n"
			"- When user reports a problem, add one short empathetic line, then move to concrete steps.\n"
			"- Keep it professional: no exaggerated praise, no roleplay, no excessive emojis.\n"
			f"{emoji_rule}"
		)
	return (
		"TONE POLICY:\n"
		"- Be friendly, clear, and concise.\n"
		"- Keep answers practical and easy to follow.\n"
		"- Avoid cold or robotic phrasing.\n"
		f"{emoji_rule}"
	)


def _global_language_system_message(*, lang: str) -> str:
	lang = normalize_lang(lang)
	lang_label = {"uz": "Uzbek (uz)", "ru": "Russian (ru)", "en": "English (en)"}[lang]
	return (
		"GLOBAL LANGUAGE OVERRIDE:\n"
		f"- Reply in {lang_label}.\n"
		"- Keep replying in this language even if incoming error/log text is in another language.\n"
		"- Only switch language if the user explicitly asks for another language."
	)


def _align_form_context_with_route(ctx: Dict[str, Any]) -> Dict[str, Any]:
	"""Drop stale form context if it doesn't match current Desk route."""
	if not isinstance(ctx, dict):
		return {}
	form = ctx.get("form")
	if not isinstance(form, dict):
		return ctx

	route = ctx.get("route")
	if not isinstance(route, list) or not route:
		ctx2 = dict(ctx)
		ctx2.pop("form", None)
		return ctx2

	head = str(route[0] or "").strip().lower()
	if head != "form":
		ctx2 = dict(ctx)
		ctx2.pop("form", None)
		return ctx2

	route_doctype = str(route[1] or "").strip() if len(route) > 1 else ""
	route_docname = str(route[2] or "").strip() if len(route) > 2 else ""
	form_doctype = str(form.get("doctype") or "").strip()
	form_docname = str(form.get("docname") or "").strip()
	if route_doctype and form_doctype and route_doctype != form_doctype:
		ctx2 = dict(ctx)
		ctx2.pop("form", None)
		return ctx2
	if route_docname and form_docname and route_docname != form_docname:
		ctx2 = dict(ctx)
		ctx2.pop("form", None)
		return ctx2
	return ctx


def _location_llm_reply(
	user_message: str, ctx: Dict[str, Any], cfg: TutorConfig, *, lang: str, fallback_lang: str
) -> str:
	"""Use the LLM to answer location questions naturally, using provided context."""
	lang = normalize_lang(lang or fallback_lang)
	ctx2 = dict(ctx or {})
	ctx2.pop("event", None)
	summary = context_summary(ctx2, lang=lang)
	if not summary:
		return location_reply(ctx, lang=lang)

	messages: List[dict] = [{"role": "system", "content": (cfg.system_prompt or "").strip()}]
	messages.append({"role": "system", "content": language_policy_system_message(fallback=fallback_lang)})
	messages.append({"role": "system", "content": language_for_response_system_message(lang=lang, fallback=fallback_lang)})
	messages.append({"role": "system", "content": _global_language_system_message(lang=lang)})
	messages.append({"role": "system", "content": _tone_system_message(advanced_mode=True, emoji_style=cfg.emoji_style)})
	messages.append(
		{
			"role": "system",
			"content": (
				"You can see the user's current ERPNext page context from the provided summary. "
				"Do NOT say you cannot see the page. "
				"Answer naturally in 2-4 short sentences: where the user is, what this page is for, "
				"and what the user can do next. If an active field is shown, mention it."
			),
		}
	)
	messages.append({"role": "system", "content": "Current ERPNext page context (summary, sanitized):\n" + summary})
	messages.append({"role": "user", "content": user_message})

	try:
		reply = call_llm(messages=messages, max_tokens=320).strip()
	except Exception:
		return location_reply(ctx, lang=lang)
	if not reply or DISMISSIVE_RE.search(reply):
		return location_reply(ctx, lang=lang)
	return reply


def _welcome_session_marker() -> str:
	user = str(getattr(frappe.session, "user", "") or "Guest")
	last_login = ""
	if user != "Guest":
		try:
			last_login = str(frappe.get_cached_value("User", user, "last_login") or "")
		except Exception:
			last_login = ""
	sid = str(getattr(frappe.session, "sid", "") or "")

	parts = [user]
	if last_login:
		parts.append(last_login)
	if sid and sid != user:
		parts.append(sid)
	return "|".join(parts)


def _llm_fallback_reply_key(exc: Exception) -> str:
	msg = str(exc or "").lower()
	if any(part in msg for part in ("429", "too many requests", "resource_exhausted", "quota", "rate limit")):
		return "rate_limited"
	return "provider_unavailable"


@frappe.whitelist()
def get_tutor_config() -> Dict[str, Any]:
	"""Client bootstrap config (safe; no secrets)."""
	doc = AITutorSettings.get_settings()
	public_cfg = dict(AITutorSettings.safe_public_config())

	ai_ok = True
	default_lang = public_cfg.get("language") or getattr(doc, "language", "uz") or "uz"
	try:
		provider_cfg = get_ai_provider_config()
		default_lang = provider_cfg.get("language") or default_lang
	except Exception:
		ai_ok = False
	public_cfg["language"] = normalize_lang(default_lang)

	return {
		"config": public_cfg,
		"ai_ready": ai_ok,
		"language": default_lang,
		"welcome_session_marker": _welcome_session_marker(),
	}


@frappe.whitelist()
def chat(message: str, context: Any | None = None, history: Any | None = None) -> Dict[str, Any]:
	"""Chat endpoint used by the Desk widget."""
	cfg = AITutorSettings.get_config()
	user_message = (message or "").strip()
	advanced_mode = bool(getattr(cfg, "advanced_mode", True))
	emoji_style = normalize_emoji_style(getattr(cfg, "emoji_style", "soft"))
	fallback_lang = normalize_lang(cfg.language or "uz")
	global_lang = ""
	try:
		global_lang = normalize_lang(get_ai_provider_config().get("language"))
	except Exception:
		global_lang = ""
	if global_lang:
		fallback_lang = global_lang

	if not cfg.enabled:
		lang = fallback_lang
		return {"ok": False, "reply": reply_text("disabled", lang=lang, emoji_style=emoji_style)}

	if not user_message:
		return {"ok": False, "reply": reply_text("empty_message", lang=fallback_lang, emoji_style=emoji_style)}

	raw_ctx = parse_json_arg(context or {})
	if not isinstance(raw_ctx, dict):
		raw_ctx = {}
	ctx = sanitize(raw_ctx)
	ctx = _align_form_context_with_route(ctx)

	is_auto = is_auto_help(user_message) if advanced_mode else False
	requested_lang = detect_requested_lang(user_message)
	if global_lang:
		lang = requested_lang or fallback_lang
	else:
		lang = detect_user_lang(user_message, fallback=fallback_lang)

	if is_auto and isinstance(ctx, dict) and not global_lang:
		ui = ctx.get("ui")
		if isinstance(ui, dict):
			raw_ui_lang = str(ui.get("language") or "").strip().lower()
			raw_ui_lang = raw_ui_lang.replace("_", "-").split("-", 1)[0]
			if raw_ui_lang in {"uz", "ru", "en"}:
				fallback_lang = raw_ui_lang
				lang = raw_ui_lang

	if is_greeting_only(user_message):
		return {"ok": True, "reply": reply_text("greeting", lang=lang, emoji_style=emoji_style)}

	if advanced_mode and isinstance(ctx, dict) and WHICH_FIELD_RE.search(user_message):
		return {"ok": True, "reply": which_field_reply(ctx, lang=lang)}

	if advanced_mode and isinstance(ctx, dict) and WHERE_AM_I_RE.search(user_message):
		# Prefer LLM for conversational location help, but keep deterministic fallback.
		reply = _location_llm_reply(user_message, ctx, cfg, lang=lang, fallback_lang=fallback_lang)
		if not reply or not reply.strip():
			reply = location_reply(ctx, lang=lang)
		return {"ok": True, "reply": reply}

	if advanced_mode and isinstance(ctx, dict) and WHAT_NEXT_RE.search(user_message):
		return {"ok": True, "reply": next_step_reply(ctx, lang=lang)}

	troubleshoot = (is_auto or wants_troubleshooting(user_message, ctx)) if advanced_mode else False

	messages: List[dict] = [{"role": "system", "content": cfg.system_prompt.strip()}]
	messages.append({"role": "system", "content": language_policy_system_message(fallback=fallback_lang)})
	messages.append({"role": "system", "content": language_for_response_system_message(lang=lang, fallback=fallback_lang)})
	messages.append({"role": "system", "content": _global_language_system_message(lang=lang)})
	messages.append({"role": "system", "content": _tone_system_message(advanced_mode=advanced_mode, emoji_style=emoji_style)})

	if advanced_mode:
		ui_snapshot = ui_snapshot_system_message(ctx) if isinstance(ctx, dict) else ""
		if ui_snapshot:
			messages.append({"role": "system", "content": ui_snapshot})
			messages.append({"role": "system", "content": ui_guidance_system_message()})

		derived_hints = derived_hints_system_message(ctx) if isinstance(ctx, dict) else ""
		if derived_hints:
			messages.append({"role": "system", "content": derived_hints})

	messages.append(
		{
			"role": "system",
			"content": (
				"You will receive current ERPNext page context in system messages. "
				"Use it to answer. Do NOT claim you cannot see the page; "
				"if context is missing, say what is missing and ask 1 short clarifying question."
			),
		}
	)

	if troubleshoot:
		messages.append(
			{
				"role": "system",
				"content": (
					"When troubleshooting an error/warning, you may use a structured, step-by-step answer. "
					"For normal chat, keep it concise and do not add extra sections."
				),
			}
		)
	else:
		messages.append(
			{
				"role": "system",
				"content": (
					"Reply concisely. For greetings/small talk: 1 short sentence. "
					"For simple questions: max 6 short sentences OR max 5 bullet points. "
					"Do NOT use long 4-section troubleshooting templates unless the user asks about an error/warning."
				),
			}
		)

	if cfg.include_form_context:
		ctx_for_prompt = ctx
		if (not troubleshoot or not advanced_mode) and isinstance(ctx, dict):
			ctx_for_prompt = dict(ctx)
			ctx_for_prompt.pop("event", None)

		if isinstance(ctx_for_prompt, dict):
			summary = context_summary(ctx_for_prompt, lang=lang)
			if summary:
				messages.append(
					{
						"role": "system",
						"content": "Current ERPNext page context (summary, sanitized):\n" + summary,
					}
				)

		if advanced_mode and not is_auto and isinstance(ctx_for_prompt, dict):
			ctx_for_json = dict(ctx_for_prompt)
			form = ctx_for_json.get("form")
			if isinstance(form, dict):
				form2 = dict(form)
				doc = form2.get("doc")
				if isinstance(doc, dict):
					form2["doc"] = shrink_doc(doc, form2.get("missing_required"))
				ctx_for_json["form"] = form2

			context_json = truncate_json(ctx_for_json, cfg.max_context_kb)
			messages.append(
				{
					"role": "system",
					"content": "Context JSON (sanitized, may be truncated):\n" + context_json,
				}
			)

	history = parse_json_arg(history)
	if history is not None and not isinstance(history, list):
		history = None

	history_limit = 20 if advanced_mode else 6
	if isinstance(history, list):
		for item in history[-history_limit:]:
			if not isinstance(item, dict):
				continue
			role = str(item.get("role") or "").strip()
			content = str(item.get("content") or "").strip()
			if role not in {"user", "assistant"}:
				continue
			if not content:
				continue
			messages.append({"role": role, "content": content[:2000]})

	messages.append({"role": "user", "content": user_message})
	if cfg.max_completion_tokens == 0:
		max_tokens = None
	elif cfg.max_completion_tokens > 0:
		max_tokens = cfg.max_completion_tokens
	elif troubleshoot:
		max_tokens = 8192
	elif advanced_mode:
		max_tokens = 1024
	else:
		max_tokens = 512
	try:
		reply = call_llm(messages=messages, max_tokens=max_tokens)
	except Exception as exc:
		return {
			"ok": True,
			"reply": reply_text(_llm_fallback_reply_key(exc), lang=lang, emoji_style=emoji_style),
		}

	if advanced_mode and isinstance(ctx, dict):
		reply = enforce_primary_action_label(reply, ctx)

	if troubleshoot and reply and looks_truncated(reply):
		continue_messages: List[dict] = [
			messages[0],
			{"role": "system", "content": language_policy_system_message(fallback=fallback_lang)},
			{
				"role": "system",
				"content": (
					"If you stopped due to length, continue exactly from where you stopped. "
					"Keep the same language as the previous assistant reply. Do not repeat."
				),
			},
			{"role": "assistant", "content": reply},
			{"role": "user", "content": reply_text("continue_request", lang=lang, emoji_style=emoji_style)},
		]
		try:
			reply2 = call_llm(messages=continue_messages)
			if reply2:
				reply = (reply.rstrip() + "\n\n" + reply2.lstrip()).strip()
		except Exception:
			pass

	return {"ok": True, "reply": reply or ""}
