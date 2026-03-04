from __future__ import annotations

import re
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

_ALLOWED_USER_OVERRIDE_FIELDS = {"email", "first_name", "middle_name", "last_name", "username"}
_CHANGE_INTENT_RE = re.compile(
	r"(o['`’]?zgart|almashtir|yangila|tahrir|edit|update|change|replace|rewrite|correct|fix|rename|измени|поменяй|замени|обнови)",
	re.IGNORECASE,
)
_EMAIL_VALUE_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_EMAIL_FIELD_RE = re.compile(
	r"\b(e-?mail|email|mail address|email address|pochta|электронн(?:ая)?\s+почта|почта)\b",
	re.IGNORECASE,
)
_USERNAME_FIELD_RE = re.compile(
	r"\b(user[\s_-]*name|username|login|foydalanuvchi\s+nomi|логин|имя\s+пользователя)\b",
	re.IGNORECASE,
)
_QUOTED_VALUE_RE = re.compile(r"""["'`“”‘’]([^"'`“”‘’]{1,160})["'`“”‘’]""")
_USERNAME_VALUE_RE = re.compile(r"^[A-Za-z0-9._-]{3,80}$")
_USERNAME_STOPWORDS = {
	"ozgartir",
	"ozgartir",
	"almashtir",
	"yangila",
	"change",
	"update",
	"edit",
	"replace",
	"rename",
	"boshqa",
	"new",
	"yangi",
	"ga",
	"to",
	"ni",
	"qilib",
	"ber",
}


def _build_field_overrides(intent_field_updates: Any, *, doctype: str) -> Dict[str, Dict[str, Any]]:
	"""Normalize semantic field-update requests into tutorial override map."""
	if str(doctype or "").strip().lower() != "user":
		return {}
	if not isinstance(intent_field_updates, list):
		return {}
	out: Dict[str, Dict[str, Any]] = {}
	for row in intent_field_updates[:10]:
		if not isinstance(row, dict):
			continue
		fieldname = str(row.get("fieldname") or "").strip().lower()
		if fieldname not in _ALLOWED_USER_OVERRIDE_FIELDS:
			continue
		overwrite = bool(row.get("overwrite"))
		value = str(row.get("value") or "").strip()
		if not overwrite and not value:
			continue
		cfg: Dict[str, Any] = {}
		if overwrite:
			cfg["overwrite"] = True
		if value:
			cfg["value"] = value
		if cfg:
			out[fieldname] = cfg
	return out


def _extract_active_user_field(ctx: Dict[str, Any]) -> str:
	if not isinstance(ctx, dict):
		return ""
	active_field = ctx.get("active_field")
	if not isinstance(active_field, dict):
		return ""
	fieldname = str(active_field.get("fieldname") or "").strip().lower()
	if fieldname in _ALLOWED_USER_OVERRIDE_FIELDS:
		return fieldname
	return ""


def _detect_explicit_user_target_field(text_rules: str) -> str:
	text = str(text_rules or "").strip()
	if not text:
		return ""
	has_username = bool(_USERNAME_FIELD_RE.search(text))
	has_email = bool(_EMAIL_FIELD_RE.search(text))
	if has_username and not has_email:
		return "username"
	if has_email and not has_username:
		return "email"
	return ""


def _extract_user_override_value(text_rules: str, fieldname: str) -> str:
	text = str(text_rules or "").strip()
	target_field = str(fieldname or "").strip().lower()
	if not text or target_field not in _ALLOWED_USER_OVERRIDE_FIELDS:
		return ""
	if target_field == "email":
		match = _EMAIL_VALUE_RE.search(text)
		return str(match.group(0) or "").strip() if match else ""
	if target_field != "username":
		return ""
	for quoted in _QUOTED_VALUE_RE.findall(text):
		candidate = str(quoted or "").strip()
		if not candidate:
			continue
		if _USERNAME_VALUE_RE.fullmatch(candidate) and "@" not in candidate and candidate.lower() not in _USERNAME_STOPWORDS:
			return candidate
	match = re.search(
		r"(?:user[\s_-]*name|username|login|foydalanuvchi\s+nomi|логин|имя\s+пользователя)[^A-Za-z0-9._-]{0,24}([A-Za-z0-9._-]{3,80})",
		text,
		flags=re.IGNORECASE,
	)
	if not match:
		return ""
	candidate = str(match.group(1) or "").strip()
	if not _USERNAME_VALUE_RE.fullmatch(candidate):
		return ""
	if candidate.lower() in _USERNAME_STOPWORDS or "@" in candidate:
		return ""
	return candidate


def _normalize_user_field_updates_with_context(
	*,
	text_rules: str,
	ctx: Dict[str, Any],
	doctype: str,
	intent_field_updates: Any,
) -> Any:
	if str(doctype or "").strip().lower() != "user":
		return intent_field_updates
	updates = intent_field_updates if isinstance(intent_field_updates, list) else []
	explicit_field = _detect_explicit_user_target_field(text_rules)
	active_field = _extract_active_user_field(ctx)
	has_change_intent = bool(_CHANGE_INTENT_RE.search(str(text_rules or "").strip()))
	target_field = explicit_field
	if not target_field and has_change_intent and active_field in _ALLOWED_USER_OVERRIDE_FIELDS:
		target_field = active_field
	if not target_field:
		return updates
	target_value = _extract_user_override_value(text_rules, target_field)
	existing_value = ""
	for row in updates[:10]:
		if not isinstance(row, dict):
			continue
		if str(row.get("fieldname") or "").strip().lower() != target_field:
			continue
		existing_value = str(row.get("value") or "").strip()
		if existing_value:
			break
	normalized: Dict[str, Any] = {"fieldname": target_field, "overwrite": True}
	if target_value:
		normalized["value"] = target_value
	elif existing_value:
		normalized["value"] = existing_value
	return [normalized]


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
	intent_field_updates = intent.get("field_updates") if isinstance(intent.get("field_updates"), list) else []
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
	override_doctype = state_doctype or intent_doctype or context_doctype
	intent_field_updates = _normalize_user_field_updates_with_context(
		text_rules=text_rules,
		ctx=ctx,
		doctype=override_doctype,
		intent_field_updates=intent_field_updates,
	)
	field_overrides = _build_field_overrides(intent_field_updates, doctype=override_doctype)
	if (
		field_overrides
		and not (state_action == "create_record" and state_doctype)
		and not show_save_requested
		and not manage_roles_requested
	):
		# Even without active tutorial state, semantic value-change requests on User form
		# should launch guided flow instead of falling back to plain text advice.
		create_requested = True
		practical_tutorial_requested = True
		if not intent_doctype:
			intent_doctype = str(override_doctype or "").strip()
	if state_action == "create_record" and state_doctype and field_overrides and not show_save_requested and not manage_roles_requested:
		# Semantic "change value" requests should continue active guided flow.
		continue_requested = True
		create_requested = False
		practical_tutorial_requested = True

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
		"field_overrides": field_overrides,
	}
