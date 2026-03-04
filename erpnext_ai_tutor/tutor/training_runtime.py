from __future__ import annotations

from typing import Any, Dict

from erpnext_ai_tutor.tutor.training_patterns import ALLOWED_STOCK_ENTRY_TYPES
from erpnext_ai_tutor.tutor.training_resolution import _resolve_doctype_target
from erpnext_ai_tutor.tutor.training_targets import _target_from_doctype


def _resolve_training_target(
	*,
	explicit_target: Dict[str, Any],
	context_doctype: str,
	state_action: str,
	state_doctype: str,
	explicit_doctype: str,
	intent_doctype: str,
	continue_requested: bool,
	show_save_requested: bool,
	practical_tutorial_requested: bool,
	text_rules: str,
	ctx: Dict[str, Any],
	allow_context_fallback: bool,
	fallback_doctype: str = "",
) -> Dict[str, Any]:
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


def _pick_stock_entry_type(
	doctype_name: str,
	*,
	requested_stock_type: str,
	state_stock_type: str,
) -> str:
	if str(doctype_name or "").strip().lower() != "stock entry":
		return ""
	if requested_stock_type:
		return requested_stock_type
	if state_stock_type in ALLOWED_STOCK_ENTRY_TYPES:
		return state_stock_type
	return ""
