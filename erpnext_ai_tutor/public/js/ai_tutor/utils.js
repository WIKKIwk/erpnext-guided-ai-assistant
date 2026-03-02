/* global frappe */

(function () {
	"use strict";

	const METHOD_GET_CONFIG = "erpnext_ai_tutor.api.get_tutor_config";
	const METHOD_CHAT = "erpnext_ai_tutor.api.chat";

	const STORAGE_VERSION = 1;
	const STORAGE_KEY_PREFIX = "erpnext_ai_tutor:";
	const MAX_CONVERSATIONS = 20;
	const MAX_MESSAGES_PER_CONVERSATION = 200;
	const AUTO_HELP_COOLDOWN_MS = 45 * 1000;
	const AUTO_HELP_RATE_WINDOW_MS = 60 * 1000;
	const AUTO_HELP_RATE_MAX = 3;
	const AUTO_HELP_FAILURE_COOLDOWN_MS = 2 * 60 * 1000;
	const AUTO_HELP_PREFIX_UZ = "ERP tizimida xatolik/ogohlantirish chiqdi.";
	const AUTO_HELP_PREFIX_EN = "ERP system reported an error or warning.";

	const SENSITIVE_KEY_PARTS = [
		"password",
		"passwd",
		"pwd",
		"token",
		"secret",
		"api_key",
		"apikey",
		"authorization",
		"auth",
		"private_key",
		"signature",
	];

	function isDesk() {
		return typeof frappe !== "undefined" && frappe.session && frappe.get_route;
	}

	function redactKey(key) {
		const lower = String(key || "").toLowerCase();
		return SENSITIVE_KEY_PARTS.some((p) => lower.includes(p));
	}

	function sanitize(value, depth = 0, maxDepth = 6) {
		if (depth > maxDepth) return "[truncated]";
		if (Array.isArray(value)) return value.slice(0, 200).map((v) => sanitize(v, depth + 1, maxDepth));
		if (value && typeof value === "object") {
			const out = {};
			for (const [k, v] of Object.entries(value)) {
				out[k] = redactKey(k) ? "[redacted]" : sanitize(v, depth + 1, maxDepth);
			}
			return out;
		}
		if (typeof value === "string" && value.length > 4000) return value.slice(0, 4000) + "…";
		return value;
	}

	function stripHtml(html) {
		try {
			const div = document.createElement("div");
			div.innerHTML = String(html || "");
			return (div.textContent || div.innerText || "").trim();
		} catch {
			return String(html || "").trim();
		}
	}

	function guessSeverity(indicator) {
		const s = String(indicator || "").toLowerCase().trim();
		if (!s) return null;
		if (s === "red") return "error";
		if (s === "orange" || s === "yellow") return "warning";
		return null;
	}

	function nowTime() {
		try {
			return new Date().toLocaleTimeString();
		} catch {
			return "";
		}
	}

	function formatTime(ts) {
		try {
			return new Date(ts).toLocaleTimeString();
		} catch {
			return nowTime();
		}
	}

	function makeId(prefix = "chat") {
		const rand = Math.random().toString(16).slice(2, 10);
		return `${prefix}_${Date.now().toString(16)}_${rand}`;
	}

	function clip(text, max = 60) {
		const s = String(text ?? "").replace(/\s+/g, " ").trim();
		if (!s) return "";
		if (s.length <= max) return s;
		return s.slice(0, max - 1) + "…";
	}

	function getPageHeading() {
		const selectors = [
			".page-title .title-text",
			".page-head .title-text",
			".page-title h1",
			".page-head h1",
			".page-head h3",
			".page-title",
		];
		for (const sel of selectors) {
			const el = document.querySelector(sel);
			if (!el) continue;
			const text = (el.textContent || "").replace(/\s+/g, " ").trim();
			if (!text) continue;
			if (text.length > 140) continue;
			return text;
		}
		return "";
	}

	function normalizeLangCode(lang) {
		const raw = String(lang || "").trim();
		if (!raw) return "";
		return raw.replace("_", "-").split("-", 1)[0].toLowerCase();
	}

	function toSlug(value) {
		return String(value || "")
			.trim()
			.toLowerCase()
			.replace(/[_\s]+/g, "-")
			.replace(/[^a-z0-9-]/g, "")
			.replace(/-+/g, "-")
			.replace(/^-|-$/g, "");
	}

	function getLocationRouteInfo() {
		const pathname = String(window.location.pathname || "");
		const search = String(window.location.search || "");
		const hash = String(window.location.hash || "");
		const appPrefix = "/app";
		const appPath = pathname.startsWith(appPrefix) ? pathname.slice(appPrefix.length) : "";
		const parts = appPath
			.split("/")
			.map((p) => {
				try {
					return decodeURIComponent(String(p || "").trim());
				} catch {
					return String(p || "").trim();
				}
			})
			.filter(Boolean);
		const route_str = parts.join("/");
		return {
			pathname,
			search,
			hash,
			route: parts,
			route_str,
			route_key: `${pathname}${search}${hash}`,
			is_desk: pathname.startsWith("/app"),
		};
	}

	function getCanonicalRouteKey() {
		return getLocationRouteInfo().route_key;
	}

	function safeTranslate(text) {
		const source = String(text || "").trim();
		if (!source) return "";
		try {
			if (typeof __ === "function") {
				const translated = __(source);
				return String(translated || source).trim();
			}
		} catch {
			// ignore
		}
		return source;
	}

	function getCommonUiLabels() {
		const keys = [
			"Save",
			"Submit",
			"Add",
			"Update",
			"Delete",
			"Cancel",
			"Close",
			"Edit",
			"Yes",
			"No",
			"Search",
			"Filter",
			"Refresh",
			"Settings",
		];
		const out = {};
		for (const key of keys) {
			const translated = safeTranslate(key);
			if (!translated) continue;
			if (translated !== key) out[key] = translated;
		}
		return out;
	}

	function getPageActionUi() {
		try {
			const currentPage =
				(frappe && frappe.container && frappe.container.page) ||
				(window.cur_page && window.cur_page.page) ||
				null;
			const actionsRoot =
				(currentPage && currentPage.querySelector && currentPage.querySelector(".page-actions")) ||
				document.querySelector(".page-head .page-actions") ||
				document.querySelector(".page-actions") ||
				null;
			if (!actionsRoot) return null;

			const cleanText = (value) => String(value || "").replace(/\s+/g, " ").trim();
			const getLabel = (el) => {
				if (!el || typeof el.getAttribute !== "function") return "";
				const attr =
					el.getAttribute("data-label") ||
					el.getAttribute("aria-label") ||
					el.getAttribute("title") ||
					"";
				return cleanText(attr) || cleanText(el.textContent);
			};

			const primaryEl =
				actionsRoot.querySelector(".primary-action") ||
				actionsRoot.querySelector("button.btn-primary, a.btn.btn-primary") ||
				actionsRoot.querySelector("[data-label]") ||
				null;
			const primary = primaryEl ? getLabel(primaryEl) : "";

			const labels = [];
			const seen = new Set();
			const candidates = actionsRoot.querySelectorAll("button, a.btn");
			for (const el of candidates) {
				const text = getLabel(el);
				if (!text) continue;
				if (text.length > 48) continue;
				if (seen.has(text)) continue;
				seen.add(text);
				labels.push(text);
				if (labels.length >= 12) break;
			}

			// Remove the primary label from the list if it was captured.
			const actions = labels.filter((label) => label && label !== primary);

			if (!primary && !actions.length) return null;
			return {
				primary_action: primary || "",
				actions,
			};
		} catch {
			return null;
		}
	}

	function getUiSnapshot() {
		if (!isDesk()) return null;
		const lang = normalizeLangCode(frappe?.boot?.lang || frappe?.boot?.user?.language || "");
		const labels = getCommonUiLabels();
		const page_actions = getPageActionUi();
		if (!lang && !Object.keys(labels).length && !page_actions) return null;
		return {
			language: lang || "",
			labels,
			page_actions,
		};
	}

	function getFormContext(includeDocValues) {
		const frm = window.cur_frm;
		if (!frm || !frm.doctype) return null;
		const loc = getLocationRouteInfo();
		if (!loc.is_desk) return null;
		const route = typeof frappe.get_route === "function" ? frappe.get_route() : [];
		const routeHead = String(route?.[0] || "").toLowerCase();
		if (routeHead !== "form") return null;
		const routeDoctype = String(route?.[1] || "").trim();
		const routeDocname = String(route?.[2] || "").trim();
		const frmDoctype = String(frm.doctype || "").trim();
		const frmDocname = String(frm.docname || "").trim();
		if (routeDoctype && frmDoctype && routeDoctype !== frmDoctype) return null;
		if (routeDocname && frmDocname && routeDocname !== frmDocname) return null;
		const routeDoctypeSlug = toSlug(routeDoctype || frmDoctype);
		const locFirstSlug = toSlug(loc.route?.[0] || "");
		if (routeDoctypeSlug && locFirstSlug && routeDoctypeSlug !== locFirstSlug) return null;

		const ctx = {
			doctype: frm.doctype,
			docname: frm.docname,
			is_new: Boolean(frm.is_new && frm.is_new()),
			is_dirty: Boolean(frm.is_dirty && frm.is_dirty()),
		};

		try {
			const meta = frappe.get_meta(frm.doctype);
			const requiredMissing = [];
			if (meta && Array.isArray(meta.fields)) {
				for (const df of meta.fields) {
					if (!df || !df.reqd || !df.fieldname) continue;
					const val = frm.doc ? frm.doc[df.fieldname] : null;
					const empty =
						val === null ||
						val === undefined ||
						val === "" ||
						(Array.isArray(val) && val.length === 0);
					if (empty) requiredMissing.push({ fieldname: df.fieldname, label: df.label || df.fieldname });
				}
			}
			if (requiredMissing.length) ctx.missing_required = requiredMissing.slice(0, 30);
		} catch {
			// ignore
		}

		if (includeDocValues && frm.doc) {
			ctx.doc = sanitize(frm.doc);
		}
		return ctx;
	}

	function getContextSnapshot(config, lastEvent) {
		const includeDocValues = Boolean(config?.include_doc_values);
		const page_heading = getPageHeading();
		const loc = getLocationRouteInfo();
		let route = typeof frappe.get_route === "function" ? frappe.get_route() : [];
		let route_str = typeof frappe.get_route_str === "function" ? frappe.get_route_str() : "";
		const locRouteStr = String(loc.route_str || "");
		const currentPath = String(loc.pathname || "");

		const routeHead = String(route?.[0] || "").toLowerCase();
		const routeDoctypeSlug = toSlug(route?.[1] || "");
		const locFirstSlug = toSlug(loc.route?.[0] || "");
		const looksStaleFormRoute =
			routeHead === "form" && Boolean(currentPath.startsWith("/app")) && Boolean(locFirstSlug) && Boolean(routeDoctypeSlug) && routeDoctypeSlug !== locFirstSlug;
		if (looksStaleFormRoute) {
			route = Array.isArray(loc.route) ? loc.route : [];
			route_str = locRouteStr;
		}
		if (!String(route_str || "").trim() && locRouteStr) {
			route_str = locRouteStr;
		}

		const snapshot = {
			route,
			route_str: route_str || "",
			page_title: document.title || "",
			page_heading: page_heading || "",
			hash: loc.hash || "",
			pathname: loc.pathname || "",
			search: loc.search || "",
			url: window.location.href,
			user: frappe.session && frappe.session.user,
			event: lastEvent || null,
		};
		const ui = getUiSnapshot();
		if (ui) snapshot.ui = ui;
		if (config?.include_form_context) {
			snapshot.form = getFormContext(includeDocValues);
		}
		return sanitize(snapshot);
	}

	function getStorageKey() {
		const user = frappe?.session?.user || "Guest";
		return `${STORAGE_KEY_PREFIX}${window.location.host}:${user}:v${STORAGE_VERSION}`;
	}

	const ns = (window.ERPNextAITutor = window.ERPNextAITutor || {});
	ns.utils = {
		METHOD_GET_CONFIG,
		METHOD_CHAT,
		STORAGE_VERSION,
		STORAGE_KEY_PREFIX,
		MAX_CONVERSATIONS,
		MAX_MESSAGES_PER_CONVERSATION,
		AUTO_HELP_COOLDOWN_MS,
		AUTO_HELP_RATE_WINDOW_MS,
		AUTO_HELP_RATE_MAX,
		AUTO_HELP_FAILURE_COOLDOWN_MS,
		AUTO_HELP_PREFIX_UZ,
		AUTO_HELP_PREFIX_EN,
		SENSITIVE_KEY_PARTS,
		isDesk,
		redactKey,
		sanitize,
		stripHtml,
		guessSeverity,
		nowTime,
		formatTime,
		makeId,
		clip,
		normalizeLangCode,
		safeTranslate,
		getCommonUiLabels,
		getPageActionUi,
		getUiSnapshot,
		getLocationRouteInfo,
		getCanonicalRouteKey,
		getFormContext,
		getContextSnapshot,
		getStorageKey,
	};
})();
