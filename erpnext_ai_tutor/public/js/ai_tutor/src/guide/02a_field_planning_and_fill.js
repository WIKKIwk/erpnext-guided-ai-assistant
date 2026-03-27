				parseFieldOptions(rawOptions) {
					if (Array.isArray(rawOptions)) {
						return rawOptions.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 20);
					}
				const text = String(rawOptions || "").trim();
				if (!text) return [];
				return text
					.split("\n")
					.map((x) => String(x || "").trim())
						.filter(Boolean)
						.slice(0, 20);
				}

				pickPreferredSelectOption(rawOptions, preferred = []) {
					const options = this.parseFieldOptions(rawOptions);
					if (!options.length) return "";
					const normalize = (v) => String(v || "").trim().toLowerCase();
					const junkValues = new Set(["", "-", "--", "---", "none", "select", "tanlang", "choose"]);
					const preferredNorm = Array.isArray(preferred)
						? preferred.map((x) => normalize(x)).filter(Boolean)
						: [];

					for (const wanted of preferredNorm) {
						const found = options.find((opt) => normalize(opt) === wanted);
						if (found) return found;
					}
					for (const opt of options) {
						const norm = normalize(opt);
						if (!norm || junkValues.has(norm)) continue;
						if (/^(please\s+select|tanlang|select\b)/i.test(opt)) continue;
						return opt;
					}
					return options[0] || "";
				}

				isTutorialNoiseField(doctype, df, fieldname = "", label = "") {
					const row = df && typeof df === "object" ? df : {};
					if (Boolean(row?.reqd) || Boolean(row?.required)) return false;
					if (Boolean(row?.read_only) || Boolean(row?.readOnly) || Boolean(row?.hidden)) return true;

					const name = String(fieldname || row?.fieldname || "").trim().toLowerCase();
					const title = String(label || row?.label || "").trim().toLowerCase();
					if (!name && !title) return false;

					const metaNames = new Set([
						"name",
						"owner",
						"creation",
						"modified",
						"modified_by",
						"idx",
						"docstatus",
						"amended_from",
						"_assign",
						"_comments",
						"_liked_by",
						"_seen",
						"_user_tags",
						"naming_series",
					]);
					if (metaNames.has(name)) return true;
					if (/(scan|barcode|last_scanned|posting_date|posting_time|amended|workflow|_seen|_assign)/i.test(name)) {
						return true;
					}
					if (/(barcode|scan|last scanned|posting date|posting time)/i.test(title)) {
						return true;
					}

					const dt = String(doctype || "").trim().toLowerCase();
					if (dt === "stock entry") {
						const stockNoise = new Set(["scan_barcode", "last_scanned_warehouse"]);
						if (stockNoise.has(name)) return true;
					}
					return false;
				}

					getTutorialFieldAllowlist(doctype, stage = "open_and_fill_basic") {
						const dt = String(doctype || "").trim().toLowerCase();
						const step = String(stage || "open_and_fill_basic").trim().toLowerCase();
						if (dt !== "user" || step !== "open_and_fill_basic") return null;
						return new Set([
							"email",
							"first_name",
							"middle_name",
							"last_name",
							"username",
							"language",
							"time_zone",
							"send_welcome_email",
							"enabled",
						]);
					}

				isFieldAllowedForTutorialStage(doctype, stage, fieldname) {
					const key = String(fieldname || "").trim().toLowerCase();
					if (!key) return false;
					const allowlist = this.getTutorialFieldAllowlist(doctype, stage);
					if (!allowlist) return true;
					return allowlist.has(key);
				}

				getFieldControlElement(fieldname, opts = {}) {
					const key = String(fieldname || "").trim();
					if (!key) return null;
					const allowHidden = Boolean(opts?.allowHidden);
					const root = this.getTutorialFieldSearchRoot();
					const control = root.querySelector(`.frappe-control[data-fieldname='${key}']`);
					if (!control) return null;
					if (!allowHidden && !isVisible(control)) return null;
					return control;
				}

				isFieldPresentInUI(fieldname) {
					return Boolean(this.getFieldControlElement(fieldname, { allowHidden: true }));
				}

				isFieldVisibleInUI(fieldname) {
					return Boolean(this.getFieldControlElement(fieldname, { allowHidden: false }));
				}

					collectPlannerFieldCandidates(doctype, stage = "open_and_fill_basic") {
						const out = [];
						const frm = window.cur_frm;
					const lower = String(doctype || "").trim().toLowerCase();
				if (!frm || String(frm.doctype || "").trim().toLowerCase() !== lower) return out;
				const metaFields = Array.isArray(frm.meta?.fields) ? frm.meta.fields : [];
				for (const df of metaFields) {
					if (!df || !df.fieldname) continue;
						const fieldname = String(df.fieldname || "").trim();
						if (!fieldname) continue;
						if (!this.isFieldPresentInUI(fieldname)) continue;
						if (!this.isFieldAllowedForTutorialStage(doctype, stage, fieldname)) continue;
						const fieldtype = String(df.fieldtype || "Data").trim() || "Data";
						if (
							[
							"Section Break",
							"Column Break",
							"Tab Break",
							"HTML",
							"Button",
							"Fold",
							"Heading",
							"Table",
							"Table MultiSelect",
						].includes(fieldtype)
						) {
							continue;
						}
						const label = String(df.label || fieldname).trim();
						if (this.isTutorialNoiseField(doctype, df, fieldname, label)) continue;
						const currentValue = frm.doc ? frm.doc[fieldname] : null;
						if (this.isFieldValueFilled(df, currentValue) && !this.isControlInvalid(fieldname)) continue;
							out.push({
								fieldname,
								label,
								fieldtype,
								required: Boolean(df.reqd),
								read_only: Boolean(df.read_only),
								hidden: Boolean(df.hidden),
								visible_in_ui: this.isFieldVisibleInUI(fieldname),
							current_value:
								currentValue === null || currentValue === undefined ? "" : String(currentValue).trim(),
							options:
								fieldtype === "Select"
									? this.parseFieldOptions(df.options)
									: fieldtype === "Link"
										? [String(df.options || "").trim()].filter(Boolean)
										: [],
						});
					if (out.length >= 100) break;
					}
					return out;
				}

				getFieldMeta(fieldname) {
					const key = String(fieldname || "").trim();
					if (!key) return null;
					const frm = window.cur_frm;
					const direct = frm?.fields_dict?.[key]?.df;
					if (direct) return direct;
					const metaFields = Array.isArray(frm?.meta?.fields) ? frm.meta.fields : [];
					for (const df of metaFields) {
						if (String(df?.fieldname || "").trim() === key) return df;
					}
					return null;
				}

				async ensureFieldTabVisible(fieldname, label = "") {
					const key = String(fieldname || "").trim();
					if (!key) return false;
					const root = this.getTutorialFieldSearchRoot();
					const control = root.querySelector(`.frappe-control[data-fieldname='${key}']`);
					if (!control) return false;

					const pane = control.closest(".tab-pane");
					if (!pane) return false;
					const isActivePane = pane.classList.contains("active") || pane.classList.contains("show");
					if (isActivePane) return true;

					const paneId = String(pane.getAttribute("id") || "").trim();
					if (!paneId) return false;
					const tabSelectors = [
						`.form-tabs a[href='#${paneId}']`,
						`.form-tabs button[data-bs-target='#${paneId}']`,
						`.form-tabs [data-target='#${paneId}']`,
						`.form-tabs a[data-target='#${paneId}']`,
					];
					for (const sel of tabSelectors) {
						const tabBtn = root.querySelector(sel) || document.querySelector(sel);
						if (!tabBtn || !isVisible(tabBtn)) continue;
						await this.focusElement(
							tabBtn,
							`**${label || key}** maydoni joylashgan tabga o'tamiz.`,
							{
								click: true,
								duration_ms: 220,
								pre_click_pause_ms: 80,
							}
						);
						await this.sleep(140);
						return true;
					}
					return false;
				}

				isStructFieldType(fieldtype) {
					const ft = String(fieldtype || "").trim();
					return [
						"Section Break",
						"Column Break",
						"Tab Break",
						"HTML",
						"Button",
						"Fold",
						"Heading",
						"Table",
						"Table MultiSelect",
					].includes(ft);
				}

				readFieldValue(fieldname) {
					const key = String(fieldname || "").trim();
					if (!key) return "";
					const frm = window.cur_frm;
					if (frm?.doc && Object.prototype.hasOwnProperty.call(frm.doc, key)) {
						return frm.doc[key];
					}
					const input = this.findFieldInput(key, { allowHidden: true });
					return input ? input.value : "";
				}

				isFieldValueFilled(df, value) {
					const ft = String(df?.fieldtype || "").trim();
					if (ft === "Check") return Boolean(value);
					if (["Int", "Float", "Currency", "Percent"].includes(ft)) {
						return value !== null && value !== undefined && String(value).trim() !== "";
					}
					return String(value === null || value === undefined ? "" : value).trim() !== "";
				}

				isControlInvalid(fieldname) {
					const key = String(fieldname || "").trim();
					if (!key) return false;
					const root = this.getTutorialFieldSearchRoot();
					const control = root.querySelector(`.frappe-control[data-fieldname='${key}']`);
					if (!control) return false;
					if (control.classList.contains("has-error") || control.classList.contains("invalid")) return true;
					return Boolean(control.querySelector(".has-error, .invalid-feedback, .text-danger"));
				}

				collectMissingRequiredFields(doctype) {
					const out = [];
					const frm = window.cur_frm;
					const lower = String(doctype || "").trim().toLowerCase();
					if (!frm || String(frm.doctype || "").trim().toLowerCase() !== lower) return out;
					const metaFields = Array.isArray(frm.meta?.fields) ? frm.meta.fields : [];
					for (const df of metaFields) {
						if (!df || !df.fieldname) continue;
						if (!Boolean(df.reqd) || Boolean(df.read_only) || Boolean(df.hidden)) continue;
						const fieldtype = String(df.fieldtype || "").trim();
						if (this.isStructFieldType(fieldtype)) continue;
						const fieldname = String(df.fieldname || "").trim();
						if (!fieldname) continue;
						const currentVal = this.readFieldValue(fieldname);
						if (this.isFieldValueFilled(df, currentVal) && !this.isControlInvalid(fieldname)) continue;
						out.push({
							fieldname,
							label: String(df.label || fieldname).trim(),
							fieldtype,
							options: String(df.options || "").trim(),
						});
					}
					return out;
				}

				normalizeStockEntryTypePreference(value) {
					const raw = String(value || "").trim().toLowerCase();
					if (!raw) return "";
					if (raw === "material issue" || raw === "issue") return "Material Issue";
					if (raw === "material receipt" || raw === "receipt") return "Material Receipt";
					if (raw === "material transfer" || raw === "transfer") return "Material Transfer";
					return "";
				}

				getStockEntryTypePreferredOrder(explicitPreference = "") {
					const base = ["Material Receipt", "Material Transfer", "Material Issue"];
					const pref = this.normalizeStockEntryTypePreference(
						explicitPreference || this._tutorialStockEntryTypePreference
					);
					if (!pref) return base;
					return [pref, ...base.filter((x) => x !== pref)];
				}

				defaultDemoValueForField(df) {
					const fieldtype = String(df?.fieldtype || "").trim();
					const label = String(df?.label || df?.fieldname || "Field").trim();
					const fieldname = String(df?.fieldname || "").trim().toLowerCase();
					if (this.isEmailField(df)) return this.makeDemoEmail(df);
					if (this.isPhoneLikeField(df)) return this.normalizePhoneDemoValue(`Demo ${label}`);
					if (["Int", "Float", "Currency", "Percent"].includes(fieldtype)) return "1";
					if (fieldtype === "Select") {
						const preferred =
							fieldname === "stock_entry_type" ? this.getStockEntryTypePreferredOrder() : [];
						return this.pickPreferredSelectOption(df?.options, preferred) || "Demo";
					}
					if (fieldtype === "Link") return "";
					return `Demo ${label}`;
				}

				isEmailField(df) {
					const fieldtype = String(df?.fieldtype || "").trim().toLowerCase();
					const options = String(df?.options || "").trim().toLowerCase();
					const fieldname = String(df?.fieldname || "").trim().toLowerCase();
					const label = String(df?.label || "").trim().toLowerCase();
					if (fieldtype === "email") return true;
					if (options === "email" || options.includes("email")) return true;
					if (fieldname.includes("email") || label.includes("email")) return true;
					return false;
				}

				isPhoneLikeField(df) {
					const fieldname = String(df?.fieldname || "").trim().toLowerCase();
					const label = String(df?.label || "").trim().toLowerCase();
					const options = String(df?.options || "").trim().toLowerCase();
					return (
						fieldname.includes("phone") ||
						fieldname.includes("mobile") ||
						label.includes("phone") ||
						label.includes("mobile") ||
						options.includes("phone") ||
						options.includes("mobile")
					);
				}

				normalizePhoneDemoValue(value = "") {
					const digits = String(value || "").replace(/\D+/g, "");
					if (digits.length >= 7) return digits.slice(0, 15);
					return "998901234567";
				}

				isValidEmailValue(value) {
					const text = String(value || "").trim();
					return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
				}

				makeDemoEmail(df) {
					const rawBase = String(df?.fieldname || df?.label || "user")
						.trim()
						.toLowerCase()
						.replace(/[^a-z0-9]+/g, ".")
						.replace(/^\.+|\.+$/g, "");
					const base = rawBase || "user";
					return `demo.${base}@example.com`;
				}

				getTutorialFieldOverrides() {
					const raw = this._tutorialFieldOverrides;
					if (!raw || typeof raw !== "object") return {};
					return raw;
				}

				getTutorialFieldOverride(fieldname) {
					const key = String(fieldname || "").trim().toLowerCase();
					if (!key) return null;
					const overrides = this.getTutorialFieldOverrides();
					const raw = overrides?.[key];
					if (!raw || typeof raw !== "object") return null;
					const overwrite = raw.overwrite === true;
					const value = String(raw.value || "").trim();
					if (!overwrite && !value) return null;
					return {
						overwrite,
						value,
					};
				}

				makeAlternativeEmail(df, currentValue = "") {
					const current = String(currentValue || "").trim().toLowerCase();
					const rawBase = String(df?.fieldname || df?.label || "user")
						.trim()
						.toLowerCase()
						.replace(/[^a-z0-9]+/g, ".")
						.replace(/^\.+|\.+$/g, "");
					const base = rawBase || "user";
					const suffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 10)}`;
					let candidate = `demo.${base}.${suffix}@example.com`;
					if (candidate.toLowerCase() === current) {
						candidate = `demo.${base}.${suffix}.new@example.com`;
					}
					return candidate;
				}

				makeAlternativeTextValue(df, currentValue = "", seedValue = "") {
					const current = String(currentValue || "").trim().toLowerCase();
					let base = String(seedValue || "").trim();
					if (!base) {
						base = this.defaultDemoValueForField(df);
					}
					base = String(base || "").trim() || `Demo ${String(df?.label || df?.fieldname || "Value").trim()}`;
					const suffix = `${Math.floor(Math.random() * 900 + 100)}`;
					let candidate = `${base} ${suffix}`.trim();
					if (candidate.toLowerCase() === current) {
						candidate = `${base} ${suffix}a`.trim();
					}
					return candidate;
				}

					buildMergedFieldPlans(doctype, stage, plannedRows = [], fallbackPlans = []) {
						const merged = [];
						const seen = new Set();
						const append = (row, source, opts = {}) => {
						if (!row || typeof row !== "object") return;
						const fieldname = String(row.fieldname || "").trim();
						if (!fieldname || seen.has(fieldname)) return;
						if (!this.isFieldPresentInUI(fieldname)) return;
						const df = this.getFieldMeta(fieldname);
						if (!df) return;
						if (Boolean(df.read_only) || Boolean(df.hidden)) return;
						const label = String(row.label || df.label || fieldname).trim();
						const force = Boolean(opts?.force);
						if (!force && !this.isFieldAllowedForTutorialStage(doctype, stage, fieldname)) return;
						if (!force && this.isTutorialNoiseField(doctype, df, fieldname, label)) return;
						if (!force && source === "ai" && String(df?.fieldtype || "").trim() === "Link" && !Boolean(df?.reqd)) {
							return;
						}
						const value =
							row.value !== undefined && row.value !== null
								? String(row.value)
								: this.defaultDemoValueForField(df);
						merged.push({
							fieldname,
							label,
							value,
							reason: String(row.reason || (source === "required" ? "majburiy maydon" : "demo o'rgatish uchun")).trim(),
						});
						seen.add(fieldname);
					};

					const requiredMissing = this.collectMissingRequiredFields(doctype);
						for (const req of requiredMissing) {
						append(
							{
								fieldname: req.fieldname,
								label: req.label,
								value: this.defaultDemoValueForField(req),
								reason: "majburiy maydonni to'ldirish uchun",
							},
							"required",
							{ force: true }
						);
					}
					const tutorialOverrides = this.getTutorialFieldOverrides();
					for (const [fieldname, cfg] of Object.entries(tutorialOverrides)) {
						if (!cfg || typeof cfg !== "object") continue;
						const normalized = String(fieldname || "").trim();
						if (!normalized) continue;
						if (cfg.overwrite !== true && !String(cfg.value || "").trim()) continue;
						append(
							{
								fieldname: normalized,
								label: this.getFieldLabel(normalized) || normalized,
								value: String(cfg.value || "").trim(),
								reason: "foydalanuvchi so'roviga ko'ra qiymatni yangilash uchun",
							},
							"override",
							{ force: true }
						);
					}
						for (const row of Array.isArray(plannedRows) ? plannedRows : []) append(row, "ai");
						for (const row of Array.isArray(fallbackPlans) ? fallbackPlans : []) append(row, "fallback");

						return merged.slice(0, this.getTutorialPlanLimit(stage));
					}

					getTutorialPlanLimit(stage = "open_and_fill_basic") {
						return String(stage || "").trim().toLowerCase() === "fill_more" ? 14 : 10;
					}

				async fetchLinkDemoValue(linkDoctype, hint = "", opts = {}) {
					const doctype = String(linkDoctype || "").trim();
					if (!doctype) return "";
					this._linkValueCache = this._linkValueCache || {};
					const shouldCreate = Boolean(opts?.create_if_missing);
					const key = `${doctype}::${String(hint || "").trim().toLowerCase()}::${shouldCreate ? "create" : "read"}`;
					if (this._linkValueCache[key]) return this._linkValueCache[key];
					try {
						const res = await frappe.call("erpnext_ai_tutor.api.get_link_demo_value", {
							doctype,
							hint: String(hint || "").trim(),
							create_if_missing: shouldCreate ? 1 : 0,
						});
						const msg = res?.message || {};
						const value = String(msg?.value || "").trim();
						if (value) {
							this._linkValueCache[key] = value;
							if (Boolean(msg?.created) && opts?.report_created) {
								this.emitProgress(`🧱 \`${doctype}\` bo'yicha demo yozuv yaratildi: **${value}**.`);
							}
							return value;
						}
					} catch {
						// ignore
					}
					return "";
				}

				async resolvePlanValue(df, rawValue, opts = {}) {
					const fieldtype = String(df?.fieldtype || "").trim();
					const fieldname = String(df?.fieldname || "").trim().toLowerCase();
					if (fieldname === "stock_entry_type") {
						return await this.resolveSafeStockEntryType(rawValue, { preferTutorial: true });
					}
					if (this.isEmailField(df)) {
						const wanted = String(rawValue || "").trim();
						return this.isValidEmailValue(wanted) ? wanted : this.makeDemoEmail(df);
					}
					if (this.isPhoneLikeField(df)) {
						return this.normalizePhoneDemoValue(rawValue);
					}
					if (fieldtype === "Link") {
						const linkDoctype = String(df?.options || "").trim();
						const hint = String(rawValue || "").trim();
						const allowCreateLink = Boolean(opts?.allowCreateLink);
						return await this.fetchLinkDemoValue(linkDoctype, hint, {
							create_if_missing: allowCreateLink,
							report_created: allowCreateLink,
						});
					}
					if (fieldtype === "Select") {
						const options = this.parseFieldOptions(df?.options);
						const wanted = String(rawValue || "").trim();
						if (wanted && options.includes(wanted)) return wanted;
						const preferred = fieldname === "stock_entry_type" ? this.getStockEntryTypePreferredOrder() : [];
						return this.pickPreferredSelectOption(options, preferred) || wanted || "Demo";
					}
					if (fieldtype === "Check") {
						const wanted = String(rawValue || "").trim().toLowerCase();
						return ["", "0", "false", "no", "off"].includes(wanted) ? "0" : "1";
					}
					if (["Int", "Float", "Currency", "Percent"].includes(fieldtype)) {
						const wanted = String(rawValue || "").trim();
						return wanted && /^-?\d+(\.\d+)?$/.test(wanted) ? wanted : "1";
					}
					return String(rawValue || "").trim();
				}

				async resolveSafeStockEntryType(rawValue, opts = {}) {
					const preferred = this.getStockEntryTypePreferredOrder(
						opts?.preferTutorial ? this._tutorialStockEntryTypePreference : ""
					);
					const tutorialWanted = this.normalizeStockEntryTypePreference(
						opts?.preferTutorial ? this._tutorialStockEntryTypePreference : ""
					);
					if (tutorialWanted) {
						const matchedTutorial = await this.fetchLinkDemoValue("Stock Entry Type", tutorialWanted);
						if (matchedTutorial) return matchedTutorial;
					}
					const wanted = this.normalizeStockEntryTypePreference(rawValue);
					if (wanted) {
						const matchedWanted = await this.fetchLinkDemoValue("Stock Entry Type", wanted);
						if (matchedWanted) return matchedWanted;
					}
					for (const option of preferred) {
						const matched = await this.fetchLinkDemoValue("Stock Entry Type", option);
						if (matched) return matched;
					}
					return preferred[0];
				}

				async requestAIFieldPlan(doctype, stage) {
					const fields = this.collectPlannerFieldCandidates(doctype, stage);
					if (!fields.length) return { plan: [], source: "none" };
					const stockEntryTypePreference =
						String(doctype || "").trim().toLowerCase() === "stock entry"
							? this.normalizeStockEntryTypePreference(this._tutorialStockEntryTypePreference)
							: "";
				try {
					const res = await frappe.call("erpnext_ai_tutor.api.plan_tutorial_fields", {
						doctype: String(doctype || "").trim(),
						stage: String(stage || "open_and_fill_basic").trim().toLowerCase(),
						fields,
						stock_entry_type_preference: stockEntryTypePreference,
					});
					const msg = res?.message || {};
					const plan = Array.isArray(msg?.plan) ? msg.plan : [];
					const source = String(msg?.source || "ai").trim().toLowerCase() || "ai";
					if (plan.length) return { plan, source };
				} catch {
					// ignore planner call errors
				}
				return { plan: [], source: "fallback" };
			}

				async typeIntoInput(input, value, opts = {}) {
					if (!input || value === undefined || value === null) return false;
					const text = String(value);
				const charDelay = Math.max(14, Number(opts?.char_delay_ms || 46));
				const initialPause = Math.max(0, Number(opts?.initial_pause_ms || 0));
				const afterTypePause = Math.max(0, Number(opts?.after_type_pause_ms || 0));
				try {
					input.focus();
					if (String(input.type || "").trim().toLowerCase() === "checkbox") {
						const shouldCheck = !["", "0", "false", "no", "off"].includes(text.trim().toLowerCase());
						input.checked = shouldCheck;
						input.dispatchEvent(new Event("input", { bubbles: true }));
						input.dispatchEvent(new Event("change", { bubbles: true }));
						return true;
					}
					if (input.tagName === "SELECT") {
						input.value = text;
						input.dispatchEvent(new Event("input", { bubbles: true }));
						input.dispatchEvent(new Event("change", { bubbles: true }));
						return true;
					}
					input.value = "";
					input.dispatchEvent(new Event("input", { bubbles: true }));
					if (initialPause) await this.sleep(initialPause);
					for (const ch of text) {
						if (!this.running) return false;
						input.value += ch;
						input.dispatchEvent(new Event("input", { bubbles: true }));
						this.playTypingSound?.();
						await this.sleep(charDelay);
					}
					if (afterTypePause) await this.sleep(afterTypePause);
					input.dispatchEvent(new Event("change", { bubbles: true }));
					return true;
				} catch {
					return false;
				}
			}

				normalizeOptionText(value = "") {
					return String(value || "")
						.replace(/\s+/g, " ")
						.trim()
						.toLowerCase();
				}

				getVisibleLinkDropdownOptions(input) {
					const root = this.getTutorialFieldSearchRoot();
					const out = [];
					const inputRect = input?.getBoundingClientRect?.() || null;
					const push = (el) => {
						if (!el || !isVisible(el)) return;
						const label = String(el.textContent || "").replace(/\s+/g, " ").trim();
						if (!label) return;
						out.push({ el, label });
					};

					const selectors = [
						".awesomplete ul li",
						".awesomplete li",
						".ui-front li",
						".ui-autocomplete li",
					];
					for (const sel of selectors) {
						const nodes = root.querySelectorAll(sel);
						for (const node of nodes) {
							const option = node.matches?.("li") ? node : node.closest?.("li");
							if (!option || !isVisible(option)) continue;
							if (inputRect) {
								const rect = option.getBoundingClientRect();
								if (Math.abs(rect.top - inputRect.bottom) > 420 && rect.bottom < inputRect.top) continue;
							}
							push(option);
						}
					}
					return out;
				}

				findMatchingVisibleLinkOption(input, desiredValue = "") {
					const options = this.getVisibleLinkDropdownOptions(input);
					if (!options.length) return null;
					const wanted = this.normalizeOptionText(desiredValue);
					if (!wanted) return options[0]?.el || null;

					for (const option of options) {
						if (this.normalizeOptionText(option.label) === wanted) return option.el;
					}
					for (const option of options) {
						if (this.normalizeOptionText(option.label).includes(wanted)) return option.el;
					}
					for (const option of options) {
						if (wanted.includes(this.normalizeOptionText(option.label))) return option.el;
					}
					return options[0]?.el || null;
				}

				async pickVisibleLinkOption(fieldname, label, input, desiredValue) {
					if (!input) return false;
					const option = await this.waitFor(
						() => this.findMatchingVisibleLinkOption(input, desiredValue),
						2200,
						100
					);
					if (!option) return false;
					const optionLabel = String(option.textContent || "").replace(/\s+/g, " ").trim();
					const clicked = await this.focusElement(
						option,
						`**${label || fieldname}** uchun ochilgan ro'yxatdan \`${optionLabel || desiredValue}\` variantini tanlaymiz.`,
						{
							click: true,
							duration_ms: 260,
							pre_click_pause_ms: 90,
						}
					);
					if (!clicked) return false;
					await this.sleep(180);
					return true;
				}

				getFormFieldSamplePlans(doctype, stage = "open_and_fill_basic") {
					const dt = String(doctype || "").trim();
					const lower = dt.toLowerCase();
					const visibleCandidates = this.collectPlannerFieldCandidates(doctype, stage);
					const visibleMap = new Map(visibleCandidates.map((row) => [String(row.fieldname || "").trim(), row]));
					const pickVisibleRows = (rows = []) =>
						rows.filter((row) => visibleMap.has(String(row?.fieldname || "").trim()));
					if (lower === "user") {
						if (stage === "fill_more") return [];
						return pickVisibleRows([
							{
								fieldname: "email",
								label: "Email",
								value: "demo.email@example.com",
								reason: "foydalanuvchi identifikatori uchun",
							},
							{
								fieldname: "first_name",
								label: "First Name",
								value: "Demo First Name",
								reason: "asosiy user ma'lumoti uchun",
							},
							{
								fieldname: "username",
								label: "Username",
								value: "demo.user",
								reason: "login nomini ko'rsatish uchun",
							},
						]);
					}
					if (lower === "item") {
					const base = [
						{
							fieldname: "item_code",
							label: "Item Code",
							value: "DEMO-ITEM-001",
							reason: "har bir mahsulot yagona kod bilan aniqlanishi uchun",
						},
						{
							fieldname: "item_name",
							label: "Item Name",
							value: "Demo Item",
							reason: "ro'yxatda nom aniq ko'rinishi uchun",
						},
						{
							fieldname: "item_group",
							label: "Item Group",
							value: "All Item Groups",
							reason: "mahsulotni toifaga biriktirish uchun",
						},
							{
								fieldname: "stock_uom",
								label: "Stock UOM",
								value: "Nos",
								reason: "ombor hisobi o'lchov birligida yurishi uchun",
							},
						];
					if (stage === "fill_more") {
						return pickVisibleRows([
							{
								fieldname: "description",
								label: "Description",
								value: "AI Tutor orqali yaratilgan demo yozuv.",
								reason: "izoh maydonini ham amalda ko'rsatish uchun",
							},
						]);
						}
						return pickVisibleRows(base);
					}
					if (lower === "stock entry") {
						return pickVisibleRows([
							{
								fieldname: "stock_entry_type",
								label: "Stock Entry Type",
								value: this.getStockEntryTypePreferredOrder()[0],
								reason: "ombor amaliyoti turi tanlanmasa qolgan qadamlar ishonchli ishlamaydi",
							},
						]);
					}

					const plans = [];
					const limit = this.getTutorialPlanLimit(stage);
				for (const candidate of visibleCandidates) {
						if (!candidate || !candidate.fieldname) continue;
						const df = this.getFieldMeta(candidate.fieldname);
						if (!df || df.hidden || df.read_only) continue;
						const ft = String(df.fieldtype || "").trim();
						if (!["Data", "Small Text", "Text", "Int", "Float", "Currency", "Select"].includes(ft)) continue;
						const fieldname = String(df.fieldname || "").trim();
						if (!fieldname || fieldname === "naming_series") continue;
						const label = String(df.label || fieldname).trim();
						if (this.isTutorialNoiseField(doctype, df, fieldname, label)) continue;
						const currentVal = frm.doc ? frm.doc[fieldname] : null;
						if (currentVal !== null && currentVal !== undefined && String(currentVal).trim()) continue;
						let sample = "Demo";
						if (ft === "Int" || ft === "Float" || ft === "Currency") sample = "1";
						else if (ft === "Select") {
							sample = this.pickPreferredSelectOption(df.options) || "Demo";
						} else {
							sample = `Demo ${label}`;
						}
						plans.push({
							fieldname,
							label,
							value: sample,
							reason: "demo ko'rsatish uchun",
						});
						if (plans.length >= limit + 1) break;
				}
				if (stage === "fill_more") {
					return plans.slice(1, limit + 1);
				}
				return plans.slice(0, limit);
			}

					async fillFormFields(doctype, stage = "open_and_fill_basic", plannedRows = []) {
						this.traceTutorialEvent("fill_form.start", {
							doctype: String(doctype || "").trim(),
							stage: String(stage || "").trim(),
							planned_rows: Array.isArray(plannedRows) ? plannedRows.length : 0,
						});
						const fallbackPlans = this.getFormFieldSamplePlans(doctype, stage);
						const plans = this.buildMergedFieldPlans(doctype, stage, plannedRows, fallbackPlans);
					let filled = 0;
					const filledLabels = [];
					const backgroundFilledLabels = [];
					const backgroundFilledEntries = [];
					const blockedLinkHints = [];
					const failedRequired = new Set();
					const addBackgroundEntry = (label, value, reason = "") => {
						const safeLabel = String(label || "").trim();
						if (!safeLabel) return;
						const safeValue = String(value === null || value === undefined ? "" : value).trim();
						const safeReason = String(reason || "").trim();
						if (!backgroundFilledLabels.includes(safeLabel)) backgroundFilledLabels.push(safeLabel);
						const exists = backgroundFilledEntries.some((x) => String(x?.label || "").trim() === safeLabel);
						if (exists) return;
						backgroundFilledEntries.push({
							label: safeLabel,
							value: safeValue,
							reason: safeReason || "demo ko'rsatish uchun",
						});
					};
					for (const plan of plans) {
						if (!this.running) break;
						const fieldname = String(plan?.fieldname || "").trim();
						if (!fieldname) continue;
						const df = this.getFieldMeta(fieldname);
						if (!df) continue;
						const label = String(plan?.label || this.getFieldLabel(fieldname) || fieldname).trim();
						if (this.isTutorialNoiseField(doctype, df, fieldname, label) && !Boolean(df?.reqd)) continue;
						const reason = String(plan?.reason || "demo maqsadida").trim();

						const currentVal = this.readFieldValue(fieldname);
						const fieldOverride = this.getTutorialFieldOverride(fieldname);
						const shouldOverwrite = Boolean(fieldOverride?.overwrite);
						if (this.isFieldValueFilled(df, currentVal) && !this.isControlInvalid(fieldname) && !shouldOverwrite) {
							this.emitProgress(`ℹ️ **${label}** allaqachon to'ldirilgan, qayta yozmadim.`);
							continue;
						}

						const overrideValue = String(fieldOverride?.value || "").trim();
						let rawValue = plan?.value;
						if (shouldOverwrite) {
							if (this.isEmailField(df)) {
								rawValue = this.isValidEmailValue(overrideValue)
									? overrideValue
									: this.makeAlternativeEmail(df, currentVal);
							} else if (overrideValue) {
								rawValue = overrideValue;
							} else {
								rawValue = this.makeAlternativeTextValue(df, currentVal, rawValue);
							}
						}
						let valueToType = await this.resolvePlanValue(df, rawValue, {
							allowCreateLink: Boolean(this._allowDependencyCreation && df?.reqd),
						});
						if (shouldOverwrite && this.isEmailField(df)) {
							const normalizedCurrent = String(currentVal || "").trim().toLowerCase();
							const normalizedNext = String(valueToType || "").trim().toLowerCase();
							if (!normalizedNext || normalizedNext === normalizedCurrent) {
								valueToType = await this.resolvePlanValue(df, this.makeAlternativeEmail(df, currentVal), {
									allowCreateLink: Boolean(this._allowDependencyCreation && df?.reqd),
								});
							}
						}
						if (!this.isFieldValueFilled(df, valueToType)) {
							const linkDoctype = String(df?.options || "").trim();
							if (String(df?.fieldtype || "").trim() === "Link" && Boolean(df?.reqd) && linkDoctype) {
								blockedLinkHints.push(`**${label}** (Link: ${linkDoctype})`);
								this.emitProgress(
									`⚠️ **${label}** uchun mavjud \`${linkDoctype}\` yozuvi topilmadi. Avval \`${linkDoctype}\` ni yarating.`
								);
							} else {
								this.emitProgress(`⚠️ **${label}** uchun demo qiymat aniqlanmadi, keyingi qadamga o'tdim.`);
							}
							continue;
						}

						await this.ensureFieldTabVisible(fieldname, label);
						const input = this.findFieldInput(fieldname, { allowHidden: false });
						if (!input) {
							this.emitProgress(`⚠️ **${label}** maydoni hozir UIda ko'rinmadi, shu qadamni o'tkazdim.`);
							continue;
						}

						const focused = await this.focusElement(input, `${label} maydonini to'ldiramiz.`, {
							click: true,
							duration_ms: 260,
							pre_click_pause_ms: 110,
						});
						if (!focused) continue;

						const ok = await this.typeIntoInput(input, valueToType);
						let optionPicked = false;
						if (String(df?.fieldtype || "").trim() === "Link" && ok) {
							optionPicked = await this.pickVisibleLinkOption(fieldname, label, input, valueToType);
						}
						await this.sleep(120);
						const reallyFilled = ok
							? await this.verifyVisibleFieldConfirmation(fieldname, df, label, valueToType)
							: false;
						if (reallyFilled) {
							if (!filledLabels.includes(label)) {
								filled += 1;
								filledLabels.push(label);
							}
							this.emitProgress(
								`✅ **${label}** maydoni \`${String(valueToType || "").trim()}\` bilan to'ldirildi${
									optionPicked ? " va ro'yxatdan bosib tanlandi" : ""
								}, sababi: ${reason}.`
							);
						} else {
							this.emitProgress(`⚠️ **${label}** qiymati UI orqali tasdiqlanmadi, keyingi maydonga o'tdim.`);
						}
					}

					// Dynamic required-field sweep:
					// after each successful fill, ERPNext may reveal new required fields.
					for (let round = 0; round < 5 && this.running; round++) {
						const missingNow = this.collectMissingRequiredFields(doctype);
						if (!missingNow.length) break;
						let roundProgress = false;
						for (const req of missingNow) {
							if (!this.running) break;
							const fieldname = String(req?.fieldname || "").trim();
							if (!fieldname || failedRequired.has(fieldname)) continue;
							const df = this.getFieldMeta(fieldname);
							if (!df) {
								failedRequired.add(fieldname);
								continue;
							}
							const label = String(req?.label || this.getFieldLabel(fieldname) || fieldname).trim();
							const currentVal = this.readFieldValue(fieldname);
							if (this.isFieldValueFilled(df, currentVal) && !this.isControlInvalid(fieldname)) continue;

							const valueToType = await this.resolvePlanValue(df, this.defaultDemoValueForField(df), {
								allowCreateLink: Boolean(this._allowDependencyCreation),
							});
							if (!this.isFieldValueFilled(df, valueToType)) {
								const linkDoctype = String(df?.options || "").trim();
								if (String(df?.fieldtype || "").trim() === "Link" && linkDoctype) {
									blockedLinkHints.push(`**${label}** (Link: ${linkDoctype})`);
								}
								failedRequired.add(fieldname);
								continue;
							}

								await this.ensureFieldTabVisible(fieldname, label);
								const input = this.findFieldInput(fieldname, { allowHidden: false });
								if (!input) {
									failedRequired.add(fieldname);
									continue;
								}

							const focused = await this.focusElement(input, `Majburiy **${label}** maydonini to'ldiramiz.`, {
								click: true,
								duration_ms: 250,
								pre_click_pause_ms: 90,
							});
							if (!focused) {
								failedRequired.add(fieldname);
								continue;
							}
							const ok = await this.typeIntoInput(input, valueToType);
							let optionPicked = false;
							if (String(df?.fieldtype || "").trim() === "Link" && ok) {
								optionPicked = await this.pickVisibleLinkOption(fieldname, label, input, valueToType);
							}
							await this.sleep(120);
							const reallyFilled = ok
								? await this.verifyVisibleFieldConfirmation(fieldname, df, label, valueToType)
								: false;
								if (reallyFilled) {
									if (!filledLabels.includes(label)) {
										filled += 1;
										filledLabels.push(label);
									}
									roundProgress = true;
									this.emitProgress(
										`✅ Majburiy **${label}** maydoni to'ldirildi${optionPicked ? " va ro'yxatdan tanlandi" : ""}.`
									);
								} else {
									failedRequired.add(fieldname);
								}
						}
						if (!roundProgress) break;
					}
						const missingRequired = this.collectMissingRequiredFields(doctype);
							const result = {
								filled,
								filledLabels,
								backgroundFilledLabels,
								backgroundFilledEntries,
								missingRequiredLabels: missingRequired.map((x) => String(x.label || x.fieldname || "").trim()).filter(Boolean),
								blockedLinkHints: [...new Set(blockedLinkHints)],
							};
						this.traceTutorialEvent("fill_form.end", {
							doctype: String(doctype || "").trim(),
							stage: String(stage || "").trim(),
							filled: Number(result.filled || 0),
							missing_required: Array.isArray(result.missingRequiredLabels) ? result.missingRequiredLabels.length : 0,
							blocked_links: Array.isArray(result.blockedLinkHints) ? result.blockedLinkHints.length : 0,
						});
						return result;
						}


				async setDocFieldValue(fieldname, value, label, opts = {}) {
					const frm = window.cur_frm;
					if (!frm || !fieldname) return false;
					const stringValue = String(value ?? "");
					const silent = Boolean(opts?.silent);
					try {
						const input = this.findFieldInput(fieldname, { allowHidden: false });
						if (input) {
							const focused = await this.focusElement(input, `**${label || fieldname}** maydonini to'ldiramiz.`, {
								click: true,
								duration_ms: 240,
								pre_click_pause_ms: 110,
							});
							if (focused) {
								await this.typeIntoInput(input, stringValue, {
									char_delay_ms: 58,
									after_type_pause_ms: 90,
								});
								input.blur?.();
								await this.sleep(140);
							}
						}
						const df = this.getFieldMeta(fieldname);
						const after = this.readFieldValue(fieldname);
						let ok = this.isFieldValueFilled(df, after) && !this.isControlInvalid(fieldname);
							if (!ok) {
								await frm.set_value(fieldname, value);
								await this.sleep(140);
								const afterFallback = this.readFieldValue(fieldname);
								ok = this.isFieldValueFilled(df, afterFallback) && !this.isControlInvalid(fieldname);
							}
							if (ok && !silent) this.emitProgress(`✅ **${label || fieldname}** maydoni \`${String(value || "")}\` bilan to'ldirildi.`);
							return ok;
						} catch {
							return false;
						}
					}

					async verifyVisibleFieldConfirmation(fieldname, df, label = "", expectedValue = "") {
						const key = String(fieldname || "").trim();
						if (!key) return false;
						await this.ensureFieldTabVisible(key, label || this.getFieldLabel(key));
						const input = this.findFieldInput(key, { allowHidden: false });
						if (!input) return false;
						const value = this.readFieldValue(key);
						if (!this.isFieldValueFilled(df, value) || this.isControlInvalid(key)) return false;
						const fieldtype = String(df?.fieldtype || "").trim();
						const docText = String(value ?? "").trim();
						const inputText = String(input.value ?? "").trim();
						const wantedText = String(expectedValue ?? "").trim();
						if (this.isEmailField(df) && !this.isValidEmailValue(docText)) return false;
						if (fieldtype === "Check") {
							const expectedChecked = !["", "0", "false", "no", "off"].includes(wantedText.toLowerCase());
							const actualChecked = !["", "0", "false", "no", "off"].includes(docText.toLowerCase());
							return Boolean(input.checked) === expectedChecked && actualChecked === expectedChecked;
						}
						if (["Int", "Float", "Currency", "Percent"].includes(fieldtype)) {
							if (!/^-?\d+(\.\d+)?$/.test(docText)) return false;
						}
						if (fieldtype === "Link") {
							// Link maydonda faqat UI va model qiymati mos bo'lsa "tasdiqlandi" deymiz.
							if (!inputText || !docText) return false;
							if (wantedText && docText !== wantedText && inputText !== wantedText) return false;
							const inputNorm = inputText.toLowerCase();
							const docNorm = docText.toLowerCase();
							if (docNorm !== inputNorm && !docNorm.includes(inputNorm) && !inputNorm.includes(docNorm)) {
								return false;
							}
						}
						return true;
					}
