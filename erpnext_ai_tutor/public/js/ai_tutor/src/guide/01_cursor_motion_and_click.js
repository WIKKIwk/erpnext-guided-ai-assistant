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
			// Slower "teaching pace": user can follow cursor path and understand steps.
			const adaptive = clamp(Math.round(320 + dist * 0.9), 360, 1400);
			const preferred = Number(preferredDuration);
			const duration = preferred > 0 ? clamp(Math.round((preferred + adaptive) / 2), 320, 1400) : adaptive;
			return { duration, distance: dist };
		}

		computeHoverPause(distance, customPause = 0) {
			const custom = Number(customPause);
			if (custom > 0) return clamp(custom, 120, 360);
			return clamp(Math.round(170 + Math.min(distance, 260) * 0.42), 180, 340);
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
			this.playClickSound?.();
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
			const settlePause = clamp(Math.round((motion?.duration || 300) * 0.32), 150, 340);
			await this.sleep((motion?.duration || 300) + settlePause);
			if (opts.click) {
				const resolved = this.resolveExactClickPoint(el, targetPoint);
				if (!resolved) return false;
				const dx = Math.abs((resolved.point?.x || 0) - (targetPoint?.x || 0));
				const dy = Math.abs((resolved.point?.y || 0) - (targetPoint?.y || 0));
				if (dx > 1 || dy > 1) {
					const correctMotion = this.moveCursorTo(resolved.point, 220);
					await this.sleep((correctMotion?.duration || 220) + 80);
				}
				const hoverPause = this.computeHoverPause(motion?.distance || 0, opts.pre_click_pause_ms);
