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

if "erpnext_ai_tutor.tutor.llm" not in sys.modules:
	llm_stub = types.ModuleType("erpnext_ai_tutor.tutor.llm")

	def _call_llm_stub(*args, **kwargs):  # noqa: ANN002, ANN003
		return '{"action":"other","doctype":"","confidence":0.0,"allow_dependency_creation":false,"field_updates":[]}'

	llm_stub.call_llm = _call_llm_stub
	sys.modules["erpnext_ai_tutor.tutor.llm"] = llm_stub

if "erpnext_ai_tutor.tutor.training_resolution" not in sys.modules:
	training_resolution_stub = types.ModuleType("erpnext_ai_tutor.tutor.training_resolution")

	def _resolve_doctype_target_stub(*args, **kwargs):  # noqa: ANN002, ANN003
		return {}

	training_resolution_stub._resolve_doctype_target = _resolve_doctype_target_stub
	sys.modules["erpnext_ai_tutor.tutor.training_resolution"] = training_resolution_stub

from erpnext_ai_tutor.tutor.guide_offer import build_guide_offer, build_guide_offer_decision  # noqa: E402


class GuideOfferLogicTests(unittest.TestCase):
	def test_returns_offer_for_semantic_create_record_request(self):
		intent = {
			"action": "create_record",
			"doctype": "Item",
			"confidence": 0.82,
			"allow_dependency_creation": False,
			"field_updates": [],
		}
		target = {"doctype": "Item", "route": "/app/item", "menu_path": ["Stock", "Item"]}
		with (
			patch(
				"erpnext_ai_tutor.tutor.guide_offer._infer_training_intent_with_ai",
				return_value=intent,
			),
			patch(
				"erpnext_ai_tutor.tutor.guide_offer._resolve_doctype_target",
				return_value=target,
			),
		):
			result = build_guide_offer("menga item qo'shishni o'rgat", {})
		self.assertEqual(result.get("show"), True)
		self.assertEqual(result.get("target_label"), "Item")
		self.assertEqual(result.get("route"), "/app/item")
		self.assertEqual(result.get("mode"), "create_record")

	def test_returns_none_when_active_guided_state_exists(self):
		with patch(
			"erpnext_ai_tutor.tutor.guide_offer._infer_training_intent_with_ai",
			return_value={"action": "create_record", "doctype": "Item", "confidence": 0.9},
		) as infer_intent:
			result = build_guide_offer(
				"menga item qo'shishni o'rgat",
				{
					"tutor_state": {
						"action": "create_record",
						"doctype": "Item",
						"stage": "open_and_fill_basic",
					}
				},
			)
		self.assertIsNone(result)
		infer_intent.assert_not_called()

	def test_returns_none_when_target_cannot_be_resolved(self):
		intent = {
			"action": "create_record",
			"doctype": "Item",
			"confidence": 0.82,
			"allow_dependency_creation": False,
			"field_updates": [],
		}
		with (
			patch(
				"erpnext_ai_tutor.tutor.guide_offer._infer_training_intent_with_ai",
				return_value=intent,
			),
			patch(
				"erpnext_ai_tutor.tutor.guide_offer._resolve_doctype_target",
				return_value={},
			),
		):
			result = build_guide_offer("menga item qo'shishni o'rgat", {})
		self.assertIsNone(result)

	def test_context_match_allows_lower_confidence_offer(self):
		intent = {
			"action": "create_record",
			"doctype": "",
			"confidence": 0.48,
			"allow_dependency_creation": False,
			"field_updates": [],
		}
		target = {"doctype": "Item", "route": "/app/item", "menu_path": ["Stock", "Item"]}
		with (
			patch(
				"erpnext_ai_tutor.tutor.guide_offer._infer_training_intent_with_ai",
				return_value=intent,
			),
			patch(
				"erpnext_ai_tutor.tutor.guide_offer._resolve_doctype_target",
				return_value=target,
			),
			patch(
				"erpnext_ai_tutor.tutor.guide_offer._infer_doctype_from_context",
				return_value="Item",
			),
		):
			result = build_guide_offer("qanday davom etaman", {"form": {"doctype": "Item"}})
		self.assertEqual(result.get("show"), True)
		self.assertEqual(result.get("reason"), "semantic_intent_resolved_target_context_match")

	def test_without_explicit_doctype_or_context_needs_higher_confidence(self):
		intent = {
			"action": "create_record",
			"doctype": "",
			"confidence": 0.60,
			"allow_dependency_creation": False,
			"field_updates": [],
		}
		target = {"doctype": "Item", "route": "/app/item", "menu_path": ["Stock", "Item"]}
		with (
			patch(
				"erpnext_ai_tutor.tutor.guide_offer._infer_training_intent_with_ai",
				return_value=intent,
			),
			patch(
				"erpnext_ai_tutor.tutor.guide_offer._resolve_doctype_target",
				return_value=target,
			),
			patch(
				"erpnext_ai_tutor.tutor.guide_offer._infer_doctype_from_context",
				return_value="",
			),
		):
			result = build_guide_offer("qanday davom etaman", {})
		self.assertIsNone(result)

	def test_read_only_preference_suppresses_guide_offer(self):
		with patch(
			"erpnext_ai_tutor.tutor.guide_offer._infer_training_intent_with_ai",
			return_value={"action": "create_record", "doctype": "Item", "confidence": 0.95},
		) as infer_intent:
			result = build_guide_offer("faqat tushuntirib ber, cursor siz", {})
		self.assertIsNone(result)
		infer_intent.assert_not_called()

	def test_decision_payload_is_privacy_safe(self):
		intent = {
			"action": "create_record",
			"doctype": "Item",
			"confidence": 0.82,
			"allow_dependency_creation": False,
			"field_updates": [],
		}
		target = {"doctype": "Item", "route": "/app/item", "menu_path": ["Stock", "Item"]}
		with (
			patch(
				"erpnext_ai_tutor.tutor.guide_offer._infer_training_intent_with_ai",
				return_value=intent,
			),
			patch(
				"erpnext_ai_tutor.tutor.guide_offer._resolve_doctype_target",
				return_value=target,
			),
		):
			result = build_guide_offer_decision("secret item qo'shishni o'rgat", {"route_str": "app/item"})
		diagnostic = result.get("diagnostic") or {}
		self.assertEqual(diagnostic.get("decision"), "offer_shown")
		self.assertNotIn("message", diagnostic)
		self.assertNotIn("user_message", diagnostic)
		self.assertEqual(diagnostic.get("target_label"), "Item")


if __name__ == "__main__":
	unittest.main()
