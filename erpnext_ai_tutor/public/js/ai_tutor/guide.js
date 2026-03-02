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

	class GuideRunner {
		constructor({ widget }) {
			this.widget = widget || null;
			this.running = false;
			this.$layer = null;
			this.$cursor = null;
			this._pulseTimers = [];
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

		findByLabel(label) {
			const target = normalizeText(label);
			if (!target) return null;

			const selectors = [
				".desk-sidebar .item-anchor",
				".desk-sidebar .sidebar-item-label",
				".desk-sidebar .standard-sidebar-item",
				".layout-main .widget a[href^='/app/']",
				".layout-main a[href^='/app/']",
				"a[href^='/app/']",
			];

			let best = null;
			let bestScore = 0;

			for (const sel of selectors) {
				const nodes = document.querySelectorAll(sel);
				for (const node of nodes) {
					let el = getClickable(node);
					if (!el || !isVisible(el)) continue;
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

					if (score > bestScore) {
						best = el;
						bestScore = score;
					}
				}
			}

			return bestScore >= 56 ? best : null;
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
					message: `1-qadam: agar ko'rinib turgan bo'lsa, \"${targetLabel}\" ni to'g'ridan-to'g'ri bosamiz.`,
					click: true,
					optional: true,
					timeout_ms: 900,
					skip_if_on_route: true,
				});
			}

			const moduleNorm = normalizeText(moduleLabel);
			const targetNorm = normalizeText(targetLabel);
			if (moduleLabel && moduleNorm && targetNorm && moduleNorm !== targetNorm) {
				steps.push({
					type: "focus",
					label: moduleLabel,
					message: `2-qadam: bo'lim ko'rinmasa, avval \"${moduleLabel}\" ni ochamiz.`,
					click: true,
					optional: true,
					timeout_ms: 900,
					skip_if_on_route: true,
				});
				if (targetLabel) {
					steps.push({
						type: "focus",
						label: targetLabel,
						message: `3-qadam: endi \"${targetLabel}\" bo'limini bosamiz.`,
						click: true,
						optional: true,
						timeout_ms: 1400,
						skip_if_on_route: true,
					});
				}
			}

			if (guide.route) {
				steps.push({
					type: "navigate",
					route: guide.route,
					message: `4-qadam: kerakli sahifani ochamiz: ${guide.route}`,
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

		moveCursorTo(rect, duration = 520) {
			if (!this.$cursor) return;
			const x = rect.left + rect.width * 0.5;
			const y = rect.top + Math.min(rect.height * 0.65, 24);
			const hotspotX = 13;
			const hotspotY = 8;
			this.$cursor.style.transitionDuration = `${duration}ms`;
			this.$cursor.style.left = `${Math.max(0, x - hotspotX)}px`;
			this.$cursor.style.top = `${Math.max(0, y - hotspotY)}px`;
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
			try {
				el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
			} catch {
				// ignore
			}
			await this.sleep(280);
			if (!this.running || !isVisible(el)) return false;
			const rect = this.getRect(el);
			this.moveCursorTo(rect, 560);
			await this.sleep(640);
			if (opts.click) {
				this.clickPulse();
				await this.sleep(120);
				try {
					if (typeof el.click === "function") el.click();
				} catch {
					// ignore
				}
				await this.sleep(300);
			}
			return true;
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
			const targetPath = this.routeToPath(route);
			if (this.isAtRoute(route)) return;

			const searchInput = this.findSearchInput();
			if (searchInput) {
				await this.focusElement(searchInput, "Qidiruvdan ham ochish mumkin.", { click: false });
			}

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
						const el = await this.waitFor(() => this.findByLabel(label), timeoutMs, 100);
						if (!el) {
							if (!step.optional) {
								await this.sleep(260);
							}
							continue;
						}
						await this.focusElement(el, step.message, { click: Boolean(step.click) });
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
