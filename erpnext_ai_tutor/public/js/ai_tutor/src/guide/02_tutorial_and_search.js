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

			isManageRolesTutorial(guide) {
				return String(guide?.tutorial?.mode || "").trim().toLowerCase() === "manage_roles";
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

			isNewDocRouteName(doctype, docname = "") {
				const slug = this.doctypeToRouteSlug(doctype);
				const name = String(docname || "").trim().toLowerCase();
				if (!slug || !name) return false;
				return name.startsWith(`new-${slug}`);
			}

			getCurrentFormRouteName(doctype) {
				const slug = this.doctypeToRouteSlug(doctype);
				const dtNorm = String(doctype || "").trim().toLowerCase();
				if (!slug || !dtNorm) return "";
				try {
					const route = Array.isArray(frappe?.get_route?.()) ? frappe.get_route() : [];
					if (route.length) {
						const head = String(route[0] || "").trim().toLowerCase();
						const second = String(route[1] || "").trim().toLowerCase();
						const third = String(route[2] || "").trim();
						if (head === "form" && second === dtNorm && third) return third;
						if (head === slug && second && !["view", "list", "report"].includes(second)) {
							return String(route[1] || "").trim();
						}
					}
				} catch {
					// ignore
				}
				const path = this.normalizePath(window.location.pathname || "");
				if (!path.startsWith(`/app/${slug}/`)) return "";
				const suffix = path.slice(`/app/${slug}/`.length);
				const routeName = String(suffix.split("/", 1)[0] || "").trim();
				if (!routeName || ["view", "list", "report"].includes(routeName.toLowerCase())) return "";
				return routeName;
			}

			getDoctypeFormState(doctype) {
				const dtNorm = String(doctype || "").trim().toLowerCase();
				if (!dtNorm) return "not_form";
				const frm = window.cur_frm;
				if (frm && String(frm.doctype || "").trim().toLowerCase() === dtNorm) {
					try {
						if (typeof frm.is_new === "function") {
							return frm.is_new() ? "new_form" : "existing_form";
						}
					} catch {
						// ignore
					}
					if (frm.doc && frm.doc.__islocal) return "new_form";
					if (frm.doc && String(frm.doc.name || "").trim()) return "existing_form";
				}
				const routeName = this.getCurrentFormRouteName(doctype);
				if (!routeName) return "not_form";
				return this.isNewDocRouteName(doctype, routeName) ? "new_form" : "existing_form";
			}

			isOnDoctypeNewForm(doctype) {
				return this.getDoctypeFormState(doctype) === "new_form";
			}

			isOnDoctypeForm(doctype) {
				const formState = this.getDoctypeFormState(doctype);
				return formState === "new_form" || formState === "existing_form";
			}

			isOnDoctypeList(doctype) {
				const slug = this.doctypeToRouteSlug(doctype);
				if (!slug) return false;
				const path = this.normalizePath(window.location.pathname || "");
				if (path === `/app/${slug}`) return true;
				if (path.startsWith(`/app/${slug}/view/`)) return true;
				try {
					const route = Array.isArray(frappe?.get_route?.()) ? frappe.get_route() : [];
					if (!route.length) return false;
					const head = String(route[0] || "").trim().toLowerCase();
					const second = String(route[1] || "").trim().toLowerCase();
					if (head === "list" && second === String(doctype || "").trim().toLowerCase()) return true;
					if (head === slug && (!second || second === "view" || second === "list")) return true;
				} catch {
					// ignore
				}
				return false;
			}

			getCreateRecordEntryState(doctype) {
				if (this.isQuickEntryOpen()) return "quick_entry";
				if (this.isOnDoctypeNewForm(doctype)) return "new_form";
				if (this.isOnDoctypeForm(doctype)) return "existing_form";
				return "other";
			}

			hasReachedCreateRecordEntryState(doctype) {
				const state = this.getCreateRecordEntryState(doctype);
				return state === "new_form" || state === "quick_entry";
			}

			async waitForCreateRecordEntryState(doctype, timeoutMs = 5200) {
				const reachedState = await this.waitFor(() => {
					const state = this.getCreateRecordEntryState(doctype);
					return state === "new_form" || state === "quick_entry" ? state : false;
				}, timeoutMs, 120);
				if (reachedState === "new_form" || reachedState === "quick_entry") return reachedState;
				return this.getCreateRecordEntryState(doctype);
			}

			isNonCreatePrimaryAction(el, label = "") {
				if (!el) return false;
				const labelNorm = normalizeText(label);
				if (!labelNorm) return false;
				if (el.closest(".actions-btn-group, .menu-btn-group")) return true;
				if (/(^|\b)(actions|menu|more)(\b|$)/i.test(labelNorm)) return true;
				if (el.getAttribute?.("aria-haspopup") === "true" && !/\b(add|new|create)\b/i.test(labelNorm)) {
					return true;
				}
				return false;
			}

			getCurrentListView(doctype) {
				const dt = String(doctype || "").trim();
				if (!dt || !this.isOnDoctypeList(dt)) return null;
				const currentList = window.cur_list;
				if (currentList && String(currentList.doctype || "").trim().toLowerCase() === dt.toLowerCase()) {
					return currentList;
				}
				try {
					if (typeof frappe?.get_list_view === "function") {
						const listView = frappe.get_list_view(dt);
						if (listView && String(listView.doctype || "").trim().toLowerCase() === dt.toLowerCase()) {
							return listView;
						}
					}
				} catch {
					// ignore
				}
				return null;
			}

			async openNewDocFromCurrentListView(doctype) {
				const dt = String(doctype || "").trim();
				const listView = this.getCurrentListView(dt);
				if (!dt || !listView) return false;

				const pagePrimary =
					listView?.page?.btn_primary?.get?.(0) ||
					listView?.page?.btn_primary?.[0] ||
					null;
				const primaryLabel = this.getElementLabel(pagePrimary);
				const createRe = /\b(add|new|create|yangi|qo['’]?sh|добав|созд)\b/i;
				if (
					pagePrimary &&
					isVisible(pagePrimary) &&
					!this.isForbiddenActionElement(pagePrimary) &&
					!this.isNonCreatePrimaryAction(pagePrimary, primaryLabel) &&
					createRe.test(primaryLabel)
				) {
					this.emitProgress(`🔁 DOM qidiruv qoqildi, **${dt}** uchun page primary action orqali davom etaman.`);
					const clicked = await this.focusElement(pagePrimary, 'List view ichidagi "Add/New" primary actionni bosamiz.', {
						click: true,
						duration_ms: 260,
						pre_click_pause_ms: 90,
					});
					if (clicked) {
						const state = await this.waitForCreateRecordEntryState(dt, 5200);
						if (state === "new_form" || state === "quick_entry") return true;
					}
				}

				if (typeof listView.make_new_doc === "function") {
					try {
						this.emitProgress(`🔁 DOM qidiruv qoqildi, **${dt}** uchun list view create actionini to'g'ridan-to'g'ri ishga tushiraman.`);
						listView.make_new_doc();
						const state = await this.waitForCreateRecordEntryState(dt, 5200);
						return state === "new_form" || state === "quick_entry";
					} catch {
						// ignore
					}
				}

				return false;
			}

			findCreateActionButton(doctype = "") {
				const createRe = /\b(add|new|create|yangi|qo['’]?sh|добав|созд)\b/i;
				const doctypeNorm = normalizeText(doctype);
				const roots = [
					document.querySelector(".page-head .page-actions"),
					document.querySelector(".layout-main .page-head .page-actions"),
					document.querySelector(".layout-main .page-actions"),
					document.querySelector(".layout-main .msg-box"),
					document.querySelector(".layout-main .list-empty-state"),
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
						const labelNorm = normalizeText(label);
						if (this.isNonCreatePrimaryAction(el, labelNorm)) continue;
						let score = 0;
						if (el.matches?.(".btn-new-doc")) score += 220;
						if (el.matches?.(".primary-action")) score += 180;
						if (el.closest?.(".standard-actions")) score += 45;
						if (el.closest?.(".page-actions")) score += 20;
						if (createRe.test(label)) score += 120;
						if (el.matches?.("[data-label]")) score += 15;
						if (el.matches?.(".btn-primary")) score += 15;
						if (/\+\s*[a-z]/i.test(label) || /^\+\s*/.test(label)) score += 20;
						if (/item|invoice|order|customer|supplier/i.test(label)) score += 10;
						if (doctypeNorm && labelNorm.includes(doctypeNorm)) score += 45;
						if (score > bestScore) {
							best = el;
							bestScore = score;
						}
					}
				}
				if (best && bestScore >= 80) return best;
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
				const nativeOpened = await this.openNewDocFromCurrentListView(dt);
				if (nativeOpened) return true;
				try {
					this.emitProgress(`🔁 UI tugmani topolmadim, fallback orqali **${dt}** uchun yangi forma ochyapman.`);
					frappe.new_doc(dt);
					const state = await this.waitForCreateRecordEntryState(dt, 5200);
					return state === "new_form" || state === "quick_entry";
				} catch {
					return false;
				}
			}

			getVisibleBlockingDialog() {
				const dialogs = document.querySelectorAll(".modal.show, .msgprint-dialog.modal");
				for (const dialog of dialogs) {
					if (!dialog || !isVisible(dialog)) continue;
					if (dialog.closest(".erpnext-ai-tutor-root")) continue;
					if (
						dialog.querySelector(".quick-entry-dialog") ||
						dialog.querySelector(".quick-entry-layout") ||
						dialog.classList.contains("quick-entry-dialog")
					) {
						continue;
					}
					const title = normalizeText(
						dialog.querySelector(".modal-title, .msgprint h4, .modal-header .title")?.textContent || ""
					);
					const body = normalizeText(
						dialog.querySelector(".msgprint, .modal-body, .modal-message, .frappe-confirm-message")?.textContent || ""
					);
					const primaryLabel = normalizeText(
						dialog.querySelector(".btn-primary:not(.hide), .modal-footer .btn-primary:not(.hide)")?.textContent || ""
					);
					const secondaryLabel = normalizeText(
						dialog.querySelector(".btn-default:not(.hide), .btn-secondary:not(.hide)")?.textContent || ""
					);
					if (!title && !body && !primaryLabel && !secondaryLabel) continue;
					return {
						title,
						body,
						primary_label: primaryLabel,
						secondary_label: secondaryLabel,
					};
				}
				return null;
			}

			buildBlockingDialogMessage(doctype, blocker = null) {
				const dt = String(doctype || "").trim() || "yozuv";
				const title = String(blocker?.title || "").trim();
				const body = String(blocker?.body || "").trim();
				const primaryLabel = String(blocker?.primary_label || "").trim();
				const parts = [`**${dt}** yaratish oqimini ekraningizdagi dialog ushlab turibdi.`];
				if (title) parts.push(`Dialog sarlavhasi: ${title}.`);
				if (body) parts.push(`Xabar: ${body}.`);
				if (primaryLabel) {
					parts.push(`Avval dialogdagi \`${primaryLabel}\` yoki mos amaliyotni yakunlang, keyin yana urinaman.`);
				} else {
					parts.push("Avval dialogni yakunlang yoki yoping, keyin yana urinaman.");
				}
				return parts.join(" ");
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
