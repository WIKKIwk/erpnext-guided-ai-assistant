from __future__ import annotations

import re
from typing import Any, Dict

from erpnext_ai_tutor.tutor.training_intent import _infer_training_intent_with_ai
from erpnext_ai_tutor.tutor.training_resolution import _resolve_doctype_target
from erpnext_ai_tutor.tutor.training_state import _extract_state
from erpnext_ai_tutor.tutor.training_targets import _infer_doctype_from_context

GUIDE_OFFER_ACTIONS = {"create_record", "manage_roles"}
GUIDE_OFFER_MIN_CONFIDENCE = 0.55
GUIDE_OFFER_CONTEXT_MATCH_MIN_CONFIDENCE = 0.45
GUIDE_OFFER_NO_CONTEXT_HIGH_CONFIDENCE = 0.65
READ_ONLY_PREFERENCE_RE = re.compile(
	r"(?:"
	r"\bfaqat\s+(?:tushuntir|yoz(?:ib)?\s+ber|izohla)\b|"
	r"\bcursor(?:siz)?\b|"
	r"\bko['’]?rsatma\s+kerak\s+emas\b|"
	r"\bko['’]?rsatib\s+berma\b|"
	r"\bno\s+cursor\b|"
	r"\bjust\s+explain\b|"
	r"\bdon['’]?t\s+show\b|"
	r"\bwithout\s+cursor\b"
	r")",
	re.IGNORECASE,
)


def _normalize_confidence(value: Any) -> float:
	try:
		return max(0.0, min(float(value or 0.0), 1.0))
	except Exception:
		return 0.0


def _context_match(target_label: str, ctx: Dict[str, Any]) -> bool:
	context_doctype = str(_infer_doctype_from_context(ctx) or "").strip()
	target = str(target_label or "").strip()
	if not context_doctype or not target:
		return False
	return context_doctype.lower() == target.lower()


def _prefers_read_only(text: str) -> bool:
	return bool(READ_ONLY_PREFERENCE_RE.search(str(text or "").strip()))


def _safe_context_diagnostic(ctx: Dict[str, Any]) -> Dict[str, Any]:
	context = ctx if isinstance(ctx, dict) else {}
	state = _extract_state(context)
	return {
		"context_doctype": str(_infer_doctype_from_context(context) or "").strip(),
		"has_form_context": isinstance(context.get("form"), dict),
		"has_active_field": isinstance(context.get("active_field"), dict),
		"has_event_context": isinstance(context.get("event"), dict),
		"state_action": str(state.get("action") or "").strip(),
		"state_doctype": str(state.get("doctype") or "").strip(),
		"state_pending": str(state.get("pending") or "").strip(),
	}


def build_guide_offer_decision(user_message: str, ctx: Dict[str, Any]) -> Dict[str, Any]:
	"""Return guide-offer metadata plus a privacy-safe diagnostic decision record."""
	text = str(user_message or "").strip()
	ctx = ctx if isinstance(ctx, dict) else {}
	diagnostic: Dict[str, Any] = {
		"decision": "none",
		"action": "",
		"intent_doctype": "",
		"confidence": 0.0,
		"target_resolved": False,
		"target_label": "",
		"route": "",
		"mode": "",
		"reason": "",
		"context_match": False,
		"read_only_preference": False,
		**_safe_context_diagnostic(ctx),
	}
	if not text:
		diagnostic["decision"] = "suppressed_empty_message"
		return {"guide_offer": None, "diagnostic": diagnostic}

	read_only_preference = _prefers_read_only(text)
	diagnostic["read_only_preference"] = read_only_preference
	if read_only_preference:
		diagnostic["decision"] = "suppressed_read_only_preference"
		return {"guide_offer": None, "diagnostic": diagnostic}

	state = _extract_state(ctx)
	if state.get("pending") or state.get("action") == "create_record":
		diagnostic["decision"] = "suppressed_active_guided_state"
		return {"guide_offer": None, "diagnostic": diagnostic}

	intent = _infer_training_intent_with_ai(text, has_active_tutorial=False)
	action = str(intent.get("action") or "").strip().lower()
	doctype = str(intent.get("doctype") or "").strip()
	confidence = _normalize_confidence(intent.get("confidence"))
	diagnostic["action"] = action
	diagnostic["intent_doctype"] = doctype
	diagnostic["confidence"] = confidence

	if action not in GUIDE_OFFER_ACTIONS:
		diagnostic["decision"] = "suppressed_non_offer_intent"
		return {"guide_offer": None, "diagnostic": diagnostic}
	if confidence < GUIDE_OFFER_CONTEXT_MATCH_MIN_CONFIDENCE:
		diagnostic["decision"] = "suppressed_low_confidence"
		return {"guide_offer": None, "diagnostic": diagnostic}

	target_query = doctype or text
	target = _resolve_doctype_target(
		target_query,
		ctx,
		fallback_doctype=doctype,
		allow_context_fallback=True,
	)
	if not isinstance(target, dict) or not target:
		diagnostic["decision"] = "suppressed_unresolved_target"
		return {"guide_offer": None, "diagnostic": diagnostic}

	route = str(target.get("route") or "").strip()
	target_label = str(target.get("doctype") or target.get("target_label") or "").strip()
	diagnostic["target_resolved"] = True
	diagnostic["target_label"] = target_label
	diagnostic["route"] = route
	if not route or not target_label:
		diagnostic["decision"] = "suppressed_invalid_target_payload"
		return {"guide_offer": None, "diagnostic": diagnostic}

	has_context_match = _context_match(target_label, ctx)
	diagnostic["context_match"] = has_context_match
	if has_context_match:
		if confidence < GUIDE_OFFER_CONTEXT_MATCH_MIN_CONFIDENCE:
			diagnostic["decision"] = "suppressed_context_match_low_confidence"
			return {"guide_offer": None, "diagnostic": diagnostic}
		reason = "semantic_intent_resolved_target_context_match"
	elif doctype:
		if confidence < GUIDE_OFFER_MIN_CONFIDENCE:
			diagnostic["decision"] = "suppressed_explicit_target_low_confidence"
			return {"guide_offer": None, "diagnostic": diagnostic}
		reason = "semantic_intent_resolved_target"
	else:
		if confidence < GUIDE_OFFER_NO_CONTEXT_HIGH_CONFIDENCE:
			diagnostic["decision"] = "suppressed_no_context_low_confidence"
			return {"guide_offer": None, "diagnostic": diagnostic}
		reason = "semantic_intent_resolved_target_high_confidence"

	menu_path = target.get("menu_path")
	if not isinstance(menu_path, list):
		menu_path = []
	menu_path = [str(x).strip() for x in menu_path if str(x or "").strip()]

	mode = "manage_roles" if action == "manage_roles" else "create_record"
	diagnostic["decision"] = "offer_shown"
	diagnostic["mode"] = mode
	diagnostic["reason"] = reason
	guide_offer = {
		"show": True,
		"confidence": confidence,
		"reason": reason,
		"target_label": target_label,
		"route": route,
		"menu_path": menu_path,
		"mode": mode,
	}
	return {"guide_offer": guide_offer, "diagnostic": diagnostic}


def build_guide_offer(user_message: str, ctx: Dict[str, Any]) -> Dict[str, Any] | None:
	decision = build_guide_offer_decision(user_message, ctx)
	return decision.get("guide_offer") if isinstance(decision, dict) else None
