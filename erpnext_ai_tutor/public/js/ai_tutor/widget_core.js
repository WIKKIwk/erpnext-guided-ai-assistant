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
		METHOD_START_GUIDE_FROM_OFFER,
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
						const allowDependencyCreation = tutorialRaw.allow_dependency_creation === true;
						const fieldOverridesRaw =
							tutorialRaw.field_overrides && typeof tutorialRaw.field_overrides === "object"
								? tutorialRaw.field_overrides
								: {};
						const fieldOverrides = {};
						const allowedOverrideFields = new Set(["email", "first_name", "middle_name", "last_name", "username"]);
						const overrideAliases = {
							user_name: "username",
							login: "username",
							name: "first_name",
							full_name: "first_name",
						};
						for (const [rawField, rawCfg] of Object.entries(fieldOverridesRaw)) {
							const rawKey = String(rawField || "").trim().toLowerCase();
							const fieldname = overrideAliases[rawKey] || rawKey;
							if (!allowedOverrideFields.has(fieldname)) continue;
							if (!rawCfg || typeof rawCfg !== "object") continue;
							const overwrite = rawCfg.overwrite === true;
							const value = String(rawCfg.value || "").trim().slice(0, 160);
							if (!overwrite && !value) continue;
							const cfg = {};
							if (overwrite) cfg.overwrite = true;
							if (value) cfg.value = value;
							if (Object.keys(cfg).length) fieldOverrides[fieldname] = cfg;
						}
						if (mode === "create_record") {
							tutorial = {
								mode,
								stage: allowedStages.has(stageRaw) ? stageRaw : "open_and_fill_basic",
								doctype: String(tutorialRaw.doctype || "").trim(),
							};
							if (stockEntryTypePreference) {
								tutorial.stock_entry_type_preference = stockEntryTypePreference;
							}
							if (allowDependencyCreation) {
								tutorial.allow_dependency_creation = true;
							}
							if (Object.keys(fieldOverrides).length) {
								tutorial.field_overrides = fieldOverrides;
							}
						} else if (mode === "manage_roles") {
							tutorial = {
								mode,
								stage: stageRaw || "open_roles_tab",
								doctype: String(tutorialRaw.doctype || "").trim() || "User",
							};
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

		normalizeGuideOfferPayload(raw) {
			if (!raw || typeof raw !== "object") return null;
			const show = raw.show === true;
			const targetLabel = String(raw.target_label || "").trim();
			const route = String(raw.route || "").trim();
			const mode = String(raw.mode || "").trim().toLowerCase();
			const confidenceRaw = Number(raw.confidence);
			const confidence = Number.isFinite(confidenceRaw)
				? Math.max(0, Math.min(1, confidenceRaw))
				: null;
			const reason = String(raw.reason || "").trim().slice(0, 160);
			const menuPathRaw = Array.isArray(raw.menu_path) ? raw.menu_path : [];
			const menuPath = menuPathRaw
				.map((x) => String(x || "").trim())
				.filter(Boolean)
				.slice(0, 6);
			const allowedModes = new Set(["create_record", "navigate", "manage_roles"]);

			if (!show) {
				return {
					show: false,
					confidence,
					reason,
					target_label: targetLabel,
					route,
					menu_path: menuPath,
					mode: allowedModes.has(mode) ? mode : "",
				};
			}

			if (!targetLabel || !route.startsWith("/app/") || !allowedModes.has(mode)) {
				return null;
			}

			const repaired = this.applyGuideRouteOverride(route, targetLabel, menuPath);
			return {
				show: true,
				confidence,
				reason,
				target_label: repaired.target_label,
				route,
				menu_path: repaired.menu_path,
				mode,
			};
		}

		repairGuidePayloadFromOffer(guideRaw, guideOfferRaw) {
			const guide = this.normalizeGuidePayload(guideRaw);
			if (!guide) return null;
			const guideOffer = this.normalizeGuideOfferPayload(guideOfferRaw);
			if (!guideOffer?.show) return guide;

			const offerMode = String(guideOffer.mode || "").trim().toLowerCase();
			const targetLabel = String(guideOffer.target_label || guide.target_label || "").trim();
			if (!targetLabel) return guide;

			if (guide.tutorial && typeof guide.tutorial === "object") {
				const tutorial = { ...guide.tutorial };
				if (!String(tutorial.doctype || "").trim()) {
					tutorial.doctype = targetLabel;
				}
				return { ...guide, tutorial };
			}

			if (offerMode === "create_record") {
				return {
					...guide,
					tutorial: {
						mode: "create_record",
						stage: "open_and_fill_basic",
						doctype: targetLabel,
					},
				};
			}

			if (offerMode === "manage_roles") {
				return {
					...guide,
					tutorial: {
						mode: "manage_roles",
						stage: "open_roles_tab",
						doctype: targetLabel || "User",
					},
				};
			}

			return guide;
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
			const tutorialMode = String(guide?.tutorial?.mode || "").trim().toLowerCase();
			if (tutorialMode === "create_record" || tutorialMode === "manage_roles") {
				return false;
			}
			return this.isRouteActive(guide.route);
		}

		isTutorialGuide(guideRaw) {
			const guide = this.normalizeGuidePayload(guideRaw);
			const tutorialMode = String(guide?.tutorial?.mode || "").trim().toLowerCase();
			return tutorialMode === "create_record" || tutorialMode === "manage_roles";
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
			const target = String(guide.target_label || "").trim();
			if (target) {
				map.set(route, target);
			}
			const menuPath = Array.isArray(guide.menu_path) ? guide.menu_path : [];
			if (menuPath.length) {
				const leaf = String(menuPath[menuPath.length - 1] || "").trim();
				if (leaf && !map.has(route)) {
					map.set(route, leaf);
				}
			}
			return map;
		}

		makeRouteChip(route, label = "") {
			const cleaned = this.normalizeRoutePath(route) || String(route || "").trim();
			const text = String(label || "").trim();
			const chip = document.createElement("strong");
			chip.className = "erpnext-ai-tutor-route-chip";
			chip.textContent = text || cleaned;
			chip.setAttribute("data-route", cleaned);
			if (text) {
				chip.classList.add("is-target-link");
				chip.title = cleaned;
				chip.setAttribute("role", "link");
				chip.setAttribute("tabindex", "0");
			}
			if (text) {
				chip.addEventListener("click", (ev) => {
					ev.preventDefault();
					this.navigateToRoute(cleaned);
				});
				chip.addEventListener("keydown", (ev) => {
					if (ev.key === "Enter" || ev.key === " ") {
						ev.preventDefault();
						this.navigateToRoute(cleaned);
					}
				});
			}
			return chip;
		}

		appendInlineRich(target, source, opts = {}) {
			const value = String(source || "");
			if (!value) return;
			const labelRouteMap = opts?.labelRouteMap instanceof Map ? opts.labelRouteMap : new Map();
			const routeLabelMap = opts?.routeLabelMap instanceof Map ? opts.routeLabelMap : new Map();
			const tokenRe = /(\[[^\]\n]+\]\(\/app\/[a-z0-9][a-z0-9\-_/]*\)|`[^`\n]+`|\*\*[^*\n]+\*\*|\/app\/[a-z0-9][a-z0-9\-_/]*)/gi;
			let lastIndex = 0;
			let match = null;
			while ((match = tokenRe.exec(value)) !== null) {
				const token = String(match[0] || "");
				const index = Number(match.index) || 0;
				if (index > lastIndex) {
					target.appendChild(document.createTextNode(value.slice(lastIndex, index)));
				}
				if (token.startsWith("[") && token.includes("](") && token.endsWith(")")) {
					const linkMatch = token.match(/^\[([^\]]+)\]\((\/app\/[a-z0-9][a-z0-9\-_/]*)\)$/i);
					if (linkMatch) {
						const label = String(linkMatch[1] || "").replace(/\*\*/g, "").trim();
						const route = String(linkMatch[2] || "").trim();
						const normalizedRoute = this.normalizeRoutePath(route);
						const fromRouteMap = normalizedRoute ? routeLabelMap.get(normalizedRoute) : "";
						const looksLikeRoute = /^\/app\/[a-z0-9][a-z0-9\-_/]*$/i.test(label);
						const finalLabel = String(fromRouteMap || (looksLikeRoute ? "" : label) || "").trim();
						if (finalLabel) {
							target.appendChild(this.makeRouteChip(route, finalLabel));
						} else {
							target.appendChild(document.createTextNode(label || route));
						}
					} else {
						target.appendChild(document.createTextNode(token));
					}
				} else if (token.startsWith("`") && token.endsWith("`")) {
					const codeText = token.slice(1, -1).trim();
					const routeLabel = routeLabelMap.get(this.normalizeRoutePath(codeText) || "");
					if (routeLabel) {
						target.appendChild(this.makeRouteChip(codeText, routeLabel));
					} else {
						const code = document.createElement("code");
						code.textContent = codeText;
						target.appendChild(code);
					}
				} else if (token.startsWith("**") && token.endsWith("**")) {
					const labelText = token.slice(2, -2).trim();
					const route = labelRouteMap.get(this.normalizeLabelKey(labelText));
					if (route) {
						target.appendChild(this.makeRouteChip(route, labelText));
					} else {
						const strong = document.createElement("strong");
						strong.textContent = labelText;
						target.appendChild(strong);
					}
				} else if (/^\/app\/[a-z0-9][a-z0-9\-_/]*$/i.test(token)) {
					const routeLabel = routeLabelMap.get(this.normalizeRoutePath(token) || "");
					if (routeLabel) {
						target.appendChild(this.makeRouteChip(token, routeLabel));
					} else {
						target.appendChild(document.createTextNode(token));
					}
				} else {
					target.appendChild(document.createTextNode(token));
				}
				lastIndex = index + token.length;
			}
			if (lastIndex < value.length) {
				target.appendChild(document.createTextNode(value.slice(lastIndex)));
			}
		}

		renderRichText(target, content, opts = {}) {
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
						this.appendInlineRich(li, m[1], opts);
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
						this.appendInlineRich(li, m[2], opts);
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
						this.appendInlineRich(p, line, opts);
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

		setGuideButtonBusy(btn, busy) {
			if (!btn) return;
			btn.disabled = Boolean(busy);
			btn.classList.toggle("is-running", Boolean(busy));
		}

		normalizeMessageTs(value) {
			const n = Number(value);
			return Number.isFinite(n) && n > 0 ? n : 0;
		}

		getGuideSignature(guideRaw) {
			const guide = this.normalizeGuidePayload(guideRaw);
			if (!guide) return "";
			const route = String(guide.route || "").trim().toLowerCase();
			const target = String(guide.target_label || "").trim().toLowerCase();
			const path = Array.isArray(guide.menu_path)
				? guide.menu_path.map((x) => String(x || "").trim().toLowerCase()).filter(Boolean).join(">")
				: "";
			const tutorialMode = String(guide?.tutorial?.mode || "").trim().toLowerCase();
			const tutorialStage = String(guide?.tutorial?.stage || "").trim().toLowerCase();
			const stockTypePref = String(guide?.tutorial?.stock_entry_type_preference || "").trim().toLowerCase();
			return [route, target, path, tutorialMode, tutorialStage, stockTypePref].join("|");
		}

		markGuideActionCompleted(messageTsRaw, guideRaw) {
			const messageTs = this.normalizeMessageTs(messageTsRaw);
			if (!messageTs) return;
			const sig = this.getGuideSignature(guideRaw);
			const matchesGuide = (itemGuide) => {
				if (!sig) return true;
				return this.getGuideSignature(itemGuide) === sig;
			};
			const markIn = (messages) => {
				if (!Array.isArray(messages)) return false;
				let changed = false;
				for (const msg of messages) {
					if (!msg || msg.role !== "assistant") continue;
					if (this.normalizeMessageTs(msg.ts) !== messageTs) continue;
					if (!matchesGuide(msg.guide)) continue;
					if (!msg.guide_completed) {
						msg.guide_completed = true;
						changed = true;
					}
				}
				return changed;
			};

			const conv = this.getActiveConversation();
			const changedConv = markIn(conv?.messages);
			const changedHistory = markIn(this.history);
			if (changedConv || changedHistory) {
				if (conv) conv.updated_at = Date.now();
				this.saveChatState();
			}
		}

		markGuideOfferActionCompleted(messageTsRaw) {
			const messageTs = this.normalizeMessageTs(messageTsRaw);
			if (!messageTs) return;
			const markIn = (messages) => {
				if (!Array.isArray(messages)) return false;
				let changed = false;
				for (const msg of messages) {
					if (!msg || msg.role !== "assistant") continue;
					if (this.normalizeMessageTs(msg.ts) !== messageTs) continue;
					if (!msg.guide_completed) {
						msg.guide_completed = true;
						changed = true;
					}
				}
				return changed;
			};

			const conv = this.getActiveConversation();
			const changedConv = markIn(conv?.messages);
			const changedHistory = markIn(this.history);
			if (changedConv || changedHistory) {
				if (conv) conv.updated_at = Date.now();
				this.saveChatState();
			}
		}

		completeGuideButton(btn) {
			if (!btn) return;
			const actions = btn.closest(".erpnext-ai-tutor-message-actions");
			if (!actions || actions.classList.contains("is-completing")) return;
			const wrap = btn.closest(".erpnext-ai-tutor-message");
			if (wrap) wrap.dataset.guideCompleted = "1";
			actions.classList.add("is-completing");
			btn.classList.add("is-complete");
			window.setTimeout(() => {
				try {
					actions.remove();
				} catch {
					// ignore
				}
			}, 360);
		}

		async runGuidedCursor(guide, opts = { auto: false, triggerEl: null, messageTs: 0 }) {
			if (!guide || !this.isGuidedCursorEnabled()) return;
			if (!this.guideRunner) {
				const runnerCtor =
					(typeof GuideRunner === "function" && GuideRunner) ||
					(typeof window !== "undefined" && typeof window.GuideRunner === "function" && window.GuideRunner) ||
					null;
				if (runnerCtor) {
					try {
						this.guideRunner = new runnerCtor({ widget: this });
					} catch {
						this.guideRunner = null;
					}
				}
			}
			if (!this.guideRunner) {
				this.append(
					"assistant",
					"Kursor moduli yuklanmadi. Sahifani yangilab qayta urinib ko'ring.",
					{ route_key: this.routeKey || this.getRouteKey() }
				);
				return;
			}
			const triggerEl = opts?.triggerEl || null;
				const messageTs = this.normalizeMessageTs(opts?.messageTs);
				this.setGuideButtonBusy(triggerEl, true);
				const prevAutoHelpDisabledUntil = Number(this.autoHelpDisabledUntil || 0);
				this.guidedRunActive = true;
				this.autoHelpDisabledUntil = Math.max(prevAutoHelpDisabledUntil, Date.now() + 45000);
				try {
					const routeKey = this.routeKey || this.getRouteKey();
					const runResult = await this.guideRunner.run(guide, {
						progress_mode: opts?.auto ? "compact" : "full",
						onProgress: (text) => {
							this.append("assistant", String(text), { route_key: routeKey });
						},
					});
					const isTutorial = this.isTutorialGuide(guide);
					const alreadyThere = runResult?.already_there === true;

				let reachedTarget = Boolean(runResult?.ok && runResult?.reached_target);
				if (!reachedTarget && !isTutorial && guide?.route && this.isRouteActive(guide.route)) {
					reachedTarget = true;
				}
				if (!reachedTarget && !isTutorial && guide?.route) {
					await new Promise((resolve) => window.setTimeout(resolve, 360));
					if (this.isRouteActive(guide.route)) reachedTarget = true;
				}

				if (reachedTarget) {
					this.markGuideActionCompleted(messageTs, guide);
					this.completeGuideButton(triggerEl);
				}
				if (runResult?.ok && runResult?.message && !alreadyThere) {
					this.append(
						"assistant",
						String(runResult.message),
						{ route_key: routeKey }
					);
				}
				if (!runResult?.ok) {
					this.append(
						"assistant",
						String(runResult?.message || "Yo'riqnoma bajarilmadi. Sahifani tekshirib qayta urinib ko'ring."),
						{ route_key: routeKey }
					);
				}
			} catch {
				this.append(
					"assistant",
					"Kursor yo‘riqnomani ishga tushirib bo‘lmadi. Sahifani yangilab qayta urinib ko‘ring.",
					{ route_key: this.routeKey || this.getRouteKey() }
				);
			} finally {
				this.guidedRunActive = false;
				this.autoHelpDisabledUntil = Math.max(Number(this.autoHelpDisabledUntil || 0), prevAutoHelpDisabledUntil);
				const shouldKeepBusy =
					Boolean(triggerEl) &&
					triggerEl.classList.contains("is-complete") &&
					triggerEl.closest(".erpnext-ai-tutor-message-actions")?.classList.contains("is-completing");
				if (!shouldKeepBusy) {
					this.setGuideButtonBusy(triggerEl, false);
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
			// Do not create a fresh chat on every login/restart when history already exists.
			// Otherwise it looks like chat history was erased because active conversation changes.
			const hasAnyHistory =
				Array.isArray(this.conversations) &&
				this.conversations.some((conv) => Array.isArray(conv?.messages) && conv.messages.length > 0);
			if (hasAnyHistory) return;
			if (this.hasShownWelcomeInSession()) return;
			this.ensureConversation();
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
					${icon("fab")}
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

			const deferGuideActions = Boolean(opts?.defer_guide_actions);
			if (!deferGuideActions && role === "assistant" && guide && this.isGuidedCursorEnabled() && !finalGuideCompleted) {
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
				!deferGuideActions &&
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

		isUserPostSaveDialogText(rawText) {
			const text = stripHtml(rawText || "").replace(/\s+/g, " ").trim().toLowerCase();
			if (!text) return false;
			if (text.includes("no roles specified") || text.includes("has no roles") || text.includes("no roles enabled")) {
				return true;
			}
			if (text.includes("duplicate name") && text.includes("user")) {
				return true;
			}
			if (text.includes("already exists") && text.includes("user")) {
				return true;
			}
			return false;
		}

		isDialogElementVisible(el) {
			if (!el) return false;
			const rect = typeof el.getBoundingClientRect === "function" ? el.getBoundingClientRect() : null;
			if (!rect || rect.width < 2 || rect.height < 2) return false;
			const style = window.getComputedStyle(el);
			if (!style) return false;
			return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
		}

		findDialogCloseButton(dialog, closeSelectors) {
			if (!dialog) return null;
			for (const sel of closeSelectors) {
				const btn = dialog.querySelector(sel);
				if (btn && typeof btn.click === "function" && this.isDialogElementVisible(btn)) {
					return btn;
				}
			}
			const headerButtons = Array.from(dialog.querySelectorAll(".modal-header button, .modal-header [role='button'], .modal-header .close"))
				.filter((el) => typeof el?.click === "function" && this.isDialogElementVisible(el))
				.sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right);
			return headerButtons[0] || null;
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
			const dialogs = Array.from(document.querySelectorAll(".msgprint-dialog, .modal.msgprint-dialog, .modal.show, .modal.in"))
				.filter((el) => {
					if (!this.isDialogElementVisible(el)) return false;
					return this.isUserPostSaveDialogText(el?.textContent || "");
				})
				.reverse();
			for (const dialog of dialogs) {
				const btn = this.findDialogCloseButton(dialog, closeSelectors);
				if (!btn) continue;
				const byCursor = await this.clickElementWithGuideCursor(btn);
				if (!byCursor) btn.click();
				await new Promise((resolve) => setTimeout(resolve, 90));
				if (!this.isNoRolesDialogVisible()) return true;
			}

			const globalCloseButtons = Array.from(
				document.querySelectorAll(
					".modal.show .modal-header button, .modal.in .modal-header button, .msgprint-dialog .modal-header button, .modal.show .modal-header .close, .modal.in .modal-header .close"
				)
			)
				.filter((el) => typeof el?.click === "function" && this.isDialogElementVisible(el))
				.sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right);
			for (const btn of globalCloseButtons) {
				const byCursor = await this.clickElementWithGuideCursor(btn);
				if (!byCursor) btn.click();
				await new Promise((resolve) => setTimeout(resolve, 90));
				if (!this.isNoRolesDialogVisible()) return true;
			}
			try {
				const dialog = frappe?.msg_dialog;
				const wrapper = dialog?.$wrapper?.[0] || dialog?.wrapper || null;
				const jqVisible = Boolean(dialog?.$wrapper && typeof dialog.$wrapper.is === "function" && dialog.$wrapper.is(":visible"));
				const domVisible = Boolean(wrapper && this.isDialogElementVisible(wrapper));
				const isVisible = jqVisible || domVisible;
				if (isVisible && dialog && typeof dialog.cancel === "function") {
					dialog.cancel();
				}
				if (wrapper) {
					const btn = isVisible ? this.findDialogCloseButton(wrapper, closeSelectors) : null;
					if (btn) {
						const byCursor = await this.clickElementWithGuideCursor(btn);
						if (!byCursor) btn.click();
						await new Promise((resolve) => setTimeout(resolve, 90));
						if (!this.isNoRolesDialogVisible()) return true;
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
				if (!this.isDialogElementVisible(el)) return false;
				return this.isUserPostSaveDialogText(el?.textContent || "");
			});
			if (matched.length) return true;
			try {
				const dialog = frappe?.msg_dialog;
				const wrapper = dialog?.$wrapper?.[0] || dialog?.wrapper || null;
				if (!wrapper || !this.isDialogElementVisible(wrapper)) return false;
				return this.isUserPostSaveDialogText(wrapper.textContent || "");
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
			await this.closeNoRolesSpecifiedDialogWithRetry();
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
			const guideOffer = this.normalizeGuideOfferPayload(opts?.guide_offer);
			const el = this.appendToDOM(role, content, ts, {
				animate: true,
				guide,
				guide_offer: guideOffer,
				guide_completed: this.isGuideTargetActive(guide),
			});
			const guideCompleted = Boolean(el?.dataset?.guideCompleted === "1");
			this.history.push({
				role,
				content,
				route_key: routeKey,
				guide,
				guide_offer: guideOffer,
				guide_completed: guideCompleted,
				ts,
			});

			const conv = this.getActiveConversation();
			if (conv) {
				if (!Array.isArray(conv.messages)) conv.messages = [];
				conv.messages.push({
					role,
					content,
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
