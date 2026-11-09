/**
 * Voxloop Studio: editing, zoom and the beat read-out
 *
 *  Edit bar     Undo / Redo, Split at the playhead, Copy, Cut, Paste, Delete, Zoom - / + / Fit
 *  Rules        - Split cuts the clip under the playhead into two clips.
 *               - Delete removes the selected part of a clip (or the whole clip if all of it is selected); the rest stays where it was.
 *               - Copy / Cut keep the selected part. Paste puts a NEW clip at the playhead on the active lane (tap a lane's name or
 *                 an empty spot of it; it follows the armed lane and the selected clip). Nothing is replaced: if the lane already has
 *                 a vocal there, the pasted one is layered with it and both play (they show in two rows).
 *               - Everything can be undone (a recorded take too).
 *  Zoom         pinch with two fingers, Ctrl + mouse wheel, or the buttons.
 *  Beat chip    the beat's tempo, key and style, worked out when it is loaded; tap it to correct it. Autopilot decides from the same
 *               numbers.
 *  Keys         Ctrl/Cmd + Z, Shift+Z, C, X, V, Delete, S (split)
 * Needs: daw.js (VLDAW), fxrack.js (selection), fxbrain.js (beat analysis).
 */
(function () {
    "use strict";
    const $ = (s, r) => (r || document).querySelector(s);
    const D = () => window.VLDAW;
    const api = () => (D() && D().api) || {};
    const lanes = () => (D() && D().lanes) || [];
    const rack = () => (window.VLFxRack && window.VLFxRack.st) || null;
    const status = (m) => { if (api().status) api().status(m); };
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const fmt = (s) => { const m = Math.floor(s / 60); return m + ":" + (s - m * 60).toFixed(1).padStart(4, "0"); };

    // ------------------------------------------------------------------ undo / redo
    const undoStack = [], redoStack = [];
    const snapshot = () => lanes().map((l) => ({ id: l.id, clips: l.clips.map((c) => Object.assign({}, c, { fxLog: c.fxLog ? c.fxLog.slice() : c.fxLog })) }));
    function checkpoint() { undoStack.push(snapshot()); if (undoStack.length > 40) undoStack.shift(); redoStack.length = 0; refresh(); }
    function restore(snap) {
        snap.forEach((s) => { const l = lanes().find((x) => x.id === s.id); if (l) l.clips = s.clips.map((c) => Object.assign({}, c)); });
        const r = rack(); if (r && r.sel && !lanes().some((l) => l.clips.some((c) => c.id === r.sel.clipId))) r.sel = null;
        redraw();
    }
    function undo() { if (!undoStack.length) { status("Nothing to undo"); return; } redoStack.push(snapshot()); restore(undoStack.pop()); status("Undone"); }
    function redo() { if (!redoStack.length) { status("Nothing to redo"); return; } undoStack.push(snapshot()); restore(redoStack.pop()); status("Redone"); }
    function redraw() {
        const a = api();
        if (a.renderLanes) a.renderLanes();
        if (a.updateTotals) a.updateTotals();
        if (a.refreshRoles) a.refreshRoles();
        refresh();
    }

    // ------------------------------------------------------------------ clips
    function slice(buf, a, b) {
        const sr = buf.sampleRate, s0 = clamp(Math.round(a * sr), 0, buf.length), s1 = clamp(Math.round(b * sr), s0 + 1, buf.length);
        const out = api().ensureCtx().createBuffer(buf.numberOfChannels, s1 - s0, sr);
        for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).subarray(s0, s1), c);
        return out;
    }
    function makeClip(buf, name, start, from) {
        const file = new File([api().audioBufferToWav(buf)], name.replace(/\s+/g, "_") + ".wav", { type: "audio/wav" });
        const c = { id: api().uid(), name, blob: file, file, buffer: buf, start, duration: buf.duration, fxLog: from && from.fxLog ? from.fxLog.slice() : undefined };
        // a piece cut from a take Autopilot already produced must not be produced a second time
        const ap = window.VLStudioAutopilot;
        if (ap && ap.markDone && (!from || ap.isDone(from))) ap.markDone(c);
        return c;
    }
    function find(laneId, clipId) {
        const lane = lanes().find((l) => l.id === laneId);
        const clip = lane && lane.clips.find((c) => c.id === clipId);
        return clip ? { lane, clip } : null;
    }
    function selected() { const r = rack(); return r && r.sel ? find(r.sel.laneId, r.sel.clipId) && Object.assign({ sel: r.sel }, find(r.sel.laneId, r.sel.clipId)) : null; }
    function clearSel() { const r = rack(); if (r) r.sel = null; }

    function targetLane() {
        const L = lanes(), id = api().getActiveLane && api().getActiveLane();
        return L.find((l) => l.id === id) || L.find((l) => l.armed) || (selected() && selected().lane) || L[0] || null;
    }

    function split() {
        const ph = api().getPlayhead();
        let hit = null;
        const sel = selected();
        const inside = (c) => ph > c.start + 0.03 && ph < c.start + c.duration - 0.03;
        if (sel && inside(sel.clip)) hit = sel;
        if (!hit) {
            const t = targetLane();
            const order = [t].concat(lanes().filter((l) => l !== t)).filter(Boolean);
            for (const lane of order) { const c = lane.clips.slice().reverse().find(inside); if (c) { hit = { lane, clip: c }; break; } }
        }
        if (!hit) { status("Put the playhead on a clip to split it"); return; }
        checkpoint();
        const { lane, clip } = hit, at = ph - clip.start, i = lane.clips.indexOf(clip);
        const a = makeClip(slice(clip.buffer, 0, at), clip.name, clip.start, clip);
        const b = makeClip(slice(clip.buffer, at, clip.duration), clip.name, ph, clip);
        lane.clips.splice(i, 1, a, b);
        clearSel();
        if (api().setActiveLane) api().setActiveLane(lane.id);
        redraw();
        status("Split at " + fmt(ph));
    }

    function removeSelected() {
        const s = selected();
        if (!s) { status("Tap a clip, or drag across part of it, then Delete"); return false; }
        const { lane, clip } = s, a = s.sel.start, b = s.sel.end, d = clip.duration, i = lane.clips.indexOf(clip);
        const pieces = [];
        if (a > 0.02) pieces.push(makeClip(slice(clip.buffer, 0, a), clip.name, clip.start, clip));
        if (d - b > 0.02) pieces.push(makeClip(slice(clip.buffer, b, d), clip.name, clip.start + b, clip));
        lane.clips.splice(i, 1, ...pieces);
        clearSel();
        return true;
    }
    function del() { const s = selected(); if (!s) { removeSelected(); return; } checkpoint(); const w = s.sel.end - s.sel.start; removeSelected(); redraw(); status("Deleted " + w.toFixed(1) + " s"); }

    let clipboard = null;
    function copy(quiet) {
        const s = selected();
        if (!s) { status("Tap a clip, or drag across part of it, then Copy"); return false; }
        const buf = slice(s.clip.buffer, s.sel.start, s.sel.end);
        clipboard = { buffer: buf, name: s.clip.name, fxLog: s.clip.fxLog ? s.clip.fxLog.slice() : undefined, from: s.clip };
        if (!quiet) status("Copied " + buf.duration.toFixed(1) + " s. Move the playhead, tap a lane, then Paste");
        refresh();
        return true;
    }
    function cut() {
        const s = selected();
        if (!s) { status("Tap a clip, or drag across part of it, then Cut"); return; }
        copy(true); checkpoint(); removeSelected(); redraw();
        status("Cut " + clipboard.buffer.duration.toFixed(1) + " s. Move the playhead, tap a lane, then Paste");
    }
    // Paste adds a new clip at the playhead. It never replaces anything: a lane that already has a vocal there keeps it.
    function paste() {
        if (!clipboard) { status("Copy something first"); return; }
        const lane = targetLane();
        if (!lane) { status("Add a vocal lane first"); return; }
        const start = api().getPlayhead();
        checkpoint();
        const buf = slice(clipboard.buffer, 0, clipboard.buffer.duration);
        const clip = makeClip(buf, clipboard.name, start, clipboard.from);
        lane.clips.push(clip);
        if (api().setActiveLane) api().setActiveLane(lane.id);
        redraw();
        const over = lane.clips.some((c) => c !== clip && c.start < start + clip.duration - 0.01 && c.start + c.duration > start + 0.01);
        status("Pasted on " + lane.name + " at " + fmt(start) + (over ? " (layered with what is already there)" : ""));
    }

    // ------------------------------------------------------------------ zoom
    function zoomBy(f, x) { const a = api(); if (a.setZoom) a.setZoom(a.getZoom() * f, x); refresh(); }
    function fit() {
        const a = api(), host = $("#studio-lanes"), head = $(".studio-ruler-head");
        const dur = a.totalDuration ? a.totalDuration() : 0;
        if (!host || !dur) return;
        const base = a.pxPerSec() / a.getZoom();
        a.setZoom(((host.clientWidth - (head ? head.offsetWidth : 0)) - 24) / (dur * base));
        host.scrollLeft = 0; refresh();
    }
    function bindZoomGestures() {
        const host = $("#studio-lanes"), ruler = $("#studio-ruler-scroll");
        if (!host || host.dataset.zoomBound) return;
        host.dataset.zoomBound = "1";
        let pinch = null;
        const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
        const start = (e) => { if (e.touches.length === 2) pinch = { d: dist(e.touches), z: api().getZoom() }; };
        const move = (e) => {
            if (!pinch || e.touches.length !== 2) return;
            e.preventDefault();
            api().setZoom(pinch.z * dist(e.touches) / pinch.d, (e.touches[0].clientX + e.touches[1].clientX) / 2);
        };
        const end = (e) => { if (e.touches.length < 2) pinch = null; };
        [host, ruler].forEach((el) => {
            if (!el) return;
            el.addEventListener("touchstart", start, { passive: true });
            el.addEventListener("touchmove", move, { passive: false });
            el.addEventListener("touchend", end, { passive: true });
            el.addEventListener("touchcancel", end, { passive: true });
            el.addEventListener("wheel", (e) => {
                if (!(e.ctrlKey || e.metaKey)) return;
                e.preventDefault();
                zoomBy(Math.exp(-e.deltaY * 0.012), e.clientX);
            }, { passive: false });
        });
    }

    // ------------------------------------------------------------------ the edit bar
    const ICON = {
        undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
        redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
        split: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/>',
        copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
        cut: '<path d="M6 3v6a6 6 0 0 0 12 0V3"/><path d="M4 21h16"/>',
        paste: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
        del: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
        zin: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M11 8v6M8 11h6"/>',
        zout: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M8 11h6"/>',
        fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
        check: '<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h9"/>',
        fx: '<path d="M12 3l1.8 4.7L18.5 9l-4.7 1.8L12 15.5l-1.8-4.7L5.5 9l4.7-1.3z"/><path d="M18 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>'
    };
    const BTN = [
        ["fx", "Effects", () => { if (window.VLFxRack) { if (selected()) window.VLFxRack.openEffects(); else status("Tap a clip first, then Effects"); } }], null,
        ["check", "Take check", () => { const s = selected(); if (s && s.clip.quality && window.VLTakeCheck) window.VLTakeCheck.show(s.clip); else status(s ? "This take was not recorded here, so there is nothing to check" : "Tap a recorded take first"); }], null,
        ["undo", "Undo", undo], ["redo", "Redo", redo], null,
        ["split", "Split", split], ["copy", "Copy", () => copy()], ["cut", "Cut", cut], ["paste", "Paste", paste], ["del", "Delete", del], null,
        ["zout", "Zoom out", () => zoomBy(1 / 1.5)], ["zin", "Zoom in", () => zoomBy(1.5)], ["fit", "Fit", fit]
    ];
    let bar = null;
    function buildBar() {
        const wrap = $(".studio-timeline-wrap");
        if (!wrap || $("#studio-editbar")) return;
        bar = document.createElement("div");
        bar.id = "studio-editbar"; bar.className = "studio-editbar"; bar.setAttribute("role", "toolbar"); bar.setAttribute("aria-label", "Edit the take");
        BTN.forEach((b) => {
            if (!b) { const s = document.createElement("span"); s.className = "eb-sep"; bar.appendChild(s); return; }
            const el = document.createElement("button");
            el.type = "button"; el.className = "eb-btn"; el.dataset.act = b[0]; el.title = b[1]; el.setAttribute("aria-label", b[1]);
            el.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[b[0]] + "</svg><span>" + b[1] + "</span>";
            el.addEventListener("click", b[2]);
            bar.appendChild(el);
        });
        wrap.parentNode.insertBefore(bar, wrap);
        refresh();
    }
    function refresh() {
        if (!bar) return;
        const s = selected();
        const on = { fx: !!s, check: !!(s && s.clip.quality), undo: undoStack.length > 0, redo: redoStack.length > 0, split: lanes().some((l) => l.clips.length), copy: !!s, cut: !!s, paste: !!clipboard && lanes().length > 0, del: !!s };
        bar.querySelectorAll(".eb-btn").forEach((b) => { if (b.dataset.act in on) b.disabled = !on[b.dataset.act]; });
    }

    document.addEventListener("keydown", (e) => {
        const panel = $("#mode-studio");
        if (!panel || panel.classList.contains("hidden")) return;
        const t = e.target;
        if (t && (/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) || t.isContentEditable)) return;
        const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
        if (mod && k === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
        else if (mod && k === "y") { e.preventDefault(); redo(); }
        else if (mod && k === "c") { if (selected()) { e.preventDefault(); copy(); } }
        else if (mod && k === "x") { if (selected()) { e.preventDefault(); cut(); } }
        else if (mod && k === "v") { if (clipboard) { e.preventDefault(); paste(); } }
        else if (!mod && (k === "delete" || k === "backspace")) { if (selected()) { e.preventDefault(); del(); } }
        else if (!mod && !e.altKey && k === "s") { e.preventDefault(); split(); }
    });

    // ------------------------------------------------------------------ the beat chip: what the beat is, and a way to correct it
    const ROOTS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    const SCALES = ["major", "minor", "dorian", "mixolydian", "lydian", "phrygian"];
    let chip = null, pop = null;
    const beatNow = () => (D() && D().beat) || {};

    function chipText() {
        const b = beatNow();
        if (!b.buffer) return "";
        if (b.listening) return "Listening to the beat…";
        const i = b.info;
        if (!i) return "";
        return (i.bpm ? Math.round(i.bpm) + " BPM" : "Tempo ?") + " · " + (i.key ? i.key.label : "Key ?") + (i.genre && i.genre.decided ? " · " + i.genre.label : "");
    }
    function buildChip() {
        const slot = $(".studio-beat-slot");
        if (!slot || $("#st-beat-chip")) return;
        chip = document.createElement("button");
        chip.type = "button"; chip.id = "st-beat-chip"; chip.className = "beat-chip"; chip.hidden = true;
        chip.title = "What Autopilot knows about this beat. Tap to correct it.";
        chip.addEventListener("click", togglePop);
        slot.appendChild(chip);
        paintChip();
    }
    function paintChip() {
        if (!chip) return;
        const txt = chipText();
        chip.hidden = !txt;
        chip.textContent = txt;
        chip.classList.toggle("is-listening", !!beatNow().listening);
        paintAware();
        if (pop && !pop.hidden) fillPop();
    }
    function sourceText(i, what) { const s = i.source && i.source[what]; return s === "Beat Lab" ? "from Beat Lab" : s === "set by you" ? "set by you" : "listened to"; }
    function fillPop() {
        const b = beatNow(), i = b.info;
        if (!i) { pop.hidden = true; return; }
        const k = i.key;
        pop.innerHTML =
            '<p class="bp-lead"><b>Autopilot decides from this.</b> It tunes to the key, times delay and reverb to the tempo, and places extras in the big parts. Correct anything that sounds wrong.</p>' +
            '<div class="bp-row"><label>Tempo (BPM)</label><input type="number" id="bp-bpm" min="40" max="240" step="1" value="' + (i.bpm ? Math.round(i.bpm) : "") + '"><button type="button" class="bp-mini" data-bp="half">½</button><button type="button" class="bp-mini" data-bp="double">×2</button><small>' + (i.bpm ? sourceText(i, "bpm") : "not found") + (i.tempoNote ? ". " + i.tempoNote : "") + "</small></div>" +
            '<div class="bp-row"><label>Key</label><select id="bp-root">' + ROOTS.map((r, n) => '<option value="' + r + '"' + (k && k.rootPc === n ? " selected" : "") + ">" + r + "</option>").join("") + '</select><select id="bp-scale">' + SCALES.map((s) => '<option value="' + s + '"' + (k && k.scale === s ? " selected" : "") + ">" + s + "</option>").join("") + "</select><small>" + (k ? sourceText(i, "key") : "not found") + "</small></div>" +
            (i.genre && i.genre.decided ? '<div class="bp-row"><label>Style</label><span>' + i.genre.label + "</span></div>" : "") +
            (i.sections && i.sections.length ? '<div class="bp-row"><label>Big parts</label><span>' + i.sections.length + " found</span></div>" : "") +
            '<div class="bp-actions"><button type="button" class="eb-primary" id="bp-apply">Use this</button><button type="button" class="bp-mini" id="bp-close">Close</button></div>';
        pop.querySelectorAll("[data-bp]").forEach((x) => x.addEventListener("click", () => { const f = $("#bp-bpm", pop); const v = +f.value; if (v) f.value = Math.round(x.dataset.bp === "half" ? v / 2 : v * 2); }));
        $("#bp-apply", pop).addEventListener("click", () => {
            api().setBeatInfo(+$("#bp-bpm", pop).value, $("#bp-root", pop).value + " " + $("#bp-scale", pop).value);
            pop.hidden = true;
            status("Autopilot will use " + Math.round(beatNow().info.bpm) + " BPM · " + beatNow().info.key.label);
        });
        $("#bp-close", pop).addEventListener("click", () => { pop.hidden = true; });
    }
    function togglePop() {
        if (!beatNow().info) return;
        if (!pop) { pop = document.createElement("div"); pop.className = "beat-pop"; pop.hidden = true; (chip.closest(".studio-toolbar") || chip.parentNode).appendChild(pop); }
        pop.hidden = !pop.hidden;
        if (!pop.hidden) fillPop();
    }

    // The Auto tab says what Autopilot is working from
    function paintAware() {
        const host = $("#fx-aware");
        if (!host) return;
        const b = beatNow();
        if (!b.buffer) { host.innerHTML = "<b>Autopilot:</b> load a beat and it will read the tempo, key and style first, then decide."; return; }
        if (b.listening) { host.innerHTML = "<b>Autopilot:</b> listening to the beat…"; return; }
        const i = b.info;
        if (!i) { host.textContent = ""; return; }
        host.innerHTML = "<b>Autopilot is working from your beat:</b> " + chipText() + (i.sections && i.sections.length ? " · " + i.sections.length + " big part" + (i.sections.length > 1 ? "s" : "") : "") +
            ". Tuning follows the key, delay and reverb follow the tempo and style. <button type=\"button\" class=\"link-button\" id=\"fx-aware-fix\">Not right? Correct it</button>";
        const fix = $("#fx-aware-fix", host);
        if (fix) fix.addEventListener("click", () => { if (chip) { chip.scrollIntoView({ block: "nearest" }); togglePop(); } });
    }

    window.addEventListener("vl-beat-info", paintChip);
    window.VLEdit = { checkpoint, undo, redo, split, copy, cut, paste, del, paintAware, get clipboard() { return clipboard; } };

    function init() {
        buildBar(); buildChip(); bindZoomGestures();
        setInterval(refresh, 400);
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
