/* global frappe */

(function () {
	"use strict";

	const ns = (window.ERPNextAITutor = window.ERPNextAITutor || {});
	const u = ns.utils;
	if (!u) return;
	const GuideRunner = ns.GuideRunner;

	const {
		METHOD_GET_CONFIG,
		METHOD_CHAT,
		STORAGE_VERSION,
		MAX_CONVERSATIONS,
		MAX_MESSAGES_PER_CONVERSATION,
		AUTO_HELP_COOLDOWN_MS,
		AUTO_HELP_RATE_WINDOW_MS,
		AUTO_HELP_RATE_MAX,
		AUTO_HELP_FAILURE_COOLDOWN_MS,
		AUTO_HELP_PREFIX_UZ,
		AUTO_HELP_PREFIX_EN,
		isDesk,
		redactKey,
		sanitize,
		stripHtml,
		guessSeverity,
		nowTime,
		formatTime,
		makeId,
		clip,
		normalizeLangCode,
		getContextSnapshot,
		getStorageKey,
		getCanonicalRouteKey,
	} = u;

	const DRAFT_STORAGE_PREFIX = "erpnext_ai_tutor_draft";
	const INPUT_MIN_HEIGHT = 38;
	const INPUT_MAX_HEIGHT = 160;

	class TutorWidget {
			constructor() {
			this.config = null;
			this.aiReady = false;
			this.isOpen = false;
			this.isBusy = false;
			this.history = [];
			this.conversations = [];
			this.activeConversationId = null;
			this.lastEvent = null;
			this.lastAutoHelpKey = "";
			this.lastAutoHelpAt = 0;
			this.autoHelpDisabledUntil = 0;
			this.autoHelpTimestamps = [];
			this.suppressEventsUntil = 0;
			this.$root = null;
			this.$drawer = null;
			this.$body = null;
			this.$history = null;
			this.$footer = null;
			this.$input = null;
			this.$send = null;
			this.$fab = null;
			this.$pill = null;
			this.$historyBtn = null;
			this.$newChatBtn = null;
			this.$typing = null;
			this.guideRunner = null;
			this._boundGlobalKeydown = (ev) => this.onGlobalKeydown(ev);
			this._boundDrawerKeydown = (ev) => this.onDrawerKeydown(ev);
			this._lastFocusedBeforeOpen = null;
				this.activeField = null;
				this.routeKey = this.getRouteKey();
				this._welcomeShownNoMarker = false;
			}

		async init() {
			this.render();
			if (typeof GuideRunner === "function") {
				this.guideRunner = new GuideRunner({ widget: this });
			}
			this.loadChatState();
			await this.loadConfig();
			if (this.isAdvancedMode()) {
				this.installHooks();
				this.installContextCapture();
			}
			this.installRouteWatcher();
			this.ensureConversation();
			this.renderActiveConversation();
			this.maybeShowWelcomeMessage();
		}

		isAdvancedMode() {
			if (!this.config) return true;
			return this.config.advanced_mode !== false;
		}

		isGuidedCursorEnabled() {
			return this.isAdvancedMode() && this.config?.guided_cursor !== false;
		}

		normalizeRoutePath(route) {
			const raw = String(route || "").trim();
			if (!raw) return "";
			const noHash = raw.split("#")[0];
			const noQuery = noHash.split("?")[0];
			if (!noQuery) return "";
			if (noQuery === "/") return "/";
			return noQuery.replace(/\/+$/, "");
		}

		applyGuideRouteOverride(route, targetLabel, menuPath) {
			const routePath = this.normalizeRoutePath(route);
			const overrides = {
				"/app/doctype": {
					target_label: "DocType",
					menu_path: ["Build", "DocType"],
				},
			};
			const override = overrides[routePath];
			if (!override) {
				return { target_label: targetLabel, menu_path: menuPath };
			}

			const normalize = (v) => String(v || "").trim().toLowerCase();
			const expectedTarget = String(override.target_label || "").trim();
			const expectedMenuPath = Array.isArray(override.menu_path)
				? override.menu_path.map((x) => String(x || "").trim()).filter(Boolean)
				: [];
			const currentTarget = normalize(targetLabel);
			const expectedTargetNorm = normalize(expectedTarget);
			const currentMenu = new Set((Array.isArray(menuPath) ? menuPath : []).map((x) => normalize(x)));

			if (currentTarget !== expectedTargetNorm || !currentMenu.has(expectedTargetNorm)) {
				return {
					target_label: expectedTarget,
					menu_path: expectedMenuPath,
				};
			}
			return { target_label: targetLabel, menu_path: menuPath };
		}

		normalizeGuidePayload(raw) {
			if (!raw || typeof raw !== "object") return null;
			if (String(raw.type || "") !== "navigation") return null;
			const route = String(raw.route || "").trim();
			if (!route || !route.startsWith("/app/")) return null;
			const menuPathRaw = Array.isArray(raw.menu_path) ? raw.menu_path : [];
			const menuPath = menuPathRaw
				.map((x) => String(x || "").trim())
				.filter(Boolean)
				.slice(0, 6);
			const targetLabel = String(raw.target_label || "").trim();
			const repaired = this.applyGuideRouteOverride(route, targetLabel, menuPath);
			return {
				type: "navigation",
				route,
				target_label: repaired.target_label,
				menu_path: repaired.menu_path,
			};
		}

		getDraftStorageKey(routeKey = "") {
			const user = String(frappe?.session?.user || "Guest").trim() || "Guest";
			const route = String(routeKey || this.routeKey || this.getRouteKey() || "")
				.trim()
				.slice(0, 220);
			return `${DRAFT_STORAGE_PREFIX}:${window.location.host}:${user}:${route}`;
		}

		saveDraft(routeKey = "") {
			if (!window.localStorage || !this.$input) return;
			const value = String(this.$input.value || "");
			const key = this.getDraftStorageKey(routeKey);
			try {
				if (value.trim()) {
					window.localStorage.setItem(key, value);
				} else {
					window.localStorage.removeItem(key);
				}
			} catch {
				// ignore
			}
		}

		loadDraftForRoute(routeKey = "") {
			if (!window.localStorage || !this.$input) return;
			const key = this.getDraftStorageKey(routeKey);
			let value = "";
			try {
				value = String(window.localStorage.getItem(key) || "");
			} catch {
				value = "";
			}
			this.$input.value = value;
			this.resizeInput();
		}

		clearDraft(routeKey = "") {
			if (!window.localStorage) return;
			const key = this.getDraftStorageKey(routeKey);
			try {
				window.localStorage.removeItem(key);
			} catch {
				// ignore
			}
		}

		resizeInput() {
			if (!this.$input) return;
			this.$input.style.height = "auto";
			const nextHeight = Math.min(INPUT_MAX_HEIGHT, Math.max(INPUT_MIN_HEIGHT, this.$input.scrollHeight));
			this.$input.style.height = `${nextHeight}px`;
			this.$input.style.overflowY = this.$input.scrollHeight > INPUT_MAX_HEIGHT ? "auto" : "hidden";
		}

		getFocusableInDrawer() {
			if (!this.$drawer) return [];
			const selector = [
				"button",
				"[href]",
				"input",
				"select",
				"textarea",
				"[tabindex]:not([tabindex='-1'])",
			].join(",");
			return Array.from(this.$drawer.querySelectorAll(selector)).filter((el) => {
				if (!el || el.disabled) return false;
				const style = window.getComputedStyle(el);
				if (!style || style.visibility === "hidden" || style.display === "none") return false;
				return el.getClientRects().length > 0;
			});
		}

		onDrawerKeydown(e) {
			if (!this.isOpen || !this.$drawer || e.key !== "Tab") return;
			const focusable = this.getFocusableInDrawer();
			if (!focusable.length) return;
			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			const active = document.activeElement;
			if (e.shiftKey && (active === first || !this.$drawer.contains(active))) {
				e.preventDefault();
				last.focus();
				return;
			}
			if (!e.shiftKey && (active === last || !this.$drawer.contains(active))) {
				e.preventDefault();
				first.focus();
			}
		}

		onGlobalKeydown(e) {
			if (!this.isOpen) return;
			if (e.key === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				this.close();
			}
		}

		navigateToRoute(route) {
			const cleaned = this.normalizeRoutePath(route);
			if (!cleaned || !cleaned.startsWith("/app/")) return;
			const parts = cleaned.replace(/^\/app\//, "").split("/").filter(Boolean);
			try {
				if (frappe?.set_route && parts.length) {
					frappe.set_route("app", ...parts);
					return;
				}
			} catch {
				// ignore and fallback
			}
			window.location.href = cleaned;
		}

		makeRouteChip(route) {
			const cleaned = this.normalizeRoutePath(route) || String(route || "").trim();
			const chip = document.createElement("a");
			chip.className = "erpnext-ai-tutor-route-chip";
			chip.href = cleaned;
			chip.textContent = cleaned;
			chip.setAttribute("data-route", cleaned);
			chip.addEventListener("click", (ev) => {
				ev.preventDefault();
				this.navigateToRoute(cleaned);
			});
			return chip;
		}

		appendInlineRich(target, source) {
			const value = String(source || "");
			if (!value) return;
			const tokenRe = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\/app\/[a-z0-9][a-z0-9\-_/]*)/gi;
			let lastIndex = 0;
			let match = null;
			while ((match = tokenRe.exec(value)) !== null) {
				const token = String(match[0] || "");
				const index = Number(match.index) || 0;
				if (index > lastIndex) {
					target.appendChild(document.createTextNode(value.slice(lastIndex, index)));
				}
				if (token.startsWith("`") && token.endsWith("`")) {
					const codeText = token.slice(1, -1).trim();
					if (/^\/app\/[a-z0-9][a-z0-9\-_/]*$/i.test(codeText)) {
						target.appendChild(this.makeRouteChip(codeText));
					} else {
						const code = document.createElement("code");
						code.textContent = codeText;
						target.appendChild(code);
					}
				} else if (token.startsWith("**") && token.endsWith("**")) {
					const strong = document.createElement("strong");
					strong.textContent = token.slice(2, -2).trim();
					target.appendChild(strong);
				} else if (/^\/app\/[a-z0-9][a-z0-9\-_/]*$/i.test(token)) {
					target.appendChild(this.makeRouteChip(token));
				} else {
					target.appendChild(document.createTextNode(token));
				}
				lastIndex = index + token.length;
			}
			if (lastIndex < value.length) {
				target.appendChild(document.createTextNode(value.slice(lastIndex)));
			}
		}

		renderRichText(target, content) {
			const text = String(content ?? "").replace(/\r\n/g, "\n");
			const lines = text.split("\n");
			const bulletRe = /^\s*[\*\-]\s+(.+)$/;
			const orderedRe = /^\s*(\d+)\.\s+(.+)$/;
			let i = 0;
			let hasBlock = false;

			while (i < lines.length) {
				const raw = String(lines[i] || "");
				const trimmed = raw.trim();
				if (!trimmed) {
					i += 1;
					continue;
				}

				const bulletMatch = raw.match(bulletRe);
				if (bulletMatch) {
					const ul = document.createElement("ul");
					while (i < lines.length) {
						const m = String(lines[i] || "").match(bulletRe);
						if (!m) break;
						const li = document.createElement("li");
						this.appendInlineRich(li, m[1]);
						ul.appendChild(li);
						i += 1;
					}
					target.appendChild(ul);
					hasBlock = true;
					continue;
				}

				const orderedMatch = raw.match(orderedRe);
				if (orderedMatch) {
					const ol = document.createElement("ol");
					const start = parseInt(String(orderedMatch[1] || "1"), 10);
					if (Number.isFinite(start) && start > 1) ol.start = start;
					while (i < lines.length) {
						const m = String(lines[i] || "").match(orderedRe);
						if (!m) break;
						const li = document.createElement("li");
						this.appendInlineRich(li, m[2]);
						ol.appendChild(li);
						i += 1;
					}
					target.appendChild(ol);
					hasBlock = true;
					continue;
				}

				const p = document.createElement("p");
				while (i < lines.length) {
					const line = String(lines[i] || "");
					const lineTrimmed = line.trim();
					if (!lineTrimmed) break;
					if (bulletRe.test(line) || orderedRe.test(line)) break;
					this.appendInlineRich(p, line);
					i += 1;
					if (i < lines.length) {
						const nextLine = String(lines[i] || "");
						if (nextLine.trim() && !bulletRe.test(nextLine) && !orderedRe.test(nextLine)) {
							p.appendChild(document.createElement("br"));
						}
					}
				}
				target.appendChild(p);
				hasBlock = true;
			}

			if (!hasBlock) {
				target.textContent = String(content ?? "");
			}
		}

		async runGuidedCursor(guide, opts = { auto: false }) {
			if (!guide || !this.isGuidedCursorEnabled() || !this.guideRunner) return;
			try {
				const runResult = await this.guideRunner.run(guide);
				if (!runResult?.ok && !opts?.auto) {
					this.append(
						"assistant",
						String(runResult?.message || "Yo'riqnoma bajarilmadi. Sahifani tekshirib qayta urinib ko'ring."),
						{ route_key: this.routeKey || this.getRouteKey() }
					);
				}
			} catch {
				if (!opts?.auto) {
					this.append(
						"assistant",
						"Kursor yo‘riqnomani ishga tushirib bo‘lmadi. Sahifani yangilab qayta urinib ko‘ring.",
						{ route_key: this.routeKey || this.getRouteKey() }
					);
				}
			}
		}

		getEmojiStyle() {
			const raw = String(this.config?.emoji_style || "soft").trim().toLowerCase();
			if (raw === "off" || raw === "soft" || raw === "warm") return raw;
			return "soft";
		}

			getWelcomeSessionKey() {
				const user = frappe?.session?.user || "Guest";
				const markerRaw = String(
					this.config?.welcome_session_marker ||
						frappe?.boot?.user?.last_login ||
						frappe?.boot?.user?.last_active ||
						""
				).trim();
				if (!markerRaw) return "";
				const marker = markerRaw.replace(/\s+/g, "_");
				return `erpnext_ai_tutor_welcome:${window.location.host}:${user}:${marker}:v3`;
			}

			hasShownWelcomeInSession() {
				const key = this.getWelcomeSessionKey();
				if (!key) return this._welcomeShownNoMarker;
				try {
					return window.sessionStorage?.getItem(key) === "1";
				} catch {
					return false;
				}
			}

			markWelcomeShownInSession() {
				const key = this.getWelcomeSessionKey();
				if (!key) {
					this._welcomeShownNoMarker = true;
					return;
				}
				try {
					window.sessionStorage?.setItem(key, "1");
				} catch {
					// ignore
				}
			}

		getWelcomeMessage() {
			const lang = normalizeLangCode(this.config?.language || frappe?.boot?.lang || frappe?.boot?.user?.language || "uz");
			const style = this.getEmojiStyle();
			const byLang = {
				off: {
					uz: "Assalomu alaykum. Men bugundan boshlab sizning ERPNext yordamchingizman. Xohlagan payt savol bering, birga hal qilamiz.",
					ru: "Здравствуйте. С этого дня я ваш помощник в ERPNext. Задавайте вопросы в любой момент, решим вместе.",
					en: "Hello. Starting today, I am your ERPNext assistant. Ask anything anytime, and we will solve it together.",
				},
				soft: {
					uz: "Assalomu alaykum 🙂 Men bugundan boshlab sizning ERPNext yordamchingizman. Xohlagan payt savol bering, birga hal qilamiz.",
					ru: "Здравствуйте 🙂 С этого дня я ваш помощник в ERPNext. Задавайте вопросы в любой момент, решим вместе.",
					en: "Hello 🙂 Starting today, I am your ERPNext assistant. Ask anything anytime, and we will solve it together.",
				},
				warm: {
					uz: "Assalomu alaykum 😊 Men bugundan boshlab sizning ERPNext yordamchingizman. Xohlagan payt yozing, hammasini birga hal qilamiz ✨",
					ru: "Здравствуйте 😊 С этого дня я ваш помощник в ERPNext. Пишите в любой момент, всё решим вместе ✨",
					en: "Hello 😊 Starting today, I am your ERPNext assistant. Message me anytime, and we will solve everything together ✨",
				},
			};
			const set = byLang[style] || byLang.soft;
			if (lang === "ru") return set.ru;
			if (lang === "en") return set.en;
			return set.uz;
		}

		maybeShowWelcomeMessage() {
			if (!this.config?.enabled) return;
			if (this.hasShownWelcomeInSession()) return;
			this.ensureConversation();
			const conv = this.getActiveConversation();
			if (conv && Array.isArray(conv.messages) && conv.messages.length) {
				this.newChat({ render: false });
			}
			const routeKey = this.routeKey || this.getRouteKey();
			this.append("assistant", this.getWelcomeMessage(), { route_key: routeKey });
			this.open();
			this.markWelcomeShownInSession();
		}

		getRouteKey() {
			try {
				const key = typeof getCanonicalRouteKey === "function" ? getCanonicalRouteKey() : "";
				if (key) return String(key).trim();
			} catch {
				// ignore
			}
			const path = String(window.location.pathname || "");
			const search = String(window.location.search || "");
			const hash = String(window.location.hash || "");
			return `${path}${search}${hash}`;
		}

		onRouteChanged(nextRouteKey) {
			const previousRouteKey = this.routeKey || this.getRouteKey();
			this.saveDraft(previousRouteKey);
			this.routeKey = nextRouteKey || this.getRouteKey();
			// Prevent stale page state from leaking into the next request.
			this.lastEvent = null;
			this.activeField = null;
			this.lastAutoHelpKey = "";
			this.lastAutoHelpAt = 0;
			this.autoHelpTimestamps = [];
			this.autoHelpDisabledUntil = 0;
			this.suppressEventsUntil = 0;
			this.clearPill();
			this.loadDraftForRoute(this.routeKey);
		}

		checkRouteChange() {
			const nextRouteKey = this.getRouteKey();
			if (!nextRouteKey || nextRouteKey === this.routeKey) return;
			this.onRouteChanged(nextRouteKey);
		}

		installRouteWatcher() {
			if (this._routeWatcherInstalled) return;
			this._routeWatcherInstalled = true;
			this.routeKey = this.getRouteKey();
			const handler = () => this.checkRouteChange();
			window.addEventListener("hashchange", handler, true);
			window.addEventListener("popstate", handler, true);
			this._routeWatchTimer = window.setInterval(handler, 500);
		}

		render() {
			const root = document.createElement("div");
			root.className = "erpnext-ai-tutor-root";
			root.innerHTML = `
				<button class="erpnext-ai-tutor-fab" type="button" aria-label="AI Tutor">
					${frappe?.utils?.icon ? frappe.utils.icon("es-line-question", "md") : "AI"}
				</button>
				<div class="erpnext-ai-tutor-drawer erpnext-ai-tutor-hidden" role="dialog" aria-label="AI Tutor" aria-modal="false" aria-hidden="true">
							<div class="erpnext-ai-tutor-header">
								<div>
									<div class="erpnext-ai-tutor-title">AI Tutor</div>
									<div class="erpnext-ai-tutor-subtitle">Help for this page</div>
								</div>
								<div class="erpnext-ai-tutor-header-spacer"></div>
								<span class="erpnext-ai-tutor-pill erpnext-ai-tutor-hidden"></span>
								<button class="erpnext-ai-tutor-icon-btn erpnext-ai-tutor-history-btn" type="button" aria-label="Chat history">
									${frappe?.utils?.icon ? frappe.utils.icon("es-line-time", "sm") : "🕘"}
								</button>
								<button class="erpnext-ai-tutor-icon-btn erpnext-ai-tutor-new-btn" type="button" aria-label="New chat">
									${frappe?.utils?.icon ? frappe.utils.icon("es-line-add", "sm") : "+"}
								</button>
								<button class="erpnext-ai-tutor-close" type="button" aria-label="Close">
									${frappe?.utils?.icon ? frappe.utils.icon("close", "sm") : "×"}
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
									${frappe?.utils?.icon ? frappe.utils.icon("es-line-arrow-up-right", "md") : "➤"}
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
			this.$newChatBtn.addEventListener("click", () => this.newChat());

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
			for (const m of messages) {
				if (!m || !m.role) continue;
				const guide = this.normalizeGuidePayload(m.guide);
				this.history.push({ role: m.role, content: m.content, route_key: m.route_key || "", guide });
				this.appendToDOM(m.role, m.content, m.ts, { animate: false, guide });
			}
			this.$body.scrollTop = this.$body.scrollHeight;
		}

		appendToDOM(role, content, ts, opts = { animate: true }) {
			const wrap = document.createElement("div");
			wrap.className = `erpnext-ai-tutor-message ${role}`;
			wrap.setAttribute("role", "listitem");
			if (opts?.animate) wrap.classList.add("is-new");

			const bubble = document.createElement("div");
			bubble.className = "erpnext-ai-tutor-bubble";

			const text = document.createElement("div");
			text.className = "erpnext-ai-tutor-text";
			if (role === "assistant") {
				this.renderRichText(text, String(content ?? ""));
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
			const guide = this.normalizeGuidePayload(opts?.guide);
			if (role === "assistant" && guide && this.isGuidedCursorEnabled()) {
				const actions = document.createElement("div");
				actions.className = "erpnext-ai-tutor-message-actions";
				const guideBtn = document.createElement("button");
				guideBtn.type = "button";
				guideBtn.className = "erpnext-ai-tutor-guide-btn";
				guideBtn.textContent = "Ko'rsatib ber";
				guideBtn.addEventListener("click", () => {
					this.runGuidedCursor(guide, { auto: false });
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

			const severity = guessSeverity(indicator);
			if (!severity) return;
			this.handleEvent({ severity, title: stripHtml(title), message: stripHtml(message), source: "msgprint" });
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
			if (!this.isAdvancedMode()) return;
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
			this._lastFocusedBeforeOpen = document.activeElement instanceof HTMLElement ? document.activeElement : null;
			this.isOpen = true;
			this.$drawer.classList.remove("erpnext-ai-tutor-hidden");
			this.$drawer.setAttribute("aria-hidden", "false");
			this.loadDraftForRoute(this.routeKey);
			setTimeout(() => {
				this.resizeInput();
				if (this.$input) this.$input.focus();
			}, 0);
		}

		close() {
			this.saveDraft(this.routeKey);
			this.isOpen = false;
			this.$drawer.classList.add("erpnext-ai-tutor-hidden");
			this.$drawer.setAttribute("aria-hidden", "true");
			this.clearPill();
			this.hideTyping();
			if (this.guideRunner) this.guideRunner.stop();
			const fallbackFocus = this.$fab;
			const restoreTo = this._lastFocusedBeforeOpen;
			if (restoreTo && typeof restoreTo.focus === "function" && !this.$drawer.contains(restoreTo)) {
				restoreTo.focus();
			} else if (fallbackFocus && typeof fallbackFocus.focus === "function") {
				fallbackFocus.focus();
			}
		}

		toggle() {
			if (this.isOpen) this.close();
			else this.open();
		}

		append(role, content, opts = {}) {
			this.ensureConversation();
			this.setConversationTitleIfNeeded(role === "user" ? content : "");

			const ts = Date.now();
			const routeKey = String(opts?.route_key || this.routeKey || this.getRouteKey() || "").trim();
			const guide = this.normalizeGuidePayload(opts?.guide);
			this.history.push({ role, content, route_key: routeKey, guide });
			const el = this.appendToDOM(role, content, ts, { animate: true, guide });

			const conv = this.getActiveConversation();
			if (conv) {
				if (!Array.isArray(conv.messages)) conv.messages = [];
				conv.messages.push({ role, content, ts, route_key: routeKey, guide });
				conv.updated_at = ts;
				conv.messages = conv.messages.slice(-MAX_MESSAGES_PER_CONVERSATION);
				this.pruneChatState();
				this.saveChatState();
			}
			this.$body.scrollTop = this.$body.scrollHeight;
			return el;
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
				const history = advanced ? this.getScopedHistory(routeKey, 20) : this.getCoreHistory(6);
				// Remove the message we just appended (current user message) to avoid duplication.
				if (history.length && history[history.length - 1]?.role === "user") {
					history.pop();
				}
				const r = await frappe.call(METHOD_CHAT, {
					message: text,
					context: ctx,
					history,
				});
				let replyText = "";
				if (typeof r?.message?.reply === "string") replyText = r.message.reply;
				else if (typeof r?.message?.message === "string") replyText = r.message.message;
				else if (typeof r?.message === "string") replyText = r.message;
				replyText = String(replyText ?? "").trim();
				if (!replyText) {
					throw new Error("EMPTY_REPLY");
				}
					const guide = this.normalizeGuidePayload(r?.message?.guide);
					const autoGuide = r?.message?.auto_guide === true;
					this.hideTyping();
					this.setMessageStatus(userEl, "sent");
					this.append("assistant", replyText, { route_key: routeKey, guide });
					if (guide && autoGuide && this.isGuidedCursorEnabled()) {
						window.setTimeout(() => {
							this.runGuidedCursor(guide, { auto: true });
						}, 280);
					}
			} catch (e) {
				this.hideTyping();
				this.setMessageStatus(userEl, "failed");
				const isEmptyReply = String(e?.message || "") === "EMPTY_REPLY";
				if (opts?.source === "auto") {
					this.autoHelpDisabledUntil = Date.now() + AUTO_HELP_FAILURE_COOLDOWN_MS;
					return;
				}
					this.append(
						"assistant",
						isEmptyReply
							? "AI didn't reply. Please try again."
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
