from __future__ import annotations

from functools import partial
from typing import Any, Dict

from erpnext_ai_tutor.tutor.training_handlers import (
	_handle_active_continue,
	_handle_create_or_intent,
	_handle_manage_roles_intent,
	_handle_pending_action,
	_handle_pending_target,
)
from erpnext_ai_tutor.tutor.training_context import _build_training_context
from erpnext_ai_tutor.tutor.training_runtime import (
	_pick_stock_entry_type,
	_resolve_training_target as _resolve_training_target_runtime,
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

	training_ctx = _build_training_context(text, ctx)
	text_rules = str(training_ctx.get("text_rules") or "")
	pending = str(training_ctx.get("pending") or "")
	state_doctype = str(training_ctx.get("state_doctype") or "")
	state_action = str(training_ctx.get("state_action") or "")
	state_stock_type = str(training_ctx.get("state_stock_type") or "")
	context_doctype = str(training_ctx.get("context_doctype") or "")
	intent_doctype = str(training_ctx.get("intent_doctype") or "")
	create_requested = bool(training_ctx.get("create_requested"))
	continue_requested = bool(training_ctx.get("continue_requested"))
	show_save_requested = bool(training_ctx.get("show_save_requested"))
	manage_roles_requested = bool(training_ctx.get("manage_roles_requested"))
	dependency_create_requested = bool(training_ctx.get("dependency_create_requested"))
	explicit_target = training_ctx.get("explicit_target") if isinstance(training_ctx.get("explicit_target"), dict) else {}
	explicit_doctype = str(training_ctx.get("explicit_doctype") or "")
	practical_tutorial_requested = bool(training_ctx.get("practical_tutorial_requested"))
	requested_stock_type = str(training_ctx.get("requested_stock_type") or "")

	resolve_training_target = partial(
		_resolve_training_target_runtime,
		explicit_target=explicit_target,
		context_doctype=context_doctype,
		state_action=state_action,
		state_doctype=state_doctype,
		explicit_doctype=explicit_doctype,
		intent_doctype=intent_doctype,
		create_requested=create_requested,
		continue_requested=continue_requested,
		show_save_requested=show_save_requested,
		practical_tutorial_requested=practical_tutorial_requested,
		text_rules=text_rules,
		ctx=ctx,
	)
	pick_stock_entry_type = partial(
		_pick_stock_entry_type,
		requested_stock_type=requested_stock_type,
		state_stock_type=state_stock_type,
	)

	manage_roles_reply = _handle_manage_roles_intent(
		lang=lang,
		manage_roles_requested=manage_roles_requested,
		state_doctype=state_doctype,
		context_doctype=context_doctype,
		intent_doctype=intent_doctype,
	)
	if manage_roles_reply is not None:
		return manage_roles_reply

	if pending == "action":
		return _handle_pending_action(
			lang=lang,
			state_doctype=state_doctype,
			create_requested=create_requested,
			resolve_training_target=resolve_training_target,
			pick_stock_entry_type=pick_stock_entry_type,
		)

	if pending == "target":
		return _handle_pending_target(
			lang=lang,
			state_doctype=state_doctype,
			create_requested=create_requested,
			resolve_training_target=resolve_training_target,
			pick_stock_entry_type=pick_stock_entry_type,
		)

	continue_flow_reply = _handle_active_continue(
		lang=lang,
		ctx=ctx,
		state_action=state_action,
		state_doctype=state_doctype,
		context_doctype=context_doctype,
		continue_requested=continue_requested,
		show_save_requested=show_save_requested,
		dependency_create_requested=dependency_create_requested,
		create_requested=create_requested,
		explicit_doctype=explicit_doctype,
		pick_stock_entry_type=pick_stock_entry_type,
	)
	if continue_flow_reply is not None:
		return continue_flow_reply

	create_or_intent_reply = _handle_create_or_intent(
		lang=lang,
		state_doctype=state_doctype,
		create_requested=create_requested,
		resolve_training_target=resolve_training_target,
		pick_stock_entry_type=pick_stock_entry_type,
	)
	if create_or_intent_reply is not None:
		return create_or_intent_reply

	return None
