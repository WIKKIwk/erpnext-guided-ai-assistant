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
					this._soundCtx = null;
					this._lastTypeSoundAt = 0;
					this._typingAudioTemplate = null;
					this._activeTypingNodes = new Set();
					this._typingAudioUrl = "/assets/erpnext_ai_tutor/sounds/keyboard01.ogg?v=79";
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
				// Warm up short typing sample for lower first-play latency.
				this.getTypingAudioTemplate();
			}

			stop() {
				this.running = false;
				this.clearPulseTimers();
				if (this._activeTypingNodes && this._activeTypingNodes.size) {
					for (const node of Array.from(this._activeTypingNodes)) this.cleanupTypingNode(node);
				}
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

			cleanupTypingNode(audio) {
				if (!audio) return;
				try {
					audio.pause();
				} catch {
					// ignore
				}
				audio.src = "";
				this._activeTypingNodes.delete(audio);
			}
			this._pulseTimers = [];
		}

			sleep(ms) {
				return new Promise((resolve) => window.setTimeout(resolve, ms));
			}

			getSoundContext() {
				try {
					const AC = window.AudioContext || window.webkitAudioContext;
					if (!AC) return null;
					if (!this._soundCtx) this._soundCtx = new AC();
					if (this._soundCtx.state === "suspended") {
						// Resume is best-effort; if blocked, we continue silently.
						this._soundCtx.resume?.();
					}
					return this._soundCtx;
				} catch {
					return null;
				}
			}

			playTone({ freq = 440, duration = 0.04, gain = 0.018, type = "triangle" } = {}) {
				const ctx = this.getSoundContext();
				if (!ctx) return;
				try {
					const now = ctx.currentTime;
					const osc = ctx.createOscillator();
					const amp = ctx.createGain();
					osc.type = type;
					osc.frequency.setValueAtTime(Math.max(80, Number(freq) || 440), now);
					amp.gain.setValueAtTime(0.0001, now);
					amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, Number(gain) || 0.018), now + 0.005);
					amp.gain.exponentialRampToValueAtTime(0.0001, now + Math.max(0.012, Number(duration) || 0.04));
					osc.connect(amp);
					amp.connect(ctx.destination);
					osc.start(now);
					osc.stop(now + Math.max(0.014, Number(duration) || 0.04));
				} catch {
					// silent fallback
				}
			}

			playClickSound() {
				this.playTone({ freq: 520, duration: 0.03, gain: 0.028, type: "triangle" });
			}

			getTypingAudioTemplate() {
				try {
					if (this._typingAudioTemplate) return this._typingAudioTemplate;
					const audio = new Audio(this._typingAudioUrl);
					audio.preload = "auto";
					this._typingAudioTemplate = audio;
					return audio;
				} catch {
					return null;
				}
			}

			playTypingSound() {
				const now = Date.now();
				if (now - this._lastTypeSoundAt < 28) return;
				this._lastTypeSoundAt = now;
				const template = this.getTypingAudioTemplate();
				if (template && this._activeTypingNodes.size < 5) {
					try {
						const node = template.cloneNode(true);
						node.volume = 0.12;
						node.playbackRate = 1.16;
						this._activeTypingNodes.add(node);
						const cleanup = () => this.cleanupTypingNode(node);
						node.addEventListener("ended", cleanup, { once: true });
						node.play().catch(cleanup);
						window.setTimeout(cleanup, 120);
						return;
					} catch {
						// fallback below
					}
				}
				const jitter = (Math.random() - 0.5) * 28;
				this.playTone({ freq: 740 + jitter, duration: 0.018, gain: 0.01, type: "square" });
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
