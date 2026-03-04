from __future__ import annotations

import json
import re
from typing import Any, Dict, List

from erpnext_ai_tutor.tutor.llm import call_llm
from erpnext_ai_tutor.tutor.navigation import build_navigation_plan
from erpnext_ai_tutor.tutor.training_patterns import (
	ACTION_KEYWORDS_RE,
	AI_TARGET_ALIASES,
	ALLOWED_INTENT_ACTIONS,
	ALLOWED_STOCK_ENTRY_TYPES,
	CONTINUE_ACTION_RE,
	CREATE_ACTION_RE,
	GENERIC_HELP_RE,
	PRACTICAL_TUTORIAL_RE,
	SHOW_SAVE_RE,
	normalize_apostrophes as _normalize_apostrophes,
)
from erpnext_ai_tutor.tutor.training_state import (
	_build_guide_payload,
	_build_training_reply,
	_coach_state,
	_extract_state,
)
from erpnext_ai_tutor.tutor.training_targets import (
	_doctype_from_plan,
	_doctype_from_slug,
	_doctype_to_slug,
	_extract_doctype_mention_from_text,
	_extract_stock_entry_type_preference,
	_infer_doctype_from_context,
	_is_real_doctype,
	_target_from_doctype,
)


def _msg(lang: str, *, uz: str, ru: str, en: str) -> str:
	if lang == "ru":
		return ru
	if lang == "en":
		return en
	return uz


def _extract_json_payload(text: str) -> Any:
	raw = str(text or "").strip()
	if not raw:
		return None
	try:
		return json.loads(raw)
	except Exception:
		pass
	fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw, re.IGNORECASE)
	if fence:
		body = str(fence.group(1) or "").strip()
		if body:
			try:
				return json.loads(body)
			except Exception:
				pass
	obj = re.search(r"\{[\s\S]*\}", raw)
	if obj:
		try:
			return json.loads(obj.group(0))
		except Exception:
			return None
	return None


def _coerce_to_real_doctype(candidate: str) -> str:
	raw = str(candidate or "").strip()
	if not raw:
		return ""

	alias = AI_TARGET_ALIASES.get(raw.lower())
	if alias and _is_real_doctype(alias):
		return alias
	if _is_real_doctype(raw):
		return raw

	doctype = _doctype_from_slug(raw)
	if doctype:
		return doctype

	raw_lower = raw.lower()
	if raw_lower.endswith("s"):
		doctype = _doctype_from_slug(raw_lower[:-1])
		if doctype:
			return doctype

	plan = build_navigation_plan(f"{raw} list")
	if isinstance(plan, dict) and str(plan.get("kind") or "").strip().lower() == "doctype":
		plan_doctype = str(plan.get("doctype") or plan.get("target_label") or "").strip()
		if _is_real_doctype(plan_doctype):
			return plan_doctype
	return ""


def _infer_doctype_with_ai(user_message: str) -> str:
	text = str(user_message or "").strip()
	if not text:
		return ""
	system_msg = (
		"You classify ERPNext training requests.\n"
		"Return strict JSON only with this schema:\n"
		"{\"action\":\"create_record|other\",\"doctype\":\"<canonical DocType name or empty>\",\"confidence\":0.0}\n"
		"Rules:\n"
		"- action=create_record only if user asks to add/create/new/teach creating a record.\n"
		"- doctype must be ERPNext DocType name (English canonical) when clear.\n"
		"- If unclear, set doctype empty and confidence <= 0.4.\n"
		"- Never include prose, markdown, or extra keys."
	)
	try:
		resp = call_llm(
			messages=[
				{"role": "system", "content": system_msg},
				{"role": "user", "content": text},
			],
			max_tokens=220,
		)
	except Exception:
		return ""

	payload = _extract_json_payload(resp)
	if not isinstance(payload, dict):
		return ""
	action = str(payload.get("action") or "").strip().lower()
	if action != "create_record":
		return ""
	try:
		confidence = float(payload.get("confidence") or 0.0)
	except Exception:
		confidence = 0.0
	if confidence < 0.45:
		return ""
	doctype_raw = str(payload.get("doctype") or "").strip()
	return _coerce_to_real_doctype(doctype_raw)


