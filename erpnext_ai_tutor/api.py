from __future__ import annotations

from typing import Any, Dict, List

import frappe

from erpnext_ai_tutor.erpnext_ai_tutor.doctype.ai_tutor_settings.ai_tutor_settings import (
	AITutorSettings,
	truncate_json,
)
from erpnext_ai_tutor.tutor.common import parse_json_arg, sanitize
from erpnext_ai_tutor.tutor.context import (
	context_summary,
	derived_hints_system_message,
	looks_truncated,
	next_step_reply,
	shrink_doc,
	which_field_reply,
)
from erpnext_ai_tutor.tutor.intents import (
	WHAT_NEXT_RE,
	WHERE_AM_I_RE,
	WHICH_FIELD_RE,
	is_auto_help,
	is_greeting_only,
	is_navigation_lookup,
	should_offer_navigation_guide,
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
from erpnext_ai_tutor.tutor.navigation import (
	build_navigation_plan,
	build_navigation_reply_from_plan,
)
from erpnext_ai_tutor.tutor.llm import call_llm, get_ai_provider_config
from erpnext_ai_tutor.tutor.ui import (
	enforce_primary_action_label,
	ui_guidance_system_message,
	ui_snapshot_system_message,
)
from erpnext_ai_tutor.tutor.chat_helpers import (
	_align_form_context_with_route,
	_extract_retry_after_seconds,
	_get_current_user_role_context,
	_global_language_system_message,
	_llm_fallback_reply_key,
	_location_llm_reply,
	_role_aware_system_message,
	_tone_system_message,
	_welcome_session_marker,
)


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
	user_ctx = _get_current_user_role_context()

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

	nav_plan: Dict[str, Any] = {}
	nav_hint = ""
	nav_query = False

	def _guide_from_nav_plan(plan: Dict[str, Any]) -> Dict[str, Any]:
		if not isinstance(plan, dict):
			return {}
		route = str(plan.get("route") or "").strip()
		if not route:
			return {}
		menu_path = plan.get("menu_path")
		if not isinstance(menu_path, list):
			menu_path = []
		return {
			"type": "navigation",
			"route": route,
			"target_label": str(plan.get("target_label") or "").strip(),
			"menu_path": [str(x).strip() for x in menu_path if str(x or "").strip()],
		}

	if advanced_mode:
		nav_plan = build_navigation_plan(user_message)
		nav_query = bool(should_offer_navigation_guide(user_message, nav_plan_exists=bool(nav_plan)))
		# If local ERP metadata already resolved a concrete destination,
		# always attach guide to keep UX consistent.
		if nav_plan and not nav_query:
			nav_query = True
	if nav_query:
		nav_hint = build_navigation_reply_from_plan(nav_plan, lang=lang, strict=True)

	if advanced_mode and isinstance(ctx, dict) and WHICH_FIELD_RE.search(user_message):
		return {"ok": True, "reply": which_field_reply(ctx, lang=lang)}

	if advanced_mode and isinstance(ctx, dict) and WHERE_AM_I_RE.search(user_message):
		# Prefer LLM for conversational location help, but keep deterministic fallback.
		reply = _location_llm_reply(
			user_message,
			ctx,
			cfg,
			lang=lang,
			fallback_lang=fallback_lang,
			user_ctx=user_ctx,
		)
		return {"ok": True, "reply": reply}

	if advanced_mode and isinstance(ctx, dict) and WHAT_NEXT_RE.search(user_message):
		return {"ok": True, "reply": next_step_reply(ctx, lang=lang)}

	troubleshoot = (is_auto or wants_troubleshooting(user_message, ctx)) if advanced_mode else False

	messages: List[dict] = [{"role": "system", "content": cfg.system_prompt.strip()}]
	messages.append({"role": "system", "content": language_policy_system_message(fallback=fallback_lang)})
	messages.append({"role": "system", "content": language_for_response_system_message(lang=lang, fallback=fallback_lang)})
	messages.append({"role": "system", "content": _global_language_system_message(lang=lang)})
	messages.append({"role": "system", "content": _tone_system_message(advanced_mode=advanced_mode, emoji_style=emoji_style)})
	messages.append({"role": "system", "content": _role_aware_system_message(user_ctx)})

	if advanced_mode:
		ui_snapshot = ui_snapshot_system_message(ctx) if isinstance(ctx, dict) else ""
		if ui_snapshot:
			messages.append({"role": "system", "content": ui_snapshot})
			messages.append({"role": "system", "content": ui_guidance_system_message()})

		derived_hints = derived_hints_system_message(ctx) if isinstance(ctx, dict) else ""
		if derived_hints:
			messages.append({"role": "system", "content": derived_hints})

	if nav_query:
		if nav_hint:
			messages.append(
				{
					"role": "system",
					"content": (
						"NAVIGATION LOOKUP RESULT (from ERP metadata):\n"
						f"{nav_hint}\n"
						"Use this as high-confidence reference, but answer naturally (humanoid style). "
						"If user asks to navigate, include exact route in backticks and short menu steps."
					),
				}
			)
		else:
			messages.append(
				{
					"role": "system",
					"content": (
						"User is asking where to find/open a module or DocType. "
						"If exact item is unclear, ask one short clarifying question and offer the closest probable path."
					),
				}
			)

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
		fallback_key = _llm_fallback_reply_key(exc)
		if advanced_mode and nav_query and nav_plan:
			guide = _guide_from_nav_plan(nav_plan)
			if guide:
				deterministic_nav_reply = nav_hint or build_navigation_reply_from_plan(nav_plan, lang=lang, strict=False)
				if deterministic_nav_reply:
					limit_note = {
						"uz": "AI servisi hozir limitga tushgan bo'lsa ham, yo'lni lokal xaritadan ko'rsatdim.",
						"ru": "Даже при текущем лимите AI я показал путь по локальной карте ERP.",
						"en": "Even with the current AI limit, I showed the path using local ERP metadata.",
					}.get(lang, "AI limit reached; navigation path is provided from local ERP metadata.")
					return {
						"ok": True,
						"reply": (deterministic_nav_reply.rstrip() + "\n\n" + limit_note).strip(),
						"guide": guide,
					}
		if fallback_key == "rate_limited":
			retry_after = _extract_retry_after_seconds(exc)
			reply = reply_text(fallback_key, lang=lang, emoji_style=emoji_style)
			if retry_after:
				if lang == "ru":
					reply = f"{reply}\n\nОжидаемое время повтора: примерно {retry_after} сек."
				elif lang == "en":
					reply = f"{reply}\n\nEstimated retry time: about {retry_after} seconds."
				else:
					reply = f"{reply}\n\nTaxminiy qayta urinish vaqti: {retry_after} soniya."
			return {"ok": True, "reply": reply}
		return {
			"ok": True,
			"reply": reply_text(fallback_key, lang=lang, emoji_style=emoji_style),
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

	guide: Dict[str, Any] = {}
	if advanced_mode and nav_query and nav_plan:
		guide = _guide_from_nav_plan(nav_plan)

	return {"ok": True, "reply": reply or "", "guide": guide}
