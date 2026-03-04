from __future__ import annotations

import re
import json
from typing import Any, Dict, List
from pathlib import Path

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
from erpnext_ai_tutor.tutor.training import maybe_handle_training_flow
from erpnext_ai_tutor.tutor.llm import call_llm, get_ai_provider_config
from erpnext_ai_tutor.tutor.planner import plan_tutorial_fields as build_tutorial_field_plan
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


GUIDE_ROUTE_OVERRIDES = {
	"/app/doctype": {
		"target_label": "DocType",
		"menu_path": ["Build", "DocType"],
	}
}
DEMO_LINK_AUTOCREATE_ALLOWLIST = {"Item", "UOM"}

GUIDE_NAV_TAG_RE = re.compile(r"\[\[\s*GUIDE_NAV\s*\]\]", re.IGNORECASE)


def _normalize_route_path(route: str) -> str:
	path = str(route or "").strip()
	if not path:
		return ""
	path = path.split("#", 1)[0].split("?", 1)[0]
	if path != "/":
		path = path.rstrip("/")
	return path


def _normalize_guide_text(value: str) -> str:
	return str(value or "").strip().casefold()


def _apply_guide_route_override(route: str, target_label: str, menu_path: List[str]) -> tuple[str, List[str]]:
	override = GUIDE_ROUTE_OVERRIDES.get(_normalize_route_path(route))
	if not override:
		return target_label, menu_path

	expected_target = str(override.get("target_label") or "").strip()
	expected_menu_path = [str(x).strip() for x in override.get("menu_path", []) if str(x or "").strip()]
	if not expected_target or not expected_menu_path:
		return target_label, menu_path

	target_norm = _normalize_guide_text(target_label)
	expected_norm = _normalize_guide_text(expected_target)
	menu_norm = {_normalize_guide_text(x) for x in menu_path}

	# Repair inconsistent payloads (e.g. stale wrong module like "EDI")
	# when route is known and deterministic.
	if target_norm != expected_norm or expected_norm not in menu_norm:
		return expected_target, expected_menu_path

	return target_label, menu_path


def _extract_guide_flag(reply_text: str) -> tuple[str, bool]:
	text = str(reply_text or "")
	if not text:
		return "", False
	has_flag = bool(GUIDE_NAV_TAG_RE.search(text))
	if not has_flag:
		return text, False
	cleaned = GUIDE_NAV_TAG_RE.sub("", text)
	cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
	return cleaned, True


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
def plan_tutorial_fields(
	doctype: str,
	stage: str = "open_and_fill_basic",
	fields: Any | None = None,
	stock_entry_type_preference: str = "",
) -> Dict[str, Any]:
	"""Plan demo field-fill steps with AI first, then deterministic fallback."""
	field_rows = parse_json_arg(fields or [])
	if not isinstance(field_rows, list):
		field_rows = []
	plan, source = build_tutorial_field_plan(
		doctype=str(doctype or "").strip(),
		stage=str(stage or "").strip().lower() or "open_and_fill_basic",
		fields=field_rows,
		stock_entry_type_preference=str(stock_entry_type_preference or "").strip(),
	)
	return {"ok": True, "plan": plan, "source": source}


@frappe.whitelist()
def get_link_demo_value(doctype: str, hint: str = "", create_if_missing: int | bool = 0) -> Dict[str, Any]:
	"""Return a safe existing record name for Link field demo fill."""
	target_doctype = str(doctype or "").strip()
	if not target_doctype:
		return {"ok": False, "value": "", "created": False}
	if not frappe.db.exists("DocType", target_doctype):
		return {"ok": False, "value": "", "created": False}
	if not frappe.has_permission(target_doctype, "read"):
		return {"ok": False, "value": "", "created": False}

	query = str(hint or "").strip()
	rows: List[Dict[str, Any]] = []
	if query:
		rows = frappe.get_all(
			target_doctype,
			fields=["name"],
			filters={"name": ["like", f"%{query}%"]},
			order_by="modified desc",
			limit=1,
		)
	if not rows:
		rows = frappe.get_all(
			target_doctype,
			fields=["name"],
			order_by="modified desc",
			limit=1,
		)

	value = str(rows[0].get("name") or "").strip() if rows else ""
	if value:
		return {"ok": True, "value": value, "created": False}
	try:
		should_create = bool(int(create_if_missing or 0))
	except Exception:
		should_create = str(create_if_missing or "").strip().lower() in {"1", "true", "yes"}
	if not should_create:
		return {"ok": False, "value": "", "created": False}
	if target_doctype not in DEMO_LINK_AUTOCREATE_ALLOWLIST:
		return {"ok": False, "value": "", "created": False}

	created = _create_demo_link_record(target_doctype, query)
	return {"ok": bool(created), "value": created, "created": bool(created)}


