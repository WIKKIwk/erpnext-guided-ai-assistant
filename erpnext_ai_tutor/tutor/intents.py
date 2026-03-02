from __future__ import annotations

import re
from typing import Any


AUTO_HELP_PREFIX_RE = re.compile(
	r"^\s*(?:ERP\s+tizimida\s+xatolik/ogohlantirish\s+chiqdi\.|ERP\s+system\s+reported\s+an\s+error\s+or\s+warning\.)",
	re.IGNORECASE,
)

TROUBLE_KEYWORDS_RE = re.compile(
	r"\b(xato|xatolik|error|ogohlantirish|warning|muammo|tuzat|fix|failed|traceback|permission|ruxsat|not\s+found)\b",
	re.IGNORECASE,
)

GREETING_ONLY_RE = re.compile(
	r"^\s*(salom|assalomu\s+alaykum|asalomu\s+alaykum|salam|hi|hello|hey|rahmat|raxmat|thanks|thx|привет|здравствуйте|спасибо|благодарю)\s*[!?.…]*\s*$",
	re.IGNORECASE,
)

WHERE_AM_I_RE = re.compile(
	r"(?:^|\b)(?:men\s+)?qayerda\s*man(?:\b|$)|(?:^|\b)hozir\s+qayerda\s*man(?:\b|$)|(?:^|\b)qaysi\s+(?:sahifa|qism|bo['’]lim|bo‘lim|joy)da\s*man(?:\b|$)|(?:^|\b)where\s+am\s+i(?:\b|$)",
	re.IGNORECASE,
)

NAVIGATION_QUERY_RE = re.compile(
	r"(?:\b(?:qayerda|qaysi\s+(?:bo['’]lim|bo‘lim|qism)da|qayerdan\s+top|qanday\s+(?:kirsam|ochsam)|where\s+is|how\s+to\s+open|ko['’]rsat(?:ib)?(?:\s+yubor)?|ko‘rsat(?:ib)?(?:\s+yubor)?|korsat(?:ib)?(?:\s+yubor)?|ochib\s+ber|olib\s+bor|navigate)\b)",
	re.IGNORECASE,
)

WHICH_FIELD_RE = re.compile(r"\b(qaysi\s+(maydon|field)|qayerini\s+to['’]ldiryapman)\b", re.IGNORECASE)

WHAT_NEXT_RE = re.compile(
	r"(?:\b(nima\s+qil(?:ay|ishim\s+kerak)|keyingi\s+qadam|qanday\s+davom|what\s+next|next\s+step|what\s+should\s+i\s+do|what\s+do\s+i\s+do\s+next|что\s+делать|следующ(?:ий|ие)\s+шаг)\b)",
	re.IGNORECASE,
)

DISMISSIVE_RE = re.compile(
	r"(ko['’]ra\s+olmayman|visual\s+ma['’]lumot|ko['’]rinmaydi|cannot\s+see|can['’]t\s+see|i\s+can['’]t\s+see|url\s+manzilini\s+ayt)",
	re.IGNORECASE,
)


def is_auto_help(user_message: str) -> bool:
	return bool(AUTO_HELP_PREFIX_RE.match(user_message or ""))


def is_greeting_only(user_message: str) -> bool:
	return bool(GREETING_ONLY_RE.match(user_message or ""))


def is_navigation_lookup(user_message: str) -> bool:
	text = user_message or ""
	return bool(NAVIGATION_QUERY_RE.search(text)) and not bool(WHERE_AM_I_RE.search(text))


def wants_troubleshooting(user_message: str, ctx: Any) -> bool:
	if TROUBLE_KEYWORDS_RE.search(user_message or ""):
		return True
	if isinstance(ctx, dict):
		event = ctx.get("event")
		if isinstance(event, dict):
			severity = str(event.get("severity") or "").strip().lower()
			if severity in {"error", "warning"} and ("?" in (user_message or "") or len((user_message or "").strip()) > 30):
				return True
	return False
