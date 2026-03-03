from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Tuple

from erpnext_ai_tutor.tutor.llm import call_llm

_FIELDNAME_RE = re.compile(r"^[a-zA-Z0-9_]+$")


def _as_text(value: Any) -> str:
	return str(value or "").strip()


def _to_bool(value: Any) -> bool:
	if isinstance(value, bool):
		return value
	text = _as_text(value).lower()
	return text in {"1", "true", "yes", "on"}


def _clip(value: str, limit: int) -> str:
	text = _as_text(value)
	if len(text) <= limit:
		return text
	return text[:limit]


def _normalize_fields(fields: Any) -> List[Dict[str, Any]]:
	if not isinstance(fields, list):
		return []
	out: List[Dict[str, Any]] = []
	for raw in fields[:120]:
		if not isinstance(raw, dict):
			continue
		fieldname = _as_text(raw.get("fieldname"))
		if not fieldname or not _FIELDNAME_RE.match(fieldname):
			continue
		label = _clip(_as_text(raw.get("label")) or fieldname, 80)
		fieldtype = _clip(_as_text(raw.get("fieldtype")) or "Data", 32)
		options_raw = raw.get("options")
		options: List[str] = []
		if isinstance(options_raw, list):
			for opt in options_raw[:30]:
				text = _clip(_as_text(opt), 80)
				if text:
					options.append(text)
		current_value = _clip(_as_text(raw.get("current_value")), 160)
		out.append(
			{
				"fieldname": fieldname,
				"label": label,
				"fieldtype": fieldtype,
				"required": _to_bool(raw.get("required")),
				"read_only": _to_bool(raw.get("read_only")),
				"hidden": _to_bool(raw.get("hidden")),
				"current_value": current_value,
				"options": options,
			}
		)
	return out


def _fallback_plan(doctype: str, stage: str, fields: List[Dict[str, Any]]) -> List[Dict[str, str]]:
	field_map = {str(f.get("fieldname") or "").strip(): f for f in fields}
	lower_dt = _as_text(doctype).lower()
	stage = _as_text(stage).lower() or "open_and_fill_basic"
	plan: List[Dict[str, str]] = []

	def add(fieldname: str, value: str, reason: str) -> None:
		f = field_map.get(fieldname)
		if not f:
			return
		if _to_bool(f.get("read_only")) or _to_bool(f.get("hidden")):
			return
		if _as_text(f.get("current_value")):
			return
		plan.append({"fieldname": fieldname, "value": value, "reason": reason})

	if lower_dt == "item":
		if stage == "fill_more":
			add("description", "AI Tutor demo description", "qo'shimcha izohni ko'rsatish uchun")
		else:
			add("item_code", "DEMO-ITEM-001", "har bir mahsulot uchun yagona kod kerak")
			add("item_name", "Demo Item", "ro'yxatda nom ko'rinishi uchun")
			add("item_group", "All Item Groups", "toifaga biriktirish uchun")
			add("stock_uom", "Nos", "ombor birligini belgilash uchun")
		if plan:
			return plan[:6]

	ordered_fields = sorted(
		fields,
		key=lambda row: (
			0 if _to_bool(row.get("required")) else 1,
			0 if _as_text(row.get("fieldtype")).lower() in {"data", "link", "select"} else 1,
		),
	)

	for f in ordered_fields:
		if len(plan) >= 4:
			break
		if _to_bool(f.get("read_only")) or _to_bool(f.get("hidden")):
			continue
		if _as_text(f.get("current_value")):
			continue
		fieldname = _as_text(f.get("fieldname"))
		fieldtype = _as_text(f.get("fieldtype")).lower()
		label = _as_text(f.get("label")) or fieldname
		value = "Demo"
		if fieldtype in {"int", "float", "currency"}:
			value = "1"
		elif fieldtype == "select":
			options = f.get("options") if isinstance(f.get("options"), list) else []
			choice = ""
			for opt in options:
				text = _as_text(opt)
				if text and text != "None":
					choice = text
					break
				value = choice or "Demo"
		elif fieldtype == "link":
			# Runtime will try to resolve an existing linked record name.
			value = ""
		else:
			value = f"Demo {label}"
		plan.append({"fieldname": fieldname, "value": value, "reason": "demo o'rgatish uchun"})
	return plan[:6]