def _infer_training_intent_with_ai(user_message: str, *, has_active_tutorial: bool) -> Dict[str, Any]:
	text = str(user_message or "").strip()
	if not text:
		return {"action": "other", "doctype": "", "confidence": 0.0}

	system_msg = (
		"You classify ERPNext tutor chat intent.\n"
		"Return strict JSON only with this schema:\n"
		"{\"action\":\"create_record|continue|show_save|other\",\"doctype\":\"<DocType or empty>\",\"confidence\":0.0}\n"
		"Rules:\n"
		"- Use semantic intent, not just keywords.\n"
		"- action=create_record when user asks practical teaching/demonstration/filling/new record workflow.\n"
		"- action=continue when user asks to continue next step in an already running tutorial.\n"
		"- action=show_save when user asks where save/submit is.\n"
		"- action=other for plain chat/small talk/non-tutorial questions.\n"
		"- doctype must be canonical ERPNext DocType name if clear, else empty.\n"
		"- If uncertain, confidence <= 0.4.\n"
		"- No prose, no markdown."
	)
	user_payload = {
		"text": text,
		"has_active_tutorial": bool(has_active_tutorial),
	}
	try:
		resp = call_llm(
			messages=[
				{"role": "system", "content": system_msg},
				{"role": "user", "content": json.dumps(user_payload, ensure_ascii=True)},
			],
			max_tokens=220,
		)
	except Exception:
		return {"action": "other", "doctype": "", "confidence": 0.0}

	payload = _extract_json_payload(resp)
	if not isinstance(payload, dict):
		return {"action": "other", "doctype": "", "confidence": 0.0}

	action = str(payload.get("action") or "").strip().lower()
	if action not in ALLOWED_INTENT_ACTIONS:
		action = "other"
	try:
		confidence = float(payload.get("confidence") or 0.0)
	except Exception:
		confidence = 0.0
	doctype = _coerce_to_real_doctype(str(payload.get("doctype") or "").strip())
	if confidence < 0.35:
		action = "other"
		doctype = ""
	return {"action": action, "doctype": doctype, "confidence": confidence}


def _resolve_doctype_target(
	user_message: str,
	ctx: Dict[str, Any],
	fallback_doctype: str = "",
	*,
	allow_context_fallback: bool = True,
) -> Dict[str, Any]:
	# Highest priority: explicit doctype mention in user sentence.
	explicit_doctype = _extract_doctype_mention_from_text(user_message)
	target = _target_from_doctype(explicit_doctype)
	if target:
		return target

	plan = build_navigation_plan(user_message)
	target = _doctype_from_plan(plan)
	if target:
		return target

	# AI-based target inference as a smart fallback when deterministic
	# navigation parsing cannot map the user's phrase to a doctype.
	ai_doctype = _infer_doctype_with_ai(user_message)
	target = _target_from_doctype(ai_doctype)
	if target:
		return target

	# Deterministic list-oriented second pass (kept after AI because this pass
	# can overfit to unrelated "list" doctypes for some natural-language inputs).
	forced_plan = build_navigation_plan(f"{user_message} list")
	target = _doctype_from_plan(forced_plan)
	if target:
		return target

	kind = str(plan.get("kind") or "").strip().lower() if isinstance(plan, dict) else ""
	forced_kind = str(forced_plan.get("kind") or "").strip().lower() if isinstance(forced_plan, dict) else ""
	explicit_nav_target = kind in {"doctype", "module", "workspace"} or forced_kind in {"doctype", "module", "workspace"}

	if allow_context_fallback and not explicit_nav_target:
		context_doctype = _infer_doctype_from_context(ctx)
		target = _target_from_doctype(context_doctype)
		if target:
			return target

	fallback = str(fallback_doctype or "").strip()
	target = _target_from_doctype(fallback)
	if target:
		return target

	return {}


def _action_clarify_reply(lang: str) -> str:
	return _msg(
		lang,
		uz=(
			"Albatta. Qaysi harakatni ko'rsatib beray?\n"
			"Masalan: yangi Item qo'shish, yangi Sales Invoice yaratish, yoki boshqa Doctype ochish."
		),
		ru=(
			"Конечно. Какое действие показать?\n"
			"Например: создать новый Item, создать Sales Invoice или открыть другой DocType."
		),
		en=(
			"Sure. Which action should I demonstrate?\n"
			"For example: create a new Item, create a Sales Invoice, or open another DocType."
		),
	)


