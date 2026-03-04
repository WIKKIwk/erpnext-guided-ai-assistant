from __future__ import annotations

from erpnext_ai_tutor.tutor.training_patterns import (
	ACTION_KEYWORDS_RE,
	CREATE_ACTION_RE,
	GENERIC_HELP_RE,
	PRACTICAL_TUTORIAL_RE,
	normalize_apostrophes as _normalize_apostrophes,
)


def _needs_action_clarification(user_message: str) -> bool:
	text = _normalize_apostrophes(str(user_message or "")).strip()
	if len(text) > 140:
		return False
	if CREATE_ACTION_RE.search(text):
		return False
	return bool(GENERIC_HELP_RE.search(text)) and not bool(ACTION_KEYWORDS_RE.search(text))


def _looks_like_practical_tutorial_request(user_message: str) -> bool:
	"""Heuristic fallback when LLM intent classifier is uncertain."""
	text = _normalize_apostrophes(str(user_message or "")).strip()
	if not text:
		return False
	if PRACTICAL_TUTORIAL_RE.search(text):
		return True
	# "qanday + create/add/new" style requests should be treated as tutorial asks.
	if GENERIC_HELP_RE.search(text) and CREATE_ACTION_RE.search(text):
		return True
	return False
