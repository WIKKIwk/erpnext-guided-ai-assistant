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

if "erpnext_ai_tutor.tutor.training_resolution" not in sys.modules:
	training_resolution_stub = types.ModuleType("erpnext_ai_tutor.tutor.training_resolution")

	def _resolve_doctype_target_stub(*args, **kwargs):  # noqa: ANN002, ANN003
		return {}

	training_resolution_stub._resolve_doctype_target = _resolve_doctype_target_stub
	sys.modules["erpnext_ai_tutor.tutor.training_resolution"] = training_resolution_stub

from erpnext_ai_tutor.tutor.training_handlers import (  # noqa: E402
	_handle_active_continue,
	_handle_create_or_intent,
	_handle_manage_roles_intent,
	_handle_pending_action,
	_handle_pending_target,
)
from erpnext_ai_tutor.tutor.training_runtime import _resolve_training_target  # noqa: E402
from erpnext_ai_tutor.tutor.training_targets import _extract_doctype_mention_from_text  # noqa: E402


class TrainingFlowLogicTests(unittest.TestCase):
	def test_pending_action_without_target_returns_action_clarify_state(self):
		result = _handle_pending_action(
			lang="uz",
			state_doctype="",
			create_requested=False,
			resolve_training_target=lambda **kwargs: {},
			pick_stock_entry_type=lambda _doctype: "",
		)
		self.assertEqual(result.get("tutor_state", {}).get("pending"), "action")
		self.assertNotIn("guide", result)

	def test_pending_target_without_target_returns_target_clarify_state(self):
		result = _handle_pending_target(
			lang="uz",
			state_doctype="",
			create_requested=False,
			resolve_training_target=lambda **kwargs: {},
			pick_stock_entry_type=lambda _doctype: "",
		)
		self.assertEqual(result.get("tutor_state", {}).get("pending"), "target")
		self.assertEqual(result.get("tutor_state", {}).get("action"), "create_record")

	def test_active_continue_returns_fill_more_stage(self):
		with patch(
			"erpnext_ai_tutor.tutor.training_handlers._resolve_doctype_target",
			return_value={"doctype": "Item", "route": "/app/item", "menu_path": ["Stock", "Item"]},
		):
			result = _handle_active_continue(
				lang="uz",
				ctx={},
				state_action="create_record",
				state_doctype="Item",
				context_doctype="",
					continue_requested=True,
					show_save_requested=False,
					dependency_create_requested=False,
					create_requested=False,
					explicit_doctype="",
					pick_stock_entry_type=lambda _doctype: "",
				)
		self.assertIsInstance(result, dict)
		self.assertEqual(result.get("tutor_state", {}).get("stage"), "fill_more")
		self.assertEqual(result.get("guide", {}).get("tutorial", {}).get("stage"), "fill_more")
		self.assertNotIn("allow_dependency_creation", result.get("guide", {}).get("tutorial", {}))

	def test_active_continue_sets_allow_dependency_creation_in_guide_and_state(self):
		with patch(
			"erpnext_ai_tutor.tutor.training_handlers._resolve_doctype_target",
			return_value={"doctype": "BOM", "route": "/app/bom", "menu_path": ["Manufacturing", "BOM"]},
		):
			result = _handle_active_continue(
				lang="uz",
				ctx={},
				state_action="create_record",
				state_doctype="BOM",
				context_doctype="",
				continue_requested=True,
				show_save_requested=False,
				dependency_create_requested=True,
				create_requested=False,
				explicit_doctype="",
				pick_stock_entry_type=lambda _doctype: "",
			)
		self.assertTrue(result.get("guide", {}).get("tutorial", {}).get("allow_dependency_creation"))
		self.assertTrue(result.get("tutor_state", {}).get("allow_dependency_creation"))

	def test_runtime_prefers_context_target_when_state_context_mismatch(self):
		context_target = {"doctype": "Customer", "route": "/app/customer", "menu_path": ["Selling", "Customer"]}

		def _target_from_doctype_side_effect(doctype: str):
			if doctype == "Customer":
				return context_target
			return {}

		with patch(
			"erpnext_ai_tutor.tutor.training_runtime._target_from_doctype",
			side_effect=_target_from_doctype_side_effect,
		), patch(
			"erpnext_ai_tutor.tutor.training_runtime._resolve_doctype_target",
			return_value={"doctype": "Item", "route": "/app/item", "menu_path": ["Stock", "Item"]},
		) as resolve_fallback:
			result = _resolve_training_target(
				explicit_target={},
				context_doctype="Customer",
				state_action="create_record",
				state_doctype="Sales Invoice",
				explicit_doctype="",
				intent_doctype="",
				create_requested=False,
				continue_requested=False,
				show_save_requested=False,
				practical_tutorial_requested=False,
				text_rules="davom et",
				ctx={},
				allow_context_fallback=True,
			)
		self.assertEqual(result.get("doctype"), "Customer")
		resolve_fallback.assert_not_called()

	def test_runtime_prefers_intent_target_for_create_request_even_if_context_exists(self):
		context_target = {"doctype": "User", "route": "/app/user", "menu_path": ["Users", "User"]}
		intent_target = {"doctype": "BOM", "route": "/app/bom", "menu_path": ["Manufacturing", "BOM"]}

		def _target_from_doctype_side_effect(doctype: str):
			if doctype == "User":
				return context_target
			return {}

		def _resolve_doctype_target_side_effect(user_message: str, ctx, fallback_doctype="", allow_context_fallback=True):  # noqa: ANN001, ANN201
			if str(user_message or "").strip() == "BOM":
				return intent_target
			return {}

		with patch(
			"erpnext_ai_tutor.tutor.training_runtime._target_from_doctype",
			side_effect=_target_from_doctype_side_effect,
		), patch(
			"erpnext_ai_tutor.tutor.training_runtime._resolve_doctype_target",
			side_effect=_resolve_doctype_target_side_effect,
		):
			result = _resolve_training_target(
				explicit_target={},
				context_doctype="User",
				state_action="create_record",
				state_doctype="User",
				explicit_doctype="",
				intent_doctype="BOM",
				create_requested=True,
				continue_requested=True,
				show_save_requested=False,
				practical_tutorial_requested=True,
				text_rules="bom ochishni o'rgat",
				ctx={},
				allow_context_fallback=True,
			)
		self.assertEqual(result.get("doctype"), "BOM")

	def test_extract_doctype_alias_bom_from_text(self):
		with patch(
			"erpnext_ai_tutor.tutor.training_targets._is_real_doctype",
			side_effect=lambda name: str(name or "").strip() == "BOM",
		):
			result = _extract_doctype_mention_from_text("endi menga bom ochishni o'rgat")
		self.assertEqual(result, "BOM")

	def test_create_or_intent_does_not_start_when_create_not_requested(self):
		result = _handle_create_or_intent(
			lang="uz",
			state_doctype="",
			create_requested=False,
			resolve_training_target=lambda **kwargs: {"doctype": "User", "route": "/app/user", "menu_path": ["Users", "User"]},
			pick_stock_entry_type=lambda _doctype: "",
		)
		self.assertIsNone(result)

	def test_manage_roles_intent_returns_manage_roles_tutorial_guide(self):
		result = _handle_manage_roles_intent(
			lang="uz",
			manage_roles_requested=True,
			state_doctype="",
			context_doctype="",
			intent_doctype="User",
		)
		self.assertEqual(result.get("guide", {}).get("route"), "/app/user")
		self.assertEqual(result.get("guide", {}).get("target_label"), "User")
		self.assertEqual(result.get("guide", {}).get("tutorial", {}).get("mode"), "manage_roles")
		self.assertEqual(result.get("tutor_state"), {})

	def test_manage_roles_intent_prefers_user_even_when_intent_mentions_role(self):
		result = _handle_manage_roles_intent(
			lang="uz",
			manage_roles_requested=True,
			state_doctype="BOM",
			context_doctype="Role",
			intent_doctype="Role",
		)
		self.assertEqual(result.get("guide", {}).get("target_label"), "User")
		self.assertEqual(result.get("guide", {}).get("route"), "/app/user")


if __name__ == "__main__":
	unittest.main()
