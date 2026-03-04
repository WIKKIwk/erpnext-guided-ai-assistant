
				this.$history.innerHTML = `
					<div class="erpnext-ai-tutor-history-title-row">
						<div class="erpnext-ai-tutor-history-title">Chats</div>
					</div>
					<div class="erpnext-ai-tutor-history-list">${rows}</div>
				`;

			for (const el of this.$history.querySelectorAll(".erpnext-ai-tutor-history-item")) {
				el.addEventListener("click", () => {
					const id = el.getAttribute("data-id");
					if (!id) return;
					this.activeConversationId = id;
					this._newChatPending = false;
					this._newChatPreviousConversationId = null;
					this.updateNewChatButtonState();
					this.saveChatState();
					this.hideHistory();
					this.renderActiveConversation();
					this.open();
				});
			}
		}

		async loadConfig() {
			try {
				const r = await frappe.call(METHOD_GET_CONFIG);
				this.config = r?.message?.config || {};
				this.aiReady = Boolean(r?.message?.ai_ready);
				const enabled = r?.message?.config?.enabled;
				if (enabled === false) {
					this.$root.classList.add("erpnext-ai-tutor-hidden");
				}
			} catch {
				// keep defaults
				this.config = { enabled: true, advanced_mode: true, auto_open_on_error: true, auto_open_on_warning: true, include_form_context: true, include_doc_values: true, max_context_kb: 24, emoji_style: "soft" };
				this.aiReady = false;
			}
		}

		installHooks() {
			if (!frappe || !frappe.msgprint || this._hooksInstalled) return;
			this._hooksInstalled = true;

			const originalMsgprint = frappe.msgprint.bind(frappe);
			frappe.msgprint = (...args) => {
				try {
					this.onMsgprint(args);
				} catch {
					// ignore
				}
				return originalMsgprint(...args);
			};

			if (frappe.show_alert) {
				const originalAlert = frappe.show_alert.bind(frappe);
				frappe.show_alert = (...args) => {
					try {
						this.onAlert(args);
					} catch {
						// ignore
					}
					return originalAlert(...args);
				};
			}

			// Catch unhandled JS errors too (best-effort).
				window.addEventListener("unhandledrejection", (event) => {
					try {
						const reason = event?.reason;
						const message = stripHtml(reason?.message || reason || "Unhandled promise rejection");
						this.handleEvent({ severity: "error", title: "Frontend error", message, source: "unhandledrejection" });
					} catch {
						// ignore
					}
				});

				window.addEventListener("error", (event) => {
					try {
						const message = stripHtml(event?.message || "Frontend error");
						this.handleEvent({ severity: "error", title: "Frontend error", message, source: "window.error" });
					} catch {
						// ignore
					}
				});
			}

		installContextCapture() {
			if (this._contextCaptureInstalled) return;
			this._contextCaptureInstalled = true;

			const handler = (ev) => {
				try {
					this.captureActiveField(ev?.target);
				} catch {
					// ignore
				}
			};

			document.addEventListener("focusin", handler, true);
			document.addEventListener("input", handler, true);
		}

		captureActiveField(target) {
			if (!target || typeof target.closest !== "function") return;
			if (target.closest(".erpnext-ai-tutor-drawer")) return;

			const tag = String(target.tagName || "").toLowerCase();
			const isInputLike =
				tag === "input" ||
				tag === "textarea" ||
				tag === "select" ||
				Boolean(target.isContentEditable);
			if (!isInputLike) return;

			const wrapper = target.closest("[data-fieldname]");
			const fieldname = wrapper?.dataset?.fieldname || target.getAttribute("name") || target.id || "";
			let label = "";

			try {
				const df = window.cur_frm?.fields_dict?.[fieldname]?.df;
				label = df?.label || "";
			} catch {
				// ignore
			}

			if (!label && wrapper) {
				const labelEl = wrapper.querySelector("label");
				label = (labelEl?.textContent || "").trim();
			}

			if (!label) {
				label =
					(target.getAttribute("aria-label") || "").trim() ||
					(target.getAttribute("placeholder") || "").trim() ||
					(label || "");
			}

			let value = "";
			try {
				if (fieldname && window.cur_frm?.doc && Object.prototype.hasOwnProperty.call(window.cur_frm.doc, fieldname)) {
					const v = window.cur_frm.doc[fieldname];
					if (typeof v === "string" || typeof v === "number") value = String(v);
				} else if (typeof target.value === "string") {
					value = target.value;
				}
			} catch {
				// ignore
			}

			const safeFieldname = String(fieldname || "");
			const safeLabel = String(label || "");
			const isSensitive = redactKey(safeFieldname) || redactKey(safeLabel);
			const safeValue = isSensitive ? "[redacted]" : clip(value, 140);

			this.activeField = {
				fieldname: safeFieldname,
				label: safeLabel,
				value: safeValue,
				at: Date.now(),
			};
		}

		onMsgprint(args) {
			let message = "";
			let title = "";
			let indicator = "";
			const first = args[0];
			if (typeof first === "string") {
				message = first;
				title = args[1] || "";
				indicator = args[2] || "";
			} else if (first && typeof first === "object") {
				message = first.message || first.msg || "";
				title = first.title || "";
				indicator = first.indicator || first.color || "";
			}

			const normalized = {
				title: stripHtml(title),
				message: stripHtml(message),
				source: "msgprint",
			};
			let severity = guessSeverity(indicator);
			// Some Frappe warnings (e.g. "No Roles Specified") may not carry indicator.
			if (!severity && this.isNoRolesSpecifiedEvent(normalized)) {
				severity = "warning";
			}
			if (!severity) return;
			this.handleEvent({ severity, ...normalized });
		}

		onAlert(args) {
			const first = args[0];
			let indicator = "";
			let message = "";
			if (typeof first === "string") {
				message = first;
				indicator = args[1] || "";
			} else if (first && typeof first === "object") {
				message = first.message || "";
				indicator = first.indicator || "";
			}

			const severity = guessSeverity(indicator);
			if (!severity) return;
			this.handleEvent({ severity, title: "", message: stripHtml(message), source: "alert" });
		}

		isNoRolesSpecifiedEvent(ev) {
			if (!ev) return false;
			const title = stripHtml(ev?.title || "").replace(/\s+/g, " ").trim().toLowerCase();
			const message = stripHtml(ev?.message || "").replace(/\s+/g, " ").trim().toLowerCase();
			const hasNoRolesTitle = title.includes("no roles specified");
			const hasNoRolesText = message.includes("no roles enabled") || message.includes("has no roles");
			return hasNoRolesTitle || hasNoRolesText;
		}

		async clickElementWithGuideCursor(el) {
			if (!el || typeof el.getBoundingClientRect !== "function") return false;
			const rect = el.getBoundingClientRect();
			if (!rect || rect.width < 2 || rect.height < 2) return false;
			const hotspotX = 13;
			const hotspotY = 8;
			const targetX = Math.min(window.innerWidth - 2, Math.max(2, rect.left + rect.width / 2));
			const targetY = Math.min(window.innerHeight - 2, Math.max(2, rect.top + rect.height / 2));
			let layer = null;
			try {
				layer = document.createElement("div");
				layer.className = "erpnext-ai-tutor-guide-layer erpnext-ai-tutor-top-cursor-layer";
				layer.style.zIndex = "2147483647";
				const cursor = document.createElement("div");
				cursor.className = "erpnext-ai-tutor-guide-cursor";
				cursor.style.left = `${Math.max(0, 18 - hotspotX)}px`;
				cursor.style.top = `${Math.max(0, 18 - hotspotY)}px`;
				layer.appendChild(cursor);
				document.body.appendChild(layer);
				await new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
				cursor.style.transitionDuration = "290ms";
				cursor.style.left = `${Math.max(0, targetX - hotspotX)}px`;
				cursor.style.top = `${Math.max(0, targetY - hotspotY)}px`;
				await new Promise((resolve) => setTimeout(resolve, 310));
				cursor.classList.remove("is-click");
				void cursor.offsetWidth;
				cursor.classList.add("is-click");
				if (typeof el.click === "function") {
					el.click();
				}
				await new Promise((resolve) => setTimeout(resolve, 120));
				return true;
			} catch {
				return false;
			} finally {
				if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
			}
		}

		async closeNoRolesSpecifiedDialog() {
			const closeSelectors = [
				".modal-header .btn-modal-close",
				".modal-header .btn-close",
				".modal-header [data-dismiss='modal']",
				".modal-header .close",
				"button[aria-label='Close']",
			];
			const dialogs = Array.from(document.querySelectorAll(".msgprint-dialog, .modal.msgprint-dialog, .modal.show"))
				.filter((el) => {
					const text = stripHtml(el?.textContent || "").toLowerCase();
					return text.includes("no roles specified") || text.includes("has no roles") || text.includes("no roles enabled");
				})
				.reverse();
			for (const dialog of dialogs) {
				for (const sel of closeSelectors) {
					const btn = dialog.querySelector(sel);
					if (btn && typeof btn.click === "function") {
						const byCursor = await this.clickElementWithGuideCursor(btn);
						if (!byCursor) btn.click();
						await new Promise((resolve) => setTimeout(resolve, 80));
						if (!this.isNoRolesDialogVisible()) return true;
					}
				}
			}
			try {
				const dialog = frappe?.msg_dialog;
				const wrapper = dialog?.$wrapper?.[0] || dialog?.wrapper || null;
				const jqVisible = Boolean(dialog?.$wrapper && typeof dialog.$wrapper.is === "function" && dialog.$wrapper.is(":visible"));
				const domVisible = Boolean(
					wrapper &&
						(wrapper.classList?.contains("show") ||
							window.getComputedStyle(wrapper).display !== "none" ||
							window.getComputedStyle(wrapper).visibility !== "hidden")
				);
				const isVisible = jqVisible || domVisible;
				if (isVisible && dialog && typeof dialog.cancel === "function") {
					dialog.cancel();
				}
				if (wrapper) {
					for (const sel of closeSelectors) {
						const btn = wrapper.querySelector(sel);
						if (btn && typeof btn.click === "function" && isVisible) {
							const byCursor = await this.clickElementWithGuideCursor(btn);
							if (!byCursor) btn.click();
							await new Promise((resolve) => setTimeout(resolve, 80));
							if (!this.isNoRolesDialogVisible()) return true;
						}
					}
				}
				if (isVisible && dialog && typeof dialog.get_close_btn === "function") {
					const closeBtn = dialog.get_close_btn();
					if (closeBtn && typeof closeBtn.trigger === "function") {
						closeBtn.trigger("click");
						await new Promise((resolve) => setTimeout(resolve, 60));
						if (!this.isNoRolesDialogVisible()) return true;
					}
				}
				if (isVisible && typeof window.jQuery === "function" && wrapper) {
					window.jQuery(wrapper).modal("hide");
				}
				if (isVisible && typeof frappe?.hide_msgprint === "function") {
					frappe.hide_msgprint(true);
				}
				if (isVisible && dialog && typeof dialog.hide === "function") {
					dialog.hide();
				}
				return !this.isNoRolesDialogVisible();
			} catch {
				// ignore
			}
			return !this.isNoRolesDialogVisible();
		}

		isNoRolesDialogVisible() {
			const dialogs = Array.from(document.querySelectorAll(".msgprint-dialog, .modal.msgprint-dialog, .modal.show, .modal.in"));
			const matched = dialogs.filter((el) => {
				const text = stripHtml(el?.textContent || "").toLowerCase();
				if (!text) return false;
				const hasNoRoles = text.includes("no roles specified") || text.includes("has no roles") || text.includes("no roles enabled");
				if (!hasNoRoles) return false;
				const style = window.getComputedStyle(el);
				return style && style.display !== "none" && style.visibility !== "hidden";
			});
			if (matched.length) return true;
			try {
				const dialog = frappe?.msg_dialog;
				if (!dialog?.$wrapper || typeof dialog.$wrapper.is !== "function") return false;
				return dialog.$wrapper.is(":visible");
			} catch {
				return false;
			}
		}

		async closeNoRolesSpecifiedDialogWithRetry() {
			for (let i = 0; i < 16; i += 1) {
				if (!this.isNoRolesDialogVisible()) return true;
				await this.closeNoRolesSpecifiedDialog();
				await new Promise((resolve) => setTimeout(resolve, 90));
				if (!this.isNoRolesDialogVisible()) return true;
			}
			await this.closeNoRolesSpecifiedDialog();
			return !this.isNoRolesDialogVisible();
		}

		async navigateToUserListAfterNoRoles() {
			const now = Date.now();
			const lastAt = Number(this._lastNoRolesRouteAt || 0);
			if (lastAt && now - lastAt < 6000) return;
			this._lastNoRolesRouteAt = now;
			await new Promise((resolve) => setTimeout(resolve, 160));
			try {
				if (frappe?.set_route) {
					frappe.set_route("List", "User");
					return;
				}
			} catch {
				// ignore and fallback
			}
			this.navigateToRoute("/app/user");
		}

		async handleNoRolesSpecifiedEvent(ev) {
			if (!this.isNoRolesSpecifiedEvent(ev)) return false;
			const now = Date.now();
			const lastAt = Number(this._lastNoRolesHandledAt || 0);
			const isDuplicate = lastAt && now - lastAt < 6000;
			this._lastNoRolesHandledAt = now;
			await this.closeNoRolesSpecifiedDialogWithRetry();
			if (!isDuplicate) {
				this.append(
					"assistant",
					"Havotir olmang, user saqlandi. Hozircha role berilmagan, keyinroq role qo'shishni birga qilamiz.",
					{ route_key: this.routeKey || this.getRouteKey() }
				);
			}
			await this.navigateToUserListAfterNoRoles();
			this.open();
			return true;
		}

		fingerprintEvent(ev) {
			const severity = String(ev?.severity || "").trim().toLowerCase();
			const title = stripHtml(ev?.title || "").replace(/\s+/g, " ").trim().slice(0, 140);
			const message = stripHtml(ev?.message || "").replace(/\s+/g, " ").trim().slice(0, 260);
			return `${severity}|${title}|${message}`;
		}

		canAutoHelpNow(eventKey) {
			const now = Date.now();
			if (document.visibilityState === "hidden") return false;
			if (this.isBusy) return false;
			if (this.autoHelpDisabledUntil && now < this.autoHelpDisabledUntil) return false;
			if (eventKey && this.lastAutoHelpKey === eventKey && now - this.lastAutoHelpAt < AUTO_HELP_COOLDOWN_MS) {
				return false;
			}

			this.autoHelpTimestamps = (this.autoHelpTimestamps || []).filter((t) => now - t < AUTO_HELP_RATE_WINDOW_MS);
			if (this.autoHelpTimestamps.length >= AUTO_HELP_RATE_MAX) {
				this.autoHelpDisabledUntil = now + AUTO_HELP_FAILURE_COOLDOWN_MS;
				return false;
			}

			this.lastAutoHelpKey = eventKey || "";
			this.lastAutoHelpAt = now;
			this.autoHelpTimestamps.push(now);
			return true;
		}

		async handleEvent(ev) {
			if (await this.handleNoRolesSpecifiedEvent(ev)) return;
			if (!this.isAdvancedMode()) return;
			if (this.guidedRunActive || this.guideRunner?.running) return;
			const now = Date.now();
			if ((ev?.source === "msgprint" || ev?.source === "alert") && now < (this.suppressEventsUntil || 0)) {
				return;
			}
			this.lastEvent = { ...ev, at: Date.now() };
			const autoOpen =
				(ev.severity === "error" && this.config?.auto_open_on_error) ||
				(ev.severity === "warning" && this.config?.auto_open_on_warning);
			if (!autoOpen) return;

			this.open();
			this.showPill(ev.severity);

			const key = this.fingerprintEvent(ev);
			if (!this.canAutoHelpNow(key)) return;
			await this.autoHelp(ev);
		}

			showPill(severity) {
				if (!this.$pill) return;
				this.$pill.classList.remove("erpnext-ai-tutor-hidden", "red", "orange");
				this.$pill.classList.add(severity === "error" ? "red" : "orange");
				this.$pill.textContent = severity === "error" ? "Error" : "Warning";
			}

		clearPill() {
			if (!this.$pill) return;
			this.$pill.classList.add("erpnext-ai-tutor-hidden");
			this.$pill.textContent = "";
		}

		open() {
			if (this.isOpen) return;
			if (!this.$drawer) return;
			this._lastFocusedBeforeOpen = document.activeElement instanceof HTMLElement ? document.activeElement : null;
			this.isOpen = true;
			if (this._drawerHideTimer) {
				clearTimeout(this._drawerHideTimer);
				this._drawerHideTimer = null;
			}
			this.$drawer.classList.remove("erpnext-ai-tutor-hidden", "is-closing");
			this.$drawer.setAttribute("aria-hidden", "false");
			window.requestAnimationFrame(() => {
				if (!this.$drawer) return;
				this.$drawer.classList.add("is-open");
			});
			this.$root?.classList.add("is-open");
			this.loadDraftForRoute(this.routeKey);
			setTimeout(() => {
				this.resizeInput();
				if (this.$input) this.$input.focus();
			}, 160);
		}

		close() {
			this.saveDraft(this.routeKey);
			this.isOpen = false;
			if (!this.$drawer) return;
			this._typingAnimationToken += 1;
			if (this._typingRAF) {
				window.cancelAnimationFrame(this._typingRAF);
				this._typingRAF = null;
			}
			if (this._drawerHideTimer) {
				clearTimeout(this._drawerHideTimer);
				this._drawerHideTimer = null;
			}
			this.$drawer.classList.remove("is-open");
			this.$drawer.classList.add("is-closing");
			this.$drawer.setAttribute("aria-hidden", "true");
			this.$root?.classList.remove("is-open");
			this.clearPill();
			this.hideTyping();
			if (this.guideRunner) this.guideRunner.stop();
			this._drawerHideTimer = window.setTimeout(() => {
				if (!this.$drawer) return;
				this.$drawer.classList.add("erpnext-ai-tutor-hidden");
				this.$drawer.classList.remove("is-closing");
				this._drawerHideTimer = null;
			}, DRAWER_CLOSE_ANIM_MS);
			const fallbackFocus = this.$fab;
			const restoreTo = this._lastFocusedBeforeOpen;
			window.setTimeout(() => {
				if (restoreTo && typeof restoreTo.focus === "function" && !this.$drawer.contains(restoreTo)) {
					restoreTo.focus();
				} else if (fallbackFocus && typeof fallbackFocus.focus === "function") {
					fallbackFocus.focus();
				}
			}, DRAWER_CLOSE_ANIM_MS);
		}

		toggle() {
			if (this.isOpen) this.close();
			else this.open();
		}

		append(role, content, opts = {}) {
			this.ensureConversation();
			this.setConversationTitleIfNeeded(role === "user" ? content : "");
			if (role === "user") this.markNewChatStarted();

			const ts = Date.now();
			const routeKey = String(opts?.route_key || this.routeKey || this.getRouteKey() || "").trim();
			const guide = this.normalizeGuidePayload(opts?.guide);
			const el = this.appendToDOM(role, content, ts, {
				animate: true,
				guide,
				guide_completed: this.isGuideTargetActive(guide),
			});
			const guideCompleted = Boolean(el?.dataset?.guideCompleted === "1");
			this.history.push({ role, content, route_key: routeKey, guide, guide_completed: guideCompleted, ts });

			const conv = this.getActiveConversation();
			if (conv) {
				if (!Array.isArray(conv.messages)) conv.messages = [];
				conv.messages.push({ role, content, ts, route_key: routeKey, guide, guide_completed: guideCompleted });
				conv.updated_at = ts;
				conv.messages = conv.messages.slice(-MAX_MESSAGES_PER_CONVERSATION);
				this.pruneChatState();
				this.saveChatState();
			}
			this.$body.scrollTop = this.$body.scrollHeight;
			return el;
		}

		shouldAnimateAssistantReply(content) {
			const text = String(content || "");
			if (!text.trim()) return false;
			try {
				if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
					return false;
				}
			} catch {
				// ignore
			}
			return true;
		}

		async animateAssistantTypewriter(textEl, finalText, token) {
			const chars = Array.from(String(finalText || ""));
			const total = chars.length;
			if (!total || !textEl) return;
			const targetDuration = Math.max(
				TYPEWRITER_TARGET_MIN_MS,
				Math.min(TYPEWRITER_TARGET_MAX_MS, 3600 + total * 18)
			);

			await new Promise((resolve) => {
				const start = performance.now();
				let lastCount = 0;

				const frame = (now) => {
					if (
						token !== this._typingAnimationToken ||
						!textEl ||
						!document.body.contains(textEl)
					) {
						this._typingRAF = null;
						resolve();
						return;
					}

					const t = Math.max(0, Math.min(1, (now - start) / targetDuration));
					const eased = t < 0.5
						? 4 * t * t * t
						: 1 - Math.pow(-2 * t + 2, 3) / 2;
					const count = Math.max(1, Math.min(total, Math.floor(eased * total)));

					if (count !== lastCount) {
						textEl.textContent = chars.slice(0, count).join("");
						this.$body.scrollTop = this.$body.scrollHeight;
						lastCount = count;
					}

					if (t >= 1) {
						this._typingRAF = null;
						resolve();
						return;
					}
					this._typingRAF = window.requestAnimationFrame(frame);
				};

				this._typingRAF = window.requestAnimationFrame(frame);
			});
		}

		buildAssistantContent(content, guide) {
			const normalizedGuide = this.normalizeGuidePayload(guide);
			const labelRouteMap = this.buildGuideLabelRouteMap(normalizedGuide);
			const routeLabelMap = this.buildGuideRouteLabelMap(normalizedGuide);
			let assistantText = String(content ?? "");
			if (normalizedGuide?.target_label && normalizedGuide?.route) {
				const target = String(normalizedGuide.target_label).trim();
				const token = `**${target}**`;
				if (target && !assistantText.includes(token)) {
					assistantText = `${assistantText}\n\n${token}`;
				}
			}
			return { assistantText, normalizedGuide, labelRouteMap, routeLabelMap };
		}
