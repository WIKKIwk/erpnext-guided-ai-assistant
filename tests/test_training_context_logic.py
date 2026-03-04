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
	frappe_stub.get_all = lambda *args, **kwargs: []  # noqa: E731, ANN002, ANN003
	sys.modules["frappe"] = frappe_stub

if "erpnext_ai_tutor.tutor.llm" not in sys.modules:
	llm_stub = types.ModuleType("erpnext_ai_tutor.tutor.llm")

	def _call_llm_stub(*args, **kwargs):  # noqa: ANN002, ANN003
		return '{"action":"other","doctype":"","confidence":0.0,"allow_dependency_creation":false,"field_updates":[]}'

	llm_stub.call_llm = _call_llm_stub
	sys.modules["erpnext_ai_tutor.tutor.llm"] = llm_stub


from erpnext_ai_tutor.tutor.training_context import _build_training_context  # noqa: E402


class TrainingContextLogicTests(unittest.TestCase):
	def _base_ctx(self, *, active_field: str = "") -> dict:
		ctx = {
			"form": {
				"doctype": "User",
				"docname": "new-user-1",
				"is_new": True,
				"doc": {
					"doctype": "User",
					"name": "new-user-1",
					"email": "demo.email@example.com",
					"username": "demo.user",
				},
			},
			"tutor_state": {
				"action": "create_record",
				"doctype": "User",
				"stage": "open_and_fill_basic",
				"pending": "",
			},
		}
		if active_field:
			ctx["active_field"] = {"fieldname": active_field, "label": active_field.title(), "value": "demo.user"}
		return ctx

	def test_explicit_username_request_overrides_wrong_email_intent(self):
		intent_payload = {
			"action": "continue",
			"doctype": "User",
			"confidence": 0.92,
			"allow_dependency_creation": False,
			"field_updates": [{"fieldname": "email", "overwrite": True, "value": "demo.email@example.com"}],
		}
		with patch("erpnext_ai_tutor.tutor.training_context._infer_training_intent_with_ai", return_value=intent_payload):
			result = _build_training_context("username ni o'zgartir", self._base_ctx(active_field="username"))
		overrides = result.get("field_overrides") or {}
		self.assertIn("username", overrides)
		self.assertNotIn("email", overrides)
		self.assertTrue(bool(overrides["username"].get("overwrite")))
		self.assertTrue(result.get("continue_requested"))

	def test_generic_change_uses_active_user_field(self):
		intent_payload = {
			"action": "continue",
			"doctype": "User",
			"confidence": 0.78,
			"allow_dependency_creation": False,
			"field_updates": [{"fieldname": "email", "overwrite": True, "value": "demo.email@example.com"}],
		}
		with patch("erpnext_ai_tutor.tutor.training_context._infer_training_intent_with_ai", return_value=intent_payload):
			result = _build_training_context("boshqasiga o'zgartirib ber", self._base_ctx(active_field="username"))
		overrides = result.get("field_overrides") or {}
		self.assertIn("username", overrides)
		self.assertNotIn("email", overrides)
		self.assertTrue(bool(overrides["username"].get("overwrite")))

	def test_explicit_email_request_stays_email_even_if_active_field_is_username(self):
		intent_payload = {
			"action": "continue",
			"doctype": "User",
			"confidence": 0.93,
			"allow_dependency_creation": False,
			"field_updates": [{"fieldname": "email", "overwrite": True, "value": "demo.email@example.com"}],
		}
		with patch("erpnext_ai_tutor.tutor.training_context._infer_training_intent_with_ai", return_value=intent_payload):
			result = _build_training_context(
				"email ni boshqa emailga almashtirib ber",
				self._base_ctx(active_field="username"),
			)
		overrides = result.get("field_overrides") or {}
		self.assertIn("email", overrides)
		self.assertNotIn("username", overrides)
		self.assertTrue(bool(overrides["email"].get("overwrite")))


if __name__ == "__main__":
	unittest.main()
