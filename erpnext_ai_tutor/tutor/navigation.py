from __future__ import annotations

import re
from typing import Any, Dict, List

import frappe

from erpnext_ai_tutor.tutor.language import normalize_lang


SPLIT_MARKERS_RE = re.compile(
	r"(?:\bqayerda\b|\bqayerdan\s+top(?:ib)?\b|\bqaysi\s+(?:bo['’]lim|bo‘lim|qism)da\b|\bwhere\s+is\b|\bhow\s+to\s+open\b|\bqanday\s+(?:kirsam|ochsam)\b)",
	re.IGNORECASE,
)

TRIM_PHRASES_RE = re.compile(
	r"(?:\bmenga\b|\bkerak\b|\biltimos\b|\btopib\s+ber\b|\bber\b|\bqismi\b|\bbo['’]limi\b|\bsahifasi\b|\bqayerda\b|\bqayerdan\b|\btop(?:ish|ib)?\b|\bekanligi(?:ni)?\b|\bekani\b|\bwhere\b|\bis\b|\bhow\b|\bto\b|\bopen\b)",
	re.IGNORECASE,
)

TOKEN_RE = re.compile(r"[a-z0-9]+")

STOPWORDS = {
	"menga",
	"kerak",
	"iltimos",
	"ber",
	"qismi",
	"bolimi",
	"sahifasi",
	"qayerda",
	"qayerdan",
	"topib",
	"top",
	"ekani",
	"ekanligini",
	"ekanligi",
	"u",
	"shu",
	"haqida",
	"bolsa",
	"where",
	"is",
	"how",
	"to",
	"open",
	"the",
	"a",
	"an",
}

SPECIFIC_DOCTYPE_HINTS = {
	"entry",
	"invoice",
	"order",
	"receipt",
	"reconciliation",
	"payment",
	"journal",
	"report",
	"settings",
	"stockentry",
}


def _normalize_ascii_key(text: str) -> str:
	x = str(text or "").lower()
	x = x.replace("’", "'").replace("`", "'")
	x = x.replace("o'", "o").replace("g'", "g")
	x = x.replace("o‘", "o").replace("g‘", "g")
	x = x.replace("bo'lim", "bolim").replace("bo‘lim", "bolim")
	return x


def _route_slug(value: str) -> str:
	return frappe.scrub(str(value or "")).replace("_", "-")


def _extract_candidates(user_message: str) -> List[str]:
	raw = _normalize_ascii_key(user_message)
	raw = re.sub(r"[^a-z0-9\s]", " ", raw)
	raw = re.sub(r"\s+", " ", raw).strip()
	if not raw:
		return []

	parts = [p.strip() for p in SPLIT_MARKERS_RE.split(raw) if p and p.strip()]
	parts.append(raw)
	out: List[str] = []
	for part in parts:
		clean = TRIM_PHRASES_RE.sub(" ", part)
		clean = re.sub(r"\s+", " ", clean).strip()
		if not clean:
			continue
		tokens = [t for t in TOKEN_RE.findall(clean) if t and t not in STOPWORDS]
		if not tokens:
			continue
		candidate = " ".join(tokens[:6]).strip()
		if candidate and candidate not in out:
			out.append(candidate)

		# Also include focused token groups (bigrams/trigrams) from long sentences.
		max_groups = 24
		added = 0
		for n in (2, 3):
			if len(tokens) < n:
				continue
			for i in range(0, len(tokens) - n + 1):
				group = " ".join(tokens[i : i + n]).strip()
				if not group or group in out:
					continue
				out.append(group)
				added += 1
				if added >= max_groups:
					break
			if added >= max_groups:
				break
	return out[:30]


def _best_doctype_match(candidates: List[str]) -> Dict[str, Any] | None:
	for cand in candidates:
		exact = frappe.db.sql(
			"""
			select name, module
			from `tabDocType`
			where ifnull(issingle, 0)=0
			  and ifnull(istable, 0)=0
			  and ifnull(is_virtual, 0)=0
			  and lower(name)=lower(%s)
			limit 1
			""",
			(cand,),
			as_dict=True,
		)
		if exact:
			return exact[0]

		like = frappe.db.sql(
			"""
			select name, module
			from `tabDocType`
			where ifnull(issingle, 0)=0
			  and ifnull(istable, 0)=0
			  and ifnull(is_virtual, 0)=0
			  and lower(name) like %s
			order by length(name) asc
			limit 1
			""",
			(f"%{cand}%",),
			as_dict=True,
		)
		if like:
			return like[0]

		tokens = [t for t in TOKEN_RE.findall(cand) if t and t not in STOPWORDS]
		if not tokens:
			continue
		conditions = " and ".join(["lower(name) like %s"] * len(tokens))
		params = tuple(f"%{t}%" for t in tokens)
		rows = frappe.db.sql(
			f"""
			select name, module
			from `tabDocType`
			where ifnull(issingle, 0)=0
			  and ifnull(istable, 0)=0
			  and ifnull(is_virtual, 0)=0
			  and {conditions}
			order by length(name) asc
			limit 1
			""",
			params,
			as_dict=True,
		)
		if rows:
			return rows[0]
	return None


