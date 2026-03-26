from __future__ import annotations

import sys
import types
import unittest
from unittest.mock import patch

if "frappe" not in sys.modules:
	frappe_stub = types.ModuleType("frappe")

	def _scrub(value: str) -> str:
		return str(value or "").strip().lower().replace(" ", "_")

	class _DBStub:
		@staticmethod
		def exists(*args, **kwargs):  # noqa: ANN002, ANN003
			return False

		@staticmethod
		def sql(*args, **kwargs):  # noqa: ANN002, ANN003
			return []

	frappe_stub.scrub = _scrub
	frappe_stub.db = _DBStub()
	sys.modules["frappe"] = frappe_stub

from erpnext_ai_tutor.tutor.guide_start import build_explicit_guide_start_reply  # noqa: E402


class GuideStartLogicTests(unittest.TestCase):
	def test_builds_create_record_start_reply_from_valid_offer(self):
		offer = {
			"show": True,
			"target_label": "Item",
			"route": "/app/item",
			"menu_path": ["Stock", "Item"],
			"mode": "create_record",
		}
		with patch(
			"erpnext_ai_tutor.tutor.guide_start._build_start_step_response",
			return_value={"ok": True, "reply": "start", "guide": {"route": "/app/item"}},
		) as start_builder:
			result = build_explicit_guide_start_reply(offer, lang="uz")
		self.assertEqual(result.get("ok"), True)
		start_builder.assert_called_once()

	def test_create_record_start_reply_can_be_enriched_with_primary_action_label(self):
		offer = {
			"show": True,
			"target_label": "Item",
			"route": "/app/item",
			"menu_path": ["Stock", "Item"],
			"mode": "create_record",
		}
		result = build_explicit_guide_start_reply(
			offer,
			lang="uz",
			ctx={"ui": {"page_actions": {"primary_action": "Yangi Item"}}},
		)
		self.assertEqual(result.get("ok"), True)
		self.assertIn("Yangi Item", str(result.get("reply") or ""))

	def test_returns_none_for_invalid_offer(self):
		offer = {"show": True, "target_label": "Item", "mode": "create_record"}
		result = build_explicit_guide_start_reply(offer, lang="uz")
		self.assertIsNone(result)

	def test_builds_manage_roles_start_reply_from_valid_offer(self):
		offer = {
			"show": True,
			"target_label": "User",
			"route": "/app/user",
			"menu_path": ["Users", "User"],
			"mode": "manage_roles",
		}
		with patch(
			"erpnext_ai_tutor.tutor.guide_start._handle_manage_roles_intent",
			return_value={"ok": True, "reply": "roles", "guide": {"route": "/app/user"}},
		) as manage_roles_handler:
			result = build_explicit_guide_start_reply(offer, lang="uz")
		self.assertEqual(result.get("ok"), True)
		manage_roles_handler.assert_called_once()


if __name__ == "__main__":
	unittest.main()
