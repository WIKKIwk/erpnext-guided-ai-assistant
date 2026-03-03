				this.clickPulse();
				await this.sleep(hoverPause);
				const clicked = this.performPreciseClick(resolved.target, resolved.point);
				await this.sleep(220);
				return clicked;
			}
			return true;
		}

		getElementLabel(el) {
			if (!el) return "";
			const raw =
				el.getAttribute?.("data-label") ||
				el.getAttribute?.("aria-label") ||
				el.getAttribute?.("title") ||
				el.textContent ||
				"";
			return String(raw).replace(/\s+/g, " ").trim();
		}

		isDangerActionLabel(label) {
			const text = normalizeText(label);
			if (!text) return false;
			return /\b(save|submit|saqla|saqlash|сохран|провест|отправ)\b/i.test(text);
		}

		isForbiddenActionElement(el) {
			const label = this.getElementLabel(el);
			return this.isDangerActionLabel(label);
		}

		isCreateTutorial(guide) {
			return String(guide?.tutorial?.mode || "").trim().toLowerCase() === "create_record";
		}

		doctypeToRouteSlug(doctype) {
			return String(doctype || "")
				.trim()
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "-")
				.replace(/^-+|-+$/g, "");
		}

		getTutorialDoctype(guide) {
			return String(guide?.tutorial?.doctype || guide?.target_label || "").trim();
		}

		isOnDoctypeNewForm(doctype) {
			const slug = this.doctypeToRouteSlug(doctype);
			if (!slug) return false;
			const path = this.normalizePath(window.location.pathname || "");
			if (path.startsWith(`/app/${slug}/new-`)) return true;
			try {
				const route = Array.isArray(frappe?.get_route?.()) ? frappe.get_route() : [];
				if (!route.length) return false;
				const head = String(route[0] || "").trim().toLowerCase();
				const second = String(route[1] || "").trim().toLowerCase();
				if (head === "form" && second === String(doctype || "").trim().toLowerCase()) return true;
				if (head === slug && second.startsWith("new-")) return true;
			} catch {
				// ignore
			}
			return false;
		}

			findCreateActionButton() {
				const createRe = /\b(add|new|create|yangi|qo['’]?sh|добав|созд)\b/i;
				const roots = [
					document.querySelector(".page-head .page-actions"),
					document.querySelector(".layout-main .page-actions"),
					document.querySelector(".layout-main-section"),
					document.querySelector(".page-container"),
					document.body,
				].filter(Boolean);
				let best = null;
				let bestScore = -1;
				for (const root of roots) {
					const nodes = root.querySelectorAll(
						"button, a.btn, [role='button'], .primary-action, .btn-primary, [data-label]"
					);
					for (const node of nodes) {
						const el = getClickable(node) || node;
						if (!el || !isVisible(el)) continue;
						if (el.closest(".erpnext-ai-tutor-root")) continue;
						if (this.isForbiddenActionElement(el)) continue;
						const label = this.getElementLabel(el);
						if (!label) continue;
						let score = 0;
						if (createRe.test(label)) score += 120;
						if (el.matches?.(".primary-action, .btn-primary")) score += 35;
						if (/\+\s*[a-z]/i.test(label) || /^\+\s*/.test(label)) score += 20;
						if (/item|invoice|order|customer|supplier/i.test(label)) score += 10;
						if (score > bestScore) {
							best = el;
							bestScore = score;
						}
					}
				}
				if (best && bestScore >= 35) return best;
				return null;
			}

			findSaveActionButton() {
			const roots = [
				document.querySelector(".page-head .page-actions"),
				document.querySelector(".layout-main .page-actions"),
				document.querySelector(".page-actions"),
			].filter(Boolean);
			for (const root of roots) {
				const nodes = root.querySelectorAll("button, a.btn, [role='button']");
				for (const node of nodes) {
					const el = getClickable(node) || node;
					if (!el || !isVisible(el)) continue;
					const label = this.getElementLabel(el);
					if (this.isDangerActionLabel(label)) return el;
				}
			}
			return null;
		}

			findFieldInput(fieldname, opts = {}) {
				const key = String(fieldname || "").trim();
				if (!key) return null;
				const allowHidden = Boolean(opts?.allowHidden);
				const selectors = [
					`.frappe-control[data-fieldname='${key}'] input:not([type='hidden'])`,
					`.frappe-control[data-fieldname='${key}'] textarea`,
					`.frappe-control[data-fieldname='${key}'] select`,
					`.control-input-wrapper [data-fieldname='${key}'] input:not([type='hidden'])`,
				];
				for (const sel of selectors) {
					const nodes = document.querySelectorAll(sel);
					for (const el of nodes) {
						if (!el) continue;
						if (!allowHidden && !isVisible(el)) continue;
						if (el.disabled || el.readOnly) continue;
						return el;
					}
				}
				return null;
			}

			async openNewDocFallback(doctype) {
				const dt = String(doctype || "").trim();
				if (!dt || typeof frappe?.new_doc !== "function") return false;
				try {
					this.emitProgress(`🔁 UI tugmani topolmadim, fallback orqali **${dt}** uchun yangi forma ochyapman.`);
					frappe.new_doc(dt);
					await this.waitFor(() => this.isOnDoctypeNewForm(dt) || this.isQuickEntryOpen(), 5200, 120);
					return this.isOnDoctypeNewForm(dt) || this.isQuickEntryOpen();
				} catch {
					return false;
				}
			}

			getQuickEntryDialog() {
				const selectors = [
					".modal.show .quick-entry-dialog",
					".modal.show .quick-entry-layout",
					".modal.show .modal-content",
					".modal.show",
				];
				for (const sel of selectors) {
					const el = document.querySelector(sel);
					if (el && isVisible(el)) return el;
				}
				return null;
			}

			isQuickEntryOpen() {
				return Boolean(this.getQuickEntryDialog());
			}

			findQuickEntryActionButton(kind = "edit_full_form") {
				const dialog = this.getQuickEntryDialog();
				if (!dialog) return null;
				const nodes = dialog.querySelectorAll("button, a.btn, [role='button']");
				const kindNorm = String(kind || "").trim().toLowerCase();
				const editRe = /\b(edit\s*full\s*form|full\s*form|to['’]?liq\s*forma|полная\s*форма)\b/i;
				const saveRe = /\b(save|submit|saqla|saqlash|сохран|провест|отправ)\b/i;
				for (const node of nodes) {
					const el = getClickable(node) || node;
					if (!el || !isVisible(el)) continue;
					const label = this.getElementLabel(el);
					if (!label) continue;
					if (kindNorm === "edit_full_form" && editRe.test(label)) return el;
					if (kindNorm === "save" && saveRe.test(label)) return el;
				}
				return null;
			}

			getFieldLabel(fieldname) {
				const key = String(fieldname || "").trim();
				if (!key) return "";
				const frm = window.cur_frm;
				const dfLabel = frm?.fields_dict?.[key]?.df?.label;
				if (dfLabel) return String(dfLabel).trim();
				const domLabel = document.querySelector(`.frappe-control[data-fieldname='${key}'] .control-label`);
				if (domLabel?.textContent) return String(domLabel.textContent).replace(/\s+/g, " ").trim();
				return key;
			}

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

					collectPlannerFieldCandidates(doctype) {
						const out = [];
						const frm = window.cur_frm;
					const lower = String(doctype || "").trim().toLowerCase();
				if (!frm || String(frm.doctype || "").trim().toLowerCase() !== lower) return out;
				const metaFields = Array.isArray(frm.meta?.fields) ? frm.meta.fields : [];
				for (const df of metaFields) {
					if (!df || !df.fieldname) continue;
					const fieldname = String(df.fieldname || "").trim();
					if (!fieldname) continue;
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
					const control = document.querySelector(`.frappe-control[data-fieldname='${key}']`);
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

				buildMergedFieldPlans(doctype, stage, plannedRows = [], fallbackPlans = []) {
					const merged = [];
					const seen = new Set();
					const append = (row, source, opts = {}) => {
						if (!row || typeof row !== "object") return;
						const fieldname = String(row.fieldname || "").trim();
						if (!fieldname || seen.has(fieldname)) return;
						const df = this.getFieldMeta(fieldname);
						if (!df) return;
						if (Boolean(df.read_only) || Boolean(df.hidden)) return;
						const label = String(row.label || df.label || fieldname).trim();
						const force = Boolean(opts?.force);
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
					for (const row of Array.isArray(plannedRows) ? plannedRows : []) append(row, "ai");
					for (const row of Array.isArray(fallbackPlans) ? fallbackPlans : []) append(row, "fallback");

					return stage === "fill_more" ? merged.slice(0, 8) : merged.slice(0, 6);
				}

				async fetchLinkDemoValue(linkDoctype, hint = "") {
					const doctype = String(linkDoctype || "").trim();
					if (!doctype) return "";
					this._linkValueCache = this._linkValueCache || {};
					const key = `${doctype}::${String(hint || "").trim().toLowerCase()}`;
					if (this._linkValueCache[key]) return this._linkValueCache[key];
					try {
						const res = await frappe.call("erpnext_ai_tutor.api.get_link_demo_value", {
							doctype,
							hint: String(hint || "").trim(),
						});
						const msg = res?.message || {};
						const value = String(msg?.value || "").trim();
						if (value) {
							this._linkValueCache[key] = value;
							return value;
						}
					} catch {
						// ignore
					}
					return "";
				}

				async resolvePlanValue(df, rawValue) {
					const fieldtype = String(df?.fieldtype || "").trim();
					const fieldname = String(df?.fieldname || "").trim().toLowerCase();
					if (fieldname === "stock_entry_type") {
						return await this.resolveSafeStockEntryType(rawValue, { preferTutorial: true });
					}
					if (this.isEmailField(df)) {
						const wanted = String(rawValue || "").trim();
						return this.isValidEmailValue(wanted) ? wanted : this.makeDemoEmail(df);
					}
					if (fieldtype === "Link") {
						const linkDoctype = String(df?.options || "").trim();
						const hint = String(rawValue || "").trim();
						return await this.fetchLinkDemoValue(linkDoctype, hint);
					}
					if (fieldtype === "Select") {
						const options = this.parseFieldOptions(df?.options);
						const wanted = String(rawValue || "").trim();
						if (wanted && options.includes(wanted)) return wanted;
						const preferred = fieldname === "stock_entry_type" ? this.getStockEntryTypePreferredOrder() : [];
						return this.pickPreferredSelectOption(options, preferred) || wanted || "Demo";
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
					const fields = this.collectPlannerFieldCandidates(doctype);
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

				getFormFieldSamplePlans(doctype, stage = "open_and_fill_basic") {
					const dt = String(doctype || "").trim();
					const lower = dt.toLowerCase();
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
						return [
							{
								fieldname: "description",
								label: "Description",
								value: "AI Tutor orqali yaratilgan demo yozuv.",
								reason: "izoh maydonini ham amalda ko'rsatish uchun",
							},
						];
						}
						return base;
					}
					if (lower === "stock entry") {
						return [
							{
								fieldname: "stock_entry_type",
								label: "Stock Entry Type",
								value: this.getStockEntryTypePreferredOrder()[0],
								reason: "ombor amaliyoti turi tanlanmasa qolgan qadamlar ishonchli ishlamaydi",
							},
						];
					}

					const frm = window.cur_frm;
					if (!frm || String(frm.doctype || "").trim().toLowerCase() !== lower) return [];
					const fields = Array.isArray(frm.meta?.fields) ? frm.meta.fields : [];
					const plans = [];
				for (const df of fields) {
						if (!df || !df.fieldname) continue;
						if (df.hidden || df.read_only) continue;
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
						if (plans.length >= 4) break;
				}
				return stage === "fill_more" ? plans.slice(1) : plans;
			}

				async fillFormFields(doctype, stage = "open_and_fill_basic", plannedRows = []) {
					const fallbackPlans = this.getFormFieldSamplePlans(doctype, stage);
					const plans = this.buildMergedFieldPlans(doctype, stage, plannedRows, fallbackPlans);
					let filled = 0;
					const filledLabels = [];
					const blockedLinkHints = [];
					const failedRequired = new Set();
					for (const plan of plans) {
						if (!this.running) break;
						const fieldname = String(plan?.fieldname || "").trim();
						if (!fieldname) continue;
						const df = this.getFieldMeta(fieldname);
						if (!df) continue;
						const label = String(plan?.label || this.getFieldLabel(fieldname) || fieldname).trim();
						if (this.isTutorialNoiseField(doctype, df, fieldname, label) && !Boolean(df?.reqd)) continue;
						const reason = String(plan?.reason || "demo maqsadida").trim();
						const input = this.findFieldInput(fieldname, { allowHidden: false });
						if (!input) {
							this.emitProgress(`⚠️ **${label}** maydoni topilmadi, keyingi qadamga o'tdim.`);
							continue;
						}

						const currentVal = this.readFieldValue(fieldname);
						if (this.isFieldValueFilled(df, currentVal) && !this.isControlInvalid(fieldname)) {
							this.emitProgress(`ℹ️ **${label}** allaqachon to'ldirilgan, qayta yozmadim.`);
							continue;
						}

						const valueToType = await this.resolvePlanValue(df, plan?.value);
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

						const focused = await this.focusElement(input, `${label} maydonini to'ldiramiz.`, {
							click: true,
							duration_ms: 260,
							pre_click_pause_ms: 110,
						});
						if (!focused) continue;

						const ok = await this.typeIntoInput(input, valueToType);
						await this.sleep(120);
						const afterVal = this.readFieldValue(fieldname);
						const reallyFilled = ok && this.isFieldValueFilled(df, afterVal) && !this.isControlInvalid(fieldname);
						if (reallyFilled) {
							filled += 1;
							filledLabels.push(label);
							this.emitProgress(
								`✅ **${label}** maydoni \`${String(valueToType || "").trim()}\` bilan to'ldirildi, sababi: ${reason}.`
							);
						} else {
							this.emitProgress(`⚠️ **${label}** qiymati form tomonidan qabul qilinmadi, qayta tekshirish kerak.`);
						}
					}

					// Dynamic required-field sweep:
					// after each successful fill, ERPNext may reveal new required fields.
					for (let round = 0; round < 3 && this.running; round++) {
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
							const input = this.findFieldInput(fieldname, { allowHidden: false });
							if (!input) {
								failedRequired.add(fieldname);
								continue;
							}
							const currentVal = this.readFieldValue(fieldname);
							if (this.isFieldValueFilled(df, currentVal) && !this.isControlInvalid(fieldname)) continue;

							const valueToType = await this.resolvePlanValue(df, this.defaultDemoValueForField(df));
							if (!this.isFieldValueFilled(df, valueToType)) {
								const linkDoctype = String(df?.options || "").trim();
								if (String(df?.fieldtype || "").trim() === "Link" && linkDoctype) {
									blockedLinkHints.push(`**${label}** (Link: ${linkDoctype})`);
								}
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
							await this.sleep(120);
							const afterVal = this.readFieldValue(fieldname);
							const reallyFilled = ok && this.isFieldValueFilled(df, afterVal) && !this.isControlInvalid(fieldname);
							if (reallyFilled) {
								filled += 1;
								roundProgress = true;
								if (!filledLabels.includes(label)) filledLabels.push(label);
								this.emitProgress(`✅ Majburiy **${label}** maydoni to'ldirildi.`);
							} else {
								failedRequired.add(fieldname);
							}
						}
						if (!roundProgress) break;
					}
					const missingRequired = this.collectMissingRequiredFields(doctype);
					return {
						filled,
						filledLabels,
						missingRequiredLabels: missingRequired.map((x) => String(x.label || x.fieldname || "").trim()).filter(Boolean),
						blockedLinkHints: [...new Set(blockedLinkHints)],
					};
				}

				detectStockEntryPurpose() {
					const raw = String(this.readFieldValue("stock_entry_type") || this.readFieldValue("purpose") || "")
						.trim()
						.toLowerCase();
					if (!raw) return "";
					if (raw.includes("receipt")) return "receipt";
					if (raw.includes("issue")) return "issue";
					if (raw.includes("transfer")) return "transfer";
					return "";
				}

				async fetchWarehouseCandidates() {
					try {
						const res = await frappe.call("frappe.client.get_list", {
							doctype: "Warehouse",
							fields: ["name"],
							filters: { disabled: 0 },
							limit_page_length: 6,
							order_by: "modified desc",
						});
						const rows = Array.isArray(res?.message) ? res.message : [];
						return rows.map((x) => String(x?.name || "").trim()).filter(Boolean);
					} catch {
						return [];
					}
				}

				async setDocFieldValue(fieldname, value, label) {
					const frm = window.cur_frm;
					if (!frm || !fieldname) return false;
					const stringValue = String(value ?? "");
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
						if (ok) this.emitProgress(`✅ **${label || fieldname}** maydoni \`${String(value || "")}\` bilan to'ldirildi.`);
						return ok;
					} catch {
						return false;
					}
				}

				async getItemsGridInput(row, fieldname) {
					const frm = window.cur_frm;
					if (!frm || !row || !fieldname) return null;
					const grid = frm.fields_dict?.items?.grid;
					if (!grid) return null;
					try {
						grid.refresh?.();
					} catch {
						// ignore
					}
					await this.sleep(90);

					const rowName = String(row.name || "").trim();
					if (!rowName) return null;
					let gridRow = grid.grid_rows_by_docname?.[rowName] || null;
					if (!gridRow && Array.isArray(grid.grid_rows)) {
						gridRow = grid.grid_rows.find((gr) => String(gr?.doc?.name || "").trim() === rowName) || null;
					}
					if (gridRow?.activate) {
						gridRow.activate();
						await this.sleep(90);
					}

					const field = gridRow?.on_grid_fields_dict?.[fieldname] || gridRow?.columns?.[fieldname]?.field;
					const jqInput = field?.$input;
					let input = null;
					if (jqInput && typeof jqInput.get === "function") input = jqInput.get(0);
					else if (jqInput?.[0]) input = jqInput[0];
					if (input && !input.disabled && !input.readOnly && isVisible(input)) return input;

					const rowEl = document.querySelector(`.grid-row[data-name='${rowName}']`);
					if (!rowEl) return null;
					const selectors = [
						`[data-fieldname='${fieldname}'] input:not([type='hidden'])`,
						`[data-fieldname='${fieldname}'] textarea`,
						`[data-fieldname='${fieldname}'] select`,
					];
					for (const sel of selectors) {
						const candidate = rowEl.querySelector(sel);
						if (!candidate) continue;
						if (candidate.disabled || candidate.readOnly) continue;
						if (!isVisible(candidate)) continue;
						return candidate;
					}
					return null;
				}

				async setStockRowValue(row, fieldname, value, label) {
					if (!row || !fieldname) return false;
					const stringValue = String(value ?? "");
					try {
						const input = await this.getItemsGridInput(row, fieldname);
						if (input) {
							const focused = await this.focusElement(input, `**${label || fieldname}** qatorini to'ldiramiz.`, {
								click: true,
								duration_ms: 250,
								pre_click_pause_ms: 110,
							});
							if (focused) {
								await this.typeIntoInput(input, stringValue, {
									char_delay_ms: 60,
									after_type_pause_ms: 100,
								});
								input.blur?.();
								await this.sleep(160);
							}
						}
						let after = String(row[fieldname] ?? "").trim();
						let ok = fieldname === "qty" ? Number(row[fieldname] || 0) > 0 : Boolean(after);
						if (!ok) {
							await frappe.model.set_value(row.doctype, row.name, fieldname, value);
							await this.sleep(140);
							after = String(row[fieldname] ?? "").trim();
							ok = fieldname === "qty" ? Number(row[fieldname] || 0) > 0 : Boolean(after);
						}
						if (ok && label) this.emitProgress(`✅ **${label}** qatori \`${String(value || "")}\` bilan to'ldirildi.`);
						return ok;
					} catch {
						return false;
					}
				}

				async fillStockEntryLineDemo() {
					const frm = window.cur_frm;
					if (!frm || String(frm.doctype || "").trim().toLowerCase() !== "stock entry") {
						return { filled: 0, filledLabels: [], blockedLinkHints: [] };
					}

					const filledLabels = [];
					const blockedLinkHints = [];
					let filled = 0;

					const currentType = String(this.readFieldValue("stock_entry_type") || "").trim();
					const safeType = await this.resolveSafeStockEntryType(currentType);
					if (safeType && currentType !== safeType) {
						if (await this.setDocFieldValue("stock_entry_type", safeType, "Stock Entry Type")) {
							filled += 1;
							filledLabels.push("Stock Entry Type");
						}
					}

					const purpose = this.detectStockEntryPurpose();
					const whCandidates = await this.fetchWarehouseCandidates();
					let sourceWh = String(this.readFieldValue("from_warehouse") || "").trim();
					let targetWh = String(this.readFieldValue("to_warehouse") || "").trim();
					if (!sourceWh) sourceWh = whCandidates[0] || "";
					if (!targetWh) targetWh = whCandidates.find((x) => x && x !== sourceWh) || whCandidates[0] || "";

					if ((purpose === "issue" || purpose === "transfer") && sourceWh && !String(this.readFieldValue("from_warehouse") || "").trim()) {
						if (await this.setDocFieldValue("from_warehouse", sourceWh, "Default Source Warehouse")) {
							filled += 1;
							filledLabels.push("Default Source Warehouse");
						}
					}
					if ((purpose === "receipt" || purpose === "transfer") && targetWh && !String(this.readFieldValue("to_warehouse") || "").trim()) {
						if (await this.setDocFieldValue("to_warehouse", targetWh, "Default Target Warehouse")) {
							filled += 1;
							filledLabels.push("Default Target Warehouse");
						}
					}

					const itemCode = await this.fetchLinkDemoValue("Item", "");
					if (!itemCode) {
						blockedLinkHints.push("**Item Code** (Link: Item)");
						return { filled, filledLabels, blockedLinkHints };
					}

					let row = Array.isArray(frm.doc?.items) ? frm.doc.items[0] : null;
					if (!row) {
						row = frm.add_child("items");
						frm.refresh_field("items");
						await this.sleep(120);
					}
					if (!row) return { filled, filledLabels, blockedLinkHints };

					if (!String(row.item_code || "").trim()) {
						if (await this.setStockRowValue(row, "item_code", itemCode, "Item Code")) {
							filled += 1;
							filledLabels.push("Item Code");
						}
					}
					const qtyRaw = Number(row.qty || 0);
					if (!(qtyRaw > 0)) {
						if (await this.setStockRowValue(row, "qty", 1, "Qty")) {
							filled += 1;
							filledLabels.push("Qty");
						}
					}

					if (purpose === "receipt" || purpose === "transfer") {
						const rowTarget = String(row.t_warehouse || "").trim();
						const target = String(this.readFieldValue("to_warehouse") || targetWh || "").trim();
						if (!rowTarget && target) {
							if (await this.setStockRowValue(row, "t_warehouse", target, "Target Warehouse")) {
								filled += 1;
								filledLabels.push("Target Warehouse");
							}
						}
					}
					if (purpose === "issue" || purpose === "transfer") {
						const rowSource = String(row.s_warehouse || "").trim();
						const source = String(this.readFieldValue("from_warehouse") || sourceWh || "").trim();
						if (!rowSource && source) {
							if (await this.setStockRowValue(row, "s_warehouse", source, "Source Warehouse")) {
								filled += 1;
								filledLabels.push("Source Warehouse");
							}
						}
					}

					frm.refresh_field("items");
					await this.sleep(120);
					return {
						filled,
						filledLabels,
						blockedLinkHints: [...new Set(blockedLinkHints)],
					};
				}

			async runCreateRecordTutorial(guide) {
				if (!this.isCreateTutorial(guide)) return { ok: true, reached_target: true, message: "" };
				const doctype = this.getTutorialDoctype(guide);
				this._tutorialStockEntryTypePreference =
					String(doctype || "").trim().toLowerCase() === "stock entry"
						? this.normalizeStockEntryTypePreference(guide?.tutorial?.stock_entry_type_preference)
						: "";
				const stage = String(guide?.tutorial?.stage || "open_and_fill_basic").trim().toLowerCase();
				this.emitProgress(`🚀 **${doctype}** bo'yicha amaliy ko'rsatishni boshladim.`);

				if (!this.isOnDoctypeNewForm(doctype)) {
					if (guide.route && !this.isAtRoute(guide.route)) {
						const openedList = await this.navigate(guide.route);
						if (!openedList) {
							return { ok: false, message: "Kerakli bo'limni ochib bo'lmadi, qayta urinib ko'ring." };
						}
					}
					const createBtn = await this.waitFor(() => this.findCreateActionButton(), 3200, 120);
					if (!createBtn) {
						const openedByFallback = await this.openNewDocFallback(doctype);
						if (!openedByFallback) {
							return { ok: false, message: 'Yangi yozuv ochish tugmasini topa olmadim ("Add/New/Create").' };
						}
					} else {
						const clicked = await this.focusElement(createBtn, 'Yangi yozuv ochish uchun "Add/New" tugmasini bosamiz.', {
							click: true,
							duration_ms: 320,
							pre_click_pause_ms: 120,
						});
						if (!clicked) {
							const openedByFallback = await this.openNewDocFallback(doctype);
							if (!openedByFallback) {
								return { ok: false, message: "Yangi yozuv tugmasini xavfsiz bosib bo'lmadi." };
							}
						} else {
							this.emitProgress("➕ `Add/New` bosildi, endi forma turini tekshiryapman.");
							await this.waitFor(() => this.isOnDoctypeNewForm(doctype) || this.isQuickEntryOpen(), 5200, 120);
						}
					}
				}

				if (!this.isOnDoctypeNewForm(doctype) && this.isQuickEntryOpen()) {
					this.emitProgress('🧩 Quick Entry ochildi, to\'liq o\'rgatish uchun **Edit Full Form** ga o\'tamiz.');
					if (stage === "show_save_only") {
						const quickSaveBtn = this.findQuickEntryActionButton("save");
						if (quickSaveBtn) {
							await this.focusElement(quickSaveBtn, 'Quick Entry ichida "Save" tugmasi shu joyda (bosmayman).', {
								click: false,
								duration_ms: 240,
							});
						}
					}
					const fullFormBtn = this.findQuickEntryActionButton("edit_full_form");
					if (!fullFormBtn) {
						return { ok: false, message: '"Edit Full Form" tugmasini topa olmadim.' };
					}
					const openedFullForm = await this.focusElement(
						fullFormBtn,
						'"Edit Full Form" ni bosib to\'liq formaga o\'tamiz.',
						{
							click: true,
							duration_ms: 300,
							pre_click_pause_ms: 120,
						}
					);
					if (openedFullForm) {
						this.emitProgress("📝 `Edit Full Form` bosildi, endi to'liq formani to'ldirishga o'tamiz.");
						await this.waitFor(() => this.isOnDoctypeNewForm(doctype), 5200, 120);
					}
				}

				if (!this.isOnDoctypeNewForm(doctype)) {
					return {
						ok: false,
						reached_target: false,
						message: "Quick Entry oynasidan to'liq formaga o'tib bo'lmadi. Iltimos qayta urinib ko'ring.",
					};
				}

				if (stage === "show_save_only") {
					const saveBtn = await this.waitFor(() => this.findSaveActionButton(), 2000, 120);
					if (saveBtn) {
						await this.focusElement(saveBtn, 'Mana shu joyda "Save/Submit" tugmasi turadi (bosmayman).', {
							click: false,
							duration_ms: 280,
						});
					}
					this.emitProgress('💾 `Save/Submit` joyini ko\'rsatdim, lekin xavfsizlik uchun bosmadim.');
					return {
						ok: true,
						reached_target: true,
						message: 'Save/Submit tugmasini ko\'rsatdim. Xavfsizlik uchun uni avtomatik bosmadim.',
					};
				}

				this.emitProgress("🧠 AI mavjud maydonlarni tahlil qilib, aqlli to'ldirish rejasini tuzyapti.");
				const planResult = await this.requestAIFieldPlan(doctype, stage === "fill_more" ? "fill_more" : "open_and_fill_basic");
				if (Array.isArray(planResult.plan) && planResult.plan.length) {
					this.emitProgress(
						`🗺️ Reja tayyor: ${planResult.plan.length} ta qadam (${String(planResult.source || "ai")}). Endi amalda to'ldiraman.`
					);
				} else {
					this.emitProgress("⚠️ AI reja qaytarmadi, zaxira reja bilan davom etaman.");
				}
					const fillResult = await this.fillFormFields(
						doctype,
						stage === "fill_more" ? "fill_more" : "open_and_fill_basic",
						planResult.plan
					);
					let filled = Number(fillResult?.filled || 0);
					const filledLabels = Array.isArray(fillResult?.filledLabels) ? [...fillResult.filledLabels] : [];
					let blockedLinkHints = Array.isArray(fillResult?.blockedLinkHints) ? [...fillResult.blockedLinkHints] : [];

					if (String(doctype || "").trim().toLowerCase() === "stock entry") {
						this.emitProgress("🧠 Stock Entry uchun qator maydonlarini ham aqlli to'ldiraman (Item, Qty, Warehouse).");
						const stockResult = await this.fillStockEntryLineDemo();
						const extraFilled = Number(stockResult?.filled || 0);
						if (extraFilled > 0) filled += extraFilled;
						const extraLabels = Array.isArray(stockResult?.filledLabels) ? stockResult.filledLabels : [];
						for (const label of extraLabels) {
							if (label && !filledLabels.includes(label)) filledLabels.push(label);
						}
						const extraBlocked = Array.isArray(stockResult?.blockedLinkHints) ? stockResult.blockedLinkHints : [];
						blockedLinkHints = [...new Set([...blockedLinkHints, ...extraBlocked])];
					}

					const missingRequiredLabels = this.collectMissingRequiredFields(doctype)
						.map((x) => String(x.label || x.fieldname || "").trim())
						.filter(Boolean);
					blockedLinkHints = [...new Set(blockedLinkHints)];
					const saveBtn = this.findSaveActionButton();
					if (saveBtn) {
						await this.focusElement(saveBtn, 'Saqlash joyini ham ko\'rsatdim (bosmayman).', {
							click: false,
							duration_ms: 220,
						});
					}
					if (missingRequiredLabels.length) {
						this.emitProgress(
							`⚠️ Majburiy maydonlar hali to'lmadi: ${missingRequiredLabels.join(", ")}. Jarayon to'liq tugamadi.`
						);
						if (blockedLinkHints.length) {
							this.emitProgress(`🧩 Bog'liq master yozuvlar kerak: ${blockedLinkHints.join(", ")}.`);
						}
						return {
							ok: true,
							reached_target: true,
							message:
								filled > 0
									? `${filled} ta maydonni to'ldirdim (${filledLabels.join(
											", "
										)}), lekin dars tugamadi. Majburiy maydonlar qolgan: ${missingRequiredLabels.join(", ")}.`
									: `Forma ochildi, lekin majburiy maydonlar hali bo'sh: ${missingRequiredLabels.join(
											", "
										)}. Avval shu maydonlarni to'ldiramiz.`,
						};
					}
					this.emitProgress(
						filled > 0
							? `🎯 To'ldirilgan maydonlar: ${filledLabels.join(", ")}. Endi keyingi bosqichga o'tish mumkin.`
							: "⚠️ To'ldirishga mos maydon topilmadi."
					);
					return {
						ok: true,
						reached_target: true,
						message:
							filled > 0
								? `${filled} ta maydonni demo tarzda to'ldirdim: ${filledLabels.join(", ")}. Keyingi bosqichni aytsangiz davom etaman.`
								: "Forma ochildi, lekin avtomatik to'ldirishga mos maydon topilmadi. Qaysi maydondan boshlaymiz?",
					};
				}

		getSearchQuery(guide, step) {
			const stepLabel = String(step?.label || "").trim();
			const targetLabel = String(guide?.target_label || "").trim();
			const stepScope = String(step?.scope || "").trim().toLowerCase();
			const stepNorm = normalizeText(stepLabel);
			const targetNorm = normalizeText(targetLabel);

			// If the current step is a parent/module hop (e.g. Core -> User),
			// search directly by final target to avoid wrong "Core" lookups.
			if (targetLabel && stepScope === "sidebar" && stepLabel && stepNorm && targetNorm && stepNorm !== targetNorm) {
				return targetLabel;
			}
			if (targetLabel) return targetLabel;

			const parts = this.routeToParts(guide?.route || "");
			if (!parts.length) return "";
			const routeLeaf = parts[parts.length - 1].replace(/-/g, " ").trim();
			if (routeLeaf) return routeLeaf;
			return stepLabel;
		}

		findSearchResult(query, route) {
			const target = normalizeText(query);
			const targetPath = this.normalizePath(this.routeToPath(route));
			const selectors = [
				".awesomplete ul li",
				".search-bar .awesomplete ul li",
				".search-dialog li",
				".awesomplete li",
			];
			let best = null;
			let bestScore = 0;
			for (const sel of selectors) {
				const nodes = document.querySelectorAll(sel);
				for (const node of nodes) {
					if (!isVisible(node)) continue;
					const el = getClickable(node) || node;
					const text = normalizeText(node.textContent || el.textContent || "");
					if (!text) continue;
					const candidatePath = this.getCandidatePath(el, node);
					let score = 0;

					if (targetPath) {
						if (candidatePath === targetPath) {
							score = 160;
						} else if (candidatePath) {
							continue;
						} else if (target && text === target) {
							// Some Awesomebar rows have no href/route in DOM.
							// In that case, only exact text is accepted.
							score = 154;
						} else {
							continue;
						}
					}
					if (target && text === target) score = Math.max(score, 180);
					else if (target && text.includes(target)) score = Math.max(score, 168);
					if (score > bestScore) {
						best = el;
						bestScore = score;
					}
				}
			}
			return bestScore >= 150 ? best : null;
		}

		submitSearchByEnter(input) {
			if (!input) return false;
			try {
				input.focus();
				const eventInit = {
					bubbles: true,
					cancelable: true,
					key: "Enter",
					code: "Enter",
					which: 13,
					keyCode: 13,
				};
				input.dispatchEvent(new KeyboardEvent("keydown", eventInit));
				input.dispatchEvent(new KeyboardEvent("keypress", eventInit));
				input.dispatchEvent(new KeyboardEvent("keyup", eventInit));
				return true;
			} catch {
				return false;
			}
		}

		async trySearchFallback(step, guide) {
			if (!this.running || !guide?.route) return false;
			const query = this.getSearchQuery(guide, step);
			const input = this.findSearchInput();
			if (!input || !query) return false;
			const openMessage =
				String(step?.message || "").trim() || "Qidiruv orqali topamiz.";

			await this.focusElement(input, openMessage, {
				click: true,
				duration_ms: 320,
			});
			if (!this.running) return false;

			try {
				input.focus();
				if (typeof input.select === "function") input.select();
				input.value = "";
				input.dispatchEvent(new Event("input", { bubbles: true }));
				input.value = query;
				input.dispatchEvent(new Event("input", { bubbles: true }));
				input.dispatchEvent(new Event("change", { bubbles: true }));
			} catch {
				return false;
			}

			await this.sleep(540);
			if (this.isAtRoute(guide.route)) return true;

			const result = this.findSearchResult(query, guide.route);
			if (result) {
				await this.focusElement(result, "Qidiruv natijasini bosamiz.", {
					click: true,
					duration_ms: 320,
					pre_click_pause_ms: 125,
				});
				await this.waitFor(() => this.isAtRoute(guide.route), 3200, 110);
