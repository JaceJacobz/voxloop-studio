/**
 * Voxloop Studio: navigation and small UI helpers
 *
 *  Phone    a menu button (three lines) opens a drawer with every place in the app: Beat Lab, Studio, Pipeline, Drafts, Settings,
 *           plus the Simple / Pro switch. The top bar then only shows the menu button, the screen you are on and "Save to drafts".
 *  Laptop   the top bar keeps the tabs in two groups (make music | your stuff) with labels; the drawer is not used.
 *  VLUI     toast(text, {action}) and sheet({title, body, actions}) used by Drafts.
 */
(function (root) {
    "use strict";
    const $ = (id) => document.getElementById(id);
    const NAMES = { beatlab: "Beat Lab", studio: "Studio", pipeline: "Pipeline", drafts: "Drafts", settings: "Settings" };

    // ---------- toast ----------
    let toastTimer = 0;
    function toast(text, action) {
        let el = $("vl-toast");
        if (!el) { el = document.createElement("div"); el.id = "vl-toast"; el.className = "vl-toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
        el.innerHTML = "";
        const span = document.createElement("span"); span.textContent = text; el.appendChild(span);
        if (action) { const b = document.createElement("button"); b.type = "button"; b.textContent = action.label; b.addEventListener("click", () => { el.classList.remove("is-on"); action.run(); }); el.appendChild(b); }
        el.classList.add("is-on");
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => el.classList.remove("is-on"), action ? 6000 : 3200);
    }

    // ---------- sheet (a small dialog that comes up from the bottom on a phone) ----------
    // actions: [{ label, primary, danger, run }]; returns a function that closes it
    function sheet(o) {
        const back = document.createElement("div"); back.className = "vl-sheet-back";
        const box = document.createElement("div"); box.className = "vl-sheet"; box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("aria-label", o.title || "");
        const h = document.createElement("h3"); h.textContent = o.title || ""; box.appendChild(h);
        if (o.body) { const p = document.createElement("div"); p.className = "vl-sheet-body"; if (typeof o.body === "string") p.textContent = o.body; else p.appendChild(o.body); box.appendChild(p); }
        const row = document.createElement("div"); row.className = "vl-sheet-actions";
        const close = () => { back.remove(); document.removeEventListener("keydown", onKey); };
        const onKey = (e) => { if (e.key === "Escape") close(); };
        (o.actions || []).forEach((a) => {
            const b = document.createElement("button"); b.type = "button"; b.textContent = a.label;
            b.className = a.primary ? "primary-button" : a.danger ? "secondary-button vl-danger" : "secondary-button";
            b.addEventListener("click", () => { close(); if (a.run) a.run(); });
            row.appendChild(b);
        });
        box.appendChild(row); back.appendChild(box);
        back.addEventListener("click", (e) => { if (e.target === back) close(); });
        document.addEventListener("keydown", onKey);
        document.body.appendChild(back);
        const first = row.querySelector(".primary-button") || row.querySelector("button"); if (first) first.focus();
        return close;
    }

    // ---------- the menu drawer ----------
    function wireDrawer() {
        const btn = $("nav-toggle"), drawer = $("nav-drawer"), back = $("nav-backdrop");
        if (!btn || !drawer || !back) return;
        const open = (on) => {
            drawer.classList.toggle("is-open", on); back.classList.toggle("is-open", on);
            drawer.setAttribute("aria-hidden", on ? "false" : "true"); btn.setAttribute("aria-expanded", on ? "true" : "false");
            document.body.classList.toggle("nav-open", on);
            if (on) { const a = drawer.querySelector(".mode-btn.is-active") || drawer.querySelector(".nav-item"); if (a) a.focus(); } else btn.focus({ preventScroll: true });
        };
        btn.addEventListener("click", () => open(!drawer.classList.contains("is-open")));
        back.addEventListener("click", () => open(false));
        $("nav-close")?.addEventListener("click", () => open(false));
        document.addEventListener("keydown", (e) => { if (e.key === "Escape" && drawer.classList.contains("is-open")) open(false); });
        window.addEventListener("vl-mode", () => open(false));        // choosing a place closes the menu
        window.matchMedia("(min-width: 721px)").addEventListener("change", (m) => { if (m.matches) open(false); });
    }

    // ---------- header: where am I, and the Save to drafts button ----------
    function wireHeader() {
        const cur = $("nav-current"), save = $("draft-save");
        window.addEventListener("vl-mode", (e) => {
            const m = e.detail.mode;
            if (cur) cur.textContent = NAMES[m] || "";
            if (save) save.hidden = !(m === "beatlab" || m === "studio");
            document.title = (NAMES[m] ? NAMES[m] + " · " : "") + "Voxloop Studio";
        });
        if (save) save.addEventListener("click", () => { if (root.VLDrafts) root.VLDrafts.saveCurrent(); });
    }

    function badge(n) {
        document.querySelectorAll(".drafts-badge").forEach((b) => { b.textContent = n > 99 ? "99+" : String(n); b.hidden = !n; });
    }
    window.addEventListener("vl-drafts-changed", (e) => badge(e.detail.count));

    function init() {
        wireDrawer(); wireHeader();
        const on = document.querySelector(".mode-switch .mode-btn.is-active");           // the screen the app opens on
        if (on) window.dispatchEvent(new CustomEvent("vl-mode", { detail: { mode: on.dataset.mode } }));
    }
    init();                                                                            // the page's elements are already above this script
    root.VLUI = { toast, sheet, badge };
})(window);
