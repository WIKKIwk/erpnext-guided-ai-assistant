from __future__ import annotations

from typing import Any, Dict

from erpnext_ai_tutor.tutor.training_intent import (
	_infer_training_intent_with_ai,
)
from erpnext_ai_tutor.tutor.training_heuristics import (
	_looks_like_practical_tutorial_request,
	_needs_action_clarification,
)
from erpnext_ai_tutor.tutor.training_patterns import (
	ALLOWED_STOCK_ENTRY_TYPES,
	CONTINUE_ACTION_RE,
	CREATE_ACTION_RE,
	SHOW_SAVE_RE,
	normalize_apostrophes as _normalize_apostrophes,
)
from erpnext_ai_tutor.tutor.training_resolution import _resolve_doctype_target
from erpnext_ai_tutor.tutor.training_replies import (
	_action_clarify_reply,
	_continue_tutorial_reply,
	_start_tutorial_reply,
	_target_clarify_reply,
)
from erpnext_ai_tutor.tutor.training_state import (
	_build_guide_payload,
	_build_training_reply,
	_coach_state,
	_extract_state,
)
from erpnext_ai_tutor.tutor.training_targets import (
	_doctype_to_slug,
	_extract_doctype_mention_from_text,
	_extract_stock_entry_type_preference,
	_infer_doctype_from_context,
	_target_from_doctype,
)


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
