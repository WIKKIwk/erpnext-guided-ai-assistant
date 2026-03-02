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
			this.hotspotX = 13;
			this.hotspotY = 8;
			this.cursorPosX = 16 + this.hotspotX;
			this.cursorPosY = 16 + this.hotspotY;
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
			return {
				type: "navigation",
				route,
				target_label: String(raw.target_label || "").trim(),
				menu_path,
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

		findByLabelCandidate(label, opts = { allowHidden: false }) {
			const target = normalizeText(label);
			if (!target) return null;
			const allowHidden = Boolean(opts?.allowHidden);

			const selectors = [
				".desk-sidebar .item-anchor",
				".desk-sidebar .sidebar-item-label",
				".desk-sidebar .standard-sidebar-item",
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
					const text = normalizeText(
						el.getAttribute("data-label") ||
							el.getAttribute("aria-label") ||
							el.getAttribute("title") ||
							node.textContent ||
							el.textContent
					);
					if (!text) continue;

					let score = 0;
					if (text === target) score = 100;
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

			if (bestVisible && bestVisibleScore >= 56) {
				return { el: bestVisible, visible: true, score: bestVisibleScore };
			}
			if (allowHidden && bestHidden && bestHiddenScore >= 56) {
				return { el: bestHidden, visible: false, score: bestHiddenScore };
			}
			return null;
		}

		findByLabel(label) {
			const match = this.findByLabelCandidate(label, { allowHidden: false });
			return match ? match.el : null;
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

			if (targetLabel) {
				steps.push({
					type: "focus",
					label: targetLabel,
					section_label: moduleLabel,
					message: `1-qadam: avval \"${targetLabel}\" ni to'g'ridan-to'g'ri topib bosamiz.`,
					click: true,
					optional: true,
					timeout_ms: 1000,
					skip_if_on_route: true,
				});
			}

			if (guide.route) {
				steps.push({
					type: "search",
					label: targetLabel || moduleLabel,
					route: guide.route,
					message: "2-qadam: bo'lim ko'rinmasa, qidiruv fallbackni sinab ko'ramiz.",
					optional: true,
					skip_if_on_route: true,
				});
			}

			if (guide.route) {
				steps.push({
					type: "navigate",
					route: guide.route,
					message: `3-qadam: oxirgi fallback sifatida route orqali ochamiz: ${guide.route}`,
				});
			}
			steps.push({
				type: "confirm",
				label: targetLabel,
				message: "Tayyor: mana shu kerakli sahifa.",
			});
			return steps;
		}

		getRect(el) {
			const rect = el.getBoundingClientRect();
			return {
				left: rect.left,
				top: rect.top,
				width: rect.width,
				height: rect.height,
				right: rect.right,
				bottom: rect.bottom,
			};
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

		moveCursorTo(rect, preferredDuration = 0) {
			if (!this.$cursor) return;
			const x = rect.left + rect.width * 0.5;
			const y = rect.top + Math.min(rect.height * 0.65, 24);
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
			cursor.classList.remove("is-pulse", "is-press", "is-release");
			void cursor.offsetWidth;
			cursor.classList.add("is-pulse", "is-press");
			const t1 = window.setTimeout(() => {
				if (!this.$cursor || this.$cursor !== cursor) return;
				cursor.classList.remove("is-press");
				cursor.classList.add("is-release");
			}, 120);
			const t2 = window.setTimeout(() => {
				if (!this.$cursor || this.$cursor !== cursor) return;
				cursor.classList.remove("is-release");
			}, 280);
			this._pulseTimers.push(t1, t2);
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
			const rect = this.getRect(el);
			const motion = this.moveCursorTo(rect, Number(opts.duration_ms) || 0);
			const settlePause = clamp(Math.round((motion?.duration || 300) * 0.22), 90, 220);
			await this.sleep((motion?.duration || 300) + settlePause);
			if (opts.click) {
				const hoverPause = this.computeHoverPause(motion?.distance || 0, opts.pre_click_pause_ms);
				this.clickPulse();
				await this.sleep(hoverPause);
				try {
					if (typeof el.click === "function") el.click();
				} catch {
					// ignore
				}
				await this.sleep(220);
			}
			return true;
		}

		getSearchQuery(guide, step) {
			const raw = String(step?.label || guide?.target_label || "").trim();
			if (raw) return raw;
			const parts = this.routeToParts(guide?.route || "");
			if (!parts.length) return "";
			return parts[parts.length - 1].replace(/-/g, " ").trim();
		}

		findSearchResult(query, route) {
			const target = normalizeText(query);
			const targetPath = this.routeToPath(route);
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
					let score = 0;
					if (target && text === target) score = 100;
					else if (target && text.includes(target)) score = 84;
					else if (target) {
						const token = target.split(" ")[0];
						if (token && text.includes(token)) score = 70;
					}
					const href = String(el.getAttribute?.("href") || "").trim();
					if (targetPath && href && href.includes(targetPath)) score = Math.max(score, 98);
					if (score > bestScore) {
						best = el;
						bestScore = score;
					}
				}
			}
			return bestScore >= 68 ? best : null;
		}

		async trySearchFallback(step, guide) {
			if (!this.running || !guide?.route) return false;
			const query = this.getSearchQuery(guide, step);
			const input = this.findSearchInput();
			if (!input || !query) return false;
			const openMessage =
				String(step?.message || "").trim() || "2-qadam: qidiruv fallbackni ishga tushiramiz.";

			await this.focusElement(input, openMessage, {
				click: false,
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
				const keydown = new KeyboardEvent("keydown", {
					key: "Enter",
					code: "Enter",
					keyCode: 13,
					which: 13,
					bubbles: true,
				});
				const keyup = new KeyboardEvent("keyup", {
					key: "Enter",
					code: "Enter",
					keyCode: 13,
					which: 13,
					bubbles: true,
				});
				input.dispatchEvent(keydown);
				input.dispatchEvent(keyup);
			} catch {
				return false;
			}

			await this.sleep(520);
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
			if (this.isAtRoute(route)) return;

			const parts = this.routeToParts(route);
			if (parts.length && frappe && typeof frappe.set_route === "function") {
				frappe.set_route(parts);
			} else {
				window.location.href = route;
				return;
			}

			await this.waitFor(() => this.isAtRoute(route), 8000, 120);
			await this.sleep(480);
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

		async run(guideRaw) {
			const guide = this.normalizeGuide(guideRaw);
			if (!guide) return;
			this.stop();
			this.running = true;
			this.createLayer();
			let clickedPrimaryTarget = false;

			try {
				const steps = this.buildSteps(guide);
				for (const step of steps) {
					if (!this.running) break;
					if (step.type === "focus") {
						if (step.skip_if_on_route && this.isAtRoute(guide.route)) {
							continue;
						}
						const label = String(step.label || "").trim();
						if (!label) continue;
						const timeoutMs = Number(step.timeout_ms) > 0 ? Number(step.timeout_ms) : step.optional ? 900 : 2600;
						let el = await this.waitFor(() => this.findByLabel(label), timeoutMs, 100);
						if (!el && step.section_label) {
							await this.ensureSidebarSectionOpen(step.section_label);
							await this.sleep(90);
							el = this.findByLabel(label);
						}
						if (!el) {
							await this.revealLabel(label);
							await this.sleep(90);
							el = this.findByLabel(label);
						}
						if (!el) {
							if (!step.optional) {
								await this.sleep(260);
							}
							continue;
						}
						const clicked = await this.focusElement(el, step.message, { click: Boolean(step.click) });
						if (clicked && step.click) {
							clickedPrimaryTarget = true;
							if (guide.route) {
								await this.waitFor(() => this.isAtRoute(guide.route), 1800, 110);
							}
						}
						continue;
					}
					if (step.type === "search") {
						if (step.skip_if_on_route && this.isAtRoute(guide.route)) {
							continue;
						}
						if (clickedPrimaryTarget && guide.route) {
							const alreadyOpened = await this.waitFor(() => this.isAtRoute(guide.route), 1400, 110);
							if (alreadyOpened) {
								continue;
							}
						}
						await this.trySearchFallback(step, guide);
						continue;
					}
					if (step.type === "navigate") {
						await this.navigate(step.route);
						continue;
					}
					if (step.type === "confirm") {
						const heading = await this.waitFor(() => this.findHeading(step.label), 3800, 120);
						if (heading) {
							await this.focusElement(heading, step.message, { click: false });
						}
					}
				}
				await this.sleep(800);
			} finally {
				this.stop();
			}
		}
	}

	ns.GuideRunner = GuideRunner;
})();