def _target_clarify_reply(lang: str) -> str:
	return _msg(
		lang,
		uz="Tayyorman. Qaysi DocType uchun yangi yozuv yaratamiz? (masalan: Item, Customer, Sales Invoice)",
		ru="Готово. Для какого DocType создаём новую запись? (например: Item, Customer, Sales Invoice)",
		en="Ready. For which DocType should we create a new record? (e.g., Item, Customer, Sales Invoice)",
	)


def _start_tutorial_reply(lang: str, doctype: str) -> str:
	return _msg(
		lang,
		uz=(
			f"Zo'r, endi **{doctype}** bo'yicha amaliy ko'rsataman: ro'yxatni ochamiz, `Add/New` ni bosamiz "
			"va asosiy maydonlarni demo tarzda to'ldiramiz. Xavfsizlik uchun `Save/Submit` ni avtomatik bosmayman."
		),
		ru=(
			f"Отлично, сейчас покажу практический сценарий для **{doctype}**: откроем список, нажмём `Add/New` "
			"и заполним базовые поля в демо-режиме. Из соображений безопасности `Save/Submit` автоматически не нажимаю."
		),
		en=(
			f"Great, I will walk you through **{doctype}**: open the list, click `Add/New`, and fill key fields in demo mode. "
			"For safety, I will not click `Save/Submit` automatically."
		),
	)


def _continue_tutorial_reply(lang: str, doctype: str, stage: str) -> str:
	if stage == "show_save_only":
		return _msg(
			lang,
			uz=f"Tushunarli. **{doctype}** formasida `Save/Submit` joyini ko'rsataman, lekin uni bosmayman.",
			ru=f"Понял. На форме **{doctype}** покажу, где находится `Save/Submit`, но нажимать не буду.",
			en=f"Understood. On the **{doctype}** form, I will show where `Save/Submit` is, but I will not click it.",
		)
	return _msg(
		lang,
		uz=f"Mayli, **{doctype}** bo'yicha keyingi bosqichni davom ettiraman va qo'shimcha maydonlarni to'ldirib ko'rsataman.",
		ru=f"Хорошо, продолжаю следующий шаг по **{doctype}** и покажу заполнение дополнительных полей.",
		en=f"Alright, I will continue the next **{doctype}** step and demonstrate filling additional fields.",
	)


def _needs_action_clarification(user_message: str) -> bool:
	text = _normalize_apostrophes(str(user_message or "")).strip()
	if len(text) > 140:
		return False
	if CREATE_ACTION_RE.search(text):
		return False
	return bool(GENERIC_HELP_RE.search(text)) and not bool(ACTION_KEYWORDS_RE.search(text))


def _looks_like_practical_tutorial_request(user_message: str) -> bool:
	"""Heuristic fallback when LLM intent classifier is uncertain."""
	text = _normalize_apostrophes(str(user_message or "")).strip()
	if not text:
		return False
	if PRACTICAL_TUTORIAL_RE.search(text):
		return True
	# "qanday + create/add/new" style requests should be treated as tutorial asks.
	if GENERIC_HELP_RE.search(text) and CREATE_ACTION_RE.search(text):
		return True
	return False


