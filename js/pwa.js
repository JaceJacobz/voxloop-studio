/**
 * Voxloop Studio: install and offline
 *
 *  - registers the service worker (sw.js) so the app opens and works with no internet
 *  - offers "Install app" (Android / desktop Chrome and Edge) or the steps for iPhone
 *  - tells the person plainly when they are offline, and when the app has been updated
 *  - asks the browser to keep saved drafts and autosaves from being cleared when the phone is low on space, and shows how much is used
 * The Settings tab shows all of this in the "Install and offline" card.
 */
(function (root) {
    "use strict";
    const $ = (id) => document.getElementById(id);
    const ui = () => root.VLUI;
    let deferred = null, swState = "unsupported";

    const standalone = () => (root.matchMedia && root.matchMedia("(display-mode: standalone)").matches) || root.navigator.standalone === true;
    const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const mb = (b) => (b < 1048576 ? Math.max(1, Math.round(b / 1024)) + " KB" : b < 1073741824 ? Math.round(b / 1048576) + " MB" : (b / 1073741824).toFixed(1) + " GB");

    // ---------- service worker ----------
    function register() {
        if (!("serviceWorker" in navigator) || !/^https?:$/.test(location.protocol)) { swState = "unsupported"; paint(); return; }
        const hadController = !!navigator.serviceWorker.controller;
        swState = "preparing"; paint();
        navigator.serviceWorker.register("sw.js").then(() => navigator.serviceWorker.ready).then(() => { swState = "ready"; paint(); }).catch((e) => { console.warn("service worker", e); swState = "failed"; paint(); });
        navigator.serviceWorker.addEventListener("controllerchange", () => {
            if (!hadController) return;                                   // the very first install is not an update
            if (ui()) ui().toast("Voxloop Studio was updated.", { label: "Reload", run: () => location.reload() });
        });
    }

    // ---------- install ----------
    root.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; paint(); });
    root.addEventListener("appinstalled", () => { deferred = null; paint(); if (ui()) ui().toast("Installed. Open Voxloop Studio from your home screen."); });
    async function install() {
        if (!deferred) return;
        deferred.prompt();
        try { await deferred.userChoice; } catch (_) { /* closed */ }
        deferred = null; paint();
    }

    // ---------- connection ----------
    let wasOffline = !navigator.onLine;
    root.addEventListener("offline", () => { wasOffline = true; if (ui()) ui().toast("You are offline. Everything still works. Your work is saved on this phone."); paint(); });
    root.addEventListener("online", () => { if (wasOffline && ui()) ui().toast("Back online."); wasOffline = false; paint(); });

    // ---------- storage ----------
    async function storageInfo() {
        const out = { used: 0, quota: 0, persisted: null };
        try { if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); out.used = e.usage || 0; out.quota = e.quota || 0; } } catch (_) {}
        try { if (navigator.storage && navigator.storage.persisted) out.persisted = await navigator.storage.persisted(); } catch (_) {}
        return out;
    }
    async function protect() {
        try { const ok = navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; if (ui()) ui().toast(ok ? "Your drafts are protected from automatic clearing." : "The browser did not allow it. Installing the app usually helps."); } catch (_) {}
        paint();
    }

    // ---------- the Settings card ----------
    async function paint() {
        const off = $("pwa-offline"), inst = $("pwa-install"), instNote = $("pwa-install-note"), store = $("pwa-storage"), prot = $("pwa-protect"); if (!off) return;
        off.textContent = swState === "ready" ? "Ready: Voxloop Studio opens and works without internet." : swState === "preparing" ? "Getting ready for offline use…" : swState === "failed" ? "Offline use could not be set up on this browser." : "Offline use is not available here (it needs https or localhost and a modern browser).";
        off.dataset.state = swState;
        if (inst) {
            const installed = standalone();
            inst.hidden = !deferred || installed;
            if (instNote) instNote.textContent = installed ? "Installed: you are using the app." : deferred ? "Put Voxloop Studio on your home screen: it opens like an app, full screen." : isIOS() ? "On iPhone: tap the Share button, then Add to Home Screen." : "Open your browser's menu and choose Install app, or Add to Home screen.";
        }
        const s = await storageInfo();
        if (store) store.textContent = s.quota ? "Using " + mb(s.used) + " of about " + mb(s.quota) + " available on this device." : "";
        if (prot) { prot.hidden = s.persisted === true || s.persisted === null; }
        const pn = $("pwa-protect-note"); if (pn) pn.textContent = s.persisted === true ? "Protected: the browser will not clear your drafts to free space." : s.persisted === false ? "Not protected: a phone that is low on space may clear saved drafts." : "";
    }

    function init() {
        $("pwa-install")?.addEventListener("click", install);
        $("pwa-protect")?.addEventListener("click", protect);
        root.addEventListener("vl-mode", (e) => { if (e.detail.mode === "settings") paint(); });
        register(); paint();
        if (!navigator.onLine) setTimeout(() => { if (ui()) ui().toast("You are offline. Everything still works. Your work is saved on this phone."); }, 1500);
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
    root.VLApp = { install, protect, isStandalone: standalone };
})(window);
