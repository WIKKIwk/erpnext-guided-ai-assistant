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
			if (!guide || !this.isGuidedCursorEnabled() || !this.guideRunner) return;
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

				let reachedTarget = Boolean(runResult?.ok && runResult?.reached_target);
				if (!reachedTarget && guide?.route && this.isRouteActive(guide.route)) {
					reachedTarget = true;
				}
				if (!reachedTarget && guide?.route) {
					await new Promise((resolve) => window.setTimeout(resolve, 360));
					if (this.isRouteActive(guide.route)) reachedTarget = true;
				}

				if (reachedTarget) {
					this.markGuideActionCompleted(messageTs, guide);
					this.completeGuideButton(triggerEl);
				}
				if (runResult?.ok && runResult?.message) {
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
