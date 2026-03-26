from __future__ import annotations

import sys
import types
import unittest
from types import SimpleNamespace
from unittest.mock import patch

if "frappe" not in sys.modules:
	frappe_stub = types.ModuleType("frappe")
	frappe_model_stub = types.ModuleType("frappe.model")
	frappe_model_document_stub = types.ModuleType("frappe.model.document")

	def _whitelist(*args, **kwargs):  # noqa: ANN002, ANN003
		def _decorator(fn):
			return fn

		return _decorator

	def _parse_json(value):  # noqa: ANN001
		return value

	def _scrub(value: str) -> str:
		return str(value or "").strip().lower().replace(" ", "_")

	class _DBStub:
		@staticmethod
		def exists(*args, **kwargs):  # noqa: ANN002, ANN003
			return False

		@staticmethod
		def sql(*args, **kwargs):  # noqa: ANN002, ANN003
			return []

	class _DocumentStub:
		pass

	frappe_stub.whitelist = _whitelist
	frappe_stub.parse_json = _parse_json
	frappe_stub.scrub = _scrub
	frappe_stub.db = _DBStub()
	frappe_stub.session = SimpleNamespace(user="test@example.com")
	frappe_stub.local = SimpleNamespace(site="erp.localhost")
	frappe_stub.utils = SimpleNamespace(now=lambda: "2026-01-01 00:00:00")
	frappe_model_document_stub.Document = _DocumentStub
	sys.modules["frappe"] = frappe_stub
	sys.modules["frappe.model"] = frappe_model_stub
	sys.modules["frappe.model.document"] = frappe_model_document_stub

if "erpnext_ai_tutor.tutor.llm" not in sys.modules:
	llm_stub = types.ModuleType("erpnext_ai_tutor.tutor.llm")

	def _call_llm_stub(*args, **kwargs):  # noqa: ANN002, ANN003
		return "stub"

	def _get_ai_provider_config_stub():  # noqa: ANN201
		return {"language": "uz"}

	llm_stub.call_llm = _call_llm_stub
	llm_stub.get_ai_provider_config = _get_ai_provider_config_stub
	sys.modules["erpnext_ai_tutor.tutor.llm"] = llm_stub

from erpnext_ai_tutor.api import chat  # noqa: E402


