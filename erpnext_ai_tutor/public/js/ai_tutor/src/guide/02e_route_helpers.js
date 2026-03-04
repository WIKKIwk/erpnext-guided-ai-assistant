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
