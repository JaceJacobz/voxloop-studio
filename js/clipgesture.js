/**
 * Voxloop Studio: fingers and mouse on a clip
 *
 *  Swipe             scrolls the timeline. It never picks or moves anything, so scrolling past a vocal is safe.
 *  Tap               picks the whole clip.
 *  Tap it again      the plug-in icon shows next to the pick; tap the icon to open Effects for it.
 *                    (There is no "select" switch to turn on: picking a clip or a part is always available.)
 *  Press and hold    (about 0.4 s, finger still) picks the clip UP: it lifts, the phone gives a tiny buzz, and it follows the
 *                    finger left and right. Let go to drop it. Undo puts it back exactly where it was.
 *  Grips             the picked clip shows a grip at each end of the pick. Drag a grip to pick just a part (for a plug-in).
 *  Mouse             a quick drag across a clip still picks a part, as before. Press and hold also lifts the clip.
 *
 *  Moving rules     the beat and the melody never move (they are not vocal clips); a clip cannot start before 0:00; it stays on
 *                   its own lane; clips that overlap are layered (both play). With Snap on (edit bar, default on) the clip's
 *                   start or end clicks onto the beat, the playhead, or the edge of another clip when it is within 10 px.
 *  While it moves   only a CSS transform changes, so the waveform is not redrawn and no effect is re-run until the finger lifts.
 *                   The read-out above the finger says the bar and beat and how far it moved from where it was.
 *
 * Needs: fxrack.js (VLFxRack.select / .paint, VLRack.afterRender), editing.js (VLEdit.moveClip, snapOn), daw.js (VLDAW).
 */
