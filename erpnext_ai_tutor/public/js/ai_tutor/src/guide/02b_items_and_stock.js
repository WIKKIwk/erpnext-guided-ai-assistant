				async fillRequiredItemsTableDemo() {
					const frm = window.cur_frm;
					this.traceTutorialEvent("fill_required_items.start", {
						doctype: String(frm?.doctype || "").trim(),
					});
					if (!frm) return { filled: 0, filledLabels: [], blockedLinkHints: [] };

					const metaFields = Array.isArray(frm.meta?.fields) ? frm.meta.fields : [];
					const itemsDf = metaFields.find((df) => String(df?.fieldname || "").trim() === "items");
					if (!itemsDf || Boolean(itemsDf.read_only) || Boolean(itemsDf.hidden)) {
						return { filled: 0, filledLabels: [], blockedLinkHints: [] };
					}

					const grid = frm.fields_dict?.items?.grid;
					if (!grid) return { filled: 0, filledLabels: [], blockedLinkHints: [] };
					const childDoctype = String(itemsDf?.options || grid?.df?.options || "").trim();
					let childFields = Array.isArray(grid.docfields) ? grid.docfields : [];
					if (!childFields.length && childDoctype && typeof frappe?.get_meta === "function") {
						try {
							const childMeta = frappe.get_meta(childDoctype);
							childFields = Array.isArray(childMeta?.fields) ? childMeta.fields : [];
						} catch {
							// ignore
						}
					}
					let requiredChildFields = childFields.filter((df) => {
						if (!df || !df.fieldname) return false;
						if (!Boolean(df.reqd) || Boolean(df.read_only) || Boolean(df.hidden)) return false;
						return !this.isStructFieldType(df.fieldtype);
					});
					if (!requiredChildFields.length) {
						const fieldIndex = new Set(
							(Array.isArray(childFields) ? childFields : [])
								.map((df) => String(df?.fieldname || "").trim())
								.filter(Boolean)
						);
						const fallbackFields = [
							{ fieldname: "item_code", label: "Item Code", fieldtype: "Link", options: "Item", reqd: 1 },
							{ fieldname: "qty", label: "Qty", fieldtype: "Float", options: "", reqd: 1 },
							{ fieldname: "uom", label: "UOM", fieldtype: "Link", options: "UOM", reqd: 1 },
						].filter((df) => !fieldIndex.size || fieldIndex.has(String(df.fieldname || "").trim()));
						requiredChildFields = fallbackFields;
						this.traceTutorialEvent("fill_required_items.meta_fallback", {
							child_doctype: childDoctype,
							fallback_fields: fallbackFields.map((x) => x.fieldname),
						});
					}
					if (!requiredChildFields.length) {
						this.traceTutorialEvent("fill_required_items.skip_no_required_fields", {
							child_doctype: childDoctype,
						});
						return { filled: 0, filledLabels: [], blockedLinkHints: [] };
					}

					const blockedLinkHints = [];
					const filledLabels = [];
					let filled = 0;

					let row = Array.isArray(frm.doc?.items) ? frm.doc.items[0] : null;
					if (!row) {
						row = frm.add_child("items");
						frm.refresh_field("items");
						await this.sleep(120);
					}
					if (!row) return { filled, filledLabels, blockedLinkHints };

						for (const df of requiredChildFields) {
						if (!this.running) break;
						const fieldtype = String(df.fieldtype || "").trim();

						const fieldname = String(df.fieldname || "").trim();
						if (!fieldname) continue;
						const currentVal = row[fieldname];
						if (this.isFieldValueFilled(df, currentVal)) continue;

						const label = String(df.label || fieldname).trim();
						const valueToType = await this.resolvePlanValue(df, this.defaultDemoValueForField(df), {
							allowCreateLink: Boolean(this._allowDependencyCreation),
						});
						if (!this.isFieldValueFilled(df, valueToType)) {
							const linkDoctype = String(df?.options || "").trim();
							if (fieldtype === "Link" && linkDoctype) {
								blockedLinkHints.push(`**${label}** (Link: ${linkDoctype})`);
							}
							continue;
						}

						const ok = await this.setStockRowValue(row, fieldname, valueToType, label);
						if (ok) {
							filled += 1;
							if (!filledLabels.includes(label)) filledLabels.push(label);
						} else {
							const linkDoctype = String(df?.options || "").trim();
							if (fieldtype === "Link" && linkDoctype) {
								blockedLinkHints.push(`**${label}** (Link: ${linkDoctype})`);
							}
						}
						}

						// Hard fallback for BOM-like child rows:
						// if dynamic metadata pass still leaves core fields empty, force-fill minimum viable row.
						const rowHasField = (fieldname) =>
							Boolean(row) && Object.prototype.hasOwnProperty.call(row, String(fieldname || "").trim());
						if (this.running && rowHasField("item_code") && !String(row.item_code || "").trim()) {
							const fallbackItemCode = await this.fetchLinkDemoValue("Item", "", {
								create_if_missing: Boolean(this._allowDependencyCreation),
								report_created: Boolean(this._allowDependencyCreation),
							});
							if (fallbackItemCode) {
								const ok = await this.setStockRowValue(row, "item_code", fallbackItemCode, "Item Code");
								if (ok) {
									filled += 1;
									if (!filledLabels.includes("Item Code")) filledLabels.push("Item Code");
								}
							} else {
								blockedLinkHints.push("**Item Code** (Link: Item)");
							}
						}
						if (this.running && rowHasField("qty") && !(Number(row.qty || 0) > 0)) {
							const ok = await this.setStockRowValue(row, "qty", 1, "Qty");
							if (ok) {
								filled += 1;
								if (!filledLabels.includes("Qty")) filledLabels.push("Qty");
							}
						}
						if (this.running && rowHasField("uom") && !String(row.uom || "").trim()) {
							const fallbackUomHint = String(row.stock_uom || row.item_uom || "Nos").trim();
							const fallbackUom = (await this.fetchLinkDemoValue("UOM", fallbackUomHint, {
								create_if_missing: Boolean(this._allowDependencyCreation),
								report_created: Boolean(this._allowDependencyCreation),
							})) || "Nos";
							const ok = await this.setStockRowValue(row, "uom", fallbackUom, "UOM");
							if (ok) {
								filled += 1;
								if (!filledLabels.includes("UOM")) filledLabels.push("UOM");
							}
						}

						frm.refresh_field("items");
					await this.sleep(120);
					const result = {
						filled,
						filledLabels,
						blockedLinkHints: [...new Set(blockedLinkHints)],
					};
					this.traceTutorialEvent("fill_required_items.end", {
						filled: Number(result.filled || 0),
						blocked_links: Array.isArray(result.blockedLinkHints) ? result.blockedLinkHints.length : 0,
					});
					return result;
				}

				detectStockEntryPurpose() {
					const raw = String(this.readFieldValue("stock_entry_type") || this.readFieldValue("purpose") || "")
						.trim()
						.toLowerCase();
					if (!raw) return "";
					if (raw.includes("receipt")) return "receipt";
					if (raw.includes("issue")) return "issue";
					if (raw.includes("transfer")) return "transfer";
					return "";
				}

				async fetchWarehouseCandidates() {
					try {
						const res = await frappe.call("frappe.client.get_list", {
							doctype: "Warehouse",
							fields: ["name"],
							filters: { disabled: 0 },
							limit_page_length: 6,
							order_by: "modified desc",
						});
						const rows = Array.isArray(res?.message) ? res.message : [];
						return rows.map((x) => String(x?.name || "").trim()).filter(Boolean);
					} catch {
						return [];
					}
				}

				async getItemsGridInput(row, fieldname) {
					const frm = window.cur_frm;
					if (!frm || !row || !fieldname) return null;
					const grid = frm.fields_dict?.items?.grid;
					if (!grid) return null;
					try {
						grid.refresh?.();
					} catch {
						// ignore
					}
					await this.sleep(90);

					const rowName = String(row.name || "").trim();
					if (!rowName) return null;
					let gridRow = grid.grid_rows_by_docname?.[rowName] || null;
					if (!gridRow && Array.isArray(grid.grid_rows)) {
						gridRow = grid.grid_rows.find((gr) => String(gr?.doc?.name || "").trim() === rowName) || null;
					}
					if (gridRow?.activate) {
						gridRow.activate();
						await this.sleep(90);
					}

					const field = gridRow?.on_grid_fields_dict?.[fieldname] || gridRow?.columns?.[fieldname]?.field;
					const jqInput = field?.$input;
					let input = null;
					if (jqInput && typeof jqInput.get === "function") input = jqInput.get(0);
					else if (jqInput?.[0]) input = jqInput[0];
					if (input && !input.disabled && !input.readOnly && isVisible(input)) return input;

					const rowEl = document.querySelector(`.grid-row[data-name='${rowName}']`);
					if (!rowEl) return null;
					const selectors = [
						`[data-fieldname='${fieldname}'] input:not([type='hidden'])`,
						`[data-fieldname='${fieldname}'] textarea`,
						`[data-fieldname='${fieldname}'] select`,
					];
					for (const sel of selectors) {
						const candidate = rowEl.querySelector(sel);
						if (!candidate) continue;
						if (candidate.disabled || candidate.readOnly) continue;
						if (!isVisible(candidate)) continue;
						return candidate;
					}
					return null;
				}

				async setStockRowValue(row, fieldname, value, label) {
					if (!row || !fieldname) return false;
					const stringValue = String(value ?? "");
					try {
						const input = await this.getItemsGridInput(row, fieldname);
						if (input) {
							const focused = await this.focusElement(input, `**${label || fieldname}** qatorini to'ldiramiz.`, {
								click: true,
								duration_ms: 250,
								pre_click_pause_ms: 110,
							});
							if (focused) {
								await this.typeIntoInput(input, stringValue, {
									char_delay_ms: 60,
									after_type_pause_ms: 100,
								});
								input.blur?.();
								await this.sleep(160);
							}
						}
						let after = String(row[fieldname] ?? "").trim();
						let ok = fieldname === "qty" ? Number(row[fieldname] || 0) > 0 : Boolean(after);
						if (!ok) {
							await frappe.model.set_value(row.doctype, row.name, fieldname, value);
							await this.sleep(140);
							after = String(row[fieldname] ?? "").trim();
							ok = fieldname === "qty" ? Number(row[fieldname] || 0) > 0 : Boolean(after);
						}
						if (ok && label) this.emitProgress(`✅ **${label}** qatori \`${String(value || "")}\` bilan to'ldirildi.`);
						return ok;
					} catch {
						return false;
					}
				}

				async fillStockEntryLineDemo() {
					const frm = window.cur_frm;
					if (!frm || String(frm.doctype || "").trim().toLowerCase() !== "stock entry") {
						return { filled: 0, filledLabels: [], blockedLinkHints: [] };
					}

					const filledLabels = [];
					const blockedLinkHints = [];
					let filled = 0;

					const currentType = String(this.readFieldValue("stock_entry_type") || "").trim();
					const safeType = await this.resolveSafeStockEntryType(currentType);
					if (safeType && currentType !== safeType) {
						if (await this.setDocFieldValue("stock_entry_type", safeType, "Stock Entry Type")) {
							filled += 1;
							filledLabels.push("Stock Entry Type");
						}
					}

					const purpose = this.detectStockEntryPurpose();
					const whCandidates = await this.fetchWarehouseCandidates();
					let sourceWh = String(this.readFieldValue("from_warehouse") || "").trim();
					let targetWh = String(this.readFieldValue("to_warehouse") || "").trim();
					if (!sourceWh) sourceWh = whCandidates[0] || "";
					if (!targetWh) targetWh = whCandidates.find((x) => x && x !== sourceWh) || whCandidates[0] || "";

					if ((purpose === "issue" || purpose === "transfer") && sourceWh && !String(this.readFieldValue("from_warehouse") || "").trim()) {
						if (await this.setDocFieldValue("from_warehouse", sourceWh, "Default Source Warehouse")) {
							filled += 1;
							filledLabels.push("Default Source Warehouse");
						}
					}
					if ((purpose === "receipt" || purpose === "transfer") && targetWh && !String(this.readFieldValue("to_warehouse") || "").trim()) {
						if (await this.setDocFieldValue("to_warehouse", targetWh, "Default Target Warehouse")) {
							filled += 1;
							filledLabels.push("Default Target Warehouse");
						}
					}

					const itemCode = await this.fetchLinkDemoValue("Item", "", {
						create_if_missing: Boolean(this._allowDependencyCreation),
						report_created: Boolean(this._allowDependencyCreation),
					});
					if (!itemCode) {
						blockedLinkHints.push("**Item Code** (Link: Item)");
						return { filled, filledLabels, blockedLinkHints };
					}

					let row = Array.isArray(frm.doc?.items) ? frm.doc.items[0] : null;
					if (!row) {
						row = frm.add_child("items");
						frm.refresh_field("items");
						await this.sleep(120);
					}
					if (!row) return { filled, filledLabels, blockedLinkHints };

					if (!String(row.item_code || "").trim()) {
						if (await this.setStockRowValue(row, "item_code", itemCode, "Item Code")) {
							filled += 1;
							filledLabels.push("Item Code");
						}
					}
					const qtyRaw = Number(row.qty || 0);
					if (!(qtyRaw > 0)) {
						if (await this.setStockRowValue(row, "qty", 1, "Qty")) {
							filled += 1;
							filledLabels.push("Qty");
						}
					}

					if (purpose === "receipt" || purpose === "transfer") {
						const rowTarget = String(row.t_warehouse || "").trim();
						const target = String(this.readFieldValue("to_warehouse") || targetWh || "").trim();
						if (!rowTarget && target) {
							if (await this.setStockRowValue(row, "t_warehouse", target, "Target Warehouse")) {
								filled += 1;
								filledLabels.push("Target Warehouse");
							}
						}
					}
					if (purpose === "issue" || purpose === "transfer") {
						const rowSource = String(row.s_warehouse || "").trim();
						const source = String(this.readFieldValue("from_warehouse") || sourceWh || "").trim();
						if (!rowSource && source) {
							if (await this.setStockRowValue(row, "s_warehouse", source, "Source Warehouse")) {
								filled += 1;
								filledLabels.push("Source Warehouse");
							}
						}
					}

					frm.refresh_field("items");
					await this.sleep(120);
					return {
						filled,
						filledLabels,
						blockedLinkHints: [...new Set(blockedLinkHints)],
					};
				}
