from __future__ import annotations

from typing import Any, Dict, List

from erpnext_ai_tutor.tutor.training_patterns import (
	ALLOWED_PENDING,
	ALLOWED_STAGES,
	ALLOWED_STOCK_ENTRY_TYPES,
)
from erpnext_ai_tutor.tutor.training_targets import _normalize_menu_path


def _extract_state(ctx: Dict[str, Any]) -> Dict[str, Any]:
	state_raw = ctx.get("tutor_state") if isinstance(ctx, dict) else None
	if not isinstance(state_raw, dict):
		return {}
	pending = str(state_raw.get("pending") or "").strip().lower()
	if pending not in ALLOWED_PENDING:
		pending = ""
	stage = str(state_raw.get("stage") or "").strip().lower()
	if stage not in ALLOWED_STAGES:
		stage = "open_and_fill_basic"
	doctype = str(state_raw.get("doctype") or "").strip()
	action = str(state_raw.get("action") or "").strip().lower()
	if action != "create_record":
		action = ""
	stock_entry_type_preference = str(state_raw.get("stock_entry_type_preference") or "").strip()
	if stock_entry_type_preference not in ALLOWED_STOCK_ENTRY_TYPES:
		stock_entry_type_preference = ""
	return {
		"pending": pending,
		"stage": stage,
		"doctype": doctype,
		"action": action,
		"stock_entry_type_preference": stock_entry_type_preference,
	}


def _build_guide_payload(
	doctype: str,
	route: str,
	menu_path: List[str],
	stage: str,
	stock_entry_type_preference: str = "",
) -> Dict[str, Any]:
	clean_stage = stage if stage in ALLOWED_STAGES else "open_and_fill_basic"
	tutorial: Dict[str, Any] = {
		"mode": "create_record",
		"stage": clean_stage,
		"doctype": doctype,
	}
	if str(doctype or "").strip().lower() == "stock entry":
		pref = str(stock_entry_type_preference or "").strip()
		if pref in ALLOWED_STOCK_ENTRY_TYPES:
			tutorial["stock_entry_type_preference"] = pref
	return {
		"type": "navigation",
		"route": str(route or "").strip(),
		"target_label": doctype,
		"menu_path": _normalize_menu_path(menu_path, doctype),
		"tutorial": tutorial,
	}


def _coach_state(
	doctype: str,
	stage: str,
	pending: str = "",
	stock_entry_type_preference: str = "",
) -> Dict[str, Any]:
	state = {
		"action": "create_record",
		"doctype": str(doctype or "").strip(),
		"stage": stage if stage in ALLOWED_STAGES else "open_and_fill_basic",
		"pending": pending if pending in ALLOWED_PENDING else "",
	}
	pref = str(stock_entry_type_preference or "").strip()
	if str(doctype or "").strip().lower() == "stock entry" and pref in ALLOWED_STOCK_ENTRY_TYPES:
		state["stock_entry_type_preference"] = pref
	return state


def _build_training_reply(
	*,
	reply: str,
	tutor_state: Dict[str, Any] | None = None,
	guide: Dict[str, Any] | None = None,
	auto_guide: bool = True,
) -> Dict[str, Any]:
	payload: Dict[str, Any] = {"ok": True, "reply": str(reply or "").strip()}
	if guide:
		payload["guide"] = guide
		payload["auto_guide"] = bool(auto_guide)
	if tutor_state is not None:
		payload["tutor_state"] = tutor_state
	return payload
