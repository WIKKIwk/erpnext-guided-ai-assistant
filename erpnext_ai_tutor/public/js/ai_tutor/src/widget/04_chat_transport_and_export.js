
		renderAssistantRichText(target, content, guide) {
			if (!target) return;
			const payload = this.buildAssistantContent(content, guide);
			target.innerHTML = "";
			this.renderRichText(target, payload.assistantText, {
				labelRouteMap: payload.labelRouteMap,
				routeLabelMap: payload.routeLabelMap,
			});
		}

		appendGuideActionIfNeeded(wrap, guide, guideOffer) {
			if (!wrap) return;
			const normalizedGuide = this.normalizeGuidePayload(guide);
			const normalizedGuideOffer = this.normalizeGuideOfferPayload(guideOffer);
			if (!normalizedGuide && !normalizedGuideOffer) return;
			if (!this.isGuidedCursorEnabled()) return;
			if (wrap.dataset.guideCompleted === "1") return;
			if (normalizedGuide && this.isGuideTargetActive(normalizedGuide)) {
				wrap.dataset.guideCompleted = "1";
				this.markGuideActionCompleted(this.normalizeMessageTs(wrap.dataset.messageTs), normalizedGuide);
				return;
			}
			const bubble = wrap.querySelector(".erpnext-ai-tutor-bubble");
			if (!bubble) return;
			if (
				normalizedGuide &&
				!this.isTutorialGuide(normalizedGuide) &&
				this.isCurrentRouteMentionedInBubble(bubble)
			) {
				wrap.dataset.guideCompleted = "1";
				this.markGuideActionCompleted(this.normalizeMessageTs(wrap.dataset.messageTs), normalizedGuide);
				return;
			}
			if (bubble.querySelector(".erpnext-ai-tutor-message-actions")) return;
			const messageTs = this.normalizeMessageTs(wrap.dataset.messageTs);
			const actions = document.createElement("div");
			actions.className = "erpnext-ai-tutor-message-actions";
			const guideBtn = document.createElement("button");
			guideBtn.type = "button";
			guideBtn.className = "erpnext-ai-tutor-guide-btn";
			guideBtn.textContent = "Ko'rsatib ber";
			guideBtn.addEventListener("click", (event) => {
				if (normalizedGuide) {
					this.runGuidedCursor(normalizedGuide, {
						auto: false,
						triggerEl: event?.currentTarget || guideBtn,
						messageTs,
					});
					return;
				}
				this.startGuideFromOffer(normalizedGuideOffer, {
					triggerEl: event?.currentTarget || guideBtn,
					messageTs,
				});
			});
			actions.appendChild(guideBtn);
			bubble.appendChild(actions);
		}

		async appendAssistantWithTypingEffect(content, opts = {}) {
			this.ensureConversation();
			const ts = Date.now();
			const routeKey = String(opts?.route_key || this.routeKey || this.getRouteKey() || "").trim();
			const guide = this.normalizeGuidePayload(opts?.guide);
			const guideOffer = this.normalizeGuideOfferPayload(opts?.guide_offer);
			const guideCompleted = this.isGuideTargetActive(guide);
			const finalText = String(content ?? "");

			this.history.push({
				role: "assistant",
				content: finalText,
				route_key: routeKey,
				guide,
				guide_offer: guideOffer,
				guide_completed: guideCompleted,
				ts,
			});
				const wrap = this.appendToDOM("assistant", "", ts, {
					animate: true,
					guide: null,
					guide_offer: guideOffer,
					guide_completed: guideCompleted,
					defer_guide_actions: true,
				});

			const conv = this.getActiveConversation();
			if (conv) {
				if (!Array.isArray(conv.messages)) conv.messages = [];
				conv.messages.push({
					role: "assistant",
					content: finalText,
					ts,
					route_key: routeKey,
					guide,
					guide_offer: guideOffer,
					guide_completed: guideCompleted,
				});
				conv.updated_at = ts;
				conv.messages = conv.messages.slice(-MAX_MESSAGES_PER_CONVERSATION);
				this.pruneChatState();
				this.saveChatState();
			}

			const textEl = wrap?.querySelector?.(".erpnext-ai-tutor-text");
			if (!textEl) {
				this.$body.scrollTop = this.$body.scrollHeight;
				return wrap;
			}

			if (!this.shouldAnimateAssistantReply(finalText)) {
				this.renderAssistantRichText(textEl, finalText, guide);
				this.appendGuideActionIfNeeded(wrap, guide, guideOffer);
				this.$body.scrollTop = this.$body.scrollHeight;
				return wrap;
			}

			const token = ++this._typingAnimationToken;
			textEl.classList.add("is-typewriting");
			await this.animateAssistantTypewriter(textEl, finalText, token);
			if (token !== this._typingAnimationToken || !document.body.contains(textEl)) {
				return wrap;
			}
			this.renderAssistantRichText(textEl, finalText, guide);
			textEl.classList.remove("is-typewriting");
			this.appendGuideActionIfNeeded(wrap, guide, guideOffer);
			this.$body.scrollTop = this.$body.scrollHeight;
			return wrap;
		}

		getScopedHistory(routeKey, maxItems = 20) {
			const conv = this.getActiveConversation();
			const messages = Array.isArray(conv?.messages) ? conv.messages : [];
			const scoped = [];
			for (let i = messages.length - 1; i >= 0 && scoped.length < maxItems + 1; i--) {
				const item = messages[i];
				if (!item || typeof item !== "object") continue;
				const role = String(item.role || "").trim();
				const content = String(item.content || "").trim();
				if (!content || (role !== "user" && role !== "assistant")) continue;
				const msgRouteKey = String(item.route_key || "").trim();
				if (!msgRouteKey || msgRouteKey !== routeKey) continue;
				scoped.push({ role, content });
			}
			return scoped.reverse();
		}

		getCoreHistory(maxItems = 6) {
			const conv = this.getActiveConversation();
			const messages = Array.isArray(conv?.messages) ? conv.messages : [];
			const out = [];
			for (let i = messages.length - 1; i >= 0 && out.length < maxItems + 1; i--) {
				const item = messages[i];
				if (!item || typeof item !== "object") continue;
				const role = String(item.role || "").trim();
				const content = String(item.content || "").trim();
				if (!content || (role !== "user" && role !== "assistant")) continue;
				out.push({ role, content });
			}
			return out.reverse();
		}

		setMessageStatus(messageEl, status) {
			if (!messageEl) return;
			messageEl.classList.remove("sending", "sent", "failed");
			if (status) messageEl.classList.add(status);
		}

		setBusy(on) {
			if (!this.$send) return;
			this.isBusy = Boolean(on);
			this.$send.disabled = Boolean(on);
			this.$send.classList.toggle("is-busy", Boolean(on));
		}

		animateBodySwap(renderFn) {
			if (!this.$body || typeof renderFn !== "function") {
				if (typeof renderFn === "function") renderFn();
				return;
			}

			if (this._swapTimer) {
				clearTimeout(this._swapTimer);
				this._swapTimer = null;
			}
			if (this._swapTimer2) {
				clearTimeout(this._swapTimer2);
				this._swapTimer2 = null;
			}

			this.$body.classList.remove("erpnext-ai-tutor-swap-in");
			this.$body.classList.add("erpnext-ai-tutor-swap-out");

			this._swapTimer = setTimeout(() => {
				this.$body.classList.remove("erpnext-ai-tutor-swap-out");
				renderFn();
				this.$body.classList.add("erpnext-ai-tutor-swap-in");
				this._swapTimer2 = setTimeout(() => {
					this.$body.classList.remove("erpnext-ai-tutor-swap-in");
					this._swapTimer2 = null;
				}, 220);
				this._swapTimer = null;
			}, 150);
		}

				async autoHelp(ev) {
					const uiLang = normalizeLangCode(frappe?.boot?.lang || frappe?.boot?.user?.language || "");
					const cfgLang = normalizeLangCode(this.config?.language || "");
					const lang = cfgLang || uiLang || "uz";
					const replyLang = lang === "ru" ? "Russian" : lang === "en" ? "English" : "Uzbek";
					const msg = [
						AUTO_HELP_PREFIX_EN,
						ev.title ? `Title: ${ev.title}` : null,
						ev.message ? `Message: ${ev.message}` : null,
					"",
					`Please explain what this means and give at least 5 concrete steps to fix it on this page. Please reply in ${replyLang}.`,
				]
					.filter(Boolean)
					.join("\n");
				await this.ask(msg, { source: "auto" });
		}

		async sendUserMessage() {
			if (this.isBusy) return;
			const text = String(this.$input.value || "").trim();
			if (!text) return;
			const routeKey = this.routeKey || this.getRouteKey();
			this.$input.value = "";
			this.clearDraft(routeKey);
			this.resizeInput();
			await this.ask(text, { source: "user" });
		}

		extractCallErrorText(err) {
			const picks = [];
			const push = (value) => {
				const text = String(value || "").replace(/\s+/g, " ").trim();
				if (!text) return;
				if (!picks.includes(text)) picks.push(text);
			};

			push(err?.message);
			push(err?.responseJSON?._error_message);

			const status = Number(err?.xhr?.status || err?.status || err?.httpStatus || 0);
			if (status) push(`HTTP ${status}`);

			const serverMessages = err?._server_messages || err?.responseJSON?._server_messages;
			if (typeof serverMessages === "string" && serverMessages.trim()) {
				try {
					const outer = JSON.parse(serverMessages);
					if (Array.isArray(outer)) {
						for (const row of outer) {
							let text = row;
							if (typeof row === "string") {
								try {
									const inner = JSON.parse(row);
									text = inner?.message || inner?._error_message || row;
								} catch {
									text = row;
								}
							}
							push(typeof text === "string" ? text : text?.message);
						}
					}
				} catch {
					push(serverMessages);
				}
			}

			const exception = String(err?.responseJSON?.exception || "").trim();
			if (exception) {
				const firstLine = exception.split("\n")[0];
				push(firstLine);
			}

			const detail = String(picks[0] || "");
			return detail.length > 220 ? `${detail.slice(0, 220)}...` : detail;
		}

		isTransientCallError(err) {
			const status = Number(err?.xhr?.status || err?.status || err?.httpStatus || 0);
			if (status === 0 || status === 408 || status === 429 || status >= 500) return true;
			const msg = String(err?.message || "").toLowerCase();
			return (
				msg.includes("network") ||
				msg.includes("timeout") ||
				msg.includes("failed to fetch") ||
				msg.includes("temporarily")
			);
		}

		async callChatWithRetry(payload) {
			let lastErr = null;
			for (let attempt = 0; attempt < 2; attempt++) {
				try {
					return await frappe.call(METHOD_CHAT, payload);
				} catch (err) {
					lastErr = err;
					if (attempt === 0 && this.isTransientCallError(err)) {
						await new Promise((resolve) => setTimeout(resolve, 420));
						continue;
					}
					throw err;
				}
			}
			throw lastErr || new Error("CHAT_CALL_FAILED");
		}

		async callStartGuideWithRetry(payload) {
			let lastErr = null;
			for (let attempt = 0; attempt < 2; attempt++) {
				try {
					return await frappe.call(METHOD_START_GUIDE_FROM_OFFER, payload);
				} catch (err) {
					lastErr = err;
					if (attempt === 0 && this.isTransientCallError(err)) {
						await new Promise((resolve) => setTimeout(resolve, 420));
						continue;
					}
					throw err;
				}
			}
			throw lastErr || new Error("GUIDE_START_CALL_FAILED");
		}

		async startGuideFromOffer(guideOffer, opts = {}) {
			const normalizedOffer = this.normalizeGuideOfferPayload(guideOffer);
			if (!normalizedOffer?.show) return;
			const triggerEl = opts?.triggerEl || null;
			const messageTs = this.normalizeMessageTs(opts?.messageTs);
			this.setGuideButtonBusy(triggerEl, true);
			try {
				const advanced = this.isAdvancedMode();
				const ctx = getContextSnapshot(this.config, advanced ? this.lastEvent : null);
				if (advanced && this.activeField) ctx.active_field = sanitize(this.activeField);
				const r = await this.callStartGuideWithRetry({
					offer: normalizedOffer,
					context: ctx,
				});
				const payload =
					r && typeof r?.message === "object" && r.message
						? r.message
						: r && typeof r === "object"
							? r
							: null;
				if (!payload || payload.ok === false) {
					const replyText = String(payload?.reply || "").trim() || "Guide start qilib bo'lmadi.";
					this.append("assistant", replyText, {
						route_key: this.routeKey || this.getRouteKey(),
					});
					return;
				}

				this.applyTutorStateFromResponse(payload || r?.message);
				const guide = this.repairGuidePayloadFromOffer(
					payload?.guide || payload?.data?.guide || r?.guide || null,
					normalizedOffer
				);
				this.guideRunner?.logGuideProbe?.("widget.start_guide_from_offer", {
					offer_mode: String(normalizedOffer?.mode || "").trim().toLowerCase(),
					offer_target_label: String(normalizedOffer?.target_label || "").trim(),
					payload_has_guide: Boolean(payload?.guide || payload?.data?.guide || r?.guide),
					payload_has_tutorial: Boolean((payload?.guide || payload?.data?.guide || r?.guide || null)?.tutorial),
					repaired_has_tutorial: Boolean(guide?.tutorial),
					repaired_tutorial_mode: String(guide?.tutorial?.mode || "").trim().toLowerCase(),
					repaired_tutorial_stage: String(guide?.tutorial?.stage || "").trim().toLowerCase(),
					repaired_tutorial_doctype: String(guide?.tutorial?.doctype || "").trim(),
					guide_route: String(guide?.route || "").trim(),
					guide_target_label: String(guide?.target_label || "").trim(),
				});
				const replyText = String(payload?.reply || payload?.message || r?.message || "").trim();
				if (replyText) {
					await this.appendAssistantWithTypingEffect(replyText, {
						route_key: this.routeKey || this.getRouteKey(),
					});
				}
				if (guide) {
					this.markGuideOfferActionCompleted(messageTs);
					await this.runGuidedCursor(guide, {
						auto: false,
						triggerEl,
						messageTs,
						offer_mode: normalizedOffer.mode,
						offer_target_label: normalizedOffer.target_label,
					});
					return;
				}
				if (triggerEl) this.completeGuideButton(triggerEl);
			} catch (e) {
				const errorDetail = this.extractCallErrorText(e);
				this.append(
					"assistant",
					errorDetail ? `Guide start qilib bo'lmadi (${errorDetail}).` : "Guide start qilib bo'lmadi.",
					{ route_key: this.routeKey || this.getRouteKey() }
				);
				this.setGuideButtonBusy(triggerEl, false);
			}
		}

		async ask(text, opts = { source: "user" }) {
			if (this.isBusy) return;
			this.checkRouteChange();
			const routeKey = this.routeKey || this.getRouteKey();
			const advanced = this.isAdvancedMode();
			this.hideHistory();
			const userEl = this.append("user", text, { route_key: routeKey });
			this.setBusy(true);
			this.showTyping();
			this.setMessageStatus(userEl, "sending");
			this.suppressEventsUntil = Date.now() + 8000;
			try {
				const ctx = getContextSnapshot(this.config, advanced ? this.lastEvent : null);
				if (advanced && this.activeField) ctx.active_field = sanitize(this.activeField);
				const tutorState = this.getTutorStateForRequest(text);
				if (tutorState) ctx.tutor_state = tutorState;
				const history = advanced ? this.getScopedHistory(routeKey, 20) : this.getCoreHistory(6);
				// Remove the message we just appended (current user message) to avoid duplication.
				if (history.length && history[history.length - 1]?.role === "user") {
					history.pop();
				}
				const r = await this.callChatWithRetry({
					message: text,
					context: ctx,
					history,
				});
					const payload =
						r && typeof r?.message === "object" && r.message
							? r.message
							: r && typeof r === "object"
								? r
								: null;
					let replyText = "";
					if (typeof payload?.reply === "string") replyText = payload.reply;
					else if (typeof payload?.message === "string") replyText = payload.message;
					else if (typeof r?.message === "string") replyText = r.message;
					replyText = String(replyText ?? "").trim();
					if (!replyText) {
						throw new Error("EMPTY_REPLY");
					}
						this.applyTutorStateFromResponse(payload || r?.message);
						const guide = this.normalizeGuidePayload(
							payload?.guide || payload?.data?.guide || r?.guide || null
						);
						const guideOffer = this.normalizeGuideOfferPayload(
							payload?.guide_offer || payload?.data?.guide_offer || r?.guide_offer || null
						);
					this.hideTyping();
					this.setMessageStatus(userEl, "sent");
					await this.appendAssistantWithTypingEffect(replyText, {
						route_key: routeKey,
						guide,
						guide_offer: guideOffer,
					});
			} catch (e) {
				this.hideTyping();
				this.setMessageStatus(userEl, "failed");
				const isEmptyReply = String(e?.message || "") === "EMPTY_REPLY";
				const errorDetail = this.extractCallErrorText(e);
				console.error("AI Tutor ask() failed", e);
				if (opts?.source === "auto") {
					this.autoHelpDisabledUntil = Date.now() + AUTO_HELP_FAILURE_COOLDOWN_MS;
					return;
				}
					this.append(
						"assistant",
						isEmptyReply
							? "AI didn't reply. Please try again."
							: errorDetail
								? `Couldn't reach AI (${errorDetail}).`
								: "Couldn't reach AI. Check AI Settings (OpenAI/Gemini API key).",
						{ route_key: routeKey }
					);
				} finally {
					this.hideTyping();
					this.setBusy(false);
				}
		}
	}

	ns.TutorWidget = TutorWidget;
})();
