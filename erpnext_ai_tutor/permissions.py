from __future__ import annotations

import frappe


ADMIN_ROLES = {"System Manager"}


def has_tutor_access(user: str | None = None) -> bool:
	"""Allow AI Tutor only for admin-level users."""
	current_user = str(user or getattr(frappe.session, "user", "") or "Guest")
	if current_user == "Administrator":
		return True
	if current_user in {"", "Guest"}:
		return False

	try:
		roles = set(frappe.get_roles(current_user))
	except Exception:
		return False

	return bool(roles.intersection(ADMIN_ROLES))
