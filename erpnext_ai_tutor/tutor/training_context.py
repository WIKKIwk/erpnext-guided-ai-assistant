from __future__ import annotations

from typing import Any, Dict

from erpnext_ai_tutor.tutor.training_intent import _infer_training_intent_with_ai
from erpnext_ai_tutor.tutor.training_patterns import (
	MANAGE_ROLES_RE,
	normalize_apostrophes as _normalize_apostrophes,
)
from erpnext_ai_tutor.tutor.training_state import _extract_state
from erpnext_ai_tutor.tutor.training_targets import (
	_extract_doctype_mention_from_text,
	_extract_stock_entry_type_preference,
	_infer_doctype_from_context,
	_target_from_doctype,
)


def _build_training_context(user_message: str, ctx: Dict[str, Any]) -> Dict[str, Any]:
	text = str(user_message or "").strip()
	text_rules = _normalize_apostrophes(text)
	state = _extract_state(ctx)
	pending = str(state.get("pending") or "")
	state_doctype = str(state.get("doctype") or "")
	state_action = str(state.get("action") or "")
	state_stock_type = str(state.get("stock_entry_type_preference") or "")
	state_allow_dependency_creation = bool(state.get("allow_dependency_creation"))
	context_doctype = _infer_doctype_from_context(ctx)
	intent = _infer_training_intent_with_ai(text, has_active_tutorial=bool(state_action and state_doctype))
	intent_action = str(intent.get("action") or "other").strip().lower()
	intent_doctype = str(intent.get("doctype") or "").strip()
	intent_allow_dependency_creation = bool(intent.get("allow_dependency_creation"))
	create_requested = intent_action == "create_record"
	continue_requested = intent_action == "continue"
	show_save_requested = intent_action == "show_save"
	manage_roles_requested = intent_action == "manage_roles"
	practical_tutorial_requested = intent_action in {"create_record", "continue"}
	manage_roles_hint = bool(MANAGE_ROLES_RE.search(text_rules))
	if manage_roles_hint:
		# Guardrail: explicit role/permission requests must switch away from create-flow continuation.
		manage_roles_requested = True
		create_requested = False
		continue_requested = False
		show_save_requested = False
		practical_tutorial_requested = False
		if not intent_doctype:
			intent_doctype = "User"
	dependency_create_requested = bool(
		state_action == "create_record"
		and not show_save_requested
		and (continue_requested or practical_tutorial_requested)
		and (intent_allow_dependency_creation or (state_allow_dependency_creation and continue_requested))
	)
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

	return {
		"text_rules": text_rules,
		"pending": pending,
		"state_doctype": state_doctype,
		"state_action": state_action,
		"state_stock_type": state_stock_type,
		"context_doctype": context_doctype,
		"intent_doctype": intent_doctype,
		"create_requested": create_requested,
		"continue_requested": continue_requested,
		"show_save_requested": show_save_requested,
		"manage_roles_requested": manage_roles_requested,
		"dependency_create_requested": dependency_create_requested,
		"explicit_target": explicit_target,
		"explicit_doctype": explicit_doctype,
		"practical_tutorial_requested": practical_tutorial_requested,
		"requested_stock_type": requested_stock_type,
	}
