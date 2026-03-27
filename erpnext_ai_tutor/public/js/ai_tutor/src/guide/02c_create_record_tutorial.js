			async runCreateRecordTutorial(guide) {
				if (!this.isCreateTutorial(guide)) return { ok: true, reached_target: true, message: "" };
				const doctype = this.getTutorialDoctype(guide);
					this._tutorialStockEntryTypePreference =
						String(doctype || "").trim().toLowerCase() === "stock entry"
							? this.normalizeStockEntryTypePreference(guide?.tutorial?.stock_entry_type_preference)
							: "";
					this._allowDependencyCreation = guide?.tutorial?.allow_dependency_creation === true;
					this._tutorialFieldOverrides =
						guide?.tutorial?.field_overrides && typeof guide.tutorial.field_overrides === "object"
							? guide.tutorial.field_overrides
							: {};
					const stage = String(guide?.tutorial?.stage || "open_and_fill_basic").trim().toLowerCase();
					this.startTutorialTrace({
						doctype,
						stage,
						route: String(guide?.route || "").trim(),
						allow_dependency_creation: Boolean(this._allowDependencyCreation),
						field_overrides: Object.keys(this._tutorialFieldOverrides || {}).slice(0, 6),
					});
					this.emitProgress(`🚀 **${doctype}** bo'yicha amaliy ko'rsatishni boshladim.`);
					if (this._allowDependencyCreation) {
						this.emitProgress("🧰 Kerakli bog'liq masterlar topilmasa, demo uchun avtomatik yaratib davom etaman.");
					}
					const finish = async (result, reason = "", extra = {}) => {
						return await this.finishTutorialTrace(result, reason, extra);
					};

				if (!this.isOnDoctypeNewForm(doctype)) {
						const entryStateBeforeCreate = this.getCreateRecordEntryState(doctype);
						this.traceTutorialEvent("create_record.entry_state.before", {
							state: entryStateBeforeCreate,
						});
						if (guide.route && !this.isAtRoute(guide.route)) {
							const openedList = await this.navigate(guide.route);
							if (!openedList) {
								return await finish(
									{ ok: false, message: "Kerakli bo'limni ochib bo'lmadi, qayta urinib ko'ring." },
									"open_section_failed"
								);
							}
						}
					const createBtn = await this.waitFor(() => this.findCreateActionButton(doctype), 3200, 120);
						if (!createBtn) {
							const openedByFallback = await this.openNewDocFallback(doctype);
							this.traceTutorialEvent("create_record.entry_state.fallback", {
								reason: "create_button_missing",
								ok: Boolean(openedByFallback),
								state: this.getCreateRecordEntryState(doctype),
							});
							if (!openedByFallback) {
								return await finish(
									{ ok: false, message: 'Yangi yozuv ochish tugmasini topa olmadim ("Add/New/Create").' },
									"create_button_missing"
								);
							}
						} else {
						const clicked = await this.focusElement(createBtn, 'Yangi yozuv ochish uchun "Add/New" tugmasini bosamiz.', {
							click: true,
							duration_ms: 320,
							pre_click_pause_ms: 120,
						});
							if (!clicked) {
								const openedByFallback = await this.openNewDocFallback(doctype);
								this.traceTutorialEvent("create_record.entry_state.fallback", {
									reason: "create_button_click_failed",
									ok: Boolean(openedByFallback),
									state: this.getCreateRecordEntryState(doctype),
								});
								if (!openedByFallback) {
									return await finish(
										{ ok: false, message: "Yangi yozuv tugmasini xavfsiz bosib bo'lmadi." },
										"create_button_click_failed"
									);
								}
							} else {
							this.emitProgress("➕ `Add/New` bosildi, endi forma turini tekshiryapman.");
							const entryStateAfterClick = await this.waitForCreateRecordEntryState(doctype, 5200);
							this.traceTutorialEvent("create_record.entry_state.after_click", {
								state: entryStateAfterClick,
							});
							if (entryStateAfterClick !== "new_form" && entryStateAfterClick !== "quick_entry") {
								const openedByFallback = await this.openNewDocFallback(doctype);
								this.traceTutorialEvent("create_record.entry_state.fallback", {
									reason: "no_create_state_change",
									ok: Boolean(openedByFallback),
									state: this.getCreateRecordEntryState(doctype),
								});
								if (!openedByFallback) {
									return await finish(
										{
											ok: false,
											message: 'Yangi yozuv oqimi boshlanmadi: `Add/New` bosilgandan keyin forma ochilmadi.',
										},
										"create_state_not_reached"
									);
								}
							}
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
							return await finish(
								{ ok: false, message: '"Edit Full Form" tugmasini topa olmadim.' },
								"quick_entry_full_form_missing"
							);
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
						return await finish({
							ok: false,
							reached_target: false,
							message: "Quick Entry oynasidan to'liq formaga o'tib bo'lmadi. Iltimos qayta urinib ko'ring.",
						}, "full_form_open_failed");
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
						return await finish({
							ok: true,
							reached_target: true,
							message: 'Save/Submit tugmasini ko\'rsatdim. Xavfsizlik uchun uni avtomatik bosmadim.',
						}, "show_save_only_done");
					}

				this.emitProgress("🧠 AI mavjud maydonlarni tahlil qilib, aqlli to'ldirish rejasini tuzyapti.");
					const planResult = await this.requestAIFieldPlan(doctype, stage === "fill_more" ? "fill_more" : "open_and_fill_basic");
					this.traceTutorialEvent("plan.primary", {
						source: String(planResult?.source || "").trim(),
						count: Array.isArray(planResult?.plan) ? planResult.plan.length : 0,
					});
					if (Array.isArray(planResult.plan) && planResult.plan.length) {
					this.emitProgress(
						`🗺️ Reja tayyor: ${planResult.plan.length} ta qadam (${String(planResult.source || "ai")}). Endi amalda to'ldiraman.`
					);
				} else {
					this.emitProgress("⚠️ AI reja qaytarmadi, zaxira reja bilan davom etaman.");
				}
					const stageToRun = stage === "fill_more" ? "fill_more" : "open_and_fill_basic";
					let filled = 0;
					const filledLabels = [];
					const backgroundFilledLabels = [];
					const backgroundFilledEntries = [];
					let blockedLinkHints = [];
					const mergeFillStats = (result) => {
						const inc = Number(result?.filled || 0);
						if (inc > 0) filled += inc;
						for (const label of Array.isArray(result?.filledLabels) ? result.filledLabels : []) {
							if (label && !filledLabels.includes(label)) filledLabels.push(label);
						}
						for (const label of Array.isArray(result?.backgroundFilledLabels) ? result.backgroundFilledLabels : []) {
							if (label && !backgroundFilledLabels.includes(label)) backgroundFilledLabels.push(label);
						}
						for (const row of Array.isArray(result?.backgroundFilledEntries) ? result.backgroundFilledEntries : []) {
							const label = String(row?.label || "").trim();
							if (!label) continue;
							const exists = backgroundFilledEntries.some((x) => String(x?.label || "").trim() === label);
							if (!exists) {
								backgroundFilledEntries.push({
									label,
									value: String(row?.value === null || row?.value === undefined ? "" : row.value).trim(),
									reason: String(row?.reason || "").trim(),
								});
							}
						}
						const blocked = Array.isArray(result?.blockedLinkHints) ? result.blockedLinkHints : [];
						blockedLinkHints = [...new Set([...blockedLinkHints, ...blocked])];
					};

						const fillResult = await this.fillFormFields(doctype, stageToRun, planResult.plan);
						mergeFillStats(fillResult);
						this.traceTutorialEvent("fill.primary", {
							filled: Number(fillResult?.filled || 0),
							missing_required: Array.isArray(fillResult?.missingRequiredLabels) ? fillResult.missingRequiredLabels.length : 0,
							blocked_links: Array.isArray(fillResult?.blockedLinkHints) ? fillResult.blockedLinkHints.length : 0,
						});

					// For User onboarding, keep first run focused on User Details only.
					const shouldRunDeepPass =
						stageToRun !== "fill_more" &&
						this.running &&
						String(doctype || "").trim().toLowerCase() !== "user";
					if (shouldRunDeepPass) {
						this.emitProgress("🔍 Qo'shimcha batafsil pass: yana ko'proq mos maydonlarni to'ldirishga harakat qilaman.");
							const deepPlanResult = await this.requestAIFieldPlan(doctype, "fill_more");
							this.traceTutorialEvent("plan.deep", {
								source: String(deepPlanResult?.source || "").trim(),
								count: Array.isArray(deepPlanResult?.plan) ? deepPlanResult.plan.length : 0,
							});
						if (Array.isArray(deepPlanResult.plan) && deepPlanResult.plan.length) {
							this.emitProgress(
								`🧭 Batafsil reja: ${deepPlanResult.plan.length} ta qo'shimcha qadam (${String(
									deepPlanResult.source || "ai"
								)}).`
							);
						}
							const deepFillResult = await this.fillFormFields(doctype, "fill_more", deepPlanResult.plan);
							mergeFillStats(deepFillResult);
							this.traceTutorialEvent("fill.deep", {
								filled: Number(deepFillResult?.filled || 0),
								missing_required: Array.isArray(deepFillResult?.missingRequiredLabels)
									? deepFillResult.missingRequiredLabels.length
									: 0,
								blocked_links: Array.isArray(deepFillResult?.blockedLinkHints) ? deepFillResult.blockedLinkHints.length : 0,
							});
						}

						const requiredItemsTableResult = await this.fillRequiredItemsTableDemo();
						mergeFillStats(requiredItemsTableResult);
						this.traceTutorialEvent("fill.required_items", {
							filled: Number(requiredItemsTableResult?.filled || 0),
							blocked_links: Array.isArray(requiredItemsTableResult?.blockedLinkHints)
								? requiredItemsTableResult.blockedLinkHints.length
								: 0,
						});

						if (String(doctype || "").trim().toLowerCase() === "stock entry") {
						this.emitProgress("🧠 Stock Entry uchun qator maydonlarini ham aqlli to'ldiraman (Item, Qty, Warehouse).");
						const stockResult = await this.fillStockEntryLineDemo();
						const extraFilled = Number(stockResult?.filled || 0);
						if (extraFilled > 0) filled += extraFilled;
						const extraLabels = Array.isArray(stockResult?.filledLabels) ? stockResult.filledLabels : [];
						for (const label of extraLabels) {
							if (label && !filledLabels.includes(label)) filledLabels.push(label);
						}
						const extraBlocked = Array.isArray(stockResult?.blockedLinkHints) ? stockResult.blockedLinkHints : [];
							blockedLinkHints = [...new Set([...blockedLinkHints, ...extraBlocked])];
							this.traceTutorialEvent("fill.stock_entry_lines", {
								filled: extraFilled,
								blocked_links: extraBlocked.length,
							});
						}

					const missingRequiredLabels = this.collectMissingRequiredFields(doctype)
						.map((x) => String(x.label || x.fieldname || "").trim())
						.filter(Boolean);
					blockedLinkHints = [...new Set(blockedLinkHints)];
					const saveBtn = this.findSaveActionButton();
					if (saveBtn) {
						await this.focusElement(saveBtn, 'Saqlash joyini ham ko\'rsatdim (bosmayman).', {
							click: false,
							duration_ms: 220,
						});
					}
						if (backgroundFilledLabels.length) {
							this.emitProgress(
								`ℹ️ Qo'shimcha maydonlar tayyorlandi (${backgroundFilledLabels.length} ta). Xohlasangiz keyingi bosqichda birga ko'ramiz.`
							);
						}
							if (missingRequiredLabels.length) {
							this.emitProgress(
								`⚠️ Majburiy maydonlar hali to'lmadi: ${missingRequiredLabels.join(", ")}. Jarayon to'liq tugamadi.`
							);
							if (blockedLinkHints.length) {
								this.emitProgress(`🧩 Bog'liq master yozuvlar kerak: ${blockedLinkHints.join(", ")}.`);
							}
								const enableAutoCreateHint =
									blockedLinkHints.length && !this._allowDependencyCreation
										? " Agar xohlasangiz `ha, davom et` deb yozing - keyingi urinishda kerakli demo masterlarni yaratib davom etaman."
										: "";
									return await finish({
										ok: true,
										reached_target: true,
										message:
										filled > 0
												? `Asosiy amaliy qadamlar bajarildi, lekin dars tugamadi. Majburiy maydonlar qolgan: ${missingRequiredLabels.join(", ")}.${
														backgroundFilledLabels.length
															? ` Qo'shimcha tayyorlangan maydonlar: ${backgroundFilledLabels.length} ta.`
															: ""
													}${enableAutoCreateHint}`
											: `Forma ochildi, lekin majburiy maydonlar hali bo'sh: ${missingRequiredLabels.join(
													", "
													)}. Avval shu maydonlarni to'ldiramiz.${enableAutoCreateHint}`,
									}, "stopped_missing_required", {
										doctype,
										missing_required: missingRequiredLabels,
										blocked_links: blockedLinkHints,
										filled,
									});
								}
						this.emitProgress(
							filled > 0
								? "✅ Asosiy amaliy maydonlar to'ldirildi. Endi keyingi bosqichga o'tish mumkin."
								: "⚠️ To'ldirishga mos maydon topilmadi."
						);
							return await finish({
								ok: true,
								reached_target: true,
								message:
									filled > 0
										? `Asosiy amaliy maydonlar to'ldirildi.${
												backgroundFilledLabels.length
													? ` Qo'shimcha tayyorlangan maydonlar: ${backgroundFilledLabels.length} ta.`
													: ""
											} Keyingi bosqichni aytsangiz davom etaman.`
									: backgroundFilledLabels.length
											? `UIda tasdiqlangan to'ldirish bo'lmadi. Fon fallback bilan ${backgroundFilledLabels.length} ta maydon tayyorlandi, endi ularni birga tekshiramiz.`
											: "Forma ochildi, lekin avtomatik to'ldirishga mos maydon topilmadi. Qaysi maydondan boshlaymiz?",
							}, "tutorial_step_done", {
								doctype,
								filled,
								missing_required: missingRequiredLabels,
								blocked_links: blockedLinkHints,
							});
						}

			async runManageRolesTutorial(guide) {
				if (!this.isManageRolesTutorial(guide)) return { ok: true, reached_target: true, message: "" };
				const doctype = this.getTutorialDoctype(guide) || "User";
				const stage = String(guide?.tutorial?.stage || "open_roles_tab").trim().toLowerCase() || "open_roles_tab";
				this.startTutorialTrace({
					doctype,
					stage,
					route: String(guide?.route || "").trim(),
				});
				const finish = async (result, reason = "", extra = {}) => {
					return await this.finishTutorialTrace(result, reason, {
						doctype,
						stage,
						...extra,
					});
				};
				this.emitProgress(`🔐 **${doctype}** uchun role qo'shish bosqichini boshladim.`);
				const isRolesSectionVisible = () => {
					const root = document.querySelector(".frappe-control[data-fieldname='roles']");
					return Boolean(root && isVisible(root));
				};
				const findRolesTabButton = () => {
					const selectors = [
						".form-tabs .nav-link",
						".form-tabs button",
						".form-tabs a",
						".nav-tabs .nav-link",
						".page-form .nav-link",
					];
					for (const sel of selectors) {
						const nodes = document.querySelectorAll(sel);
						for (const node of nodes) {
							const el = getClickable(node) || node;
							if (!el || !isVisible(el)) continue;
							if (el.closest(".erpnext-ai-tutor-root")) continue;
							const text = normalizeText(el.textContent || el.getAttribute("data-label") || "");
							if (!text) continue;
							if (text.includes("roles") && (text.includes("permission") || text.includes("permissions"))) {
								return el;
							}
						}
					}
					return null;
				};
				let rolesTabActivated = false;
				let addRowClicked = false;
				let roleInputReady = false;

				if (guide?.route && !this.isAtRoute(guide.route)) {
					const opened = await this.navigate(guide.route);
					if (!opened) {
						return await finish({
							ok: false,
							reached_target: false,
							message: "User bo'limini ochib bo'lmadi. Ruxsat va menyuni tekshirib qayta urinib ko'ring.",
						}, "navigate_user_section_failed");
					}
				}

				if (!this.isOnDoctypeForm("User")) {
					const rowSelectors = [
						"a[href^='/app/user/']:not([href='/app/user']):not([href='/app/users'])",
						".list-row-container a[href*='/app/user/']",
						".result-list a[href*='/app/user/']",
					];
					let rowLink = null;
					for (const sel of rowSelectors) {
						const nodes = document.querySelectorAll(sel);
						for (const node of nodes) {
							const clickable = getClickable(node) || node;
							if (clickable && isVisible(clickable)) {
								rowLink = clickable;
								break;
							}
						}
						if (rowLink) break;
					}
					if (!rowLink) {
						return await finish({
							ok: true,
							reached_target: true,
							message: "User ro'yxatidan kerakli user kartasini oching, keyin yana `davom et` deb yozing.",
						}, "user_card_missing");
					}
					await this.focusElement(rowLink, "Kerakli user kartasini ochamiz.", {
						click: true,
						duration_ms: 320,
						pre_click_pause_ms: 120,
					});
					await this.waitFor(() => this.isOnDoctypeForm("User"), 4200, 120);
					if (!this.isOnDoctypeForm("User")) {
						return await finish({
							ok: false,
							reached_target: false,
							message: "User kartasini ochib bo'lmadi. Ro'yxatdan userni qo'lda ochib, yana `davom et` deb yozing.",
						}, "user_form_open_failed");
					}
				}
				const isNewUserForm =
					this.isOnDoctypeNewForm("User") ||
					Boolean(window.cur_frm && typeof window.cur_frm.is_new === "function" && window.cur_frm.is_new());
				if (isNewUserForm) {
					const saveBtn = this.findSaveActionButton();
					if (saveBtn) {
						await this.focusElement(
							saveBtn,
							"Role qo'shishdan oldin userni saqlash kerak, `Save` joyini ko'rsataman (bosmayman).",
							{
								click: false,
								duration_ms: 260,
							}
						);
					}
					return await finish(
						{
							ok: true,
							reached_target: true,
							message:
								"Bu **New User (Not Saved)** forma. ERPNext'da role qo'shish maydoni user saqlangandan keyin chiqadi. `Save` ni bosing, keyin `davom et` deb yozing.",
						},
						"roles_requires_saved_user",
						{
							save_button_visible: Boolean(saveBtn),
						}
					);
				}

				if (isRolesSectionVisible()) {
					rolesTabActivated = true;
					this.traceTutorialEvent("manage_roles.roles_tab", {
						found: true,
						clicked: false,
						already_visible: true,
					});
				} else {
					const openedByFieldTab = await this.ensureFieldTabVisible("roles", "Roles & Permissions");
					rolesTabActivated = Boolean(isRolesSectionVisible());
					this.traceTutorialEvent("manage_roles.roles_tab", {
						found: true,
						clicked: Boolean(openedByFieldTab),
						strategy: "ensure_field_tab_visible",
						visible_after: rolesTabActivated,
					});
					if (!rolesTabActivated) {
						const rolesTabBtn = findRolesTabButton();
						if (rolesTabBtn) {
							const clicked = await this.focusElement(rolesTabBtn, "`Roles & Permissions` bo'limiga o'tamiz.", {
								click: true,
								duration_ms: 300,
								pre_click_pause_ms: 120,
							});
							await this.sleep(160);
							rolesTabActivated = Boolean(clicked) && isRolesSectionVisible();
							this.traceTutorialEvent("manage_roles.roles_tab_fallback", {
								found: true,
								clicked: Boolean(clicked),
								visible_after: rolesTabActivated,
							});
						} else {
							this.traceTutorialEvent("manage_roles.roles_tab_fallback", {
								found: false,
								clicked: false,
							});
						}
					}
				}

				const rolesRoot = await this.waitFor(
					() => {
						const root = document.querySelector(".frappe-control[data-fieldname='roles']");
						if (!root || !isVisible(root)) return null;
						return root;
					},
					2600,
					120
				);
				if (!rolesRoot) {
					return await finish({
						ok: false,
						reached_target: false,
						message: "`Roles & Permissions` bo'limini ochib bo'lmadi. Shu tabni qo'lda ochib, yana `davom et` deb yozing.",
					}, "roles_table_missing");
				}
				rolesTabActivated = rolesTabActivated || isRolesSectionVisible();

				const addRowBtn =
					rolesRoot.querySelector(".grid-add-row") ||
					rolesRoot.querySelector(".btn[data-label*='Add Row']") ||
					rolesRoot.querySelector("button[data-label*='Add Row']");
				if (addRowBtn && isVisible(addRowBtn)) {
					const clicked = await this.focusElement(addRowBtn, "`Add Row` ni bosib yangi role qatori ochamiz.", {
						click: true,
						duration_ms: 300,
						pre_click_pause_ms: 120,
					});
					addRowClicked = Boolean(clicked);
					this.traceTutorialEvent("manage_roles.add_row", {
						found: true,
						clicked: Boolean(clicked),
					});
					await this.sleep(180);
				} else {
					this.traceTutorialEvent("manage_roles.add_row", {
						found: false,
						clicked: false,
					});
				}
				if (!addRowClicked) {
					return await finish({
						ok: false,
						reached_target: false,
						message: "`Add Row` tugmasini topib bosolmadim. Roles jadvalini ochiq holatga keltirib, yana `davom et` deb yozing.",
					}, "roles_add_row_missing", {
						roles_tab_activated: rolesTabActivated,
					});
				}

				const roleInput = await this.waitFor(
					() =>
						rolesRoot.querySelector(".grid-row[data-idx] [data-fieldname='role'] input:not([type='hidden'])") ||
						rolesRoot.querySelector(".grid-row-open [data-fieldname='role'] input:not([type='hidden'])"),
					2200,
					120
				);
				if (roleInput) {
					await this.focusElement(roleInput, "Endi shu yerga kerakli roleni tanlaymiz (masalan: System Manager).", {
						click: false,
						duration_ms: 260,
					});
					roleInputReady = true;
				}
				this.traceTutorialEvent("manage_roles.role_input", {
					ready: Boolean(roleInputReady),
				});
				if (!roleInputReady) {
					return await finish({
						ok: false,
						reached_target: false,
						message: "Role tanlash maydoni ochilmadi. `Add Row` ni qo'lda bir marta bosib, yana `davom et` deb yozing.",
					}, "roles_input_missing", {
						roles_tab_activated: rolesTabActivated,
						add_row_clicked: addRowClicked,
					});
				}

				return await finish({
					ok: true,
					reached_target: true,
					message: "Role qo'shish qatorini ochdim. Endi role qiymatini tanlang, `Save` ni esa o'zingiz bosing.",
				}, "manage_roles_done");
			}
