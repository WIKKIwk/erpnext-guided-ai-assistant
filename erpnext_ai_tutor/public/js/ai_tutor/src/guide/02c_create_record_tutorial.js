			async runCreateRecordTutorial(guide) {
				if (!this.isCreateTutorial(guide)) return { ok: true, reached_target: true, message: "" };
				const doctype = this.getTutorialDoctype(guide);
				this._tutorialStockEntryTypePreference =
					String(doctype || "").trim().toLowerCase() === "stock entry"
						? this.normalizeStockEntryTypePreference(guide?.tutorial?.stock_entry_type_preference)
						: "";
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
					const stageToRun = stage === "fill_more" ? "fill_more" : "open_and_fill_basic";
					let filled = 0;
					const filledLabels = [];
					const backgroundFilledLabels = [];
					const backgroundFilledEntries = [];
					let blockedLinkHints = [];
					const describeBackgroundEntries = (entries) => {
						const rows = [];
						for (const row of Array.isArray(entries) ? entries : []) {
							const label = String(row?.label || "").trim();
							if (!label) continue;
							const value = String(row?.value === null || row?.value === undefined ? "" : row.value).trim();
							if (value) {
								rows.push(`${label}=\`${value}\``);
							} else {
								rows.push(label);
							}
						}
						if (!rows.length) return "";
						return rows.slice(0, 8).join(", ");
					};
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

					// Always do one deeper pass so tutor fills more than a single field when possible.
					if (stageToRun !== "fill_more" && this.running) {
						this.emitProgress("🔍 Qo'shimcha batafsil pass: yana ko'proq mos maydonlarni to'ldirishga harakat qilaman.");
						const deepPlanResult = await this.requestAIFieldPlan(doctype, "fill_more");
						if (Array.isArray(deepPlanResult.plan) && deepPlanResult.plan.length) {
							this.emitProgress(
								`🧭 Batafsil reja: ${deepPlanResult.plan.length} ta qo'shimcha qadam (${String(
									deepPlanResult.source || "ai"
								)}).`
							);
						}
						const deepFillResult = await this.fillFormFields(doctype, "fill_more", deepPlanResult.plan);
						mergeFillStats(deepFillResult);
					}

					const requiredItemsTableResult = await this.fillRequiredItemsTableDemo();
					mergeFillStats(requiredItemsTableResult);

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
							const details = describeBackgroundEntries(backgroundFilledEntries);
							this.emitProgress(
								details
									? `ℹ️ Keyingi amaliy bosqichda birga tasdiqlanadigan maydonlar: ${details}.`
									: `ℹ️ Keyingi amaliy bosqichda birga tasdiqlanadigan maydonlar: ${backgroundFilledLabels.join(", ")}.`
							);
						}
					if (missingRequiredLabels.length) {
						const details = describeBackgroundEntries(backgroundFilledEntries);
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
											? `UI tasdiqlagan ${filled} ta maydon to'ldirildi (${filledLabels.join(
													", "
												)}), lekin dars tugamadi. Majburiy maydonlar qolgan: ${missingRequiredLabels.join(", ")}.${
													backgroundFilledLabels.length
														? ` Keyingi amaliy bosqichda tasdiqlanadigan maydonlar: ${details || backgroundFilledLabels.join(", ")}.`
														: ""
												}`
										: `Forma ochildi, lekin majburiy maydonlar hali bo'sh: ${missingRequiredLabels.join(
												", "
											)}. Avval shu maydonlarni to'ldiramiz.`,
							};
						}
						this.emitProgress(
							filled > 0
								? `🎯 UI tasdiqlagan maydonlar: ${filledLabels.join(", ")}. Endi keyingi bosqichga o'tish mumkin.`
								: "⚠️ To'ldirishga mos maydon topilmadi."
						);
						return {
							ok: true,
							reached_target: true,
							message:
									filled > 0
										? `UI tasdiqlagan ${filled} ta maydonni demo tarzda to'ldirdim: ${filledLabels.join(", ")}.${
												backgroundFilledLabels.length
													? ` Endi navbatdagi amaliy maydonlar: ${describeBackgroundEntries(backgroundFilledEntries) || backgroundFilledLabels.join(", ")}.`
													: ""
											} Keyingi bosqichni aytsangiz davom etaman.`
									: backgroundFilledLabels.length
										? `UIda tasdiqlangan to'ldirish bo'lmadi. Fon fallback bilan qiymat berilgan maydonlar: ${describeBackgroundEntries(backgroundFilledEntries) || backgroundFilledLabels.join(", ")}. Endi ularni birga tekshiramiz.`
										: "Forma ochildi, lekin avtomatik to'ldirishga mos maydon topilmadi. Qaysi maydondan boshlaymiz?",
						};
					}