class ChatFlowLogicTests(unittest.TestCase):
	def test_item_teaching_request_returns_reply_and_guide_offer_without_starting_guide(self):
		cfg = SimpleNamespace(
			enabled=True,
			advanced_mode=True,
			language="uz",
			emoji_style="soft",
			system_prompt="You are an ERPNext tutor assistant.",
			include_form_context=False,
			max_context_kb=24,
			max_completion_tokens=0,
		)
		guide_offer = {
			"show": True,
			"confidence": 0.82,
			"reason": "semantic_intent_resolved_target",
			"target_label": "Item",
			"route": "/app/item",
			"menu_path": ["Stock", "Item"],
			"mode": "create_record",
		}
		with (
			patch("erpnext_ai_tutor.api.AITutorSettings.get_config", return_value=cfg),
			patch("erpnext_ai_tutor.api.get_ai_provider_config", return_value={"language": "uz"}),
			patch("erpnext_ai_tutor.api.maybe_handle_training_flow", return_value=None),
			patch("erpnext_ai_tutor.api.is_auto_help", return_value=False),
			patch("erpnext_ai_tutor.api.is_greeting_only", return_value=False),
			patch("erpnext_ai_tutor.api.wants_troubleshooting", return_value=False),
			patch("erpnext_ai_tutor.api.should_offer_navigation_guide", return_value=False),
			patch(
				"erpnext_ai_tutor.api.call_llm",
				return_value="Item qo'shish jarayonini yozma ko'rsatib beraman.",
			),
			patch("erpnext_ai_tutor.api.build_guide_offer", return_value=guide_offer),
			patch("erpnext_ai_tutor.api._get_current_user_role_context", return_value={}),
			patch("erpnext_ai_tutor.api._log_chat_diagnostic", return_value=None),
		):
			result = chat(
				"menga item qo'shishni o'rgat",
				context={"ui": {"language": "uz"}},
				history=[],
			)
		self.assertEqual(result.get("ok"), True)
		self.assertEqual(result.get("reply"), "Item qo'shish jarayonini yozma ko'rsatib beraman.")
		self.assertEqual(result.get("guide_offer"), guide_offer)
		self.assertEqual(result.get("guide"), {})
		self.assertNotIn("tutor_state", result)

	def test_navigation_request_returns_reply_and_guide_payload(self):
		cfg = SimpleNamespace(
			enabled=True,
			advanced_mode=True,
			language="uz",
			emoji_style="soft",
			system_prompt="You are an ERPNext tutor assistant.",
			include_form_context=False,
			max_context_kb=24,
			max_completion_tokens=0,
		)
		nav_plan = {"route": "/app/item", "target_label": "Item", "menu_path": ["Stock", "Item"]}
		with (
			patch("erpnext_ai_tutor.api.AITutorSettings.get_config", return_value=cfg),
			patch("erpnext_ai_tutor.api.get_ai_provider_config", return_value={"language": "uz"}),
			patch("erpnext_ai_tutor.api.maybe_handle_training_flow", return_value=None),
			patch("erpnext_ai_tutor.api.is_auto_help", return_value=False),
			patch("erpnext_ai_tutor.api.is_greeting_only", return_value=False),
			patch("erpnext_ai_tutor.api.wants_troubleshooting", return_value=False),
			patch("erpnext_ai_tutor.api.should_offer_navigation_guide", return_value=True),
			patch("erpnext_ai_tutor.api.build_navigation_plan", return_value=nav_plan),
			patch("erpnext_ai_tutor.api.build_navigation_reply_from_plan", return_value="`/app/item`"),
			patch(
				"erpnext_ai_tutor.api.call_llm",
				return_value="Item bo'limiga shu yo'l bilan o'ting. [[GUIDE_NAV]]",
			),
			patch("erpnext_ai_tutor.api._get_current_user_role_context", return_value={}),
			patch("erpnext_ai_tutor.api._log_chat_diagnostic", return_value=None),
		):
			result = chat(
				"item qayerdan kiraman",
				context={"ui": {"language": "uz"}},
				history=[],
			)
		self.assertEqual(result.get("ok"), True)
		self.assertIn("Item bo'limiga", str(result.get("reply") or ""))
		self.assertEqual(result.get("guide", {}).get("route"), "/app/item")
		self.assertEqual(result.get("guide", {}).get("target_label"), "Item")

	def test_read_only_request_returns_plain_reply_without_offer_or_guide(self):
		cfg = SimpleNamespace(
			enabled=True,
			advanced_mode=True,
			language="uz",
			emoji_style="soft",
			system_prompt="You are an ERPNext tutor assistant.",
			include_form_context=False,
			max_context_kb=24,
			max_completion_tokens=0,
		)
		with (
			patch("erpnext_ai_tutor.api.AITutorSettings.get_config", return_value=cfg),
			patch("erpnext_ai_tutor.api.get_ai_provider_config", return_value={"language": "uz"}),
			patch("erpnext_ai_tutor.api.maybe_handle_training_flow", return_value=None),
			patch("erpnext_ai_tutor.api.is_auto_help", return_value=False),
			patch("erpnext_ai_tutor.api.is_greeting_only", return_value=False),
			patch("erpnext_ai_tutor.api.wants_troubleshooting", return_value=False),
			patch("erpnext_ai_tutor.api.should_offer_navigation_guide", return_value=False),
			patch(
				"erpnext_ai_tutor.api.call_llm",
				return_value="Mayli, faqat yozma tarzda tushuntiraman.",
			),
			patch("erpnext_ai_tutor.api.build_guide_offer", return_value=None),
			patch("erpnext_ai_tutor.api._get_current_user_role_context", return_value={}),
			patch("erpnext_ai_tutor.api._log_chat_diagnostic", return_value=None),
		):
			result = chat(
				"faqat tushuntirib ber, cursor siz",
				context={"ui": {"language": "uz"}},
				history=[],
			)
		self.assertEqual(result.get("ok"), True)
		self.assertEqual(result.get("reply"), "Mayli, faqat yozma tarzda tushuntiraman.")
		self.assertIsNone(result.get("guide_offer"))
		self.assertEqual(result.get("guide"), {})
		self.assertNotIn("tutor_state", result)


if __name__ == "__main__":
	unittest.main()
