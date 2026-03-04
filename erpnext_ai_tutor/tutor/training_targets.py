from __future__ import annotations

import re
from typing import Any, Dict, List

import frappe

from erpnext_ai_tutor.tutor.navigation import build_navigation_plan
from erpnext_ai_tutor.tutor.training_patterns import (
	AI_TARGET_ALIASES,
	ALLOWED_STOCK_ENTRY_TYPES,
	normalize_apostrophes,
)


def _normalize_slug(text: str) -> str:
	value = str(text or "").strip().lower().replace("_", "-")
	if value.endswith("-list"):
		value = value[: -len("-list")]
	return value.strip("-")


def _doctype_to_slug(doctype: str) -> str:
	return frappe.scrub(str(doctype or "")).replace("_", "-")


def _is_real_doctype(name: str) -> bool:
	value = str(name or "").strip()
	if not value:
		return False
	return bool(
		frappe.db.exists(
			"DocType",
			{
				"name": value,
				"issingle": 0,
				"istable": 0,
				"is_virtual": 0,
			},
		)
	)


def _doctype_from_slug(slug: str) -> str:
	key = _normalize_slug(slug)
	if not key:
		return ""
	row = frappe.db.sql(
		"""
		select name
		from `tabDocType`
		where ifnull(issingle, 0)=0
		  and ifnull(istable, 0)=0
		  and ifnull(is_virtual, 0)=0
		  and replace(replace(lower(name), ' ', '-'), '_', '-')=%s
		limit 1
		""",
		(key,),
		as_dict=True,
	)
	if not row:
		return ""
	return str(row[0].get("name") or "").strip()


def _extract_route_parts(ctx: Dict[str, Any]) -> List[str]:
	route = ctx.get("route")
	if isinstance(route, list):
		parts = [str(x or "").strip() for x in route if str(x or "").strip()]
		if parts:
			return parts
	route_str = str(ctx.get("route_str") or "").strip().strip("/")
	if not route_str:
		return []
	return [p.strip() for p in route_str.split("/") if p.strip()]


def _infer_doctype_from_context(ctx: Dict[str, Any]) -> str:
	if not isinstance(ctx, dict):
		return ""
	form = ctx.get("form")
	if isinstance(form, dict):
		form_doctype = str(form.get("doctype") or "").strip()
		if _is_real_doctype(form_doctype):
			return form_doctype

	parts = _extract_route_parts(ctx)
	if not parts:
		return ""
	if parts and parts[0].lower() == "form" and len(parts) > 1 and _is_real_doctype(parts[1]):
		return str(parts[1]).strip()

	candidates: List[str] = []
	if parts:
		candidates.append(parts[0])
		candidates.append(parts[-1])
	if len(parts) > 1:
		candidates.append(parts[-2])

	seen = set()
	for raw in candidates:
		token = str(raw or "").strip()
		if not token or token in seen:
			continue
		seen.add(token)
		if token.lower().startswith("new-"):
			continue
		doctype = _doctype_from_slug(token)
		if doctype:
			return doctype
	return ""


def _normalize_menu_path(menu_path: Any, doctype: str) -> List[str]:
	path: List[str] = []
	if isinstance(menu_path, list):
		for item in menu_path:
			text = str(item or "").strip()
			if text and text not in path:
				path.append(text)
	if doctype and doctype not in path:
		path.append(doctype)
	return path[:6]


def _normalize_text_for_match(value: str) -> str:
	text = str(value or "").lower()
	text = re.sub(r"[^a-z0-9\u0400-\u04ff]+", " ", text)
	return re.sub(r"\s+", " ", text).strip()


def _extract_doctype_mention_from_text(user_message: str) -> str:
	normalized_text = _normalize_text_for_match(user_message)
	if not normalized_text:
		return ""
	wrapped_text = f" {normalized_text} "

	# First pass: known aliases/synonyms used by users.
	for alias, canonical in sorted(AI_TARGET_ALIASES.items(), key=lambda x: len(str(x[0])), reverse=True):
		alias_norm = _normalize_text_for_match(alias)
		if not alias_norm:
			continue
		if f" {alias_norm} " in wrapped_text and _is_real_doctype(canonical):
			return canonical

	# Second pass: any real doctype name mention (longest match wins).
	rows = frappe.db.sql(
		"""
		select name
		from `tabDocType`
		where ifnull(issingle, 0)=0
		  and ifnull(istable, 0)=0
		  and ifnull(is_virtual, 0)=0
		""",
		as_dict=True,
	)
	best_name = ""
	best_len = 0
	for row in rows:
		name = str((row or {}).get("name") or "").strip()
		if not name:
			continue
		name_norm = _normalize_text_for_match(name)
		if not name_norm or len(name_norm) < 4:
			continue
		if f" {name_norm} " not in wrapped_text:
			continue
		if len(name_norm) > best_len and _is_real_doctype(name):
			best_len = len(name_norm)
			best_name = name
	return best_name


def _extract_stock_entry_type_preference(user_message: str, doctype: str = "") -> str:
	text = normalize_apostrophes(str(user_message or "")).strip().lower()
	if not text:
		return ""
	if str(doctype or "").strip().lower() not in {"", "stock entry"}:
		return ""
	patterns: List[tuple[str, List[str]]] = [
		(
			"Material Issue",
			[
				r"\bmaterial[\s_-]*issue\b",
				r"\bissue\s+bilan\b",
				r"\bchiqim\b",
				r"\bombordan?\s+chiq",
			],
		),
		(
			"Material Receipt",
			[
				r"\bmaterial[\s_-]*receipt\b",
				r"\breceipt\b",
				r"\bkirim\b",
				r"\bqabul\b",
			],
		),
		(
			"Material Transfer",
			[
				r"\bmaterial[\s_-]*transfer\b",
				r"\btransfer\b",
				r"\bo['’]?tkaz",
				r"\bko['’]?chir",
			],
		),
	]
	matches: List[tuple[int, str]] = []
	for canonical, regexes in patterns:
		for raw in regexes:
			m = re.search(raw, text, flags=re.IGNORECASE)
			if m:
				matches.append((int(m.start()), canonical))
				break
	if not matches:
		return ""
	matches.sort(key=lambda x: x[0])
	chosen = str(matches[0][1] or "").strip()
	return chosen if chosen in ALLOWED_STOCK_ENTRY_TYPES else ""


def _target_from_doctype(doctype: str) -> Dict[str, Any]:
	name = str(doctype or "").strip()
	if not name or not _is_real_doctype(name):
		return {}
	plan = build_navigation_plan(f"{name} list")
	route = str(plan.get("route") or "").strip() if isinstance(plan, dict) else ""
	if not route:
		route = f"/app/{_doctype_to_slug(name)}"
	menu_path = _normalize_menu_path(plan.get("menu_path") if isinstance(plan, dict) else None, name)
	return {
		"doctype": name,
		"route": route,
		"menu_path": menu_path,
	}


def _doctype_from_plan(plan: Dict[str, Any]) -> Dict[str, Any]:
	if not isinstance(plan, dict):
		return {}
	kind = str(plan.get("kind") or "").strip().lower()
	if kind != "doctype":
		return {}
	doctype = str(plan.get("doctype") or plan.get("target_label") or "").strip()
	return _target_from_doctype(doctype)
