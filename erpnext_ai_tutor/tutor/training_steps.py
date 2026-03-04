from __future__ import annotations

from typing import Any, Dict, List

from erpnext_ai_tutor.tutor.training_replies import (
	_continue_tutorial_reply,
	_start_tutorial_reply,
)
from erpnext_ai_tutor.tutor.training_state import (
	_build_guide_payload,
	_build_training_reply,
	_coach_state,
)


def _build_start_step_response(
	*,
	lang: str,
	doctype: str,
	route: str,
	menu_path: List[str],
	stock_entry_type_preference: str = "",
	allow_dependency_creation: bool = False,
	field_overrides: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
	reply = _start_tutorial_reply(lang, doctype)
	guide = _build_guide_payload(
		doctype=doctype,
		route=route,
		menu_path=menu_path,
		stage="open_and_fill_basic",
		stock_entry_type_preference=stock_entry_type_preference,
		allow_dependency_creation=allow_dependency_creation,
		field_overrides=field_overrides if isinstance(field_overrides, dict) else None,
	)
	return _build_training_reply(
		reply=reply,
		guide=guide,
		tutor_state=_coach_state(
			doctype,
			"open_and_fill_basic",
			stock_entry_type_preference=stock_entry_type_preference,
			allow_dependency_creation=allow_dependency_creation,
		),
	)


def _build_continue_step_response(
	*,
	lang: str,
	doctype: str,
	stage: str,
	route: str,
	menu_path: List[str],
	stock_entry_type_preference: str = "",
	allow_dependency_creation: bool = False,
	field_overrides: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
	reply = _continue_tutorial_reply(lang, doctype, stage)
	guide = _build_guide_payload(
		doctype=doctype,
		route=route,
		menu_path=menu_path,
		stage=stage,
		stock_entry_type_preference=stock_entry_type_preference,
		allow_dependency_creation=allow_dependency_creation,
		field_overrides=field_overrides if isinstance(field_overrides, dict) else None,
	)
	return _build_training_reply(
		reply=reply,
		guide=guide,
		tutor_state=_coach_state(
			doctype,
			stage,
			stock_entry_type_preference=stock_entry_type_preference,
			allow_dependency_creation=allow_dependency_creation,
		),
	)
