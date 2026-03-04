from __future__ import annotations

import re


APOSTROPHE_VARIANTS_RE = re.compile(r"[`’‘ʻʼ‛´]")

CREATE_ACTION_RE = re.compile(
	r"(?:\b(?:yangi|create|add|new|yarat[a-z\u0400-\u04FF'’_-]*|qo['’]?sh[a-z\u0400-\u04FF'’_-]*)\b)",
	re.IGNORECASE,
)

PRACTICAL_TUTORIAL_RE = re.compile(
	r"(?:"
	r"\bo['’]?rgat[a-z\u0400-\u04FF'’_-]*\b|"
	r"\borgat[a-z\u0400-\u04FF'’_-]*\b|"
	r"\bto['’]?ldir[a-z\u0400-\u04FF'’_-]*\b|"
	r"\btoldir[a-z\u0400-\u04FF'’_-]*\b|"
	r"\bqadam(?:-|\s*)baqadam\b|"
	r"\bamaliy(?:da)?\s+ko['’]?rsat[a-z\u0400-\u04FF'’_-]*\b|"
	r"\bdemo(?:da)?\s+ko['’]?rsat[a-z\u0400-\u04FF'’_-]*\b|"
	r"\bshow\s+me\s+how\b|"
	r"\bstep[\s-]*by[\s-]*step\b"
	r")",
	re.IGNORECASE,
)

CONTINUE_ACTION_RE = re.compile(
	r"(?:\b(?:davom|keyingi|yana|continue|next)\b)",
	re.IGNORECASE,
)

SHOW_SAVE_RE = re.compile(
	r"(?:\b(?:save|submit|saqla|saqlash|сохран|отправ)\b)",
	re.IGNORECASE,
)

GENERIC_HELP_RE = re.compile(
	r"(?:\b(?:qanday|qanaqa|nima\s+qil(?:ay|sam|ishim)|yordam|help|how\s+do\s+i|what\s+should\s+i\s+do)\b)",
	re.IGNORECASE,
)

ACTION_KEYWORDS_RE = re.compile(
	r"(?:\b(?:qo['’]sh|yarat|create|add|new|tahrir|edit|delete|o['’]chir|top|find|navigate|ko['’]rsat|show)\b)",
	re.IGNORECASE,
)

ALLOWED_STAGES = {"open_and_fill_basic", "fill_more", "show_save_only"}
ALLOWED_PENDING = {"", "action", "target"}
ALLOWED_STOCK_ENTRY_TYPES = {"Material Issue", "Material Receipt", "Material Transfer"}
AI_TARGET_ALIASES = {
	"user": "User",
	"users": "User",
	"foydalanuvchi": "User",
	"foydalanuvchilar": "User",
	"bom": "BOM",
	"bill of materials": "BOM",
}
ALLOWED_INTENT_ACTIONS = {"create_record", "continue", "show_save", "other"}


def normalize_apostrophes(value: str) -> str:
	"""Normalize common Uzbek apostrophe variants for regex-based intent rules."""
	text = str(value or "")
	return APOSTROPHE_VARIANTS_RE.sub("'", text)
