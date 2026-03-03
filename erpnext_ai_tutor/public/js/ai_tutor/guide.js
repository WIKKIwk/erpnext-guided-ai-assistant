/* global frappe */

(function () {
	"use strict";

	const ns = (window.ERPNextAITutor = window.ERPNextAITutor || {});

	function normalizeText(value) {
		return String(value || "")
			.toLowerCase()
			.replace(/[\u2018\u2019`']/g, "")
			.replace(/\s+/g, " ")
			.trim();
	}

	function getClickable(el) {
		if (!el || typeof el.closest !== "function") return null;
		return el.closest("a, button, [role='button'], .desk-sidebar-item, .link-item") || el;
	}

	function isVisible(el) {
		if (!el || typeof el.getBoundingClientRect !== "function") return false;
		const style = window.getComputedStyle(el);
		if (!style || style.visibility === "hidden" || style.display === "none") return false;
		const rect = el.getBoundingClientRect();
		return rect.width > 2 && rect.height > 2;
	}

	function clamp(value, min, max) {
		const n = Number(value);
		if (!Number.isFinite(n)) return min;
		return Math.max(min, Math.min(max, n));
	}

		class GuideRunner {
			constructor({ widget }) {
				this.widget = widget || null;
				this.running = false;
				this.$layer = null;
				this.$cursor = null;
				this._pulseTimers = [];
				this._runOptions = {};
				this._lastProgressText = "";
				this._lastProgressAt = 0;
				this.hotspotX = 13;
				this.hotspotY = 8;
				this.cursorPosX = 16 + this.hotspotX;
				this.cursorPosY = 16 + this.hotspotY;
			}

			setRunOptions(opts = {}) {
				this._runOptions = opts && typeof opts === "object" ? opts : {};
			}

			emitProgress(message) {
				const text = String(message || "").trim();
				if (!text) return;
				const now = Date.now();
				if (text === this._lastProgressText && now - this._lastProgressAt < 480) return;
				this._lastProgressText = text;
				this._lastProgressAt = now;
				const cb = this._runOptions?.onProgress;
				if (typeof cb !== "function") return;
				try {
					cb(text);
				} catch {
					// ignore progress callback errors
				}
			}

		normalizeGuide(raw) {
			if (!raw || typeof raw !== "object") return null;
			if (String(raw.type || "") !== "navigation") return null;
			const route = String(raw.route || "").trim();
			if (!route || !route.startsWith("/app/")) return null;
			const menuPathRaw = Array.isArray(raw.menu_path) ? raw.menu_path : [];
			const menu_path = menuPathRaw
				.map((x) => String(x || "").trim())
				.filter(Boolean)
				.slice(0, 6);
			const tutorialRaw = raw.tutorial;
			let tutorial = null;
			if (tutorialRaw && typeof tutorialRaw === "object") {
				const mode = String(tutorialRaw.mode || "").trim().toLowerCase();
				const stageRaw = String(tutorialRaw.stage || "open_and_fill_basic").trim().toLowerCase();
				const allowedStages = new Set(["open_and_fill_basic", "fill_more", "show_save_only"]);
				const stage = allowedStages.has(stageRaw) ? stageRaw : "open_and_fill_basic";
				if (mode === "create_record") {
					tutorial = {
						mode,
						stage,
						doctype: String(tutorialRaw.doctype || "").trim(),
					};
				}
			}
			return {
				type: "navigation",
				route,
				target_label: String(raw.target_label || "").trim(),
				menu_path,
				tutorial,
			};
		}

		createLayer() {
			if (this.$layer && document.body.contains(this.$layer)) return;
			this.$layer = document.createElement("div");
			this.$layer.className = "erpnext-ai-tutor-guide-layer";

			this.$cursor = document.createElement("div");
			this.$cursor.className = "erpnext-ai-tutor-guide-cursor";

			this.$layer.append(this.$cursor);
			document.body.appendChild(this.$layer);
			this.cursorPosX = 16 + this.hotspotX;
			this.cursorPosY = 16 + this.hotspotY;
		}

		stop() {
			this.running = false;
			this.clearPulseTimers();
			if (this.$layer && this.$layer.parentNode) {
				this.$layer.parentNode.removeChild(this.$layer);
			}
			this.$layer = null;
			this.$cursor = null;
		}

		clearPulseTimers() {
			if (!Array.isArray(this._pulseTimers) || !this._pulseTimers.length) return;
			for (const timer of this._pulseTimers) {
				window.clearTimeout(timer);
			}
			this._pulseTimers = [];
		}

		sleep(ms) {
			return new Promise((resolve) => window.setTimeout(resolve, ms));
		}

		async waitFor(getter, timeoutMs = 4200, intervalMs = 120) {
			const start = Date.now();
			while (this.running && Date.now() - start < timeoutMs) {
				const value = getter();
				if (value) return value;
				await this.sleep(intervalMs);
			}
			return null;
		}

		findByLabelCandidate(label, opts = {}) {
			const target = normalizeText(label);
			if (!target) return null;
			const allowHidden = Boolean(opts?.allowHidden);
			const strict = Boolean(opts?.strict);
			const expectedPath = this.normalizePath(opts?.expected_path || "");
			const selectors = Array.isArray(opts?.selectors) && opts.selectors.length
				? opts.selectors
				: [
						".desk-sidebar .item-anchor",
						".desk-sidebar .sidebar-item-label",
						".desk-sidebar .standard-sidebar-item",
						".layout-main .widget .link-item",
						".layout-main [data-route]",
						".layout-main .widget a[href^='/app/']",
						".layout-main a[href^='/app/']",
						"a[href^='/app/']",
				  ];
			const minScore = Number(opts?.min_score) > 0 ? Number(opts.min_score) : strict ? 90 : 56;

			let bestVisible = null;
			let bestVisibleScore = 0;
			let bestHidden = null;
			let bestHiddenScore = 0;

			for (const sel of selectors) {
				const nodes = document.querySelectorAll(sel);
				for (const node of nodes) {
					const el = getClickable(node);
					if (!el) continue;
					const visible = isVisible(el);
					if (!visible && !allowHidden) continue;
					const text = normalizeText(
						el.getAttribute("data-label") ||
							el.getAttribute("aria-label") ||
							el.getAttribute("title") ||
							node.textContent ||
							el.textContent
					);
					if (!text) continue;

					let score = 0;
					if (strict) {
						const textCompact = text.replace(/\s+/g, "");
						const targetCompact = target.replace(/\s+/g, "");
						if (text === target) score = 120;
						else if (textCompact === targetCompact) score = 110;
						else continue;
					} else if (text === target) score = 100;
					else if (text.startsWith(target)) score = 90;
					else if (text.includes(target)) score = 80;
					else {
						const targetTokens = target.split(" ").filter(Boolean);
						const textTokens = new Set(text.split(" ").filter(Boolean));
						let overlap = 0;
						for (const token of targetTokens) {
							if (textTokens.has(token)) overlap += 1;
						}
						if (overlap > 0) {
							score = 40 + overlap * 8;
						}
					}

					const candidatePath = this.getCandidatePath(el, node);
					if (expectedPath) {
						// When route is known, avoid guessing by label alone.
						if (!candidatePath && strict) continue;
						if (candidatePath) {
							if (candidatePath === expectedPath) {
								score += 30;
							} else if (strict) {
								continue;
							} else {
								score -= 40;
							}
						}
					}

					if (visible) {
						if (score > bestVisibleScore) {
							bestVisible = el;
							bestVisibleScore = score;
						}
					} else if (score > bestHiddenScore) {
						bestHidden = el;
						bestHiddenScore = score;
					}
				}
			}

			if (bestVisible && bestVisibleScore >= minScore) {
				return { el: bestVisible, visible: true, score: bestVisibleScore };
			}
			if (allowHidden && bestHidden && bestHiddenScore >= minScore) {
				return { el: bestHidden, visible: false, score: bestHiddenScore };
			}
			return null;
		}

		findByLabel(label) {
			const match = this.findByLabelCandidate(label, { allowHidden: false });
			return match ? match.el : null;
		}

		getScopeSelectors(scope) {
			const mode = String(scope || "").trim().toLowerCase();
			if (mode === "sidebar") {
				return [
					".desk-sidebar .item-anchor[href^='/app/']",
					".desk-sidebar [data-route]",
					".desk-sidebar .sidebar-item-label",
					".desk-sidebar .standard-sidebar-item",
				];
			}
			if (mode === "content") {
				return [
					".layout-main .widget .link-item",
					".layout-main [data-route]",
					".layout-main .widget a[href^='/app/']",
					".layout-main a[href^='/app/']",
				];
			}
			return [
				".desk-sidebar .item-anchor[href^='/app/']",
				".desk-sidebar [data-route]",
				".desk-sidebar .sidebar-item-label",
				".desk-sidebar .standard-sidebar-item",
				".layout-main .widget .link-item",
				".layout-main [data-route]",
				".layout-main .widget a[href^='/app/']",
				".layout-main a[href^='/app/']",
				"a[href^='/app/']",
			];
		}

		collectVisibleLabels(scope = "any", limit = 6) {
			const selectors = this.getScopeSelectors(scope);
			const labels = [];
			const seen = new Set();
			for (const sel of selectors) {
				const nodes = document.querySelectorAll(sel);
				for (const node of nodes) {
					const el = getClickable(node);
					if (!el || !isVisible(el)) continue;
					const text = normalizeText(
						el.getAttribute("data-label") ||
							el.getAttribute("aria-label") ||
							el.getAttribute("title") ||
							node.textContent ||
							el.textContent
					);
					if (!text || seen.has(text)) continue;
					seen.add(text);
					labels.push(text);
					if (labels.length >= limit) return labels;
				}
			}
			return labels;
		}

		findStepCandidate(step, opts = { allowHidden: false }) {
			const allowHidden = Boolean(opts?.allowHidden);
			const scope = String(step?.scope || "any").trim();
			const selectors = this.getScopeSelectors(scope);
			const route = String(step?.route || "").trim();

			if (route) {
				const routeMatch = this.findByRouteCandidate(route, { allowHidden, selectors });
				if (routeMatch) return routeMatch;
			}

			return this.findByLabelCandidate(step?.label, {
				allowHidden,
				selectors,
				strict: Boolean(step?.strict_label),
				min_score: step?.strict_label ? 90 : 70,
				expected_path: route,
			});
		}

		findNavbarHomeButton() {
			const selectors = [
				".navbar .navbar-home",
				".navbar-home",
				"a.navbar-brand.navbar-home",
				".navbar-home .app-logo",
				".navbar-home img",
			];
			for (const sel of selectors) {
				const nodes = document.querySelectorAll(sel);
				for (const node of nodes) {
					const el = getClickable(node);
					if (el && isVisible(el)) return el;
				}
			}
			return null;
		}

		hasVisibleSidebarRoutes() {
			const selectors = this.getScopeSelectors("sidebar");
			for (const sel of selectors) {
				const nodes = document.querySelectorAll(sel);
				for (const node of nodes) {
					const el = getClickable(node);
					if (!el || !isVisible(el)) continue;
					const path = this.getCandidatePath(el, node);
					if (path && path.startsWith("/app/")) return true;
				}
			}
			return false;
		}

		isAtHomeRoute() {
			const current = this.normalizePath(window.location.pathname || "");
			return current === "/app" || current === "/app/home";
		}

		async openMainMenuFromLogo() {
			if (!this.running) return false;
			const homeBtn = this.findNavbarHomeButton();
			if (!homeBtn) return false;
			const clicked = await this.focusElement(homeBtn, "Bosh menyuga qaytamiz.", {
				click: true,
				skip_scroll: true,
				duration_ms: 260,
				pre_click_pause_ms: 110,
			});
			if (!clicked) return false;
			const opened = await this.waitFor(() => this.isAtHomeRoute() || this.hasVisibleSidebarRoutes(), 3400, 110);
			return Boolean(opened);
		}

		isCollapsedNode(node) {
			if (!node || typeof node.getAttribute !== "function") return false;
			const expanded = String(node.getAttribute("aria-expanded") || "").toLowerCase();
			if (expanded === "false") return true;
			const cls = node.classList;
			return Boolean(cls && (cls.contains("collapsed") || cls.contains("is-collapsed") || cls.contains("collapsed-item")));
		}

		getCollapseToggle(node) {
			if (!node) return null;
			const picks = [
				node.querySelector?.(":scope > .sidebar-item-control"),
				node.querySelector?.(":scope > .collapse-indicator"),
				node.querySelector?.(":scope > .dropdown-btn"),
				node.querySelector?.(":scope > [aria-expanded='false']"),
			].filter(Boolean);
			for (const pick of picks) {
				const el = getClickable(pick);
				if (el && isVisible(el)) return el;
			}
			const self = getClickable(node);
			if (self && isVisible(self)) return self;
			return null;
		}

		async expandCollapsedAncestors(el) {
			if (!el || !this.running) return false;
			const sidebarRoot = el.closest(".desk-sidebar, .standard-sidebar, .layout-side-section");
			if (!sidebarRoot) return false;

			const toggles = [];
			const seen = new Set();
			let node = el.parentElement;
			while (node && node !== sidebarRoot) {
				if (this.isCollapsedNode(node)) {
					const toggle = this.getCollapseToggle(node);
					if (toggle) {
						const key = `${toggle.tagName}:${toggle.className}:${toggle.textContent || ""}`;
						if (!seen.has(key)) {
							seen.add(key);
							toggles.push(toggle);
						}
					}
				}
				node = node.parentElement;
			}

			if (!toggles.length) return false;
			toggles.reverse();
			for (const toggle of toggles) {
				if (!this.running || !isVisible(toggle)) continue;
				await this.focusElement(toggle, "Yopiq bo'limni ochamiz.", {
					click: true,
					skip_scroll: true,
					duration_ms: 260,
					pre_click_pause_ms: 95,
				});
				await this.sleep(120);
			}
			return true;
		}

		async ensureSidebarSectionOpen(label) {
			const sectionLabel = String(label || "").trim();
			if (!sectionLabel || !this.running) return false;
			let match = this.findByLabelCandidate(sectionLabel, { allowHidden: true });
			if (!match) return false;

			if (!match.visible) {
				await this.expandCollapsedAncestors(match.el);
				await this.sleep(120);
				match = this.findByLabelCandidate(sectionLabel, { allowHidden: true }) || match;
			}

			const el = match.visible ? match.el : null;
			if (!el || !isVisible(el)) return false;

			const parentNode = el.closest(".standard-sidebar-item, .sidebar-item-container, li, .tree-link");
			const isCollapsed = parentNode ? this.isCollapsedNode(parentNode) : false;
			if (!isCollapsed) return true;

			const toggle = this.getCollapseToggle(parentNode) || el;
			await this.focusElement(toggle, `Fallback: "${sectionLabel}" bo'limini ochamiz.`, {
				click: true,
				duration_ms: 320,
				pre_click_pause_ms: 120,
			});
			return true;
		}

		async revealLabel(label) {
			const match = this.findByLabelCandidate(label, { allowHidden: true });
			if (!match || match.visible) return false;
			const expanded = await this.expandCollapsedAncestors(match.el);
			if (expanded) {
				await this.sleep(110);
			}
			return expanded;
		}

		findSearchInput() {
			const selectors = [
				".search-bar input",
				"input[placeholder*='Search']",
				"input[placeholder*='search']",
				".awesomplete input",
			];
			for (const sel of selectors) {
				const el = document.querySelector(sel);
				if (el && isVisible(el)) return el;
			}
			return null;
		}

		buildSteps(guide) {
			const steps = [];
			const menuPath = Array.isArray(guide.menu_path) ? guide.menu_path : [];
			const moduleLabel = String(menuPath[0] || "").trim();
			const targetLabel = String(guide.target_label || menuPath[menuPath.length - 1] || moduleLabel || "").trim();

			const pathLabels = [];
			for (const raw of menuPath) {
				const label = String(raw || "").trim();
				if (!label) continue;
				if (pathLabels[pathLabels.length - 1] === label) continue;
				pathLabels.push(label);
			}
			if (targetLabel && pathLabels[pathLabels.length - 1] !== targetLabel) {
				pathLabels.push(targetLabel);
			}

			for (let i = 0; i < pathLabels.length; i += 1) {
				const label = pathLabels[i];
				const stepNo = i + 1;
				const isLast = i === pathLabels.length - 1;
				steps.push({
					type: "focus",
					label,
					scope: i === 0 ? "sidebar" : "content",
					section_label: i > 0 ? moduleLabel : "",
					message: `${stepNo}-qadam: "${label}" tugmasini bosamiz.`,
					click: true,
					strict_label: true,
					route: isLast ? String(guide.route || "").trim() : "",
					optional: false,
					timeout_ms: 2200,
					skip_if_on_route: Boolean(isLast && guide.route),
				});
			}

			// Fallback route jump only when no clickable path exists in payload.
			if (!pathLabels.length && guide.route) {
				steps.push({
					type: "navigate",
					route: guide.route,
					message: `Fallback: route orqali ochamiz: ${guide.route}`,
				});
			}
			return steps;
		}

		rectFromDomRect(rect) {
			if (!rect) return null;
			const left = Number(rect.left);
			const top = Number(rect.top);
			const width = Number(rect.width);
			const height = Number(rect.height);
			if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(width) || !Number.isFinite(height)) {
				return null;
			}
			if (width <= 2 || height <= 2) return null;
			return {
				left,
				top,
				width,
				height,
				right: left + width,
				bottom: top + height,
			};
		}

		getPreferredLabelElement(el) {
			if (!el) return null;
			const selectors = [
				".sidebar-item-label",
				".item-anchor",
				".desk-sidebar-item",
				".link-item",
				".widget a",
				"a",
				"button",
			];
			for (const sel of selectors) {
				const node = el.matches?.(sel) ? el : el.querySelector?.(sel);
				if (node && isVisible(node)) return node;
			}
			return isVisible(el) ? el : null;
		}

		makePoint(x, y) {
			return {
				x: clamp(Number(x), 2, window.innerWidth - 2),
				y: clamp(Number(y), 2, window.innerHeight - 2),
			};
		}

		pointsFromRect(rect) {
			if (!rect) return [];
			const cx = rect.left + rect.width * 0.5;
			const cy = rect.top + rect.height * 0.5;
			const l = rect.left + rect.width * 0.28;
			const r = rect.left + rect.width * 0.72;
			const t = rect.top + rect.height * 0.36;
			const b = rect.top + rect.height * 0.66;
			return [
				this.makePoint(cx, cy),
				this.makePoint(l, cy),
				this.makePoint(r, cy),
				this.makePoint(cx, t),
				this.makePoint(cx, b),
				this.makePoint(l, t),
				this.makePoint(r, t),
				this.makePoint(l, b),
				this.makePoint(r, b),
			];
		}

		getTextRects(rootEl, maxRects = 16) {
			if (!rootEl || typeof document.createTreeWalker !== "function") return [];
			const rects = [];
			let walker = null;
			try {
				walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, {
					acceptNode: (node) => {
						const text = String(node?.textContent || "")
							.replace(/\s+/g, " ")
							.trim();
						if (!text) return NodeFilter.FILTER_REJECT;
						if (text.length < 2 && !/\d/.test(text)) return NodeFilter.FILTER_REJECT;
						const parent = node.parentElement;
						if (!parent || !isVisible(parent)) return NodeFilter.FILTER_REJECT;
						return NodeFilter.FILTER_ACCEPT;
					},
				});
			} catch {
				return [];
			}
			if (!walker) return [];

			let node = walker.nextNode();
			while (node) {
				try {
					const range = document.createRange();
					range.selectNodeContents(node);
					const clientRects = range.getClientRects();
					for (const r of clientRects) {
						const rect = this.rectFromDomRect(r);
						if (!rect) continue;
						rects.push(rect);
					}
				} catch {
					// ignore bad text node ranges
				}
				node = walker.nextNode();
			}

			rects.sort((a, b) => b.width * b.height - a.width * a.height);
			return rects.slice(0, Math.max(1, maxRects));
		}

		getLargestTextRect(rootEl) {
			const rects = this.getTextRects(rootEl, 1);
			return rects.length ? rects[0] : null;
		}

		getPreciseTargetPoint(el) {
			const preferred = this.getPreferredLabelElement(el) || el;
			const labelTextRect = this.getLargestTextRect(preferred);
			const rect = labelTextRect || this.getRect(preferred);
			if (!rect) return null;
			const points = this.pointsFromRect(rect);
			return points.length ? points[0] : null;
		}

		getRect(el) {
			return this.rectFromDomRect(el?.getBoundingClientRect?.());
		}

		computeAdaptiveDuration(x, y, preferredDuration = 0) {
			const fromX = Number(this.cursorPosX) || x;
			const fromY = Number(this.cursorPosY) || y;
			const dist = Math.hypot(x - fromX, y - fromY);
			const adaptive = clamp(Math.round(210 + dist * 0.55), 220, 780);
			const preferred = Number(preferredDuration);
			const duration = preferred > 0 ? clamp(Math.round((preferred + adaptive) / 2), 180, 860) : adaptive;
			return { duration, distance: dist };
		}

		computeHoverPause(distance, customPause = 0) {
			const custom = Number(customPause);
			if (custom > 0) return clamp(custom, 80, 260);
			return clamp(Math.round(120 + Math.min(distance, 220) * 0.28), 120, 180);
		}

		moveCursorTo(target, preferredDuration = 0) {
			if (!this.$cursor) return;
			let x = 0;
			let y = 0;
			if (target && Number.isFinite(target.x) && Number.isFinite(target.y)) {
				x = Number(target.x);
				y = Number(target.y);
			} else {
				const rect = target;
				if (!rect) return;
				x = rect.left + rect.width * 0.5;
				y = rect.top + Math.min(rect.height * 0.65, 24);
			}
			const motion = this.computeAdaptiveDuration(x, y, preferredDuration);
			this.$cursor.style.transitionDuration = `${motion.duration}ms`;
			this.$cursor.style.left = `${Math.max(0, x - this.hotspotX)}px`;
			this.$cursor.style.top = `${Math.max(0, y - this.hotspotY)}px`;
			this.cursorPosX = x;
			this.cursorPosY = y;
			return motion;
		}

		clickPulse() {
			if (!this.$cursor) return;
			this.clearPulseTimers();
			const cursor = this.$cursor;
			cursor.classList.remove("is-click");
			void cursor.offsetWidth;
			cursor.classList.add("is-click");
			const t1 = window.setTimeout(() => {
				if (!this.$cursor || this.$cursor !== cursor) return;
				cursor.classList.remove("is-click");
			}, 260);
			this._pulseTimers.push(t1);
		}

		isSameClickableTarget(anchor, node) {
			if (!anchor || !node) return false;
			const hitClickable = getClickable(node) || node;
			return hitClickable === anchor || anchor.contains(hitClickable) || hitClickable.contains(anchor);
		}

		collectCandidatePoints(el, preferredPoint = null) {
			const preferred = this.getPreferredLabelElement(el) || el;
			const points = [];
			if (preferredPoint && Number.isFinite(preferredPoint.x) && Number.isFinite(preferredPoint.y)) {
				points.push(this.makePoint(preferredPoint.x, preferredPoint.y));
			}

			const textRects = this.getTextRects(preferred, 8);
			for (const rect of textRects) {
				points.push(...this.pointsFromRect(rect));
			}

			const rootRect = this.getRect(preferred);
			if (rootRect) {
				points.push(...this.pointsFromRect(rootRect));
			}

			// small local scan around the primary point for pixel-level precision
			if (points.length) {
				const p = points[0];
				const offsets = [
					[-2, 0],
					[2, 0],
					[0, -2],
					[0, 2],
					[-3, -3],
					[3, -3],
					[-3, 3],
					[3, 3],
				];
				for (const [dx, dy] of offsets) {
					points.push(this.makePoint(p.x + dx, p.y + dy));
				}
			}

			const out = [];
			const seen = new Set();
			for (const p of points) {
				const key = `${Math.round(p.x * 10) / 10}:${Math.round(p.y * 10) / 10}`;
				if (seen.has(key)) continue;
				seen.add(key);
				out.push(p);
				if (out.length >= 42) break;
			}
			return out;
		}

		resolveExactClickPoint(el, preferredPoint = null) {
			if (!el) return null;
			const anchor = getClickable(el) || el;
			const candidates = this.collectCandidatePoints(anchor, preferredPoint);
			for (const point of candidates) {
				const hit = document.elementFromPoint(point.x, point.y);
				if (!hit) continue;
				if (!this.isSameClickableTarget(anchor, hit)) continue;
				const target = getClickable(hit) || anchor;
				return { target, point };
			}
			return null;
		}

		performPreciseClick(target, point = null) {
			if (!target || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
			const x = Number(point.x);
			const y = Number(point.y);
			const hit = document.elementFromPoint(x, y);
			if (!hit) return false;
			const clickable = getClickable(hit) || hit;
			if (!(clickable === target || target.contains(clickable) || clickable.contains(target))) {
				return false;
			}
			// Safety boundary: never auto-click Save/Submit style actions.
			if (this.isForbiddenActionElement(clickable)) {
				return false;
			}

			try {
				if (typeof PointerEvent === "function") {
					const pointerInit = {
						bubbles: true,
						cancelable: true,
						view: window,
						pointerId: 1,
						pointerType: "mouse",
						isPrimary: true,
						clientX: x,
						clientY: y,
						button: 0,
						buttons: 1,
					};
					clickable.dispatchEvent(new PointerEvent("pointerdown", pointerInit));
					clickable.dispatchEvent(new PointerEvent("pointerup", { ...pointerInit, buttons: 0 }));
				}

				const down = new MouseEvent("mousedown", {
					bubbles: true,
					cancelable: true,
					view: window,
					clientX: x,
					clientY: y,
					button: 0,
					buttons: 1,
				});
				const up = new MouseEvent("mouseup", {
					bubbles: true,
					cancelable: true,
					view: window,
					clientX: x,
					clientY: y,
					button: 0,
					buttons: 0,
				});
				const click = new MouseEvent("click", {
					bubbles: true,
					cancelable: true,
					view: window,
					clientX: x,
					clientY: y,
					button: 0,
					buttons: 0,
				});
				clickable.dispatchEvent(down);
				clickable.dispatchEvent(up);
				clickable.dispatchEvent(click);
				return true;
			} catch {
				return false;
			}
		}

		async focusElement(el, message, opts = { click: false }) {
			if (!el || !this.running) return false;
			if (!opts.skip_scroll) {
				try {
					el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
				} catch {
					// ignore
				}
			}
			await this.sleep(opts.skip_scroll ? 90 : 220);
			if (!this.running || !isVisible(el)) return false;
			const targetPoint = this.getPreciseTargetPoint(el) || this.getRect(el);
			const motion = this.moveCursorTo(targetPoint, Number(opts.duration_ms) || 0);
			const settlePause = clamp(Math.round((motion?.duration || 300) * 0.22), 90, 220);
			await this.sleep((motion?.duration || 300) + settlePause);
			if (opts.click) {
				const resolved = this.resolveExactClickPoint(el, targetPoint);
				if (!resolved) return false;
				const dx = Math.abs((resolved.point?.x || 0) - (targetPoint?.x || 0));
				const dy = Math.abs((resolved.point?.y || 0) - (targetPoint?.y || 0));
				if (dx > 1 || dy > 1) {
					const correctMotion = this.moveCursorTo(resolved.point, 120);
					await this.sleep((correctMotion?.duration || 120) + 40);
				}
				const hoverPause = this.computeHoverPause(motion?.distance || 0, opts.pre_click_pause_ms);
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
					const currentValue = frm.doc ? frm.doc[fieldname] : null;
						out.push({
							fieldname,
							label: String(df.label || fieldname).trim(),
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

				defaultDemoValueForField(df) {
					const fieldtype = String(df?.fieldtype || "").trim();
					const label = String(df?.label || df?.fieldname || "Field").trim();
					if (["Int", "Float", "Currency", "Percent"].includes(fieldtype)) return "1";
					if (fieldtype === "Select") {
						const options = this.parseFieldOptions(df?.options);
						return options[0] || "Demo";
					}
					if (fieldtype === "Link") return "";
					return `Demo ${label}`;
				}

				buildMergedFieldPlans(doctype, stage, plannedRows = [], fallbackPlans = []) {
					const merged = [];
					const seen = new Set();
					const append = (row, source) => {
						if (!row || typeof row !== "object") return;
						const fieldname = String(row.fieldname || "").trim();
						if (!fieldname || seen.has(fieldname)) return;
						const df = this.getFieldMeta(fieldname);
						if (!df) return;
						if (Boolean(df.read_only) || Boolean(df.hidden)) return;
						const value =
							row.value !== undefined && row.value !== null
								? String(row.value)
								: this.defaultDemoValueForField(df);
						merged.push({
							fieldname,
							label: String(row.label || df.label || fieldname).trim(),
							value,
							reason: String(row.reason || (source === "required" ? "majburiy maydon" : "demo o'rgatish uchun")).trim(),
						});
						seen.add(fieldname);
					};

					for (const row of Array.isArray(plannedRows) ? plannedRows : []) append(row, "ai");
					for (const row of Array.isArray(fallbackPlans) ? fallbackPlans : []) append(row, "fallback");

					const requiredMissing = this.collectMissingRequiredFields(doctype);
					for (const req of requiredMissing) {
						append(
							{
								fieldname: req.fieldname,
								label: req.label,
								value: this.defaultDemoValueForField(req),
								reason: "majburiy maydonni to'ldirish uchun",
							},
							"required"
						);
					}

					return stage === "fill_more" ? merged.slice(0, 8) : merged.slice(0, 10);
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
					if (fieldtype === "Link") {
						const linkDoctype = String(df?.options || "").trim();
						const hint = String(rawValue || "").trim();
						return await this.fetchLinkDemoValue(linkDoctype, hint);
					}
					if (fieldtype === "Select") {
						const options = this.parseFieldOptions(df?.options);
						const wanted = String(rawValue || "").trim();
						if (wanted && options.includes(wanted)) return wanted;
						return options[0] || wanted || "Demo";
					}
					if (["Int", "Float", "Currency", "Percent"].includes(fieldtype)) {
						const wanted = String(rawValue || "").trim();
						return wanted && /^-?\d+(\.\d+)?$/.test(wanted) ? wanted : "1";
					}
					return String(rawValue || "").trim();
				}

				async requestAIFieldPlan(doctype, stage) {
					const fields = this.collectPlannerFieldCandidates(doctype);
					if (!fields.length) return { plan: [], source: "none" };
				try {
					const res = await frappe.call("erpnext_ai_tutor.api.plan_tutorial_fields", {
						doctype: String(doctype || "").trim(),
						stage: String(stage || "open_and_fill_basic").trim().toLowerCase(),
						fields,
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

		async typeIntoInput(input, value) {
			if (!input || value === undefined || value === null) return false;
			const text = String(value);
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
				for (const ch of text) {
					if (!this.running) return false;
					input.value += ch;
					input.dispatchEvent(new Event("input", { bubbles: true }));
					await this.sleep(18);
				}
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
					const currentVal = frm.doc ? frm.doc[fieldname] : null;
					if (currentVal !== null && currentVal !== undefined && String(currentVal).trim()) continue;
					let sample = "Demo";
					if (ft === "Int" || ft === "Float" || ft === "Currency") sample = "1";
					else if (ft === "Select") {
						const opts = this.parseFieldOptions(df.options);
						sample = opts[0] || "Demo";
					} else {
						sample = `Demo ${String(df.label || fieldname).trim()}`;
					}
					plans.push({
						fieldname,
						label: String(df.label || fieldname).trim(),
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
					for (const plan of plans) {
						if (!this.running) break;
						const fieldname = String(plan?.fieldname || "").trim();
						if (!fieldname) continue;
						const df = this.getFieldMeta(fieldname);
						if (!df) continue;
						const label = String(plan?.label || this.getFieldLabel(fieldname) || fieldname).trim();
						const reason = String(plan?.reason || "demo maqsadida").trim();
						const input = this.findFieldInput(fieldname, { allowHidden: true });
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
					const missingRequired = this.collectMissingRequiredFields(doctype);
					return {
						filled,
						filledLabels,
						missingRequiredLabels: missingRequired.map((x) => String(x.label || x.fieldname || "").trim()).filter(Boolean),
						blockedLinkHints: [...new Set(blockedLinkHints)],
					};
				}

			async runCreateRecordTutorial(guide) {
				if (!this.isCreateTutorial(guide)) return { ok: true, reached_target: true, message: "" };
				const doctype = this.getTutorialDoctype(guide);
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
					const filled = Number(fillResult?.filled || 0);
					const filledLabels = Array.isArray(fillResult?.filledLabels) ? fillResult.filledLabels : [];
					const missingRequiredLabels = Array.isArray(fillResult?.missingRequiredLabels)
						? fillResult.missingRequiredLabels
						: [];
					const blockedLinkHints = Array.isArray(fillResult?.blockedLinkHints) ? fillResult.blockedLinkHints : [];
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
			}
			if (this.isAtRoute(guide.route)) return true;

			// If the row exists but click handler didn't fire, confirm with Enter.
			const entered = this.submitSearchByEnter(input);
			if (entered) {
				await this.waitFor(() => this.isAtRoute(guide.route), 3200, 110);
			}
			return this.isAtRoute(guide.route);
		}

		routeToPath(route) {
			const cleaned = String(route || "").trim();
			if (!cleaned) return "";
			const hashIndex = cleaned.indexOf("#");
			const noHash = hashIndex >= 0 ? cleaned.slice(0, hashIndex) : cleaned;
			const queryIndex = noHash.indexOf("?");
			return queryIndex >= 0 ? noHash.slice(0, queryIndex) : noHash;
		}

		normalizePath(path) {
			const cleaned = String(path || "").trim();
			if (!cleaned) return "";
			const noHash = cleaned.split("#")[0];
			const noQuery = noHash.split("?")[0];
			if (!noQuery) return "";
			if (noQuery === "/") return "/";
			return noQuery.replace(/\/+$/, "");
		}

		hrefToPath(href) {
			const raw = String(href || "").trim();
			if (!raw) return "";
			try {
				const parsed = new URL(raw, window.location.origin);
				return this.normalizePath(parsed.pathname);
			} catch {
				return this.normalizePath(this.routeToPath(raw));
			}
		}

		routeLikeToPath(raw) {
			const value = String(raw || "").trim();
			if (!value) return "";
			if (value.startsWith("#/app/")) return this.normalizePath(value.slice(1));
			if (value.startsWith("/app/")) return this.normalizePath(value);
			if (value.startsWith("app/")) return this.normalizePath(`/${value}`);
			if (value.startsWith("#")) return this.normalizePath(value.slice(1));
			if (value.startsWith("/")) return this.normalizePath(value);
			return this.hrefToPath(value);
		}

		getCandidatePath(el, node) {
			const values = [];
			const push = (x) => {
				const s = String(x || "").trim();
				if (s) values.push(s);
			};

			push(el?.getAttribute?.("href"));
			push(node?.getAttribute?.("href"));
			push(el?.getAttribute?.("data-route"));
			push(node?.getAttribute?.("data-route"));
			push(el?.getAttribute?.("data-url"));
			push(node?.getAttribute?.("data-url"));
			push(el?.dataset?.route);
			push(node?.dataset?.route);
			push(el?.dataset?.url);
			push(node?.dataset?.url);
			push(el?.getAttribute?.("data-value"));
			push(node?.getAttribute?.("data-value"));
			push(el?.dataset?.value);
			push(node?.dataset?.value);

			for (const raw of values) {
				if (String(raw || "").includes("/app/")) {
					const match = String(raw).match(/\/app\/[a-z0-9\-_/]+/i);
					if (match && match[0]) {
						const extracted = this.normalizePath(match[0]);
						if (extracted && extracted.startsWith("/app/")) return extracted;
					}
				}
				const path = this.routeLikeToPath(raw);
				if (path && path.startsWith("/app/")) return path;
			}
			return "";
		}

		findByRouteCandidate(route, opts = {}) {
			const targetPath = this.normalizePath(this.routeToPath(route));
			if (!targetPath) return null;
			const allowHidden = Boolean(opts?.allowHidden);
			const selectors = Array.isArray(opts?.selectors) && opts.selectors.length
				? opts.selectors
				: [
						".desk-sidebar a[href^='/app/']",
						".desk-sidebar [data-route]",
						".layout-main .widget .link-item",
						".layout-main [data-route]",
						".layout-main .widget a[href^='/app/']",
						".layout-main a[href^='/app/']",
						"a[href^='/app/']",
				  ];

			let bestVisible = null;
			let bestVisibleScore = 0;
			let bestHidden = null;
			let bestHiddenScore = 0;

			for (const sel of selectors) {
				const nodes = document.querySelectorAll(sel);
				for (const node of nodes) {
					const el = getClickable(node);
					if (!el) continue;
					const visible = isVisible(el);
					if (!visible && !allowHidden) continue;
					const candidatePath = this.getCandidatePath(el, node);
					if (!candidatePath || !candidatePath.startsWith("/app/")) continue;

					let score = 0;
					if (candidatePath === targetPath) score = 120;
					else continue;

					if (visible) {
						if (score > bestVisibleScore) {
							bestVisible = el;
							bestVisibleScore = score;
						}
					} else if (score > bestHiddenScore) {
						bestHidden = el;
						bestHiddenScore = score;
					}
				}
			}

			if (bestVisible && bestVisibleScore >= 88) {
				return { el: bestVisible, visible: true, score: bestVisibleScore };
			}
			if (allowHidden && bestHidden && bestHiddenScore >= 88) {
				return { el: bestHidden, visible: false, score: bestHiddenScore };
			}
			return null;
		}

		isAtRoute(route) {
			const targetPath = this.routeToPath(route);
			if (!targetPath) return false;
			const current = String(window.location.pathname || "");
			return current === targetPath || current.startsWith(targetPath + "/");
		}

		routeToParts(route) {
			const path = this.routeToPath(route);
			const appPath = path.startsWith("/app/") ? path.slice(5) : path.replace(/^\/+/, "");
			return appPath
				.split("/")
				.map((x) => String(x || "").trim())
				.filter(Boolean);
		}

		async navigate(route) {
			if (!route || !this.running) return;
			if (this.isAtRoute(route)) return true;

			let routeMatch = this.findByRouteCandidate(route, { allowHidden: true });
			if (routeMatch && !routeMatch.visible) {
				await this.expandCollapsedAncestors(routeMatch.el);
				await this.sleep(90);
				routeMatch = this.findByRouteCandidate(route, { allowHidden: false });
			}
			if (!routeMatch) {
				routeMatch = this.findByRouteCandidate(route, { allowHidden: false });
			}
			if (!routeMatch) {
				const homeOpened = await this.openMainMenuFromLogo();
				if (homeOpened) {
					routeMatch = this.findByRouteCandidate(route, { allowHidden: true });
					if (routeMatch && !routeMatch.visible) {
						await this.expandCollapsedAncestors(routeMatch.el);
						await this.sleep(90);
					}
					if (!routeMatch) {
						routeMatch = this.findByRouteCandidate(route, { allowHidden: false });
					}
				}
			}
			if (routeMatch?.el && isVisible(routeMatch.el)) {
				await this.focusElement(routeMatch.el, "2-qadam: kerakli bo'lim tugmasini bosamiz.", {
					click: true,
					duration_ms: 320,
					pre_click_pause_ms: 120,
				});
				const openedByClick = await this.waitFor(() => this.isAtRoute(route), 3200, 110);
				if (openedByClick) return true;
			}
			// Strict learn mode: do not force route jump if no visible clickable path was found.
			return false;
		}

		findHeading(targetLabel) {
			const selectors = [
				".page-title .title-text",
				".page-head .title-text",
				".workspace-title",
				"h1",
				"h2",
			];
			const target = normalizeText(targetLabel);
			for (const sel of selectors) {
				const nodes = document.querySelectorAll(sel);
				for (const node of nodes) {
					if (!isVisible(node)) continue;
					if (!target) return node;
					const txt = normalizeText(node.textContent || "");
					if (txt && (txt === target || txt.includes(target) || target.includes(txt))) {
						return node;
					}
				}
			}
			return null;
		}

		buildFailureMessage(step, guide, reason = "not_found") {
			const label = String(step?.label || guide?.target_label || "").trim();
			const scope = String(step?.scope || "any").trim().toLowerCase();
			const visible = this.collectVisibleLabels(scope || "any", 6);
			const visibleText = visible.length ? visible.join(", ") : "aniq tugmalar topilmadi";

			if (reason === "not_clickable") {
				return `Men "${label}" elementini ko'rdim, lekin uni xavfsiz bosib bo'lmadi (yopiq yoki bloklangan). Hozir ko'rinayotgan elementlar: ${visibleText}.`;
			}
			if (reason === "not_opened") {
				return `Men "${label}" tugmasini bosdim, lekin kerakli sahifa ochilmadi. Hozir ko'rinayotgan elementlar: ${visibleText}.`;
			}
			return `Men "${label}" tugmasini aniq topa olmadim, shuning uchun noto'g'ri bosishni to'xtatdim. Hozir ko'rinayotgan elementlar: ${visibleText}.`;
		}

			async run(guideRaw, runOptions = {}) {
				const guide = this.normalizeGuide(guideRaw);
				if (!guide) return { ok: false, message: "Guide payload noto'g'ri." };
				const isTutorial = this.isCreateTutorial(guide);
			if (!isTutorial && guide.route && this.isAtRoute(guide.route)) {
				return {
					ok: true,
					reached_target: true,
					already_there: true,
					message: "Siz allaqachon shu yerdasiz.",
				};
				}
				this.stop();
				this.setRunOptions(runOptions);
				this.running = true;
				this.createLayer();
				let result = {
				ok: true,
				message: "",
				reached_target: false,
				already_there: false,
			};

			try {
				const skipNavigation = Boolean(isTutorial && guide.route && this.isAtRoute(guide.route));
				if (!skipNavigation) {
					const steps = this.buildSteps(guide);
					for (let i = 0; i < steps.length; i += 1) {
						const step = steps[i];
						if (!this.running) break;
						if (step.type === "focus") {
							if (step.skip_if_on_route && this.isAtRoute(guide.route)) {
								continue;
							}
							const label = String(step.label || "").trim();
							if (!label) continue;
							const timeoutMs = Number(step.timeout_ms) > 0 ? Number(step.timeout_ms) : step.optional ? 900 : 2600;
							let match = await this.waitFor(() => this.findStepCandidate(step, { allowHidden: false }), timeoutMs, 100);
							if (!match && step.section_label) {
								await this.ensureSidebarSectionOpen(step.section_label);
								await this.sleep(90);
								match = this.findStepCandidate(step, { allowHidden: true }) || match;
								if (match && !match.visible) {
									await this.expandCollapsedAncestors(match.el);
									await this.sleep(90);
									match = this.findStepCandidate(step, { allowHidden: false });
								}
							}
							if (!match) {
								await this.revealLabel(label);
								await this.sleep(90);
								match = this.findStepCandidate(step, { allowHidden: false });
							}
							if (!match && String(step.scope || "").trim().toLowerCase() === "sidebar") {
								const homeOpened = await this.openMainMenuFromLogo();
								if (homeOpened) {
									await this.sleep(110);
									match = await this.waitFor(() => this.findStepCandidate(step, { allowHidden: false }), 2000, 100);
								}
							}
							const el = match?.el || null;
							if (!el) {
								if (!step.optional) {
									const openedBySearch = await this.trySearchFallback(step, guide);
									if (openedBySearch) {
										continue;
									}
									result = {
										ok: false,
										message: this.buildFailureMessage(step, guide, "not_found"),
									};
									break;
								}
								continue;
							}
							const clicked = await this.focusElement(el, step.message, { click: Boolean(step.click) });
							if (step.click && !clicked) {
								if (!step.optional) {
									result = {
										ok: false,
										message: this.buildFailureMessage(step, guide, "not_clickable"),
									};
									break;
								}
								continue;
							}
							if (clicked && step.click && step.route) {
								const opened = await this.waitFor(() => this.isAtRoute(step.route), 2200, 110);
								const isLast = i === steps.length - 1;
								if (!opened && isLast) {
									const openedBySearch = await this.trySearchFallback(step, guide);
									if (openedBySearch) {
										continue;
									}
									result = {
										ok: false,
										message: this.buildFailureMessage(step, guide, "not_opened"),
									};
									break;
								}
							}
							continue;
						}
						if (step.type === "navigate") {
							const opened = await this.navigate(step.route);
							if (!opened) {
								const openedBySearch = await this.trySearchFallback(
									{ label: String(guide?.target_label || "").trim(), message: "Qidiruv fallbackni ishga tushiramiz." },
									guide
								);
								if (openedBySearch) {
									continue;
								}
								result = {
									ok: false,
									message: `Men "${step.route}" uchun bosiladigan tugmani topa olmadim. Layout yoki ruxsatni tekshiring.`,
								};
								break;
							}
							continue;
						}
						if (step.type === "confirm") {
							const heading = await this.waitFor(() => this.findHeading(step.label), 3800, 120);
							if (heading) {
								await this.focusElement(heading, step.message, { click: false });
							}
						}
					}
				}
				if (result.ok && isTutorial) {
					const tutorialResult = await this.runCreateRecordTutorial(guide);
					if (!tutorialResult?.ok) {
						result = {
							ok: false,
							message: String(tutorialResult?.message || "Tutorial bosqichini bajarib bo'lmadi."),
							reached_target: false,
							already_there: false,
						};
					} else {
						result.ok = true;
						result.reached_target = Boolean(tutorialResult?.reached_target);
						result.already_there = false;
						result.message = String(tutorialResult?.message || "");
					}
				}
				await this.sleep(420);
				if (!isTutorial && guide.route && this.isAtRoute(guide.route)) {
					result.ok = true;
					result.reached_target = true;
					result.already_there = false;
					result.message = "";
				} else if (!guide.route) {
					result.reached_target = Boolean(result.ok);
				}
				} finally {
					this.setRunOptions({});
					this.stop();
				}
				return result;
			}
	}

	ns.GuideRunner = GuideRunner;
})();
