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
