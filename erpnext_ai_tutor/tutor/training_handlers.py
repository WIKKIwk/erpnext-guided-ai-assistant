from __future__ import annotations

from typing import Any, Callable, Dict

from erpnext_ai_tutor.tutor.training_replies import (
	_action_clarify_reply,
	_target_clarify_reply,
)
from erpnext_ai_tutor.tutor.training_resolution import _resolve_doctype_target
from erpnext_ai_tutor.tutor.training_state import _build_training_reply
from erpnext_ai_tutor.tutor.training_steps import (
	_build_continue_step_response,
	_build_start_step_response,
)
from erpnext_ai_tutor.tutor.training_targets import _doctype_to_slug


def _handle_pending_action(
	*,
	lang: str,
	state_doctype: str,
	create_requested: bool,
	resolve_training_target: Callable[..., Dict[str, Any]],
	pick_stock_entry_type: Callable[[str], str],
) -> Dict[str, Any]:
	target = resolve_training_target(allow_context_fallback=False, fallback_doctype=state_doctype)
	if target:
		doctype = str(target.get("doctype") or "").strip()
		return _build_start_step_response(
			lang=lang,
			doctype=doctype,
			route=str(target.get("route") or ""),
			menu_path=target.get("menu_path") or [],
			stock_entry_type_preference=pick_stock_entry_type(doctype),
		)

	if create_requested:
		target = resolve_training_target(allow_context_fallback=True, fallback_doctype=state_doctype)
		if target:
			doctype = str(target.get("doctype") or "").strip()
			return _build_start_step_response(
				lang=lang,
				doctype=doctype,
				route=str(target.get("route") or ""),
				menu_path=target.get("menu_path") or [],
				stock_entry_type_preference=pick_stock_entry_type(doctype),
			)
		return _build_training_reply(
			reply=_target_clarify_reply(lang),
			tutor_state={"pending": "target", "action": "create_record", "stage": "open_and_fill_basic"},
		)

	return _build_training_reply(reply=_action_clarify_reply(lang), tutor_state={"pending": "action"})


def _handle_pending_target(
	*,
	lang: str,
	state_doctype: str,
	create_requested: bool,
	resolve_training_target: Callable[..., Dict[str, Any]],
	pick_stock_entry_type: Callable[[str], str],
) -> Dict[str, Any]:
	target = resolve_training_target(allow_context_fallback=False, fallback_doctype=state_doctype)
	if not target and create_requested:
		target = resolve_training_target(allow_context_fallback=True, fallback_doctype=state_doctype)
	if not target:
		return _build_training_reply(
			reply=_target_clarify_reply(lang),
			tutor_state={"pending": "target", "action": "create_record", "stage": "open_and_fill_basic"},
		)

	doctype = str(target.get("doctype") or "").strip()
	return _build_start_step_response(
		lang=lang,
		doctype=doctype,
		route=str(target.get("route") or ""),
		menu_path=target.get("menu_path") or [],
		stock_entry_type_preference=pick_stock_entry_type(doctype),
	)


def _handle_active_continue(
	*,
	lang: str,
	ctx: Dict[str, Any],
	state_action: str,
	state_doctype: str,
	context_doctype: str,
	continue_requested: bool,
	show_save_requested: bool,
	create_requested: bool,
	explicit_doctype: str,
	pick_stock_entry_type: Callable[[str], str],
) -> Dict[str, Any] | None:
	if not (state_action == "create_record" and state_doctype and (continue_requested or show_save_requested)):
		return None

	if create_requested and explicit_doctype and explicit_doctype.lower() != state_doctype.lower():
		return None

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
	return _build_continue_step_response(
		lang=lang,
		doctype=doctype,
		stage=stage,
		route=route,
		menu_path=menu_path,
		stock_entry_type_preference=pick_stock_entry_type(doctype),
	)


def _handle_create_or_intent(
	*,
	lang: str,
	state_doctype: str,
	create_requested: bool,
	intent_doctype: str,
	resolve_training_target: Callable[..., Dict[str, Any]],
	pick_stock_entry_type: Callable[[str], str],
) -> Dict[str, Any] | None:
	if not (create_requested or intent_doctype):
		return None

	target = resolve_training_target(allow_context_fallback=True, fallback_doctype=state_doctype)
	if not target:
		return _build_training_reply(
			reply=_target_clarify_reply(lang),
			tutor_state={"pending": "target", "action": "create_record", "stage": "open_and_fill_basic"},
		)

	doctype = str(target.get("doctype") or "").strip()
	return _build_start_step_response(
		lang=lang,
		doctype=doctype,
		route=str(target.get("route") or ""),
		menu_path=target.get("menu_path") or [],
		stock_entry_type_preference=pick_stock_entry_type(doctype),
	)
