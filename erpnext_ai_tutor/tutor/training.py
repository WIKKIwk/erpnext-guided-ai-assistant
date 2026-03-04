from __future__ import annotations

from typing import Any, Dict

from erpnext_ai_tutor.tutor.training_intent import (
	_infer_training_intent_with_ai,
)
from erpnext_ai_tutor.tutor.training_heuristics import (
	_looks_like_practical_tutorial_request,
	_needs_action_clarification,
)
from erpnext_ai_tutor.tutor.training_handlers import (
	_handle_active_continue,
	_handle_create_or_intent,
	_handle_pending_action,
	_handle_pending_target,
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
)
from erpnext_ai_tutor.tutor.training_state import (
	_build_training_reply,
	_extract_state,
)
from erpnext_ai_tutor.tutor.training_targets import (
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
		return _handle_pending_action(
			lang=lang,
			state_doctype=state_doctype,
			create_requested=create_requested,
			resolve_training_target=_resolve_training_target,
			pick_stock_entry_type=_pick_stock_entry_type,
		)

	if pending == "target":
		return _handle_pending_target(
			lang=lang,
			state_doctype=state_doctype,
			create_requested=create_requested,
			resolve_training_target=_resolve_training_target,
			pick_stock_entry_type=_pick_stock_entry_type,
		)

	continue_flow_reply = _handle_active_continue(
		lang=lang,
		ctx=ctx,
		state_action=state_action,
		state_doctype=state_doctype,
		context_doctype=context_doctype,
		continue_requested=continue_requested,
		show_save_requested=show_save_requested,
		create_requested=create_requested,
		explicit_doctype=explicit_doctype,
		pick_stock_entry_type=_pick_stock_entry_type,
	)
	if continue_flow_reply is not None:
		return continue_flow_reply

	create_or_intent_reply = _handle_create_or_intent(
		lang=lang,
		state_doctype=state_doctype,
		create_requested=create_requested,
		intent_doctype=intent_doctype,
		resolve_training_target=_resolve_training_target,
		pick_stock_entry_type=_pick_stock_entry_type,
	)
	if create_or_intent_reply is not None:
		return create_or_intent_reply

	if _needs_action_clarification(text_rules):
		return _build_training_reply(reply=_action_clarify_reply(lang), tutor_state={"pending": "action"})

	return None