@frappe.whitelist()
def log_tutorial_trace(trace: Any | None = None, level: str = "info") -> Dict[str, Any]:
	"""Persist guided tutorial trace to site logs for debugging stalled cursor flows."""
	raw = parse_json_arg(trace or {})
	if not isinstance(raw, dict):
		return {"ok": False, "trace_id": ""}
	trace_id = str(raw.get("trace_id") or frappe.generate_hash(length=12)).strip()
	payload = sanitize(raw)
	payload["trace_id"] = trace_id
	payload["user"] = str(frappe.session.user or "Guest").strip()
	payload["site"] = str(frappe.local.site or "").strip()
	payload["logged_at"] = frappe.utils.now()
	message = truncate_json(payload, 128)
	level_norm = str(level or "info").strip().lower()

	# Always persist raw trace as JSONL for deterministic post-mortem debugging.
	try:
		line = json.dumps(payload, ensure_ascii=True)
	except Exception:
		line = message
	_append_tutorial_log_line(line)

	# Keep standard logger output too (best-effort).
	try:
		logger = frappe.logger("erpnext_ai_tutor_tutorial", allow_site=True, file_count=20)
		if level_norm in {"warn", "warning"}:
			logger.warning(message)
		elif level_norm == "error":
			logger.error(message)
		else:
			logger.info(message)
	except Exception:
		pass
	return {"ok": True, "trace_id": trace_id}


def _append_tutorial_log_line(line: str) -> None:
	text = str(line or "").strip()
	if not text:
		return
	paths = [Path(frappe.get_site_path("logs", "erpnext_ai_tutor_tutorial.log"))]
	try:
		bench_path = Path(frappe.get_bench_path()) / "logs" / "erpnext_ai_tutor_tutorial.log"
		paths.append(bench_path)
	except Exception:
		pass
	for path in paths:
		try:
			path.parent.mkdir(parents=True, exist_ok=True)
			with path.open("a", encoding="utf-8") as handle:
				handle.write(text + "\n")
		except Exception:
			continue


def _append_chat_diag_log_line(line: str) -> None:
	text = str(line or "").strip()
	if not text:
		return
	paths = [Path(frappe.get_site_path("logs", "erpnext_ai_tutor_chat_diag.log"))]
	try:
		bench_path = Path(frappe.get_bench_path()) / "logs" / "erpnext_ai_tutor_chat_diag.log"
		paths.append(bench_path)
	except Exception:
		pass
	for path in paths:
		try:
			path.parent.mkdir(parents=True, exist_ok=True)
			with path.open("a", encoding="utf-8") as handle:
				handle.write(text + "\n")
		except Exception:
			continue


def _log_chat_diagnostic(
	*,
	phase: str,
	user_message: str,
	ctx: Dict[str, Any] | None,
	response_payload: Dict[str, Any] | None,
	lang: str,
	advanced_mode: bool,
) -> None:
	try:
		payload = response_payload if isinstance(response_payload, dict) else {}
		guide = payload.get("guide") if isinstance(payload.get("guide"), dict) else {}
		tutorial = guide.get("tutorial") if isinstance(guide.get("tutorial"), dict) else {}
		context = ctx if isinstance(ctx, dict) else {}
		entry = {
			"phase": str(phase or "").strip(),
			"logged_at": frappe.utils.now(),
			"user": str(frappe.session.user or "Guest").strip(),
			"site": str(frappe.local.site or "").strip(),
			"lang": str(lang or "").strip(),
			"advanced_mode": bool(advanced_mode),
			"message": str(user_message or "").strip()[:220],
			"context_route": str(context.get("route_str") or "").strip(),
			"has_tutor_state": isinstance(context.get("tutor_state"), dict),
			"ok": bool(payload.get("ok")) if "ok" in payload else None,
			"has_guide": bool(guide),
			"guide_route": str(guide.get("route") or "").strip(),
			"guide_target": str(guide.get("target_label") or "").strip(),
			"tutorial_mode": str(tutorial.get("mode") or "").strip(),
			"tutorial_stage": str(tutorial.get("stage") or "").strip(),
			"auto_guide": bool(payload.get("auto_guide")) if "auto_guide" in payload else False,
		}
		line = json.dumps(entry, ensure_ascii=False)
		_append_chat_diag_log_line(line)
		try:
			frappe.logger("erpnext_ai_tutor_chat_diag", allow_site=True, file_count=20).info(line)
		except Exception:
			pass
	except Exception:
		pass


def _sanitize_demo_token(value: str, *, max_len: int = 16) -> str:
	text = re.sub(r"[^A-Za-z0-9]+", "-", str(value or "").strip()).strip("-")
	if not text:
		text = "DEMO"
	return text[:max_len].upper()


def _ensure_demo_uom() -> str:
	rows = frappe.get_all(
		"UOM",
		fields=["name"],
		filters={"name": ["in", ["Nos", "Unit"]]},
		order_by="modified desc",
		limit=1,
	)
	if rows:
		return str(rows[0].get("name") or "").strip()
	latest = frappe.get_all("UOM", fields=["name"], order_by="modified desc", limit=1)
	if latest:
		return str(latest[0].get("name") or "").strip()
	if not frappe.has_permission("UOM", "create"):
		return ""
	try:
		doc = frappe.new_doc("UOM")
		doc.uom_name = "Nos"
		doc.enabled = 1
		doc.insert()
		return str(doc.name or "").strip()
	except Exception:
		return ""