def maybe_handle_training_flow(
	user_message: str,
	ctx: Dict[str, Any],
	*,
	lang: str,
	advanced_mode: bool,
) -> Dict[str, Any] | None:
	"""Deterministic coach flow for practical create-record teaching."""
	if not advanced_mode:
		return None

	text = str(user_message or "").strip()
	if not text:
		return None

	text_rules = _normalize_apostrophes(text)
	state = _extract_state(ctx)
	pending = str(state.get("pending") or "")
	state_doctype = str(state.get("doctype") or "")
	state_action = str(state.get("action") or "")
	state_stock_type = str(state.get("stock_entry_type_preference") or "")
	context_doctype = _infer_doctype_from_context(ctx)
	intent = _infer_training_intent_with_ai(text, has_active_tutorial=bool(state_action and state_doctype))
	intent_action = str(intent.get("action") or "other").strip().lower()
	intent_doctype = str(intent.get("doctype") or "").strip()
	practical_tutorial_requested = _looks_like_practical_tutorial_request(text_rules)
	create_requested = bool(CREATE_ACTION_RE.search(text_rules)) or practical_tutorial_requested or intent_action == "create_record"
	continue_requested = bool(CONTINUE_ACTION_RE.search(text_rules)) or intent_action == "continue"
	show_save_requested = bool(SHOW_SAVE_RE.search(text_rules)) or intent_action == "show_save"
	explicit_mention_doctype = _extract_doctype_mention_from_text(text_rules)
	explicit_target = _target_from_doctype(explicit_mention_doctype)
	explicit_doctype = str(explicit_target.get("doctype") or "").strip()
	requested_stock_type = _extract_stock_entry_type_preference(
		text_rules,
		explicit_doctype or state_doctype or intent_doctype,
	)

	# When a tutorial is already active, "to'ldir / o'rgat" style follow-ups
	# should continue the same guided flow unless user explicitly switches target.
	if state_action == "create_record" and state_doctype and practical_tutorial_requested and not explicit_doctype and not show_save_requested:
		continue_requested = True

	def _resolve_training_target(*, allow_context_fallback: bool, fallback_doctype: str = "") -> Dict[str, Any]:
		# User's direct doctype mention always wins over inferred intent.
		if explicit_target:
			return explicit_target
		context_target = _target_from_doctype(context_doctype) if context_doctype else {}
		intent_target: Dict[str, Any] = {}
		context_vs_state_mismatch = (
			bool(context_target)
			and bool(state_action == "create_record")
			and bool(state_doctype)
			and str(context_doctype or "").strip().lower() != str(state_doctype or "").strip().lower()
		)
		# Active tutorial holatida (state bor) va user yangi doctype'ni aniq aytmagan bo'lsa,
		# joriy sahifa doctype'i stale state/intentiondan ustun turadi.
		if context_vs_state_mismatch and not explicit_doctype:
			return context_target
		if intent_doctype:
			intent_target = _resolve_doctype_target(intent_doctype, ctx, allow_context_fallback=False)
			if intent_target:
				intent_dt = str(intent_target.get("doctype") or "").strip().lower()
				context_dt = str(context_doctype or "").strip().lower()
				# Generic "davom et / qolganini to'ldir" so'rovlarda joriy form doctype
				# oldingi yoki xato intentdan ustun turishi kerak.
				if (
					context_target
					and not explicit_doctype
					and intent_dt
					and context_dt
					and intent_dt != context_dt
					and (continue_requested or show_save_requested or practical_tutorial_requested)
				):
					return context_target
				return intent_target
		if context_target and not explicit_doctype and (continue_requested or show_save_requested):
			return context_target
		return _resolve_doctype_target(
			text_rules,
			ctx,
			fallback_doctype=fallback_doctype,
			allow_context_fallback=allow_context_fallback,
		)

	def _pick_stock_entry_type(doctype_name: str) -> str:
		if str(doctype_name or "").strip().lower() != "stock entry":
			return ""
		if requested_stock_type:
			return requested_stock_type
		if state_stock_type in ALLOWED_STOCK_ENTRY_TYPES:
			return state_stock_type
		return ""

	if pending == "action":
		target = _resolve_training_target(allow_context_fallback=False, fallback_doctype=state_doctype)
		if target:
			doctype = str(target.get("doctype") or "").strip()
			reply = _start_tutorial_reply(lang, doctype)
			guide = _build_guide_payload(
				doctype=doctype,
				route=str(target.get("route") or ""),
				menu_path=target.get("menu_path") or [],
				stage="open_and_fill_basic",
				stock_entry_type_preference=_pick_stock_entry_type(doctype),
			)
			return _build_training_reply(
				reply=reply,
				guide=guide,
				tutor_state=_coach_state(
					doctype,
					"open_and_fill_basic",
					stock_entry_type_preference=_pick_stock_entry_type(doctype),
				),
			)
		if create_requested:
			target = _resolve_training_target(allow_context_fallback=True, fallback_doctype=state_doctype)
			if target:
				doctype = str(target.get("doctype") or "").strip()
				reply = _start_tutorial_reply(lang, doctype)
				guide = _build_guide_payload(
					doctype=doctype,
					route=str(target.get("route") or ""),
					menu_path=target.get("menu_path") or [],
					stage="open_and_fill_basic",
					stock_entry_type_preference=_pick_stock_entry_type(doctype),
				)
				return _build_training_reply(
					reply=reply,
					guide=guide,
					tutor_state=_coach_state(
						doctype,
						"open_and_fill_basic",
						stock_entry_type_preference=_pick_stock_entry_type(doctype),
					),
				)
			return _build_training_reply(
				reply=_target_clarify_reply(lang),
				tutor_state={"pending": "target", "action": "create_record", "stage": "open_and_fill_basic"},
			)
		return _build_training_reply(reply=_action_clarify_reply(lang), tutor_state={"pending": "action"})

	if pending == "target":
		target = _resolve_training_target(allow_context_fallback=False, fallback_doctype=state_doctype)
		if not target and create_requested:
			target = _resolve_training_target(allow_context_fallback=True, fallback_doctype=state_doctype)
		if not target:
			return _build_training_reply(
				reply=_target_clarify_reply(lang),
				tutor_state={"pending": "target", "action": "create_record", "stage": "open_and_fill_basic"},
			)
		doctype = str(target.get("doctype") or "").strip()
		reply = _start_tutorial_reply(lang, doctype)
		guide = _build_guide_payload(
			doctype=doctype,
			route=str(target.get("route") or ""),
			menu_path=target.get("menu_path") or [],
			stage="open_and_fill_basic",
			stock_entry_type_preference=_pick_stock_entry_type(doctype),
		)
		return _build_training_reply(
			reply=reply,
			guide=guide,
			tutor_state=_coach_state(
				doctype,
				"open_and_fill_basic",
				stock_entry_type_preference=_pick_stock_entry_type(doctype),
			),
		)

	if state_action == "create_record" and state_doctype and (continue_requested or show_save_requested):
		if create_requested and explicit_doctype and explicit_doctype.lower() != state_doctype.lower():
			continue_requested = False
			show_save_requested = False
		else:
			stage = "show_save_only" if show_save_requested else "fill_more"
			effective_state_doctype = state_doctype
			if (
				context_doctype
				and not explicit_doctype
				and str(context_doctype).strip().lower() != str(state_doctype).strip().lower()
			):
				effective_state_doctype = str(context_doctype).strip()
			target = _resolve_doctype_target(
				effective_state_doctype,
				ctx,
				fallback_doctype=effective_state_doctype,
			)
			doctype = str(target.get("doctype") or effective_state_doctype).strip()
			route = str(target.get("route") or f"/app/{_doctype_to_slug(doctype)}")
			menu_path = target.get("menu_path") or [doctype]
			reply = _continue_tutorial_reply(lang, doctype, stage)
			guide = _build_guide_payload(
				doctype=doctype,
				route=route,
				menu_path=menu_path,
				stage=stage,
				stock_entry_type_preference=_pick_stock_entry_type(doctype),
			)
			return _build_training_reply(
				reply=reply,
				guide=guide,
				tutor_state=_coach_state(
					doctype,
					stage,
					stock_entry_type_preference=_pick_stock_entry_type(doctype),
				),
			)

	if create_requested or intent_doctype:
		target = _resolve_training_target(allow_context_fallback=True, fallback_doctype=state_doctype)
		if not target:
			return _build_training_reply(
				reply=_target_clarify_reply(lang),
				tutor_state={"pending": "target", "action": "create_record", "stage": "open_and_fill_basic"},
			)
		doctype = str(target.get("doctype") or "").strip()
		reply = _start_tutorial_reply(lang, doctype)
		guide = _build_guide_payload(
			doctype=doctype,
			route=str(target.get("route") or ""),
			menu_path=target.get("menu_path") or [],
			stage="open_and_fill_basic",
			stock_entry_type_preference=_pick_stock_entry_type(doctype),
		)
		return _build_training_reply(
			reply=reply,
			guide=guide,
			tutor_state=_coach_state(
				doctype,
				"open_and_fill_basic",
				stock_entry_type_preference=_pick_stock_entry_type(doctype),
			),
		)

	if _needs_action_clarification(text_rules):
		return _build_training_reply(reply=_action_clarify_reply(lang), tutor_state={"pending": "action"})

	return None
