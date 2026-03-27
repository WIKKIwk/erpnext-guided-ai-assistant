								<div class="erpnext-ai-tutor-header-spacer"></div>
								<span class="erpnext-ai-tutor-pill erpnext-ai-tutor-hidden"></span>
								<button class="erpnext-ai-tutor-icon-btn erpnext-ai-tutor-history-btn" type="button" aria-label="Chat history">
									${icon("history")}
								</button>
								<button class="erpnext-ai-tutor-icon-btn erpnext-ai-tutor-new-btn" type="button" aria-label="New chat" title="New chat">
									${icon("new_chat")}
								</button>
								<button class="erpnext-ai-tutor-close" type="button" aria-label="Close">
									${icon("close")}
								</button>
							</div>
					<div class="erpnext-ai-tutor-content">
						<div class="erpnext-ai-tutor-body erpnext-ai-tutor-view is-active"></div>
						<div class="erpnext-ai-tutor-history erpnext-ai-tutor-view"></div>
					</div>
						<div class="erpnext-ai-tutor-footer">
							<form class="erpnext-ai-tutor-form">
								<textarea class="erpnext-ai-tutor-input" rows="1" placeholder="Type your question..."></textarea>
								<button class="erpnext-ai-tutor-send" type="submit" aria-label="Send" title="Send">
									${icon("send")}
								</button>
							</form>
						</div>
				</div>
			`;

			document.body.appendChild(root);
			this.$root = root;
			this.$drawer = root.querySelector(".erpnext-ai-tutor-drawer");
			this.$body = root.querySelector(".erpnext-ai-tutor-body");
			this.$history = root.querySelector(".erpnext-ai-tutor-history");
			this.$footer = root.querySelector(".erpnext-ai-tutor-footer");
			this.$input = root.querySelector(".erpnext-ai-tutor-input");
			this.$send = root.querySelector(".erpnext-ai-tutor-send");
			this.$fab = root.querySelector(".erpnext-ai-tutor-fab");
			this.$pill = root.querySelector(".erpnext-ai-tutor-pill");
			this.$historyBtn = root.querySelector(".erpnext-ai-tutor-history-btn");
			this.$newChatBtn = root.querySelector(".erpnext-ai-tutor-new-btn");
			this.$body.setAttribute("role", "log");
			this.$body.setAttribute("aria-live", "polite");
			this.$body.setAttribute("aria-relevant", "additions text");
			this.$body.setAttribute("aria-atomic", "false");
			this.$input.setAttribute("aria-label", "AI Tutor message input");
			this.$input.setAttribute("aria-keyshortcuts", "Enter,Control+Enter,Meta+Enter,Escape");

			this.$fab.addEventListener("click", () => this.toggle());
			root.querySelector(".erpnext-ai-tutor-close").addEventListener("click", () => this.close());
			this.$historyBtn.addEventListener("click", () => this.toggleHistory());
			this.$newChatBtn.addEventListener("click", () => this.handleNewChatClick());
			this.updateNewChatButtonState();

			root.querySelector(".erpnext-ai-tutor-form").addEventListener("submit", async (e) => {
				e.preventDefault();
				await this.sendUserMessage();
			});

			this.$drawer.addEventListener("keydown", this._boundDrawerKeydown);
			document.addEventListener("keydown", this._boundGlobalKeydown, true);
			this.$input.addEventListener("input", () => {
				this.resizeInput();
				this.saveDraft(this.routeKey);
			});
			this.$input.addEventListener("keydown", (e) => {
				if (e.key === "Escape") {
					e.preventDefault();
					this.close();
					return;
				}
				const sendWithModifier = e.key === "Enter" && (e.ctrlKey || e.metaKey);
				const sendWithEnter = e.key === "Enter" && !e.shiftKey;
				if (sendWithModifier || sendWithEnter) {
					e.preventDefault();
					this.sendUserMessage();
				}
			});
			this.resizeInput();
			this.loadDraftForRoute(this.routeKey || this.getRouteKey());
		}

		loadChatState() {
			try {
				const raw = window.localStorage ? window.localStorage.getItem(getStorageKey()) : null;
				if (!raw) return;
				const parsed = JSON.parse(raw);
				if (!parsed || parsed.version !== STORAGE_VERSION) return;
				if (Array.isArray(parsed.conversations)) this.conversations = parsed.conversations;
				if (typeof parsed.active_conversation_id === "string") {
					this.activeConversationId = parsed.active_conversation_id;
				}
			} catch {
				// ignore
			}
		}

		saveChatState() {
			if (!window.localStorage) return;
			const payload = {
				version: STORAGE_VERSION,
				active_conversation_id: this.activeConversationId,
				conversations: this.conversations,
			};
			try {
				window.localStorage.setItem(getStorageKey(), JSON.stringify(payload));
			} catch {
				// Quota exceeded or storage blocked; try to prune and retry once.
				try {
					this.pruneChatState();
					window.localStorage.setItem(getStorageKey(), JSON.stringify(payload));
				} catch {
					// ignore
				}
			}
		}

		shouldSendTutorStateWithMessage(text = "") {
			const conv = this.getActiveConversation();
			const state = conv?.tutor_state;
			if (!state || typeof state !== "object") return false;
			const pending = String(state.pending || "").trim().toLowerCase();
			if (pending) return true;
			const raw = String(text || "").trim().toLowerCase();
			if (!raw) return false;
			return /(?:^|\b)(davom|continue|keyingi|next|yana|save|submit|saqla|ha\b|xo'p|xop|ok\b|okay\b|show\s+save)(?:\b|$)/i.test(
				raw
			);
		}

		getTutorStateForRequest(text = "") {
			const conv = this.getActiveConversation();
			const state = conv?.tutor_state;
			if (!state || typeof state !== "object") return null;
			if (!this.shouldSendTutorStateWithMessage(text)) return null;
			return sanitize(state);
		}

		applyTutorStateFromResponse(respMessage) {
			if (!respMessage || typeof respMessage !== "object") return;
			if (!Object.prototype.hasOwnProperty.call(respMessage, "tutor_state")) return;
			const conv = this.getActiveConversation();
			if (!conv) return;
			const next = respMessage.tutor_state;
			if (next && typeof next === "object") {
				conv.tutor_state = sanitize(next);
			} else {
				delete conv.tutor_state;
			}
			conv.updated_at = Date.now();
			this.saveChatState();
		}

		pruneChatState() {
			// Keep only the most recent conversations/messages to avoid storage bloat.
			const convs = Array.isArray(this.conversations) ? this.conversations : [];
			convs.sort((a, b) => (b?.updated_at || 0) - (a?.updated_at || 0));
			const trimmed = convs.slice(0, MAX_CONVERSATIONS);
			for (const c of trimmed) {
				if (Array.isArray(c.messages)) {
					c.messages = c.messages.slice(-MAX_MESSAGES_PER_CONVERSATION);
				} else {
					c.messages = [];
				}
			}
			this.conversations = trimmed;
		}

		getActiveConversation() {
			if (!this.activeConversationId) return null;
			return this.conversations.find((c) => c && c.id === this.activeConversationId) || null;
		}

		updateNewChatButtonState() {
			if (!this.$newChatBtn) return;
			const isPending = Boolean(this._newChatPending);
			this.$newChatBtn.classList.toggle("is-cancel-state", isPending);
			this.$root?.classList.toggle("is-new-chat-pending", isPending);
			this.$newChatBtn.setAttribute("aria-label", isPending ? "Cancel new chat" : "New chat");
			this.$newChatBtn.setAttribute("title", isPending ? "Cancel new chat" : "New chat");
			this.$newChatBtn.innerHTML = icon("new_chat");
		}

		markNewChatStarted() {
			if (!this._newChatPending) return;
			this._newChatPending = false;
			this._newChatPreviousConversationId = null;
			this.updateNewChatButtonState();
		}

		cancelPendingNewChat() {
			if (!this._newChatPending) return;
			const pendingConv = this.getActiveConversation();
			const pendingId = String(pendingConv?.id || "");
			const hasMessages = Array.isArray(pendingConv?.messages) && pendingConv.messages.length > 0;
			if (pendingId && !hasMessages) {
				this.conversations = this.conversations.filter((c) => String(c?.id || "") !== pendingId);
			}

			const previousId = String(this._newChatPreviousConversationId || "");
			if (previousId && this.conversations.some((c) => String(c?.id || "") === previousId)) {
				this.activeConversationId = previousId;
			} else if (!this.getActiveConversation() && this.conversations.length) {
				this.conversations.sort((a, b) => (b?.updated_at || 0) - (a?.updated_at || 0));
				this.activeConversationId = this.conversations[0]?.id || null;
			} else if (!this.getActiveConversation()) {
				this.newChat({ render: false });
			}

			this._newChatPending = false;
			this._newChatPreviousConversationId = null;
			this.saveChatState();
			this.hideHistory();
			this.animateBodySwap(() => this.renderActiveConversation());
			this.open();
			this.updateNewChatButtonState();
		}

		handleNewChatClick() {
			if (this._newChatPending) {
				this.cancelPendingNewChat();
				return;
			}
			this._newChatPreviousConversationId = this.activeConversationId || null;
			this.newChat({ render: true });
			this._newChatPending = true;
			this.updateNewChatButtonState();
		}

		ensureConversation() {
			if (!Array.isArray(this.conversations)) this.conversations = [];
			if (this.getActiveConversation()) return;
			if (this.conversations.length) {
				// fall back to most recent
				this.conversations.sort((a, b) => (b?.updated_at || 0) - (a?.updated_at || 0));
				this.activeConversationId = this.conversations[0]?.id || null;
				return;
			}
			this.newChat({ render: false });
		}

			newChat(opts = { render: true }) {
				const id = makeId("tutor");
				const now = Date.now();
				const conversation = {
					id,
					title: "New chat",
					created_at: now,
					updated_at: now,
					messages: [],
				};
			this.conversations.unshift(conversation);
			this.activeConversationId = id;
			this.pruneChatState();
			this.saveChatState();
			if (opts.render) {
				this.hideHistory();
				this.animateBodySwap(() => this.renderActiveConversation());
				this.open();
			}
		}

			setConversationTitleIfNeeded(message) {
				const conv = this.getActiveConversation();
				if (!conv) return;
				if (conv.title && conv.title !== "New chat" && conv.title !== "Yangi chat") return;

				const text = String(message || "").trim();
				const isAuto = text.startsWith(AUTO_HELP_PREFIX_UZ) || text.startsWith(AUTO_HELP_PREFIX_EN);
				if (isAuto && this.lastEvent) {
					const prefix = this.lastEvent.severity === "error" ? "Error" : "Warning";
					const title = clip(this.lastEvent.title || this.lastEvent.message || "", 48);
					conv.title = title ? `${prefix}: ${title}` : `${prefix}`;
				} else {
					conv.title = clip(message, 48) || "New chat";
				}
			}

		renderActiveConversation() {
			const conv = this.getActiveConversation();
			this.history = [];
			this.$body.innerHTML = "";
			if (!conv) return;

			const messages = Array.isArray(conv.messages) ? conv.messages : [];
			let changed = false;
			for (const m of messages) {
				if (!m || !m.role) continue;
				const guide = this.normalizeGuidePayload(m.guide);
				const guideOffer = this.normalizeGuideOfferPayload(m.guide_offer);
				const initialGuideCompleted = Boolean(m.guide_completed) || this.isGuideTargetActive(guide);
				const wrap = this.appendToDOM(m.role, m.content, m.ts, {
					animate: false,
					guide,
					guide_offer: guideOffer,
					guide_completed: initialGuideCompleted,
				});
				const renderedGuideCompleted =
					Boolean(wrap?.dataset?.guideCompleted === "1") || initialGuideCompleted;
				if (renderedGuideCompleted && !m.guide_completed) {
					m.guide_completed = true;
					changed = true;
				}
				this.history.push({
					role: m.role,
					content: m.content,
					route_key: m.route_key || "",
					guide,
					guide_offer: guideOffer,
					guide_completed: renderedGuideCompleted,
					ts: m.ts,
				});
			}
			if (changed) {
				conv.updated_at = Date.now();
				this.saveChatState();
			}
			this.$body.scrollTop = this.$body.scrollHeight;
		}

		appendToDOM(role, content, ts, opts = { animate: true }) {
			const wrap = document.createElement("div");
			wrap.className = `erpnext-ai-tutor-message ${role}`;
			wrap.setAttribute("role", "listitem");
			const guide = this.normalizeGuidePayload(opts?.guide);
			const guideOffer = this.normalizeGuideOfferPayload(opts?.guide_offer);
			const initialGuideCompleted = Boolean(opts?.guide_completed) || this.isGuideTargetActive(guide);
			const messageTs = this.normalizeMessageTs(ts);
			if (messageTs) wrap.dataset.messageTs = String(messageTs);
			if (opts?.animate) wrap.classList.add("is-new");

			const bubble = document.createElement("div");
			bubble.className = "erpnext-ai-tutor-bubble";

			const text = document.createElement("div");
			text.className = "erpnext-ai-tutor-text";
			if (role === "assistant") {
				const labelRouteMap = this.buildGuideLabelRouteMap(guide);
				const routeLabelMap = this.buildGuideRouteLabelMap(guide);
				let assistantText = String(content ?? "");
				if (guide?.target_label && guide?.route) {
					const target = String(guide.target_label).trim();
					const token = `**${target}**`;
					if (target && !assistantText.includes(token)) {
						assistantText = `${assistantText}\n\n${token}`;
					}
				}
				this.renderRichText(text, assistantText, { labelRouteMap, routeLabelMap });
			} else {
				text.textContent = String(content ?? "");
			}

			const meta = document.createElement("div");
			meta.className = "erpnext-ai-tutor-meta";
			const metaTime = document.createElement("span");
			metaTime.className = "erpnext-ai-tutor-meta-time";
			metaTime.textContent = ts ? formatTime(ts) : nowTime();

			const metaStatus = document.createElement("span");
			metaStatus.className = "erpnext-ai-tutor-meta-status";

			meta.append(metaTime, metaStatus);

			bubble.append(text, meta);
			const bubbleShowsCurrentTarget =
				role === "assistant" && !this.isTutorialGuide(guide)
					? this.isCurrentRouteMentionedInBubble(bubble)
					: false;
			const finalGuideCompleted = initialGuideCompleted || bubbleShowsCurrentTarget;
			if (finalGuideCompleted) wrap.dataset.guideCompleted = "1";

			if (role === "assistant" && guide && this.isGuidedCursorEnabled() && !finalGuideCompleted) {
				const actions = document.createElement("div");
				actions.className = "erpnext-ai-tutor-message-actions";
				const guideBtn = document.createElement("button");
				guideBtn.type = "button";
				guideBtn.className = "erpnext-ai-tutor-guide-btn";
				guideBtn.textContent = "Ko'rsatib ber";
				guideBtn.addEventListener("click", (event) => {
					this.runGuidedCursor(guide, {
						auto: false,
						triggerEl: event?.currentTarget || guideBtn,
						messageTs,
					});
				});
				actions.appendChild(guideBtn);
				bubble.appendChild(actions);
			} else if (
				role === "assistant" &&
				guideOffer?.show &&
				this.isGuidedCursorEnabled() &&
				!finalGuideCompleted
			) {
				const actions = document.createElement("div");
				actions.className = "erpnext-ai-tutor-message-actions";
				const guideBtn = document.createElement("button");
				guideBtn.type = "button";
				guideBtn.className = "erpnext-ai-tutor-guide-btn";
				guideBtn.textContent = "Ko'rsatib ber";
				guideBtn.addEventListener("click", (event) => {
					this.startGuideFromOffer(guideOffer, {
						triggerEl: event?.currentTarget || guideBtn,
						messageTs,
					});
				});
				actions.appendChild(guideBtn);
				bubble.appendChild(actions);
			}
			wrap.appendChild(bubble);
			this.$body.appendChild(wrap);
			return wrap;
		}

		showTyping() {
			this.hideTyping();
			if (!this.$body) return;

			const wrap = document.createElement("div");
			wrap.className = "erpnext-ai-tutor-message assistant erpnext-ai-tutor-typing";

			const bubble = document.createElement("div");
			bubble.className = "erpnext-ai-tutor-bubble";

			const dots = document.createElement("div");
			dots.className = "erpnext-ai-tutor-typing-dots";

			for (let i = 0; i < 3; i++) {
				const dot = document.createElement("span");
				dot.className = "erpnext-ai-tutor-typing-dot";
				dots.appendChild(dot);
			}

			bubble.appendChild(dots);
			wrap.appendChild(bubble);
			this.$body.appendChild(wrap);
			this.$typing = wrap;
			this.$body.scrollTop = this.$body.scrollHeight;
		}

		hideTyping() {
			if (!this.$typing) return;
			try {
				this.$typing.remove();
			} catch {
				// ignore
			}
			this.$typing = null;
		}

		toggleHistory() {
			if (!this.$history || !this.$body) return;
			const isOpen = this.$history.classList.contains("is-active");
			if (!isOpen) this.showHistory();
			else this.hideHistory();
		}

		showHistory() {
			this.renderHistoryList();
			this.$history.classList.add("is-active");
			this.$body.classList.remove("is-active");
			this.$footer.classList.add("is-collapsed");
		}

		hideHistory() {
			this.$history.classList.remove("is-active");
			this.$body.classList.add("is-active");
			this.$footer.classList.remove("is-collapsed");
		}

		renderHistoryList() {
			if (!this.$history) return;
			const convs = Array.isArray(this.conversations) ? [...this.conversations] : [];
			convs.sort((a, b) => (b?.updated_at || 0) - (a?.updated_at || 0));

				if (!convs.length) {
					this.$history.innerHTML = `<div class="erpnext-ai-tutor-history-empty">No chats yet.</div>`;
					return;
				}

			const rows = convs
				.map((c) => {
					const title = clip(c?.title || "Chat", 60);
					const meta = c?.updated_at ? formatTime(c.updated_at) : "";
					const active = c?.id === this.activeConversationId ? "active" : "";
					return `
						<button class="erpnext-ai-tutor-history-item ${active}" type="button" data-id="${String(c?.id || "")}">
							<div class="erpnext-ai-tutor-history-item-title">${title}</div>
							<div class="erpnext-ai-tutor-history-item-meta">${meta}</div>
						</button>
					`;
				})
				.join("");
