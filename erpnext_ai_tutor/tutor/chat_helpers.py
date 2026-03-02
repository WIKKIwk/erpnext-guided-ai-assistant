from __future__ import annotations

from typing import Any, Dict, List

import frappe

from erpnext_ai_tutor.erpnext_ai_tutor.doctype.ai_tutor_settings.ai_tutor_settings import TutorConfig
from erpnext_ai_tutor.tutor.context import context_summary, location_reply
from erpnext_ai_tutor.tutor.intents import DISMISSIVE_RE
from erpnext_ai_tutor.tutor.language import (
	language_for_response_system_message,
	language_policy_system_message,
	normalize_emoji_style,
	normalize_lang,
)
from erpnext_ai_tutor.tutor.llm import call_llm


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


def _get_current_user_role_context() -> Dict[str, Any]:
	user = str(getattr(frappe.session, "user", "") or "Guest")
	roles: List[str] = []
	user_type = ""
	role_profile = ""
	if user not in {"", "Guest"}:
		try:
			roles = sorted(
				{
					str(role).strip()
					for role in (frappe.get_roles(user) or [])
					if str(role).strip() and str(role).strip() not in {"All", "Guest"}
				}
			)
		except Exception:
			roles = []
		try:
			row = frappe.db.get_value("User", user, ["user_type", "role_profile_name"], as_dict=True) or {}
			user_type = str(row.get("user_type") or "").strip()
			role_profile = str(row.get("role_profile_name") or "").strip()
		except Exception:
			user_type = ""
			role_profile = ""
	is_admin = user == "Administrator" or "System Manager" in set(roles)
	return {
		"user": user,
		"roles": roles,
		"user_type": user_type,
		"role_profile_name": role_profile,
		"is_admin": is_admin,
	}


def _role_aware_system_message(user_ctx: Dict[str, Any]) -> str:
	user = str(user_ctx.get("user") or "Guest")
	roles = user_ctx.get("roles") or []
	if isinstance(roles, list):
		role_items = [str(role).strip() for role in roles if str(role).strip()]
	else:
		role_items = []
	roles_text = ", ".join(role_items[:16]) if role_items else "none"
	user_type = str(user_ctx.get("user_type") or "").strip() or "unknown"
	role_profile = str(user_ctx.get("role_profile_name") or "").strip() or "none"
	admin_access = "yes" if bool(user_ctx.get("is_admin")) else "no"
	return (
		"ROLE-AWARE POLICY:\n"
		f"- Current ERP user: {user}\n"
		f"- User Type: {user_type}\n"
		f"- Role Profile: {role_profile}\n"
		f"- Roles: {roles_text}\n"
		f"- Admin-level access: {admin_access}\n"
		"- Tailor recommendations to this role set.\n"
		"- Never suggest bypassing permissions, security checks, or hidden backdoors.\n"
		"- If an action likely needs a higher role than the user has, explicitly say so and ask to involve System Manager/Administrator."
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
	user_message: str,
	ctx: Dict[str, Any],
	cfg: TutorConfig,
	*,
	lang: str,
	fallback_lang: str,
	user_ctx: Dict[str, Any] | None = None,
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
	if isinstance(user_ctx, dict):
		messages.append({"role": "system", "content": _role_aware_system_message(user_ctx)})
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