def _best_module_match(candidates: List[str]) -> str:
	for cand in candidates:
		exact = frappe.db.sql(
			"select module_name from `tabModule Def` where lower(module_name)=lower(%s) limit 1",
			(cand,),
			as_dict=True,
		)
		if exact:
			return str(exact[0].get("module_name") or "").strip()
		like = frappe.db.sql(
			"select module_name from `tabModule Def` where lower(module_name) like %s order by length(module_name) asc limit 1",
			(f"%{cand}%",),
			as_dict=True,
		)
		if like:
			return str(like[0].get("module_name") or "").strip()
	return ""


def _workspace_labels_for_doctype(doctype_name: str) -> List[str]:
	rows = frappe.db.sql(
		"""
		select w.label, w.name
		from `tabWorkspace Link` l
		inner join `tabWorkspace` w on w.name = l.parent
		where l.link_type='DocType'
		  and l.link_to=%s
		  and ifnull(l.hidden,0)=0
		  and ifnull(w.is_hidden,0)=0
		order by w.public desc, w.label asc
		limit 3
		""",
		(doctype_name,),
		as_dict=True,
	)
	labels: List[str] = []
	for row in rows:
		label = str(row.get("label") or row.get("name") or "").strip()
		if label and label not in labels:
			labels.append(label)
	return labels


def build_navigation_plan(user_message: str) -> Dict[str, Any]:
	"""Resolve a navigation target and return structured hints for UI guidance."""
	candidates = _extract_candidates(user_message)
	if not candidates:
		return {}

	raw_tokens = [t for t in TOKEN_RE.findall(_normalize_ascii_key(user_message)) if t and t not in STOPWORDS]
	has_specific_doctype_hint = any(t in SPECIFIC_DOCTYPE_HINTS for t in raw_tokens)
	module_name = _best_module_match(candidates)
	if module_name and not has_specific_doctype_hint and len(raw_tokens) <= 3:
		return {
			"kind": "module",
			"module": module_name,
			"target_label": module_name,
			"route": f"/app/{_route_slug(module_name)}",
			"menu_path": [module_name],
			"workspace": "",
		}

	doctype = _best_doctype_match(candidates)
	if doctype:
		name = str(doctype.get("name") or "").strip()
		module = str(doctype.get("module") or "").strip()
		workspace_labels = _workspace_labels_for_doctype(name)
		workspace = ""
		if module:
			for ws in workspace_labels:
				if ws.strip().lower() == module.strip().lower():
					workspace = ws
					break
		menu_path: List[str] = []
		if module:
			menu_path.append(module)
		menu_path.append(name)
		return {
			"kind": "doctype",
			"doctype": name,
			"module": module,
			"target_label": name,
			"route": f"/app/{_route_slug(name)}",
			"menu_path": menu_path,
			"workspace": workspace,
		}

	if module_name:
		return {
			"kind": "module",
			"module": module_name,
			"target_label": module_name,
			"route": f"/app/{_route_slug(module_name)}",
			"menu_path": [module_name],
			"workspace": "",
		}

	return {}


def build_navigation_reply_from_plan(plan: Dict[str, Any], *, lang: str, strict: bool = False) -> str:
	lang = normalize_lang(lang)
	if not plan:
		return ""

	kind = str(plan.get("kind") or "").strip()
	route = str(plan.get("route") or "").strip()
	target_label = str(plan.get("target_label") or "").strip()
	module_name = str(plan.get("module") or "").strip()
	doctype_name = str(plan.get("doctype") or "").strip()
	workspace = str(plan.get("workspace") or "").strip()

	if kind == "module" and module_name:
		route = f"/app/{_route_slug(module_name)}"
		if lang == "ru":
			return f"Topdim: **{module_name}** modul. Ochish: `{route}`."
		if lang == "en":
			return f"Found module: **{module_name}**. Open: `{route}`."
		return f"Topdim: **{module_name}** moduli. Ochish: `{route}`."

	if kind == "doctype" and doctype_name:
		if lang == "ru":
			base = [f"Нашёл: **{doctype_name}**.", f"Откройте: `{route}`."]
			if module_name:
				base.append(f"Обычно путь в меню: **{module_name} → {doctype_name}**.")
			if workspace:
				base.append(f"Также можно найти в workspace: **{workspace}**.")
			return " ".join(base)
		if lang == "en":
			base = [f"Found it: **{doctype_name}**.", f"Open: `{route}`."]
			if module_name:
				base.append(f"Menu path is usually: **{module_name} → {doctype_name}**.")
			if workspace:
				base.append(f"You can also find it in workspace: **{workspace}**.")
			return " ".join(base)

		base = [f"Topdim: **{doctype_name}**.", f"Ochish manzili: `{route}`."]
		if module_name:
			base.append(f"Chap menyudagi yo'l: **{module_name} → {doctype_name}**.")
		if workspace:
			base.append(f"Workspace: **{workspace}**.")
		return " ".join(base)

	if strict:
		return ""

	if lang == "ru":
		return "Не смог найти точный раздел. Укажите полное имя DocType (например: Stock Entry, Sales Invoice)."
	if lang == "en":
		return "I couldn't find the exact section. Please provide the full DocType name (e.g., Stock Entry, Sales Invoice)."
	return "Aniq bo'limni topa olmadim. DocType nomini to'liq yozing (masalan: Stock Entry, Sales Invoice)."


def build_navigation_reply(user_message: str, *, lang: str, strict: bool = False) -> str:
	plan = build_navigation_plan(user_message)
	return build_navigation_reply_from_plan(plan, lang=lang, strict=strict)
