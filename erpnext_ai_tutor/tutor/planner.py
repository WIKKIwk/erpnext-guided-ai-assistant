from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Tuple

from erpnext_ai_tutor.tutor.llm import call_llm

_FIELDNAME_RE = re.compile(r"^[a-zA-Z0-9_]+$")
_DEFAULT_STOCK_ENTRY_ORDER = ["Material Receipt", "Material Transfer", "Material Issue"]
_BASIC_PLAN_LIMIT = 10
_FILL_MORE_PLAN_LIMIT = 14


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


def _is_noise_field(doctype: str, row: Dict[str, Any]) -> bool:
	if _to_bool(row.get("required")):
		return False
	name = _as_text(row.get("fieldname")).lower()
	label = _as_text(row.get("label")).lower()
	if not name and not label:
		return False
	meta_fields = {
		"name",
		"owner",
		"creation",
		"modified",
		"modified_by",
		"idx",
		"docstatus",
		"amended_from",
		"_assign",
		"_comments",
		"_liked_by",
		"_seen",
		"_user_tags",
		"naming_series",
	}
	if name in meta_fields:
		return True
	if re.search(r"(scan|barcode|last_scanned|posting_date|posting_time|workflow)", name):
		return True
	if re.search(r"(scan|barcode|last scanned|posting date|posting time)", label):
		return True
	if _as_text(doctype).lower() == "stock entry" and name in {"scan_barcode", "last_scanned_warehouse"}:
		return True
	return False


def _pick_select_option(options: Any, preferred: List[str] | None = None) -> str:
	opts = [str(x or "").strip() for x in (options if isinstance(options, list) else []) if str(x or "").strip()]
	if not opts:
		return ""
	norm = lambda v: str(v or "").strip().lower()
	pref_norm = [norm(x) for x in (preferred or []) if norm(x)]
	for wanted in pref_norm:
		for opt in opts:
			if norm(opt) == wanted:
				return opt
	for opt in opts:
		text = norm(opt)
		if text in {"", "-", "--", "---", "none", "select", "tanlang", "choose"}:
			continue
		if re.match(r"^(please\s+select|select\b|tanlang)", opt, flags=re.IGNORECASE):
			continue
		return opt
	return opts[0]


def _normalize_stock_entry_type_preference(value: Any) -> str:
	text = _as_text(value)
	if not text:
		return ""
	lower = text.lower()
	if lower in {"material issue", "issue"}:
		return "Material Issue"
	if lower in {"material transfer", "transfer"}:
		return "Material Transfer"
	if lower in {"material receipt", "receipt"}:
		return "Material Receipt"
	return ""


def _stock_entry_preferred_order(stock_entry_type_preference: str = "") -> List[str]:
	pref = _normalize_stock_entry_type_preference(stock_entry_type_preference)
	if not pref:
		return list(_DEFAULT_STOCK_ENTRY_ORDER)
	return [pref] + [x for x in _DEFAULT_STOCK_ENTRY_ORDER if x != pref]


def _plan_limit_for_stage(stage: str) -> int:
	stage_norm = _as_text(stage).lower() or "open_and_fill_basic"
	if stage_norm == "fill_more":
		return _FILL_MORE_PLAN_LIMIT
	return _BASIC_PLAN_LIMIT


