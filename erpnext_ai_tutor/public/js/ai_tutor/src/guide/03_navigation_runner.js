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
