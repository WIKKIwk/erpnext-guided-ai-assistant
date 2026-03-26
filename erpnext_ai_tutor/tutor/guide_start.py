from __future__ import annotations

from typing import Any, Dict, List

from erpnext_ai_tutor.tutor.training_handlers import _handle_manage_roles_intent
from erpnext_ai_tutor.tutor.training_state import _build_training_reply, _normalize_menu_path
from erpnext_ai_tutor.tutor.training_steps import _build_start_step_response
from erpnext_ai_tutor.tutor.ui import extract_primary_action_label


def _normalize_offer(raw_offer: Any) -> Dict[str, Any]:
	if not isinstance(raw_offer, dict):
		return {}
	show = raw_offer.get("show") is True
	target_label = str(raw_offer.get("target_label") or "").strip()
	route = str(raw_offer.get("route") or "").strip()
	mode = str(raw_offer.get("mode") or "").strip().lower()
	menu_path_raw = raw_offer.get("menu_path")
	menu_path: List[str] = []
	if isinstance(menu_path_raw, list):
		menu_path = [str(x).strip() for x in menu_path_raw if str(x or "").strip()]
	if not show or not target_label or not route.startswith("/app/"):
		return {}
	if mode not in {"create_record", "manage_roles", "navigate"}:
		return {}
	return {
		"show": True,
		"target_label": target_label,
		"route": route,
		"mode": mode,
		"menu_path": menu_path,
	}


def _navigate_reply(lang: str, target_label: str) -> str:
	if lang == "ru":
		return f"Хорошо, покажу путь к **{target_label}**."
	if lang == "en":
		return f"Alright, I will show the path to **{target_label}**."
	return f"Mayli, **{target_label}** ga yo'lni ko'rsataman."


def build_explicit_guide_start_reply(
	offer: Any,
	*,
	lang: str,
	ctx: Dict[str, Any] | None = None,
) -> Dict[str, Any] | None:
	normalized = _normalize_offer(offer)
	if not normalized:
		return None

	mode = str(normalized.get("mode") or "").strip().lower()
	target_label = str(normalized.get("target_label") or "").strip()
	route = str(normalized.get("route") or "").strip()
	menu_path = _normalize_menu_path(normalized.get("menu_path"), target_label)
	primary_action_label = extract_primary_action_label(ctx or {})

	if mode == "create_record":
		return _build_start_step_response(
			lang=lang,
			doctype=target_label,
			route=route,
			menu_path=menu_path,
			primary_action_label=primary_action_label,
		)

	if mode == "manage_roles":
		return _handle_manage_roles_intent(
			lang=lang,
			manage_roles_requested=True,
			state_doctype="",
			context_doctype="",
			intent_doctype=target_label,
		)

	return _build_training_reply(
		reply=_navigate_reply(lang, target_label),
		guide={
			"type": "navigation",
			"route": route,
			"target_label": target_label,
			"menu_path": menu_path,
		},
		tutor_state={},
		auto_guide=False,
	)