def _fallback_plan(
	doctype: str,
	stage: str,
	fields: List[Dict[str, Any]],
	*,
	stock_entry_type_preference: str = "",
) -> List[Dict[str, str]]:
	field_map = {str(f.get("fieldname") or "").strip(): f for f in fields}
	lower_dt = _as_text(doctype).lower()
	stage = _as_text(stage).lower() or "open_and_fill_basic"
	max_rows = _plan_limit_for_stage(stage)
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
			return plan[:max_rows]
	if lower_dt == "stock entry":
		stock_pref = _stock_entry_preferred_order(stock_entry_type_preference)[0]
		add("stock_entry_type", stock_pref, "ombor amaliyoti turi tanlanmasa qolgan qadamlar barqaror ishlamaydi")
		if plan:
			return plan[:max_rows]

	ordered_fields = sorted(
		fields,
		key=lambda row: (
			0 if _to_bool(row.get("required")) else 1,
			0 if _as_text(row.get("fieldtype")).lower() in {"data", "link", "select"} else 1,
		),
	)

	for f in ordered_fields:
		if len(plan) >= max_rows:
			break
		if _to_bool(f.get("read_only")) or _to_bool(f.get("hidden")):
			continue
		if _as_text(f.get("current_value")):
			continue
		if _is_noise_field(doctype, f):
			continue
		fieldname = _as_text(f.get("fieldname"))
		fieldtype = _as_text(f.get("fieldtype")).lower()
		label = _as_text(f.get("label")) or fieldname
		value = "Demo"
		if fieldtype in {"int", "float", "currency"}:
			value = "1"
		elif fieldtype == "select":
			options = f.get("options") if isinstance(f.get("options"), list) else []
			preferred = _stock_entry_preferred_order(stock_entry_type_preference) if fieldname == "stock_entry_type" else []
			choice = _pick_select_option(options, preferred=preferred)
			value = choice or "Demo"
		elif fieldtype == "link":
			# Runtime will try to resolve an existing linked record name.
			value = ""
		else:
			value = f"Demo {label}"
		plan.append({"fieldname": fieldname, "value": value, "reason": "demo o'rgatish uchun"})
	return plan[:max_rows]


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


def _normalize_plan(
	raw_plan: Any,
	fields: List[Dict[str, Any]],
	doctype: str = "",
	stage: str = "",
	*,
	stock_entry_type_preference: str = "",
) -> List[Dict[str, str]]:
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
	max_rows = _plan_limit_for_stage(stage)
	for row in raw_plan[: max(12, max_rows * 2)]:
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
		if _is_noise_field(doctype, field):
			continue

		value = _as_text(row.get("value"))
		reason = _clip(_as_text(row.get("reason")) or "demo ko'rsatish uchun", 180)
		fieldtype = _as_text(field.get("fieldtype")).lower()
		if fieldtype in {"int", "float", "currency"} and not re.fullmatch(r"-?\d+(\.\d+)?", value):
			value = "1"
		if fieldtype == "select":
			options = field.get("options") if isinstance(field.get("options"), list) else []
			if options and value not in options:
				preferred = _stock_entry_preferred_order(stock_entry_type_preference) if fieldname == "stock_entry_type" else []
				fallback_opt = _pick_select_option(options, preferred=preferred)
				value = fallback_opt or value or "Demo"
			if not value:
				value = "Demo"
			out.append({"fieldname": fieldname, "value": value, "reason": reason})
			seen.add(fieldname)
	return out[:max_rows]


def _plan_with_llm(
	doctype: str,
	stage: str,
	fields: List[Dict[str, Any]],
	*,
	stock_entry_type_preference: str = "",
) -> List[Dict[str, str]]:
	stage_norm = _as_text(stage).lower() or "open_and_fill_basic"
	max_rows = _plan_limit_for_stage(stage_norm)
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
			"- For Stock Entry stock_entry_type, prioritize user's requested type when provided.\n"
			f"- Max {max_rows} rows."
		)
	user_payload = {
		"doctype": _as_text(doctype),
		"stage": stage_norm,
		"stock_entry_type_preference": _normalize_stock_entry_type_preference(stock_entry_type_preference),
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
	return _normalize_plan(
		parsed,
		fields,
		doctype=doctype,
		stage=stage_norm,
		stock_entry_type_preference=stock_entry_type_preference,
	)


def plan_tutorial_fields(
	*,
	doctype: str,
	stage: str,
	fields: Any,
	stock_entry_type_preference: str = "",
) -> Tuple[List[Dict[str, str]], str]:
	normalized = _normalize_fields(fields)
	fallback = _fallback_plan(
		doctype,
		stage,
		normalized,
		stock_entry_type_preference=stock_entry_type_preference,
	)
	if not normalized:
		return fallback, "fallback"

	try:
		ai_plan = _plan_with_llm(
			doctype,
			stage,
			normalized,
			stock_entry_type_preference=stock_entry_type_preference,
		)
		if ai_plan:
			return ai_plan, "ai"
	except Exception:
		pass
	return fallback, "fallback"
