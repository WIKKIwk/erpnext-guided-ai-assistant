from __future__ import annotations

import json
import re
from typing import Any, Dict

from erpnext_ai_tutor.tutor.llm import call_llm
from erpnext_ai_tutor.tutor.navigation import build_navigation_plan
from erpnext_ai_tutor.tutor.training_patterns import AI_TARGET_ALIASES, ALLOWED_INTENT_ACTIONS
from erpnext_ai_tutor.tutor.training_targets import _doctype_from_slug, _is_real_doctype

INTENT_MAX_TOKENS = 2048


def _extract_json_payload(text: str) -> Any:
	raw = str(text or "").strip()
	if not raw:
		return None
	try:
		return json.loads(raw)
	except Exception:
		pass
	fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw, re.IGNORECASE)
	if fence:
		body = str(fence.group(1) or "").strip()
		if body:
			try:
				return json.loads(body)
			except Exception:
				pass
	obj = re.search(r"\{[\s\S]*\}", raw)
	if obj:
		try:
			return json.loads(obj.group(0))
		except Exception:
			return None
	return None


def _extract_partial_intent_payload(text: str) -> Dict[str, Any] | None:
	raw = str(text or "").strip()
	if not raw:
		return None
	action_match = re.search(r'"action"\s*:\s*"([^"]+)"', raw, flags=re.IGNORECASE)
	if not action_match:
		return None
	action = str(action_match.group(1) or "").strip().lower()
	doctype_match = re.search(r'"doctype"\s*:\s*"([^"]*)"', raw, flags=re.IGNORECASE)
	conf_match = re.search(r'"confidence"\s*:\s*([0-9]*\.?[0-9]+)', raw, flags=re.IGNORECASE)
	dep_match = re.search(r'"allow_dependency_creation"\s*:\s*(true|false)', raw, flags=re.IGNORECASE)
	try:
		confidence = float(conf_match.group(1)) if conf_match else 0.4
	except Exception:
		confidence = 0.4
	return {
		"action": action,
		"doctype": str(doctype_match.group(1) or "").strip() if doctype_match else "",
		"confidence": confidence,
		"allow_dependency_creation": bool(dep_match and str(dep_match.group(1) or "").lower() == "true"),
	}


def _coerce_to_real_doctype(candidate: str) -> str:
	raw = str(candidate or "").strip()
	if not raw:
		return ""

	alias = AI_TARGET_ALIASES.get(raw.lower())
	if alias and _is_real_doctype(alias):
		return alias
	if _is_real_doctype(raw):
		return raw

	doctype = _doctype_from_slug(raw)
	if doctype:
		return doctype

	raw_lower = raw.lower()
	if raw_lower.endswith("s"):
		doctype = _doctype_from_slug(raw_lower[:-1])
		if doctype:
			return doctype

	plan = build_navigation_plan(f"{raw} list")
	if isinstance(plan, dict) and str(plan.get("kind") or "").strip().lower() == "doctype":
		plan_doctype = str(plan.get("doctype") or plan.get("target_label") or "").strip()
		if _is_real_doctype(plan_doctype):
			return plan_doctype
	return ""


def _infer_doctype_with_ai(user_message: str) -> str:
	text = str(user_message or "").strip()
	if not text:
		return ""
	system_msg = (
		"You classify ERPNext training requests.\n"
		"Return strict JSON only with this schema:\n"
		"{\"action\":\"create_record|other\",\"doctype\":\"<canonical DocType name or empty>\",\"confidence\":0.0}\n"
		"Rules:\n"
		"- action=create_record only if user asks to add/create/new/teach creating a record.\n"
		"- doctype must be ERPNext DocType name (English canonical) when clear.\n"
		"- If unclear, set doctype empty and confidence <= 0.4.\n"
		"- Never include prose, markdown, or extra keys."
	)
	try:
		resp = call_llm(
			messages=[
				{"role": "system", "content": system_msg},
				{"role": "user", "content": text},
			],
			max_tokens=INTENT_MAX_TOKENS,
		)
	except Exception:
		return ""

	payload = _extract_json_payload(resp)
	if not isinstance(payload, dict):
		return ""
	action = str(payload.get("action") or "").strip().lower()
	if action != "create_record":
		return ""
	try:
		confidence = float(payload.get("confidence") or 0.0)
	except Exception:
		confidence = 0.0
	if confidence < 0.45:
		return ""
	doctype_raw = str(payload.get("doctype") or "").strip()
	return _coerce_to_real_doctype(doctype_raw)


def _infer_training_intent_with_ai(user_message: str, *, has_active_tutorial: bool) -> Dict[str, Any]:
	text = str(user_message or "").strip()
	if not text:
		return {"action": "other", "doctype": "", "confidence": 0.0, "allow_dependency_creation": False}

	system_msg = (
		"You classify ERPNext tutor chat intent.\n"
		"Return strict JSON only with this schema:\n"
		"{\"action\":\"create_record|continue|show_save|manage_roles|other\",\"doctype\":\"<DocType or empty>\",\"confidence\":0.0,\"allow_dependency_creation\":false}\n"
		"Rules:\n"
		"- Use semantic intent, not just keywords.\n"
		"- action=create_record when user asks practical teaching/demonstration/filling/new record workflow.\n"
		"- action=continue when user asks to continue next step in an already running tutorial.\n"
		"- action=show_save when user asks where save/submit is.\n"
		"- action=manage_roles when user asks to add/assign/remove roles/permissions for an existing User.\n"
		"- action=other for plain chat/small talk/non-tutorial questions.\n"
		"- doctype must be canonical ERPNext DocType name if clear, else empty.\n"
		"- For action=manage_roles, prefer doctype=User unless user clearly names another security doctype.\n"
		"- allow_dependency_creation=true only if user explicitly allows auto-creating missing linked masters and continuing tutorial.\n"
		"- If uncertain, confidence <= 0.4.\n"
		"- No prose, no markdown."
	)
	user_payload = {
		"text": text,
		"has_active_tutorial": bool(has_active_tutorial),
	}
	try:
		resp = call_llm(
			messages=[
				{"role": "system", "content": system_msg},
				{"role": "user", "content": json.dumps(user_payload, ensure_ascii=True)},
			],
			max_tokens=INTENT_MAX_TOKENS,
		)
	except Exception:
		return {"action": "other", "doctype": "", "confidence": 0.0, "allow_dependency_creation": False}

	payload = _extract_json_payload(resp)
	if not isinstance(payload, dict):
		payload = _extract_partial_intent_payload(resp)
	if not isinstance(payload, dict):
		return {"action": "other", "doctype": "", "confidence": 0.0, "allow_dependency_creation": False}

	action = str(payload.get("action") or "").strip().lower()
	if action not in ALLOWED_INTENT_ACTIONS:
		action = "other"
	try:
		confidence = float(payload.get("confidence") or 0.0)
	except Exception:
		confidence = 0.0
	doctype = _coerce_to_real_doctype(str(payload.get("doctype") or "").strip())
	allow_dependency_creation = bool(payload.get("allow_dependency_creation"))
	if confidence < 0.35:
		action = "other"
		doctype = ""
		allow_dependency_creation = False
	return {
		"action": action,
		"doctype": doctype,
		"confidence": confidence,
		"allow_dependency_creation": allow_dependency_creation,
	}
