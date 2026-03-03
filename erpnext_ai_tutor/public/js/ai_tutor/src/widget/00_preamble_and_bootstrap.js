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
	const DRAWER_CLOSE_ANIM_MS = 280;
	const TYPEWRITER_TARGET_MIN_MS = 5200;
	const TYPEWRITER_TARGET_MAX_MS = 14000;
	const ROUTE_NON_ENTITY_PARTS = new Set([
		"app",
		"view",
		"list",
		"new",
		"form",
		"tree",
		"report",
		"dashboard",
		"calendar",
		"kanban",
		"gantt",
		"map",
		"workspace",
		"module",
		"home",
	]);
	const ROUTE_MODULE_PARTS = new Set([
		"accounting",
		"buying",
		"selling",
		"stock",
		"assets",
		"manufacturing",
		"quality",
		"projects",
		"support",
		"users",
		"website",
		"crm",
		"tools",
		"integrations",
		"build",
		"setup",
		"automation",
	]);

	function normalizeStockEntryTypePreference(value) {
		const raw = String(value || "").trim().toLowerCase();
		if (!raw) return "";
		if (raw === "material issue" || raw === "issue") return "Material Issue";
		if (raw === "material receipt" || raw === "receipt") return "Material Receipt";
		if (raw === "material transfer" || raw === "transfer") return "Material Transfer";
		return "";
	}
	const ICONS = Object.freeze({
		fab: `
			<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
				<path d="M12 3.5l1.35 3.64L17 8.5l-3.65 1.36L12 13.5l-1.35-3.64L7 8.5l3.65-1.36L12 3.5z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
				<path d="M18.5 13l.8 2.1 2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8.8-2.1z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
				<path d="M6 14.5l.55 1.45L8 16.5l-1.45.55L6 18.5l-.55-1.45L4 16.5l1.45-.55L6 14.5z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
			</svg>
		`,
		history: `
			<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
				<path d="M3.8 11.9A8.2 8.2 0 1112 20.2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>
				<path d="M3.8 8.8v3.6h3.6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
				<path d="M12 8v4.1l2.6 1.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
			</svg>
		`,
		new_chat: `
			<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
				<path d="M12 5.2v13.6M5.2 12h13.6" stroke="currentColor" stroke-width="1.95" stroke-linecap="round"/>
			</svg>
		`,
		close: `
			<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
				<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" stroke="currentColor" stroke-width="1.95" stroke-linecap="round"/>
			</svg>
		`,
		send: `
			<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
				<path d="M6 18L18 6" stroke="currentColor" stroke-width="1.95" stroke-linecap="round"/>
				<path d="M9.8 6H18v8.2" stroke="currentColor" stroke-width="1.95" stroke-linecap="round" stroke-linejoin="round"/>
			</svg>
		`,
	});

	function icon(name) {
		return ICONS[name] || "";
	}

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
			this._newChatPending = false;
			this._newChatPreviousConversationId = null;
			this.guideRunner = null;
			this._typingAnimationToken = 0;
			this._typingRAF = null;
			this._drawerHideTimer = null;
			this._boundGlobalKeydown = (ev) => this.onGlobalKeydown(ev);
			this._boundDrawerKeydown = (ev) => this.onDrawerKeydown(ev);
			this._lastFocusedBeforeOpen = null;
			this.guidedRunActive = false;
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
			const tutorialRaw = raw.tutorial;
			let tutorial = null;
				if (tutorialRaw && typeof tutorialRaw === "object") {
					const mode = String(tutorialRaw.mode || "").trim().toLowerCase();
					const stageRaw = String(tutorialRaw.stage || "open_and_fill_basic").trim().toLowerCase();
					const allowedStages = new Set(["open_and_fill_basic", "fill_more", "show_save_only"]);
					const stockEntryTypePreference = normalizeStockEntryTypePreference(
						tutorialRaw.stock_entry_type_preference
					);
					if (mode === "create_record") {
						tutorial = {
							mode,
							stage: allowedStages.has(stageRaw) ? stageRaw : "open_and_fill_basic",
							doctype: String(tutorialRaw.doctype || "").trim(),
						};
						if (stockEntryTypePreference) {
							tutorial.stock_entry_type_preference = stockEntryTypePreference;
						}
					}
				}
			const repaired = this.applyGuideRouteOverride(route, targetLabel, menuPath);
			return {
				type: "navigation",
				route,
				target_label: repaired.target_label,
				menu_path: repaired.menu_path,
				tutorial,
			};
		}

		normalizeRoutePath(value) {
			const cleaned = String(value || "").trim();
			if (!cleaned) return "";
			const noHash = cleaned.split("#")[0];
			const noQuery = noHash.split("?")[0];
			if (!noQuery) return "";
			if (noQuery === "/") return "/";
			return noQuery.replace(/\/+$/, "");
		}

		getAppRouteParts(pathRaw) {
			const path = this.normalizeRoutePath(pathRaw);
			if (!path || !path.startsWith("/app/")) return [];
			return path
				.slice(5)
				.split("/")
				.map((x) => String(x || "").trim().toLowerCase())
				.filter(Boolean);
		}

		normalizeRouteLeafToken(tokenRaw) {
			let token = String(tokenRaw || "").trim().toLowerCase();
			if (!token) return "";
			if (token.endsWith("-list")) token = token.slice(0, -5);
			return token;
		}

		getRouteEntityKeys(pathRaw) {
			const parts = this.getAppRouteParts(pathRaw).map((x) => this.normalizeRouteLeafToken(x)).filter(Boolean);
			if (!parts.length) return [];
			const keys = [];
			for (const part of parts) {
				if (!part || ROUTE_NON_ENTITY_PARTS.has(part) || ROUTE_MODULE_PARTS.has(part)) continue;
				if (/^\d+$/.test(part)) continue;
				if (/^[a-f0-9]{8,}$/i.test(part)) continue;
				keys.push(part);
			}
			if (!keys.length && parts[0]) keys.push(parts[0]);
			return Array.from(new Set(keys));
		}

		isRouteActive(routeRaw) {
			const targetPath = this.normalizeRoutePath(routeRaw);
			const currentPath = this.normalizeRoutePath(window.location.pathname || "");
			if (!targetPath || !currentPath) return false;
			if (currentPath === targetPath || currentPath.startsWith(`${targetPath}/`)) return true;

			const currentParts = this.getAppRouteParts(currentPath);
			const targetParts = this.getAppRouteParts(targetPath);
			if (!currentParts.length || !targetParts.length) return false;

			const currentLeaf = this.normalizeRouteLeafToken(currentParts[currentParts.length - 1]);
			const targetLeaf = this.normalizeRouteLeafToken(targetParts[targetParts.length - 1]);
			if (!currentLeaf || !targetLeaf || currentLeaf !== targetLeaf) return false;

			// Treat canonical list aliases as equal:
			// /app/item  <=> /app/stock/item
			// /app/item  <=> /app/item-list
			if (currentParts.length === 1 || targetParts.length === 1) return true;

			const currentKeys = this.getRouteEntityKeys(currentPath);
			const targetKeys = this.getRouteEntityKeys(targetPath);
			if (!currentKeys.length || !targetKeys.length) return false;
			return currentKeys.some((key) => targetKeys.includes(key));
		}

		isGuideTargetActive(guideRaw) {
			const guide = this.normalizeGuidePayload(guideRaw);
			if (!guide?.route) return false;
			if (String(guide?.tutorial?.mode || "").trim().toLowerCase() === "create_record") {
				return false;
			}
			return this.isRouteActive(guide.route);
		}

		isTutorialGuide(guideRaw) {
			const guide = this.normalizeGuidePayload(guideRaw);
			return String(guide?.tutorial?.mode || "").trim().toLowerCase() === "create_record";
		}

		isCurrentRouteMentionedInBubble(container) {
			if (!container?.querySelectorAll) return false;
			const chips = container.querySelectorAll(".erpnext-ai-tutor-route-chip.is-target-link[data-route]");
			for (const chip of chips) {
				const route = String(chip.getAttribute("data-route") || "").trim();
				if (this.isRouteActive(route)) return true;
			}
			return false;
		}

		getDraftScopeKey(routeKey = "") {
			const activeConversation = String(this.activeConversationId || "").trim();
			if (activeConversation) {
				return `conv:${activeConversation}`;
			}
			const route = String(routeKey || this.routeKey || this.getRouteKey() || "")
				.trim()
				.slice(0, 220);
			return `route:${route}`;
		}

		getLegacyRouteDraftStorageKey(routeKey = "") {
			const user = String(frappe?.session?.user || "Guest").trim() || "Guest";
			const route = String(routeKey || this.routeKey || this.getRouteKey() || "")
				.trim()
				.slice(0, 220);
			return `${DRAFT_STORAGE_PREFIX}:${window.location.host}:${user}:${route}`;
		}

		getDraftStorageKey(routeKey = "") {
			const user = String(frappe?.session?.user || "Guest").trim() || "Guest";
			const scope = this.getDraftScopeKey(routeKey);
			return `${DRAFT_STORAGE_PREFIX}:${window.location.host}:${user}:${scope}`;
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
			const legacyRouteKey = this.getLegacyRouteDraftStorageKey(routeKey);
			let value = "";
			try {
				value = String(window.localStorage.getItem(key) || "");
				// Backward compatibility: migrate route-based draft to conversation-based key.
				if (!value && legacyRouteKey && legacyRouteKey !== key) {
					const legacy = String(window.localStorage.getItem(legacyRouteKey) || "");
					if (legacy) {
						value = legacy;
						window.localStorage.setItem(key, legacy);
					}
				}
			} catch {
				value = "";
			}
			this.$input.value = value;
			this.resizeInput();
		}

		clearDraft(routeKey = "") {
			if (!window.localStorage) return;
			const key = this.getDraftStorageKey(routeKey);
			const legacyRouteKey = this.getLegacyRouteDraftStorageKey(routeKey);
			try {
				window.localStorage.removeItem(key);
				if (legacyRouteKey && legacyRouteKey !== key) {
					window.localStorage.removeItem(legacyRouteKey);
				}
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

		normalizeLabelKey(label) {
			return String(label || "")
				.toLowerCase()
				.replace(/[\u2018\u2019`']/g, "")
				.replace(/\s+/g, " ")
				.trim();
		}

		buildGuideLabelRouteMap(guide) {
			const map = new Map();
			if (!guide || typeof guide !== "object") return map;
			const route = this.normalizeRoutePath(guide.route);
			if (!route) return map;
			const target = String(guide.target_label || "").trim();
			if (target) {
				map.set(this.normalizeLabelKey(target), route);
			}
			const menuPath = Array.isArray(guide.menu_path) ? guide.menu_path : [];
			if (menuPath.length) {
				const leaf = String(menuPath[menuPath.length - 1] || "").trim();
				if (leaf) {
					map.set(this.normalizeLabelKey(leaf), route);
				}
			}
			return map;
		}

		buildGuideRouteLabelMap(guide) {
			const map = new Map();
			if (!guide || typeof guide !== "object") return map;
			const route = this.normalizeRoutePath(guide.route);
			if (!route) return map;