def _extract_json_payload(text: str) -> Any:
	raw = _as_text(text)
	if not raw:
		return None
	try:
		return json.loads(raw)
	except Exception:
		pass
	fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw, re.IGNORECASE)
	if fence:
		body = _as_text(fence.group(1))
		if body:
			try:
				return json.loads(body)
			except Exception:
				pass
	match = re.search(r"\[[\s\S]*\]", raw)
	if match:
		try:
			return json.loads(match.group(0))
		except Exception:
			return None
	return None


def _normalize_plan(raw_plan: Any, fields: List[Dict[str, Any]]) -> List[Dict[str, str]]:
	if isinstance(raw_plan, dict):
		if isinstance(raw_plan.get("plan"), list):
			raw_plan = raw_plan.get("plan")
		elif isinstance(raw_plan.get("steps"), list):
			raw_plan = raw_plan.get("steps")
	if not isinstance(raw_plan, list):
		return []

	field_map = {str(f.get("fieldname") or "").strip(): f for f in fields}
	out: List[Dict[str, str]] = []
	seen = set()
	for row in raw_plan[:12]:
		if not isinstance(row, dict):
			continue
		fieldname = _as_text(row.get("fieldname"))
		if not fieldname or fieldname in seen:
			continue
		field = field_map.get(fieldname)
		if not field:
			continue
		if _to_bool(field.get("read_only")) or _to_bool(field.get("hidden")):
			continue
		if _as_text(field.get("current_value")):
			continue

		value = _as_text(row.get("value"))
		reason = _clip(_as_text(row.get("reason")) or "demo ko'rsatish uchun", 180)
		fieldtype = _as_text(field.get("fieldtype")).lower()
		if fieldtype in {"int", "float", "currency"} and not re.fullmatch(r"-?\d+(\.\d+)?", value):
			value = "1"
		if fieldtype == "select":
			options = field.get("options") if isinstance(field.get("options"), list) else []
			if options and value not in options:
				fallback_opt = ""
				for opt in options:
					text = _as_text(opt)
					if text and text != "None":
						fallback_opt = text
						break
				value = fallback_opt or value or "Demo"
		if not value:
			value = "Demo"
		out.append({"fieldname": fieldname, "value": value, "reason": reason})
		seen.add(fieldname)
	return out[:6]


def _plan_with_llm(doctype: str, stage: str, fields: List[Dict[str, Any]]) -> List[Dict[str, str]]:
	compact_fields = []
	for f in fields[:80]:
		compact_fields.append(
			{
				"fieldname": f.get("fieldname"),
				"label": f.get("label"),
				"fieldtype": f.get("fieldtype"),
				"required": bool(f.get("required")),
				"current_value": _as_text(f.get("current_value")),
				"options": (f.get("options") or [])[:10],
			}
		)

	system_msg = (
		"You are an ERPNext form planning assistant.\n"
		"Return only JSON.\n"
		"Output format: [{\"fieldname\":\"...\",\"value\":\"...\",\"reason\":\"...\"}]\n"
		"Rules:\n"
		"- Use only provided fieldname values.\n"
		"- Never include save/submit/delete actions.\n"
		"- Keep reasons short and practical in Uzbek.\n"
		"- Prefer required fields first.\n"
		"- For Item (open_and_fill_basic), strongly prefer item_code, item_name, item_group, stock_uom.\n"
		"- Max 6 rows."
	)
	user_payload = {
		"doctype": _as_text(doctype),
		"stage": _as_text(stage) or "open_and_fill_basic",
		"fields": compact_fields,
	}
	resp = call_llm(
		messages=[
			{"role": "system", "content": system_msg},
			{"role": "user", "content": json.dumps(user_payload, ensure_ascii=True)},
		],
		max_tokens=900,
	)
	parsed = _extract_json_payload(resp)
	return _normalize_plan(parsed, fields)


def plan_tutorial_fields(*, doctype: str, stage: str, fields: Any) -> Tuple[List[Dict[str, str]], str]:
	normalized = _normalize_fields(fields)
	fallback = _fallback_plan(doctype, stage, normalized)
	if not normalized:
		return fallback, "fallback"

	try:
		ai_plan = _plan_with_llm(doctype, stage, normalized)
		if ai_plan:
			return ai_plan, "ai"
	except Exception:
		pass
	return fallback, "fallback"