def _ensure_demo_item_group() -> str:
	rows = frappe.get_all(
		"Item Group",
		fields=["name"],
		filters={"name": ["like", "%All Item Groups%"]},
		order_by="modified desc",
		limit=1,
	)
	if rows:
		return str(rows[0].get("name") or "").strip()
	latest = frappe.get_all("Item Group", fields=["name"], order_by="modified desc", limit=1)
	if latest:
		return str(latest[0].get("name") or "").strip()
	if not frappe.has_permission("Item Group", "create"):
		return ""
	try:
		doc = frappe.new_doc("Item Group")
		doc.item_group_name = "All Item Groups"
		doc.is_group = 1
		doc.insert()
		return str(doc.name or "").strip()
	except Exception:
		return ""


def _create_demo_item(hint: str = "") -> str:
	if not frappe.has_permission("Item", "create"):
		return ""
	item_group = _ensure_demo_item_group()
	stock_uom = _ensure_demo_uom()
	if not item_group or not stock_uom:
		return ""

	token = _sanitize_demo_token(hint or "item")
	item_code = f"AI-{token}"
	if frappe.db.exists("Item", item_code):
		item_code = f"AI-{token}-{frappe.generate_hash(length=5).upper()}"
	try:
		doc = frappe.new_doc("Item")
		doc.item_code = item_code
		doc.item_name = f"AI Demo {token.title()}"
		doc.item_group = item_group
		doc.stock_uom = stock_uom
		doc.is_stock_item = 1
		doc.include_item_in_manufacturing = 1
		doc.insert()
		return str(doc.name or "").strip()
	except Exception:
		return ""


def _create_demo_link_record(doctype: str, hint: str = "") -> str:
	target_doctype = str(doctype or "").strip()
	if target_doctype == "UOM":
		return _ensure_demo_uom()
	if target_doctype == "Item":
		return _create_demo_item(hint)
	return ""


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
		payload: Dict[str, Any] = {"ok": True, "reply": reply_text("greeting", lang=lang, emoji_style=emoji_style)}
		pending_state = ctx.get("tutor_state") if isinstance(ctx, dict) else None
		if isinstance(pending_state, dict) and str(pending_state.get("pending") or "").strip():
			payload["tutor_state"] = None
		return payload

	training_flow = maybe_handle_training_flow(
		user_message,
		ctx,
		lang=lang,
		advanced_mode=advanced_mode,
	)
	if training_flow:
		_log_chat_diagnostic(
			phase="training_flow",
			user_message=user_message,
			ctx=ctx,
			response_payload=training_flow if isinstance(training_flow, dict) else {},
			lang=lang,
			advanced_mode=advanced_mode,
		)
		return training_flow

	nav_plan: Dict[str, Any] = {}
	nav_hint = ""
	pre_nav_candidate = False

	def _guide_from_nav_plan(plan: Dict[str, Any]) -> Dict[str, Any]:
		if not isinstance(plan, dict):
			return {}
		route = str(plan.get("route") or "").strip()
		if not route:
			return {}
		menu_path = plan.get("menu_path")
		if not isinstance(menu_path, list):
			menu_path = []
		menu_path = [str(x).strip() for x in menu_path if str(x or "").strip()]
		target_label = str(plan.get("target_label") or "").strip()
		target_label, menu_path = _apply_guide_route_override(route, target_label, menu_path)
		return {
			"type": "navigation",
			"route": route,
			"target_label": target_label,
			"menu_path": menu_path,
		}

	if advanced_mode:
		# Conservative pre-check only to improve LLM context when user already
		# sounds like they are asking for navigation help.
		pre_nav_candidate = bool(should_offer_navigation_guide(user_message, nav_plan_exists=False))
		if pre_nav_candidate:
			nav_plan = build_navigation_plan(user_message)
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

	if pre_nav_candidate:
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
				"Navigation action flag protocol:\n"
				"Append `[[GUIDE_NAV]]` only when the user asks to find/open/navigate to a "
				"module, workspace, report, DocType, or page in ERPNext.\n"
				"Do not append this flag for greetings, gratitude, small talk, status/chat, "
				"or general explanation questions.\n"
				"If unsure, do not append the flag."
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
		if advanced_mode and pre_nav_candidate and nav_plan:
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

	guide_requested_by_llm = False
	if advanced_mode:
		reply, guide_requested_by_llm = _extract_guide_flag(reply)

	guide: Dict[str, Any] = {}
	if advanced_mode and guide_requested_by_llm:
		if not nav_plan:
			nav_plan = build_navigation_plan(user_message)
		if nav_plan:
			guide = _guide_from_nav_plan(nav_plan)

	result_payload = {"ok": True, "reply": reply or "", "guide": guide}
	_log_chat_diagnostic(
		phase="llm_flow",
		user_message=user_message,
		ctx=ctx,
		response_payload=result_payload,
		lang=lang,
		advanced_mode=advanced_mode,
	)
	return result_payload
