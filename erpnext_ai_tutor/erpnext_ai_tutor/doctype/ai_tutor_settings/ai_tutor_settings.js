frappe.ui.form.on("AI Tutor Settings", {
	setup(frm) {
		apply_model_options(frm, { force_default: false });
	},

	refresh(frm) {
		apply_model_options(frm, { force_default: false });
	},

	ai_provider(frm) {
		apply_model_options(frm, { force_default: true });
	},
});

function apply_model_options(frm, opts = {}) {
	const force_default = Boolean(opts.force_default);
	const provider = String(frm.doc.ai_provider || "openai").toLowerCase();
	const models = MODEL_OPTIONS[provider] || MODEL_OPTIONS.openai;
	const current = String(frm.doc.ai_model || "").trim();
	const custom = String(frm.doc.custom_ai_model || "").trim();

	frm.set_df_property("ai_model", "options", models.join("\n"));
	if (custom) return;
	if (force_default || !current || !models.includes(current)) {
		frm.set_value("ai_model", models[0]);
	}
}

const MODEL_OPTIONS = {
	openai: ["gpt-5-mini", "gpt-5", "gpt-5-nano"],
	gemini: ["gemini-3-flash-preview", "gemini-3-flash", "gemini-3-pro"],
};