(function () {
    "use strict";
    const $ = (s, r) => (r || document).querySelector(s);
    const D = () => window.VLDAW;
    const lanes = () => (D() && D().lanes) || [];
    const api = () => (D() && D().api) || {};
    const rack = () => window.VLFxRack || null;
    const edit = () => window.VLEdit || null;
    const status = (m) => { if (api().status) api().status(m); };
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const fmt = (s) => { const m = Math.floor(s / 60); return m + ":" + (s - m * 60).toFixed(2).padStart(5, "0"); };

    const HOLD_MS = 400;        // how long a finger rests before the clip lifts
    const SLOP = 10;            // px a finger may wander during that time (more = it is a swipe, so it scrolls)
    const MOUSE_SLOP = 5;       // px before a mouse drag starts picking a part
    const MIN_SEL = 0.12;       // s: the smallest part a mouse drag keeps
    const MIN_GAP = 0.05;       // s: the grips cannot be closer than this
    const EDGE_PX = 36;         // px from the screen edge where dragging scrolls the timeline
    const SNAP_PX = 10;         // px: how close the clip must come before it clicks onto something

    let host = null, g = null, raf = 0, plug = null, tip = null, hinted = false;

    function lookup(el) {
        const lane = lanes().find((l) => l.id === el.dataset.laneId);
        const clip = lane && lane.clips.find((c) => c.id === el.dataset.clipId);
        return clip ? { lane, clip } : null;
    }
    function picked(laneId, clipId) {
        const R = rack(), s = R && R.st.sel;
        return !!(s && s.laneId === laneId && s.clipId === clipId);
    }
    function timeAt(el, x, dur) { const r = el.getBoundingClientRect(); return clamp((x - r.left) / Math.max(1, r.width) * dur, 0, dur); }
    const recording = () => !!(window.VLRecWave && window.VLRecWave.active);

    // ------------------------------------------------------------------ the plug-in icon
    function hidePlug() { if (plug) { plug.remove(); plug = null; } }
    // The icon appears where the finger just tapped (inside the picked part and inside what is on screen: a long clip's middle can be far off
    // screen, and an icon there could not be reached).
    function showPlug(el, clientX) {
        hidePlug();
        const R = rack(), f = lookup(el);
        if (!R || !f || !R.st.sel) return;
        const s = R.st.sel, track = el.parentNode;
        if (!track) return;
        const head = $(".studio-lane-head", host), headW = head ? head.offsetWidth : 0;
        const selL = el.offsetLeft + s.start / f.clip.duration * el.offsetWidth, selR = el.offsetLeft + s.end / f.clip.duration * el.offsetWidth;
        const visL = host.scrollLeft, visR = host.scrollLeft + host.clientWidth - headW, M = 26;
        const lo = Math.max(selL, visL) + M, hi = Math.min(selR, visR) - M;
        // not under the finger: the browser sends its "click" to whatever is under the finger after it lifts, which would hit the new icon
        let x = clientX != null ? clientX - track.getBoundingClientRect().left : (selL + selR) / 2;
        if (clientX != null) x += (x + 56 <= (hi >= lo ? hi : visR - M)) ? 56 : -56;
        x = hi >= lo ? clamp(x, lo, hi) : clamp(x, visL + M, Math.max(visL + M, visR - M));
        const b = document.createElement("button");
        b.type = "button"; b.className = "fx-plug";
        b.setAttribute("aria-label", "Effects for the picked part"); b.title = "Effects for the picked part";
        b.innerHTML = window.VLI ? window.VLI("sparkle", 19) : "FX";
        b.style.left = x + "px";
        b.style.top = (el.offsetTop + el.offsetHeight / 2) + "px";
        const born = Date.now();
        b.addEventListener("click", (ev) => { ev.stopPropagation(); if (Date.now() - born < 250) return; hidePlug(); R.openEffects(); });     // a click straight after it appears is the first tap's echo
        track.appendChild(b);
        plug = b;
    }

    // ------------------------------------------------------------------ the read-out above the finger while a clip moves
    function hideTip() { if (tip) { tip.remove(); tip = null; } }
    function tipText(t, why) {
        const grid = api().gridInfo && api().gridInfo();
        let at;
        if (grid) {
            const bar = Math.floor(t / grid.barSec + 1e-6), inBar = t - bar * grid.barSec, beatN = Math.floor(inBar / grid.beatSec + 1e-6);
            at = "Bar " + (bar + 1) + " · beat " + (beatN + 1);
            const off = Math.round((inBar - beatN * grid.beatSec) * 1000);
            if (off > 0) at += " +" + off + " ms";
        } else at = fmt(t);
        const d = Math.round((t - g.start0) * 1000);
        const change = d === 0 ? "not moved" : (d > 0 ? "+" : "−") + (Math.abs(d) >= 1000 ? (Math.abs(d) / 1000).toFixed(2) + " s" : Math.abs(d) + " ms");
        return at + " · " + change + (why ? " · clicks onto " + why : "");
    }
    function showTip(t, why) {
        if (!tip) { tip = document.createElement("div"); tip.className = "clip-tip"; tip.setAttribute("aria-live", "polite"); document.body.appendChild(tip); }
        tip.textContent = tipText(t, why);
        const r = g.el.getBoundingClientRect(), vw = document.documentElement.clientWidth;
        tip.style.left = clamp(g.x, 90, Math.max(90, vw - 90)) + "px";
        tip.style.top = Math.max(10, r.top - 8) + "px";
    }

    // ------------------------------------------------------------------ moving
    // The new start of the lifted clip, from how far the finger went (plus how far the view scrolled meanwhile).
    function snapStart(t, dur, pps) {
        const lim = SNAP_PX / pps;
        let best = null;
        const tryT = (cand, why, bias) => {
            const d = Math.abs(cand - t);
            if (d > lim) return;
            const score = d * (bias || 1);
            if (!best || score < best.score) best = { score, t: cand, why };
        };
        const grid = api().gridInfo && api().gridInfo();
        if (grid) { tryT(Math.round(t / grid.beatSec) * grid.beatSec, "the beat", 1.5); tryT(Math.round((t + dur) / grid.beatSec) * grid.beatSec - dur, "the beat", 1.5); }
        const ph = api().getPlayhead ? api().getPlayhead() : 0;
        tryT(ph, "the playhead"); tryT(ph - dur, "the playhead");
        lanes().forEach((l) => l.clips.forEach((c) => {
            if (c.id === g.clipId) return;
            tryT(c.start, "another clip"); tryT(c.start + c.duration, "another clip");
            tryT(c.start - dur, "another clip"); tryT(c.start + c.duration - dur, "another clip");
        }));
        tryT(0, "the start");
        return best ? { t: Math.max(0, best.t), why: best.why } : { t, why: "" };
    }
    function moveTo() {
        const pps = api().pxPerSec(), E = edit();
        const dx = (g.x - g.x0) + (host.scrollLeft - g.scroll0);
        let t = Math.max(0, g.start0 + dx / pps), why = "";
        if (E && E.snapOn && E.snapOn()) { const s = snapStart(t, g.dur, pps); t = s.t; why = s.why; }
        g.newStart = t;
        g.el.style.transform = "translate3d(" + ((t - g.start0) * pps) + "px,0,0)";
        showTip(t, why);
    }
    function update() {
        if (!g) return;
        if (g.mode === "move") { moveTo(); return; }
        const R = rack();
        if (g.mode === "handle") {
            const r = g.el.getBoundingClientRect();
            const t = clamp((g.x + g.off - r.left) / Math.max(1, r.width) * g.dur, 0, g.dur);
            if (g.edge === "a") g.a = Math.max(0, Math.min(t, g.b - MIN_GAP)); else g.b = Math.min(g.dur, Math.max(t, g.a + MIN_GAP));
            R.paint(g.el, g.a, g.b, g.dur);
        } else if (g.mode === "range") {
            const t = timeAt(g.el, g.x, g.dur);
            g.a = Math.min(g.t0, t); g.b = Math.max(g.t0, t);
            R.paint(g.el, g.a, g.b, g.dur);
        }
    }

    // One animation frame loop while something is being dragged: it applies the latest finger position once per frame and
    // scrolls the timeline when the finger is near either screen edge.
    function loop() {
        raf = 0;
        if (!g || g.mode === "wait" || g.mode === "dead") return;
        const hr = host.getBoundingClientRect(), head = $(".studio-lane-head", host);
        const left = hr.left + (head ? head.offsetWidth : 0), right = hr.right;
        let v = 0;
        if (g.x > right - EDGE_PX) v = Math.min(18, (g.x - (right - EDGE_PX)) / 3 + 4);
        else if (g.x < left + EDGE_PX) v = -Math.min(18, ((left + EDGE_PX) - g.x) / 3 + 4);
        if (v) { const before = host.scrollLeft; host.scrollLeft = Math.max(0, before + v); if (host.scrollLeft !== before) g.dirty = true; }
        if (g.dirty) { g.dirty = false; update(); }
        raf = requestAnimationFrame(loop);
    }
    function startLoop() { if (!raf) raf = requestAnimationFrame(loop); }
    function stopLoop() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }

    function pickUp() {
        if (!g || g.mode !== "wait") return;
        g.timer = 0;
        const f = lookup(g.el), R = rack();
        if (!f || !R || recording()) { g.mode = "dead"; return; }
        g.mode = "move"; g.start0 = f.clip.start; g.newStart = f.clip.start; g.scroll0 = host.scrollLeft;
        if (!picked(g.laneId, g.clipId)) R.select({ laneId: g.laneId, clipId: g.clipId, start: 0, end: g.dur });
        g.el.classList.add("is-lifted");
        try { if (navigator.vibrate) navigator.vibrate(10); } catch (_) { /* not every phone allows it */ }
        status("Slide it, then let go to drop it. Undo puts it back.");
        g.dirty = true; startLoop();
    }

    // ------------------------------------------------------------------ the end of a gesture
    function hintOnce() {
        let seen = hinted;
        try { seen = seen || !!localStorage.getItem("vl-clip-hint"); localStorage.setItem("vl-clip-hint", "1"); } catch (_) { /* ignore */ }
        hinted = true;
        if (!seen) status("Tip: tap the clip again for effects. Press and hold, then slide, to move it. Swipe to scroll.");
    }
    function tap(d, force) {
        const R = rack(), f = lookup(d.el);
        if (!R || !f) return;
        const s = R.st.sel;
        if (picked(d.laneId, d.clipId)) {
            const t = timeAt(d.el, d.x, d.dur);
            if (force || (t >= s.start - 0.02 && t <= s.end + 0.02)) { showPlug(d.el, d.x); return; }
        }
        R.select({ laneId: d.laneId, clipId: d.clipId, start: 0, end: d.dur });
        hintOnce();
    }
    function drop(d) {
        d.el.style.transform = ""; d.el.classList.remove("is-lifted"); hideTip();
        const E = edit();
        if (!E || !E.moveClip || Math.abs(d.newStart - d.start0) < 0.001) { status("Dropped where it was"); return; }
        E.moveClip(d.laneId, d.clipId, d.newStart);
    }
    function abort() {
        if (!g) return;
        const d = g; clearTimeout(d.timer); g = null; stopLoop(); hideTip();
        if (d.mode === "move") { d.el.style.transform = ""; d.el.classList.remove("is-lifted"); status("Move cancelled"); }
        else if ((d.mode === "handle" || d.mode === "range") && window.VLRack) window.VLRack.afterRender();
    }

    function onDown(e) {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        if (g) { const again = g.id === e.pointerId; abort(); if (!again) return; }     // a second finger means pinch: let go of everything (the same pointer again = a stale gesture)
        const t = e.target;
        if (!t || !t.closest) return;
        if (t.closest(".fx-plug")) return;
        hidePlug();
        const el = t.closest(".studio-clip[data-clip-id]");
        if (!el) return;
        const f = lookup(el);
        if (!f) return;
        g = { id: e.pointerId, type: e.pointerType === "mouse" ? "mouse" : "touch", el, laneId: el.dataset.laneId, clipId: el.dataset.clipId, dur: f.clip.duration,
              x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, mode: "wait", timer: 0, dirty: false, moved: false };
        try { el.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
        const handle = t.closest(".fx-handle"), R = rack();
        if (handle && R && picked(g.laneId, g.clipId)) {
            const s = R.st.sel, r = el.getBoundingClientRect();
            g.mode = "handle"; g.edge = handle.dataset.edge; g.a = s.start; g.b = s.end;
            g.off = (r.left + (g.edge === "a" ? s.start : s.end) / g.dur * r.width) - e.clientX;     // keep the grab point, so the edge does not jump
            startLoop();
        } else {
            g.timer = setTimeout(pickUp, HOLD_MS);
        }
    }
    function onMove(e) {
        if (!g || e.pointerId !== g.id) return;
        g.x = e.clientX; g.y = e.clientY;
        const dist = Math.hypot(g.x - g.x0, g.y - g.y0);
        if (g.mode === "wait") {
            if (g.type === "mouse") {
                if (dist > MOUSE_SLOP) { clearTimeout(g.timer); g.mode = "range"; g.t0 = timeAt(g.el, g.x0, g.dur); g.dirty = true; startLoop(); }
            } else if (dist > SLOP) { clearTimeout(g.timer); g.mode = "dead"; }       // a swipe: the page scrolls, nothing is picked
            return;
        }
        if (g.mode === "handle" && dist > SLOP) g.moved = true;
        if (g.mode !== "dead") g.dirty = true;
    }
    function onUp(e) {
        if (!g || e.pointerId !== g.id) return;
        g.x = e.clientX; g.y = e.clientY;
        if (g.mode !== "wait" && g.mode !== "dead") update();
        const d = g; clearTimeout(d.timer); stopLoop(); g = null;
        const R = rack();
        if (d.mode === "wait") tap(d);
        else if (d.mode === "move") drop(d);
        else if (d.mode === "handle") { if (d.moved && R) R.select({ laneId: d.laneId, clipId: d.clipId, start: d.a, end: d.b }); else tap(d, true); }
        else if (d.mode === "range") { if (d.b - d.a >= MIN_SEL && R) R.select({ laneId: d.laneId, clipId: d.clipId, start: d.a, end: d.b }); else if (window.VLRack) window.VLRack.afterRender(); }
    }
    function onCancel(e) {
        if (!g || e.pointerId !== g.id) return;
        if (g.mode === "wait" || g.mode === "dead") { clearTimeout(g.timer); g = null; return; }     // the page took over: it is scrolling
        abort();
    }

    function bind() {
        host = $("#studio-lanes");
        if (!host || host.dataset.clipGesture) return;
        host.dataset.clipGesture = "1";
        host.addEventListener("pointerdown", onDown);
        host.addEventListener("pointermove", onMove);
        host.addEventListener("pointerup", onUp);
        host.addEventListener("pointercancel", onCancel);
        // Once a clip is lifted (or a grip is held) the finger must not scroll the page. This is the one place that needs a
        // non-passive listener; every other touch listener stays passive.
        host.addEventListener("touchmove", (e) => { if (g && g.mode !== "wait" && g.mode !== "dead" && e.cancelable) e.preventDefault(); }, { passive: false });
        // a long press on a phone would otherwise open the browser's own menu over the lifted clip
        host.addEventListener("contextmenu", (e) => { if (g && g.type === "touch" && e.target.closest && e.target.closest(".studio-clip[data-clip-id]")) e.preventDefault(); });
        host.addEventListener("scroll", () => { if (plug && !(g && g.mode !== "wait")) hidePlug(); }, { passive: true });
        document.addEventListener("keydown", (e) => { if (e.key === "Escape" && g) abort(); });
    }

    window.VLClipGesture = { HOLD_MS, SLOP, state: () => g && { mode: g.mode, newStart: g.newStart }, hidePlug, showPlug, hasPlug: () => !!plug };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind); else bind();
})();
