from __future__ import annotations

from erpnext_ai_tutor.permissions import has_tutor_access


def get_data():
	if not has_tutor_access():
		return []
	return [
		{
			"module_name": "ERPNext AI Tutor",
			"category": "Modules",
			"label": "AI Tutor Admin",
			"color": "#1f2937",
			"icon": "es-line-question",
			"type": "module",
			"description": "Admin controls for AI Tutor and provider setup.",
		}
	]
