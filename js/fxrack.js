/**
 * Voxloop Studio — FX Rack (Studio mode)
 *
 *  1. Drag across part of a vocal clip to SELECT it (tap a clip = the whole clip)
 *  2. Pick plugins (or a one-tap "recipe"), tweak, and hear a looping LIVE PREVIEW over the beat
 *  3. Apply → the effect is baked into just that part of the clip (undo any time)
 *  4. ✨ Auto: Voxloop listens to the vocal + beat and only adds what is actually needed
 *
 * Needs: fxrack-dsp.js (VLFx), fxbrain.js (VLBrain, optional), daw.js (VocalVaultDAW bridge).
 */
(function () {
    "use strict";
    const Fx = window.VLFx;
    if (!Fx) { console.warn("[FX Rack] fxrack-dsp.js is missing"); return; }

    const $ = (s, r) => (r || document).querySelector(s);
    const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
    const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const fmtT = (s) => { const m = Math.floor(s / 60); return m + ":" + (s - m * 60).toFixed(1).padStart(4, "0"); };
    const NOTE = Fx.NOTE_NAMES;
    const noteName = (m) => NOTE[((Math.round(m) % 12) + 12) % 12] + (Math.floor(Math.round(m) / 12) - 1);
    const clone = (o) => JSON.parse(JSON.stringify(o));

    const st = {
        sel: null,               // { laneId, clipId, start, end }  start/end in CLIP seconds
        chain: [],
        easy: true,
        tab: "chain",
        beatOn: true,
        ab: "fx",
        open: false,
        rev: 0,
        token: 0, running: false, again: false, timer: null,
        cache: [], out: null, dry: null, outSr: 44100,
        pv: null,                // live preview voice
        pitch: null, snap: "scale",
        beatInfo: null, beatFor: null,
        heard: null,             // findings from "Auto this"
        plan: null, planStyle: "polished", intensity: "normal", flavors: { doubs: false, tails: false, crowd: false, voice: false, orbit: false, ride: false },
        busyMsg: ""
    };
    try { const v = localStorage.getItem("vl-rack-easy"); if (v != null) st.easy = v === "1"; } catch (e) { /* ignore */ }

    let panel = null, D = null;

    // ------------------------------------------------------------------ bridge to daw.js
    const lanes = () => (D && D.lanes) || [];
    const beat = () => (D && D.beat) || { buffer: null };
    const api = () => (D && D.api) || {};
    const status = (m) => { if (api().status) api().status(m); const el = $("#fx-status"); if (el) el.textContent = m; };
    function findClip(sel) {
        sel = sel || st.sel; if (!sel) return null;
        for (const l of lanes()) { if (l.id !== sel.laneId) continue; const c = l.clips.find((x) => x.id === sel.clipId); if (c) return { lane: l, clip: c }; }
        return null;
    }
    function segAudio(clip, a, b) {
        const buf = clip.buffer, sr = buf.sampleRate;
        const s0 = clamp(Math.round(a * sr), 0, buf.length), s1 = clamp(Math.round(b * sr), s0 + 1, buf.length);
        const ch = []; for (let c = 0; c < buf.numberOfChannels; c++) ch.push(Float32Array.from(buf.getChannelData(c).subarray(s0, s1)));
        return { channels: ch, sr, s0, s1 };
    }
    function env() { const b = st.beatInfo; return { bpm: b && b.bpm, key: b && b.key ? { rootPc: b.key.rootPc, scale: b.key.scale } : null }; }
    async function ensureBeatInfo() {
        const b = beat().buffer;
        if (!b || !window.VLBrain) return null;
        if (st.beatFor === b && st.beatInfo) return st.beatInfo;
        st.beatFor = b;
        try { st.beatInfo = await window.VLBrain.analyzeBeat(b); } catch (e) { st.beatInfo = null; }
        updateHeader();
        return st.beatInfo;
    }

    // ------------------------------------------------------------------ panel markup
    function buildPanel() {
        const layout = $(".studio-layout");
        if (!layout || $("#fx-rack")) return;
        panel = document.createElement("section");
        panel.id = "fx-rack"; panel.className = "fx-rack hidden";
        panel.innerHTML =
            '<div class="fx-head">' +
            '  <div class="fx-sel" id="fx-sel-info"></div>' +
            '  <div class="fx-head-btns">' +
            '    <div class="fx-seg" role="group" aria-label="Easy or Pro"><button type="button" data-mode="easy">Easy</button><button type="button" data-mode="pro">Pro</button></div>' +
            '    <button type="button" class="fx-x" id="fx-close" aria-label="Close FX rack">✕</button>' +
            '  </div>' +
            '</div>' +
            '<div class="fx-tabs" role="tablist">' +
            '  <button type="button" data-tab="chain" role="tab">Effects</button>' +
            '  <button type="button" data-tab="pitch" role="tab">Pitch editor</button>' +
            '  <button type="button" data-tab="auto" role="tab">✨ Auto</button>' +
            '</div>' +
            '<div class="fx-pvbar" id="fx-pvbar">' +
            '  <button type="button" class="fx-btn fx-play" id="fx-play">▶ Preview</button>' +
            '  <div class="fx-seg fx-ab" role="group" aria-label="Compare"><button type="button" data-ab="dry">Original</button><button type="button" data-ab="fx">With effects</button></div>' +
            '  <label class="fx-chk"><input type="checkbox" id="fx-beat" checked> Beat</label>' +
            '  <span class="fx-busy" id="fx-busy" hidden>working…</span>' +
            '  <span class="fx-status" id="fx-status"></span>' +
            '</div>' +
            '<div class="fx-body" id="fx-body"></div>' +
            '<div class="fx-foot" id="fx-foot">' +
            '  <button type="button" class="fx-btn fx-apply" id="fx-apply">Apply to selection</button>' +
            '  <button type="button" class="fx-btn" id="fx-undo">Undo last</button>' +
            '  <button type="button" class="fx-btn fx-ghost" id="fx-revert">Back to original clip</button>' +
            '</div>';
        const transport = $(".studio-transport", layout);
        layout.insertBefore(panel, transport || null);

        $("#fx-close", panel).addEventListener("click", closeRack);
        $$(".fx-seg [data-mode]", panel).forEach((b) => b.addEventListener("click", () => { st.easy = b.dataset.mode === "easy"; try { localStorage.setItem("vl-rack-easy", st.easy ? "1" : "0"); } catch (e) { /* ignore */ } renderAll(); }));
        $$(".fx-tabs [data-tab]", panel).forEach((b) => b.addEventListener("click", () => { st.tab = b.dataset.tab; renderAll(); }));
        $$("[data-ab]", panel).forEach((b) => b.addEventListener("click", () => { st.ab = b.dataset.ab; markAB(); if (st.pv) restartPreview(); }));
        $("#fx-beat", panel).addEventListener("change", (e) => { st.beatOn = e.target.checked; if (st.pv) restartPreview(); });
        $("#fx-play", panel).addEventListener("click", togglePreview);
        $("#fx-apply", panel).addEventListener("click", applyDraft);
        $("#fx-undo", panel).addEventListener("click", undoLast);
        $("#fx-revert", panel).addEventListener("click", revertClip);
    }

    function injectToolbar() {
        const box = $(".studio-toolbar-actions");
        if (!box || $("#fx-open-btn")) return;
        const b1 = document.createElement("button");
        b1.type = "button"; b1.id = "fx-open-btn"; b1.className = "secondary-button studio-tool-btn"; b1.textContent = "🎛 FX Rack";
        b1.title = "Pick a part of a vocal, add plugins, and hear it live before you commit";
        const b2 = document.createElement("button");
        b2.type = "button"; b2.id = "fx-auto-btn"; b2.className = "secondary-button studio-tool-btn fx-auto-btn"; b2.textContent = "✨ Auto-produce";
        b2.title = "Voxloop listens to your vocals and beat and only adds what's needed";
        box.insertBefore(b2, box.firstChild); box.insertBefore(b1, box.firstChild);
        b1.addEventListener("click", () => { if (st.open && st.tab !== "auto") closeRack(); else openRack("chain"); });
        b2.addEventListener("click", () => { openRack("auto"); });
    }

    function openRack(tab) {
        if (!panel) return;
        st.open = true; if (tab) st.tab = tab;
        if (!st.sel && tab !== "auto") autoPickSelection();
        panel.classList.remove("hidden");
        renderAll();
        ensureBeatInfo();
        panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    function closeRack() { stopPreview(); st.open = false; panel.classList.add("hidden"); afterRender(); }

    function autoPickSelection() {
        const ls = lanes();
        const lane = ls.find((l) => l.armed && l.clips.length) || ls.find((l) => l.clips.length);
        if (lane) { const c = lane.clips[lane.clips.length - 1]; select({ laneId: lane.id, clipId: c.id, start: 0, end: c.duration }); }
    }

    // ------------------------------------------------------------------ selecting part of a clip
    let drag = null;
    function bindSelection() {
        const host = $("#studio-lanes");
        if (!host || host.dataset.fxBound) return;
        host.dataset.fxBound = "1";
        host.addEventListener("pointerdown", (e) => {
            const el = e.target.closest && e.target.closest(".studio-clip[data-clip-id]");
            if (!el || e.button > 0) return;
            const found = findClip({ laneId: el.dataset.laneId, clipId: el.dataset.clipId });
            if (!found) return;
            const r = el.getBoundingClientRect();
            drag = { el, laneId: el.dataset.laneId, clipId: el.dataset.clipId, x0: e.clientX, rect: r, dur: found.clip.duration, moved: false, id: e.pointerId };
            try { el.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
        });
        host.addEventListener("pointermove", (e) => {
            if (!drag || e.pointerId !== drag.id) return;
            if (Math.abs(e.clientX - drag.x0) > 5) drag.moved = true;
            if (!drag.moved) return;
            const t0 = clamp((drag.x0 - drag.rect.left) / drag.rect.width * drag.dur, 0, drag.dur);
            const t1 = clamp((e.clientX - drag.rect.left) / drag.rect.width * drag.dur, 0, drag.dur);
            drag.a = Math.min(t0, t1); drag.b = Math.max(t0, t1);
            paintSel(drag.el, drag.a, drag.b, drag.dur);
        });
        const end = (e) => {
            if (!drag || e.pointerId !== drag.id) return;
            const d = drag; drag = null;
            if (d.moved && d.b - d.a >= 0.12) select({ laneId: d.laneId, clipId: d.clipId, start: d.a, end: d.b });
            else if (!d.moved) select({ laneId: d.laneId, clipId: d.clipId, start: 0, end: d.dur });
            else afterRender();
        };
        host.addEventListener("pointerup", end);
        host.addEventListener("pointercancel", end);
    }
    function paintSel(el, a, b, dur) {
        let o = $(".fx-sel-box", el);
        if (!o) { o = document.createElement("div"); o.className = "fx-sel-box"; el.appendChild(o); }
        o.style.left = (a / dur * 100) + "%"; o.style.width = ((b - a) / dur * 100) + "%";
    }
    function select(sel) {
        const changed = !st.sel || st.sel.clipId !== sel.clipId || Math.abs(st.sel.start - sel.start) > 1e-3 || Math.abs(st.sel.end - sel.end) > 1e-3;
        st.sel = sel;
        if (changed) { st.cache = []; st.out = null; st.pitch = null; st.heard = null; st.chain.forEach((p) => { if (p.type === "pitchedit") p.params.moves = {}; }); }
        if (!st.open) { st.open = true; panel.classList.remove("hidden"); if (st.tab === "auto") st.tab = "chain"; }
        afterRender();
        renderAll();
        ensureBeatInfo();
        if (st.pv) schedule(); 
    }
    function afterRender() {
        $$(".studio-clip .fx-sel-box").forEach((n) => n.remove());
        $$(".studio-clip .fx-badge").forEach((n) => n.remove());
        lanes().forEach((l) => l.clips.forEach((c) => {
            const el = $('.studio-clip[data-clip-id="' + c.id + '"]');
            if (!el) return;
            if (c.fxLog && c.fxLog.length) { const b = document.createElement("span"); b.className = "fx-badge"; b.textContent = "fx " + c.fxLog.length; b.title = c.fxLog.map((z) => z.text).join("\n"); el.appendChild(b); }
            if (st.open && st.sel && st.sel.clipId === c.id) paintSel(el, st.sel.start, st.sel.end, c.duration);
        }));
    }

    // ------------------------------------------------------------------ rendering the UI
    function renderAll() {
        if (!panel) return;
        $$(".fx-seg [data-mode]", panel).forEach((b) => b.classList.toggle("is-on", (b.dataset.mode === "easy") === st.easy));
        $$(".fx-tabs [data-tab]", panel).forEach((b) => b.classList.toggle("is-on", b.dataset.tab === st.tab));
        panel.classList.toggle("fx-easy", st.easy);
        markAB(); updateHeader();
        const showPv = st.tab !== "auto";
        $("#fx-pvbar").hidden = !showPv; $("#fx-foot").hidden = !showPv;
        if (st.tab === "chain") renderChain();
        else if (st.tab === "pitch") renderPitch();
        else renderAuto();
    }
    function markAB() { $$("[data-ab]", panel).forEach((b) => b.classList.toggle("is-on", b.dataset.ab === st.ab)); const bt = $("#fx-beat", panel); if (bt) bt.checked = st.beatOn; }
    function updateHeader() {
        const el = $("#fx-sel-info"); if (!el) return;
        const f = findClip();
        let beatTxt = "";
        if (st.beatInfo) beatTxt = '<span class="fx-chip">' + (st.beatInfo.bpm ? Math.round(st.beatInfo.bpm) + " BPM" : "BPM ?") + (st.beatInfo.key ? " · " + esc(st.beatInfo.key.label) : "") + "</span>";
        el.innerHTML = f && st.sel
            ? '<strong>' + esc(f.lane.name) + '</strong> · ' + esc(f.clip.name) + ' <span class="fx-range">' + fmtT(f.clip.start + st.sel.start) + ' → ' + fmtT(f.clip.start + st.sel.end) + ' (' + (st.sel.end - st.sel.start).toFixed(1) + ' s)</span> ' + beatTxt
            : '<span class="fx-hint">Drag across part of a vocal clip to select it — or tap a clip to pick all of it.</span> ' + beatTxt;
    }

    function fmtVal(q, v) {
        const dec = (String(q.step).split(".")[1] || "").length;
        return Number(v).toFixed(dec) + (q.unit || "");
    }
    function chainItem(type, preset) { return { type, params: Fx.withPreset(type, preset || "Default"), bypass: false, reason: "" }; }

    const RECIPES = [
        ["Fix the notes (auto-tune style)", () => [chainItem("tune")], "Select the part with off notes. Lower 'speed' = more robotic."],
        ["Hand-fix notes (blob editor)", () => [chainItem("pitchedit")], "Open the Pitch editor tab and drag a note blob up or down."],
        ["Radio-ready lead", () => { const e = chainItem("eq", "Clean-up"), c = chainItem("comp", "Gentle level"), d = chainItem("deess", "Gentle"), r = chainItem("reverb", "Vocal plate"); return [d, e, c, r]; }, "A safe all-round chain: clean-up, de-ess, level, a little space."],
        ["Chorus doubs (wide doubled vocal)", () => [chainItem("doubler"), chainItem("imager", "Doubled lead width")], "Select a chorus line. Makes it sound doubled and wide."],
        ["Rich hall reverb", () => [chainItem("reverb", "Rich hall")], "Long hall with the lows and harsh highs of the reverb trimmed."],
        ["Slow stereo movement (headphones)", () => [chainItem("orbit")], "Listen on headphones. The voice drifts slowly around you."],
        ["Crowd response", () => [chainItem("crowd")], "Select a short phrase to be 'sung back' by a crowd."],
        ["Voice change chop", () => [chainItem("voice")], "Select a short chopped bit. Change 'Style' for chipmunk / deep."],
        ["Tail-end echo spice", () => [chainItem("delay", "Tail-end throw")], "Select just the last word. The echo only comes in near the end."]
    ];

    function renderChain() {
        const body = $("#fx-body");
        const cats = {}; Fx.ORDER.forEach((id) => { const p = Fx.P[id]; (cats[p.cat] = cats[p.cat] || []).push(p); });
        let addOpts = '<option value="">+ Add a plugin…</option>';
        Object.keys(cats).forEach((c) => { addOpts += '<optgroup label="' + esc(c) + '">' + cats[c].map((p) => '<option value="' + p.id + '">' + esc(p.name) + (st.easy ? "" : " — " + esc(p.likeA)) + "</option>").join("") + "</optgroup>"; });
        let recOpts = '<option value="">Quick start…</option>' + RECIPES.map((r, i) => '<option value="' + i + '">' + esc(r[0]) + "</option>").join("");

        let html = '<div class="fx-addrow"><select id="fx-recipe" aria-label="Quick start">' + recOpts + '</select><select id="fx-add" aria-label="Add plugin">' + addOpts + "</select>" +
            '<button type="button" class="fx-btn fx-ghost" id="fx-whole">Select whole clip</button></div>';
        html += '<div id="fx-recipe-tip" class="fx-tip" hidden></div>';
        if (st.heard) html += '<div class="fx-heard"><strong>What I heard</strong><ul>' + st.heard.map((f) => '<li class="' + (f.ok ? "ok" : "warn") + '">' + esc(f.text) + "</li>").join("") + "</ul></div>";
        if (!st.chain.length) html += '<div class="fx-empty">No plugins yet. Pick a <b>Quick start</b>, add a plugin, or press <b>✨ Auto</b> and let Voxloop decide what this part needs.</div>';
        html += '<div class="fx-chain" id="fx-chain">';
        st.chain.forEach((pl, i) => { html += cardHtml(pl, i); });
        html += "</div>";
        html += '<div class="fx-autoone"><button type="button" class="fx-btn fx-auto" id="fx-auto-one">✨ Auto: what does this part need?</button></div>';
        body.innerHTML = html;

        $("#fx-add").addEventListener("change", (e) => { if (e.target.value) addPlugin(e.target.value); });
        $("#fx-recipe").addEventListener("change", (e) => {
            if (e.target.value === "") return;
            const r = RECIPES[+e.target.value];
            st.chain = r[1](); st.cache = [];
            if (st.chain.some((p) => p.type === "pitchedit")) st.tab = "pitch";
            renderAll();
            const tip = $("#fx-recipe-tip"); if (tip) { tip.hidden = false; tip.textContent = "Tip: " + r[2]; }
            schedule();
        });
        $("#fx-whole").addEventListener("click", () => { const f = findClip(); if (f) select({ laneId: f.lane.id, clipId: f.clip.id, start: 0, end: f.clip.duration }); });
        $("#fx-auto-one").addEventListener("click", autoThis);
        bindCards(body);
    }

    function cardHtml(pl, i) {
        const def = Fx.P[pl.type];
        const keys = st.easy ? def.easy : def.params.map((q) => q.k);
        let rows = "";
        keys.forEach((k) => {
            const q = def.params.find((x) => x.k === k); if (!q) return;
            const label = st.easy && q.easyLabel ? q.easyLabel : q.label;
            const v = pl.params[k];
            if (q.type === "select") {
                rows += '<label class="fx-p"><span>' + esc(label) + '</span><select data-i="' + i + '" data-k="' + k + '">' + q.options.map((o) => '<option' + (String(o) === String(v) ? " selected" : "") + ">" + esc(o) + "</option>").join("") + "</select></label>";
            } else {
                const pos = q.invert ? q.min + q.max - v : v;
                rows += '<label class="fx-p"><span>' + esc(label) + '</span><input type="range" min="' + q.min + '" max="' + q.max + '" step="' + q.step + '" value="' + pos + '" data-i="' + i + '" data-k="' + k + '"><output>' + fmtVal(q, v) + "</output></label>";
            }
        });
        const presets = Object.keys(def.presets || {});
        return '<div class="fx-card' + (pl.bypass ? " is-bypassed" : "") + '" data-i="' + i + '">' +
            '<div class="fx-card-h"><button type="button" class="fx-pow" data-act="bypass" aria-label="Turn on or off" title="On / off">' + (pl.bypass ? "○" : "●") + "</button>" +
            '<div class="fx-card-t"><strong>' + esc(def.icon + " " + def.name) + "</strong>" + (st.easy ? "" : '<small>' + esc(def.likeA) + "</small>") + "</div>" +
            '<select class="fx-preset" data-act="preset" aria-label="Preset"><option value="">Preset…</option>' + presets.map((p) => "<option>" + esc(p) + "</option>").join("") + "</select>" +
            '<div class="fx-card-b"><button type="button" data-act="up" title="Move earlier">↑</button><button type="button" data-act="down" title="Move later">↓</button><button type="button" data-act="del" title="Remove">✕</button></div></div>' +
            (st.easy ? '<p class="fx-blurb">' + esc(def.blurb) + "</p>" : "") +
            (pl.reason ? '<p class="fx-why">Why: ' + esc(pl.reason) + "</p>" : "") +
            '<div class="fx-params">' + rows + "</div></div>";
    }

    function bindCards(root) {
        $$("#fx-chain .fx-card", root).forEach((card) => {
            const i = +card.dataset.i;
            card.addEventListener("click", (e) => {
                const act = e.target.dataset && e.target.dataset.act; if (!act) return;
                if (act === "bypass") { st.chain[i].bypass = !st.chain[i].bypass; st.cache = []; renderChain(); schedule(); }
                else if (act === "del") { st.chain.splice(i, 1); st.cache = []; renderChain(); schedule(); }
                else if (act === "up" && i > 0) { [st.chain[i - 1], st.chain[i]] = [st.chain[i], st.chain[i - 1]]; st.cache = []; renderChain(); schedule(); }
                else if (act === "down" && i < st.chain.length - 1) { [st.chain[i + 1], st.chain[i]] = [st.chain[i], st.chain[i + 1]]; st.cache = []; renderChain(); schedule(); }
            });
            const pre = $('[data-act="preset"]', card);
            pre.addEventListener("change", () => {
                if (!pre.value) return;
                const pl = st.chain[i], keepMoves = pl.params.moves;
                pl.params = Fx.withPreset(pl.type, pre.value); if (keepMoves) pl.params.moves = keepMoves; pl.reason = "";
                renderChain(); schedule();
            });
            $$("[data-k]", card).forEach((inp) => {
                const k = inp.dataset.k, pl = st.chain[i], def = Fx.P[pl.type], q = def.params.find((x) => x.k === k);
                inp.addEventListener("input", () => {
                    let v = inp.type === "range" ? +inp.value : inp.value;
                    if (q.type === "range") { if (q.invert) v = q.min + q.max - v; inp.parentNode.querySelector("output").textContent = fmtVal(q, v); }
                    pl.params[k] = v; pl.reason = "";
                    if (pl.type === "comp") { if (k === "amount") pl.params._easy = 1; else delete pl.params._easy; }
                    schedule();
                });
            });
        });
    }

    function addPlugin(id) {
        const it = chainItem(id);
        if (id === "pitchedit" || id === "tune") st.chain.unshift(it); else st.chain.push(it);
        if (id === "pitchedit") { const j = st.chain.indexOf(it); if (j > 0) { st.chain.splice(j, 1); st.chain.unshift(it); } }
        st.cache = [];
        if (id === "pitchedit") st.tab = "pitch";
        renderAll(); schedule();
    }

    // ------------------------------------------------------------------ render the draft (what you hear in preview)
    function setBusy(on, msg) { const b = $("#fx-busy"); if (b) { b.hidden = !on; if (msg) b.textContent = msg; } }
    function schedule() {
        if (!st.sel || !findClip()) return;
        clearTimeout(st.timer);
        st.timer = setTimeout(runDraft, 140);
    }
    async function runDraft() {
        const f = findClip(); if (!f) return;
        if (st.running) { st.again = true; return; }
        st.running = true; setBusy(true, "working…");
        try {
            do {
                st.again = false;
                const seg = segAudio(f.clip, st.sel.start, st.sel.end);
                const key0 = f.clip.id + ":" + st.rev + ":" + seg.s0 + ":" + seg.s1;
                const r = await Fx.runChain(seg.channels, seg.sr, st.chain, env(), st.cache, key0);
                st.out = r.channels; st.dry = seg.channels; st.outSr = seg.sr;
                if (!st.again) { if (st.pv) restartPreview(); }
            } while (st.again);
        } catch (e) { console.warn("[FX Rack] render failed", e); status("Effect failed: " + (e.message || e).toString().split("\n")[0]); }
        st.running = false; setBusy(false);
    }

    // ------------------------------------------------------------------ live preview (loops the selection over the beat)
    function previewBuffers() {
        const ctx = api().ensureCtx(), sr = st.outSr;
        const wet = st.ab === "fx" ? st.out : st.dry;
        const len = Math.max(st.out[0].length, st.dry[0].length);
        const nch = Math.max(wet.length, 1);
        const vb = ctx.createBuffer(nch, len, sr);
        for (let c = 0; c < nch; c++) { const src = wet[Math.min(c, wet.length - 1)]; const d = new Float32Array(len); d.set(src.subarray(0, Math.min(src.length, len))); vb.copyToChannel(d, c); }
        let bb = null;
        const B = beat();
        if (st.beatOn && B.buffer) {
            const f = findClip(), t0 = f.clip.start + st.sel.start, bsr = B.buffer.sampleRate;
            const n = Math.round(len / sr * bsr);
            bb = ctx.createBuffer(B.buffer.numberOfChannels, n, bsr);
            const a = Math.round(t0 * bsr);
            for (let c = 0; c < B.buffer.numberOfChannels; c++) { const d = new Float32Array(n), s = B.buffer.getChannelData(c); for (let i = 0; i < n && a + i < s.length; i++) d[i] = s[a + i]; bb.copyToChannel(d, c); }
        }
        return { ctx, vb, bb, L: len / sr };
    }
    function startPreview(pos) {
        if (!st.out) return;
        stopVoice();
        if (api().pause) api().pause();
        const { ctx, vb, bb, L } = previewBuffers();
        const t0 = ctx.currentTime + 0.03, off = (pos || 0) % L;
        const v = ctx.createBufferSource(); v.buffer = vb; v.loop = true; v.loopEnd = L;
        const vg = ctx.createGain(); vg.gain.value = 1; v.connect(vg); vg.connect(ctx.destination); v.start(t0, off);
        const nodes = [v];
        if (bb) { const b = ctx.createBufferSource(); b.buffer = bb; b.loop = true; b.loopEnd = L; const bg = ctx.createGain(); bg.gain.value = 0.85; b.connect(bg); bg.connect(ctx.destination); b.start(t0, off); nodes.push(b); }
        st.pv = { ctx, nodes, t0, off, L };
        $("#fx-play").textContent = "■ Stop preview"; $("#fx-play").classList.add("is-on");
    }
    function stopVoice() { if (st.pv) { st.pv.nodes.forEach((n) => { try { n.stop(); } catch (e) { /* ignore */ } }); st.pv = null; } }
    function stopPreview() { stopVoice(); const p = $("#fx-play"); if (p) { p.textContent = "▶ Preview"; p.classList.remove("is-on"); } }
    function restartPreview() {
        if (!st.pv || !st.out) return;
        const pos = ((st.pv.ctx.currentTime - st.pv.t0) + st.pv.off) % st.pv.L;
        const keepL = st.pv.L;
        startPreview(Math.min(pos, keepL));
    }
    async function togglePreview() {
        if (st.pv) { stopPreview(); return; }
        if (!st.sel || !findClip()) { status("Select part of a vocal clip first"); return; }
        if (!st.out) { clearTimeout(st.timer); await runDraft(); }
        if (st.out) startPreview(0);
    }

    // ------------------------------------------------------------------ bake into the clip
    function bake(clip, s0, segLen, out, sr, text) {
        const ctx = api().ensureCtx(), buf = clip.buffer;
        const n0 = buf.length, nch = Math.max(buf.numberOfChannels, out.length), outLen = out[0].length, newLen = Math.max(n0, s0 + outLen);
        const res = [];
        for (let c = 0; c < nch; c++) { const o = new Float32Array(newLen); o.set(buf.getChannelData(Math.min(c, buf.numberOfChannels - 1))); res.push(o); }
        const fade = Math.max(2, Math.round(0.006 * sr));
        for (let c = 0; c < nch; c++) {
            const oc = out[Math.min(c, out.length - 1)], rc = res[c];
            for (let i = 0; i < outLen; i++) {
                const idx = s0 + i;
                if (i < segLen) {
                    let w = 1;
                    if (s0 > 0 && i < fade) w = i / fade;
                    else if (i > segLen - fade && s0 + segLen < n0) w = (segLen - i) / fade;
                    rc[idx] = rc[idx] * (1 - w) + oc[i] * w;
                } else rc[idx] += oc[i];
            }
        }
        const nb = ctx.createBuffer(nch, newLen, sr);
        res.forEach((r, c) => nb.copyToChannel(r, c));
        clip.fxHistory = clip.fxHistory || [];
        if (!clip.original) clip.original = { buffer: buf, duration: clip.duration };
        clip.fxHistory.push({ buffer: buf, duration: clip.duration, log: (clip.fxLog || []).length });
        if (clip.fxHistory.length > 10) clip.fxHistory.shift();
        clip.buffer = nb; clip.duration = newLen / sr;
        clip.fxLog = (clip.fxLog || []).concat([{ text }]);
        st.rev++; st.cache = [];
    }
    function refreshDaw() { const a = api(); if (a.renderLanes) a.renderLanes(); if (a.updateTotals) a.updateTotals(); if (a.refreshRoles) a.refreshRoles(); }
    const chainText = (chain, a, b) => chain.filter((p) => !p.bypass).map((p) => Fx.P[p.type].name).join(" + ") + " @ " + fmtT(a) + "–" + fmtT(b);

    async function applyDraft() {
        const f = findClip();
        if (!f || !st.sel) { status("Select part of a vocal clip first"); return; }
        if (!st.chain.filter((p) => !p.bypass).length) { status("Add at least one plugin first"); return; }
        stopPreview();
        setBusy(true, "applying…");
        try {
            clearTimeout(st.timer);
            while (st.running) await new Promise((r) => setTimeout(r, 30));
            const seg = segAudio(f.clip, st.sel.start, st.sel.end);
            const r = await Fx.runChain(seg.channels, seg.sr, st.chain, env());
            bake(f.clip, seg.s0, seg.s1 - seg.s0, r.channels, seg.sr, chainText(st.chain, f.clip.start + st.sel.start, f.clip.start + st.sel.end));
            st.chain = []; st.out = null; st.pitch = null; st.heard = null;
            refreshDaw(); afterRender(); renderAll();
            status("Applied. Press Undo last if you don't like it.");
        } catch (e) { console.warn(e); status("Could not apply: " + (e.message || e).toString().split("\n")[0]); }
        setBusy(false);
    }
    function undoLast() {
        const f = findClip(); if (!f || !f.clip.fxHistory || !f.clip.fxHistory.length) { status("Nothing to undo on this clip"); return; }
        stopPreview();
        const h = f.clip.fxHistory.pop();
        f.clip.buffer = h.buffer; f.clip.duration = h.duration; f.clip.fxLog = (f.clip.fxLog || []).slice(0, h.log);
        st.rev++; st.cache = []; st.out = null; st.pitch = null;
        refreshDaw(); afterRender(); renderAll(); status("Undid the last effect");
    }
    function revertClip() {
        const f = findClip(); if (!f || !f.clip.original) { status("This clip has no effects to remove"); return; }
        stopPreview();
        f.clip.buffer = f.clip.original.buffer; f.clip.duration = f.clip.original.duration; f.clip.fxLog = []; f.clip.fxHistory = []; delete f.clip.original;
        if (st.sel) st.sel.end = Math.min(st.sel.end, f.clip.duration);
        st.rev++; st.cache = []; st.out = null; st.pitch = null;
        refreshDaw(); afterRender(); renderAll(); status("Clip is back to how it was recorded");
    }

    // ------------------------------------------------------------------ Auto on the selection
    async function autoThis() {
        const f = findClip(); if (!f || !st.sel) { status("Select part of a vocal clip first"); return; }
        if (!window.VLBrain) { status("fxbrain.js is not loaded"); return; }
        setBusy(true, "listening…");
        try {
            const bi = await ensureBeatInfo();
            const seg = segAudio(f.clip, st.sel.start, st.sel.end);
            const r = await window.VLBrain.analyzeClip(seg.channels, seg.sr, { type: f.lane.type, style: st.planStyle, beat: bi || {}, beatKeyConfidence: bi && bi.source && bi.source.key === "Beat Lab" ? 1 : 0 });
            st.heard = r.findings; st.chain = r.chain; st.cache = [];
            st.tab = "chain"; renderAll(); schedule();
            status(r.chain.length ? "Here's what this part needs. Press Preview to hear it." : "This part already sounds good. Nothing needed.");
        } catch (e) { console.warn(e); status("Could not analyse: " + (e.message || e)); }
        setBusy(false);
    }

    // ------------------------------------------------------------------ Pitch editor (blob view)
    let eng = null;
    const tuneEng = () => { if (!eng && typeof window.createTuneEngine === "function") eng = window.createTuneEngine(); return eng; };

    async function ensurePitch() {
        const f = findClip(); if (!f || !st.sel) return null;
        const seg = segAudio(f.clip, st.sel.start, st.sel.end);
        const key = f.clip.id + ":" + st.rev + ":" + seg.s0 + ":" + seg.s1;
        if (st.pitch && st.pitch.key === key) return st.pitch;
        st.pitch = { key, loading: true };
        const k = env().key || { rootPc: 0, scale: "major" };
        const mono = Fx.util.mono(seg.channels);
        const r = await Fx.runTask("analyze", { mono, sr: seg.sr, rootPc: k.rootPc, scale: k.scale });
        if (!st.pitch || st.pitch.key !== key) return null;
        st.pitch = Object.assign({ key, hopSec: r.hop / r.sr, dur: (seg.s1 - seg.s0) / seg.sr }, r);
        return st.pitch;
    }
    function pitchItem(create) {
        let it = st.chain.find((p) => p.type === "pitchedit");
        if (!it && create) { it = chainItem("pitchedit"); st.chain.unshift(it); }
        return it;
    }
    function devPct(P, n) { let s = 0, c = 0; for (let k = n.start; k < n.end && k < P.midi.length; k++) { const m = P.midi[k]; if (!isNaN(m)) { s += Math.abs(m - n.center) * 100; c++; } } return c ? s / c : 0; }

    async function renderPitch() {
        const body = $("#fx-body");
        const f = findClip();
        if (!f || !st.sel) { body.innerHTML = '<div class="fx-empty">Select part of a vocal clip, then come back here to see its notes as blobs.</div>'; return; }
        body.innerHTML = '<div class="fx-empty">Reading the notes…</div>';
        let P;
        try { P = await ensurePitch(); } catch (e) { body.innerHTML = '<div class="fx-empty">Could not read the pitch: ' + esc(e.message || e) + "</div>"; return; }
        if (!P || st.tab !== "pitch") return;
        if (!P.notes || !P.notes.length) { body.innerHTML = '<div class="fx-empty">I couldn\'t find clear sung notes in this selection. Try selecting a held vowel or a longer phrase.</div>'; return; }
        const it = pitchItem(false);
        const moves = (it && it.params.moves) || {}, vf = it ? (it.params.variation == null ? 100 : it.params.variation) / 100 : 1;
        const avg = P.notes.reduce((a, n) => a + devPct(P, n), 0) / P.notes.length;
        body.innerHTML =
            '<div class="fx-pitch-top">' +
            '<span class="fx-chip" title="How much the pitch wobbles inside each note, on average">Pitch variation: ' + (avg * vf).toFixed(2) + '%</span>' +
            '<label class="fx-p fx-p-inline"><span>' + (st.easy ? "Wobble: steady ← → expressive" : "Pitch variation") + '</span><input type="range" id="fx-var" min="0" max="200" step="1" value="' + (it ? it.params.variation : 100) + '"><output id="fx-var-o">' + (it ? it.params.variation : 100) + '%</output></label>' +
            '<div class="fx-seg" id="fx-snap" role="group" aria-label="Snap"><button type="button" data-snap="scale">Snap: key</button><button type="button" data-snap="semitone">Semitone</button><button type="button" data-snap="free">Free</button></div>' +
            '<button type="button" class="fx-btn" id="fx-snapall">Snap all to key</button>' +
            '<button type="button" class="fx-btn fx-ghost" id="fx-resetnotes">Reset notes</button>' +
            "</div>" +
            '<div class="fx-pitch-wrap" id="fx-pitch-wrap"><canvas id="fx-pitch" aria-label="Pitch blobs. Drag a note up or down."></canvas><div class="fx-pitch-tip" id="fx-pitch-tip" hidden></div></div>' +
            '<p class="fx-tip">Drag a blob up or down to move that note. Double-tap a blob to snap it to the key. ' + (env().key ? "Key: " + esc(st.beatInfo.key.label) + "." : "No beat key known yet, so notes snap to the nearest semitone.") + "</p>";
        $$("#fx-snap [data-snap]").forEach((b) => { b.classList.toggle("is-on", b.dataset.snap === st.snap); b.addEventListener("click", () => { st.snap = b.dataset.snap; renderPitch(); }); });
        $("#fx-var").addEventListener("input", (e) => { const p = pitchItem(true); p.params.variation = +e.target.value; $("#fx-var-o").textContent = e.target.value + "%"; drawPitch(P); schedule(); });
        $("#fx-resetnotes").addEventListener("click", () => { const p = pitchItem(false); if (p) { p.params.moves = {}; p.params.variation = 100; } st.cache = []; renderPitch(); schedule(); });
        $("#fx-snapall").addEventListener("click", () => {
            const p = pitchItem(true), E = tuneEng(), k = env().key;
            P.notes.forEach((n) => { const t = snapTarget(n.center, k, E, "scale"); p.params.moves[n.start] = t - n.center; });
            st.cache = []; drawPitch(P); schedule();
        });
        bindPitchCanvas(P);
        drawPitch(P);
        if (!st.out) schedule();
    }

    function snapTarget(m, key, E, mode) {
        if (mode === "free") return m;
        if (mode === "scale" && key && E) { try { const mask = E.scaleMask(key.rootPc, key.scale); return E.nearestNote(m, key.rootPc, mask, false); } catch (e) { /* fall through */ } }
        return Math.round(m);
    }

    const PV = { pxSec: 150, gutter: 40, H: 300, lo: 0, hi: 0, rowH: 10, blobs: [], drag: null };
    function drawPitch(P) {
        const cv = $("#fx-pitch"); if (!cv) return;
        const wrap = $("#fx-pitch-wrap");
        const it = pitchItem(false), moves = (it && it.params.moves) || {}, vf = it ? (it.params.variation == null ? 100 : it.params.variation) / 100 : 1;
        const W = Math.max(wrap.clientWidth || 600, Math.ceil(P.dur * PV.pxSec) + PV.gutter + 20), H = PV.H;
        const dpr = window.devicePixelRatio || 1;
        cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + "px"; cv.style.height = H + "px";
        const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0);
        let lo = 1e9, hi = -1e9;
        P.notes.forEach((n) => { const c = n.center + (moves[n.start] || 0); lo = Math.min(lo, c, n.center); hi = Math.max(hi, c, n.center); });
        PV.lo = Math.floor(lo) - 3; PV.hi = Math.ceil(hi) + 3; if (PV.hi - PV.lo < 12) PV.hi = PV.lo + 12;
        PV.rowH = H / (PV.hi - PV.lo);
        const yOf = (m) => H - (m - PV.lo + 0.5) * PV.rowH;
        const key = env().key, E = tuneEng(), mask = key && E ? E.scaleMask(key.rootPc, key.scale) : null;
        const cs = getComputedStyle(document.documentElement);
        const col = (n, d) => (cs.getPropertyValue(n).trim() || d);
        g.fillStyle = col("--surface", "#181521"); g.fillRect(0, 0, W, H);
        for (let m = PV.lo; m <= PV.hi; m++) {
            const pc = ((m % 12) + 12) % 12, black = [1, 3, 6, 8, 10].indexOf(pc) >= 0, inKey = mask ? mask[pc] : !black;
            const y = H - (m - PV.lo + 1) * PV.rowH;
            g.fillStyle = inKey ? "rgba(124,92,252,0.10)" : "rgba(255,255,255,0.015)"; g.fillRect(PV.gutter, y, W, PV.rowH);
            g.fillStyle = "rgba(255,255,255,0.05)"; g.fillRect(PV.gutter, y + PV.rowH - 1, W, 1);
            if (pc === 0 || inKey) { g.fillStyle = inKey ? "#c6c2d8" : "#6b6585"; g.font = "10px system-ui"; g.textBaseline = "middle"; g.fillText(noteName(m), 4, y + PV.rowH / 2); }
        }
        PV.blobs = [];
        P.notes.forEach((n) => {
            const mv = (PV.drag && PV.drag.n === n) ? PV.drag.move : (moves[n.start] || 0);
            const x0 = PV.gutter + n.start * P.hopSec * PV.pxSec, w = Math.max(6, (n.end - n.start) * P.hopSec * PV.pxSec);
            const cy = yOf(n.center + mv), h = Math.max(8, PV.rowH * 0.78);
            PV.blobs.push({ n, x: x0, y: cy - h / 2, w, h, mv });
            if (mv) { g.setLineDash([3, 3]); g.strokeStyle = "rgba(255,255,255,0.35)"; g.beginPath(); g.moveTo(x0, yOf(n.center)); g.lineTo(x0 + w, yOf(n.center)); g.stroke(); g.setLineDash([]); }
            const grad = g.createLinearGradient(0, cy - h / 2, 0, cy + h / 2);
            grad.addColorStop(0, mv ? "#a894ff" : "#8a6cff"); grad.addColorStop(1, mv ? "#7c5cfc" : "#5f43e0");
            g.fillStyle = grad; g.strokeStyle = mv ? "#d8ceff" : "rgba(255,255,255,0.25)";
            const r = Math.min(h / 2, 10); g.beginPath();
            if (g.roundRect) g.roundRect(x0, cy - h / 2, w, h, r); else g.rect(x0, cy - h / 2, w, h);
            g.fill(); g.stroke();
            // the real pitch curve inside the blob (with the variation setting applied)
            g.strokeStyle = col("--vocal", "#3fd0b8"); g.lineWidth = 1.6; g.beginPath();
            let pen = false;
            for (let k = n.start; k < n.end && k < P.midi.length; k++) {
                const m = P.midi[k]; if (isNaN(m)) { pen = false; continue; }
                const mm = n.center + mv + (m - n.center) * vf, x = PV.gutter + k * P.hopSec * PV.pxSec, y = yOf(mm);
                if (!pen) { g.moveTo(x, y); pen = true; } else g.lineTo(x, y);
            }
            g.stroke(); g.lineWidth = 1;
        });
    }

    function bindPitchCanvas(P) {
        const cv = $("#fx-pitch"), tip = $("#fx-pitch-tip"), wrap = $("#fx-pitch-wrap");
        if (!cv) return;
        const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
        const hit = (p) => PV.blobs.find((b) => p.x >= b.x - 2 && p.x <= b.x + b.w + 2 && p.y >= b.y - 4 && p.y <= b.y + b.h + 4);
        const E = tuneEng();
        const showTip = (b, e) => {
            const it = pitchItem(false), vf = it ? (it.params.variation == null ? 100 : it.params.variation) / 100 : 1;
            tip.hidden = false;
            tip.textContent = noteName(b.n.center + b.mv) + "  ·  variation: " + (devPct(P, b.n) * vf).toFixed(2) + "%" + (b.mv ? "  ·  moved " + (b.mv > 0 ? "+" : "") + b.mv.toFixed(2) + " st" : "");
            const wr = wrap.getBoundingClientRect();
            tip.style.left = clamp(e.clientX - wr.left + wrap.scrollLeft + 12, 0, 2000) + "px"; tip.style.top = clamp(e.clientY - wr.top - 30, 0, 300) + "px";
        };
        cv.style.touchAction = "pan-x";
        cv.addEventListener("pointerdown", (e) => {
            const p = pos(e), b = hit(p); if (!b) return;
            const it = pitchItem(true);
            PV.drag = { n: b.n, y0: p.y, move0: it.params.moves[b.n.start] || 0, move: it.params.moves[b.n.start] || 0, id: e.pointerId };
            cv.setPointerCapture(e.pointerId); cv.style.touchAction = "none"; e.preventDefault();
        });
        cv.addEventListener("pointermove", (e) => {
            const p = pos(e);
            if (PV.drag && e.pointerId === PV.drag.id) {
                const k = env().key, d = PV.drag;
                let target = d.n.center + d.move0 - (p.y - d.y0) / PV.rowH;
                target = snapTarget(target, k, E, st.snap);
                d.move = target - d.n.center;
                drawPitch(P);
                const b = PV.blobs.find((x) => x.n === d.n); if (b) showTip(b, e);
                return;
            }
            const b = hit(p); cv.style.cursor = b ? "grab" : "default";
            if (b) showTip(b, e); else tip.hidden = true;
        });
        const up = (e) => {
            if (!PV.drag || e.pointerId !== PV.drag.id) return;
            const d = PV.drag; PV.drag = null; cv.style.touchAction = "pan-x";
            const it = pitchItem(true);
            if (Math.abs(d.move) < 0.001) delete it.params.moves[d.n.start]; else it.params.moves[d.n.start] = d.move;
            st.cache = []; drawPitch(P); schedule();
        };
        cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
        cv.addEventListener("pointerleave", () => { if (!PV.drag) tip.hidden = true; });
        cv.addEventListener("dblclick", (e) => {
            const b = hit(pos(e)); if (!b) return;
            const it = pitchItem(true), t = snapTarget(b.n.center, env().key, E, st.snap === "free" ? "semitone" : st.snap);
            const mv = t - b.n.center; if (Math.abs(mv) < 0.001) delete it.params.moves[b.n.start]; else it.params.moves[b.n.start] = mv;
            st.cache = []; drawPitch(P); schedule();
        });
    }

    // ------------------------------------------------------------------ Auto-produce (whole project)
    function renderAuto() {
        const body = $("#fx-body");
        const styles = [["natural", "Natural", "Keeps it sounding like you. Gentle tuning, light space."], ["polished", "Polished", "Radio-ready balance. Tight tuning, clean tone."], ["big", "Big", "Thicker, wider, more reverb. Strong tuning."]];
        const fl = [["doubs", "Doubles in the big parts of the song"], ["tails", "Echo on the last word of lines"], ["crowd", "Crowd answering back"], ["voice", "Voice-change spice on the final sound"], ["orbit", "Slow stereo movement (headphones)"], ["ride", "Even out phrase loudness with volume automation (Auto-ride)"]];
        let html = '<div class="fx-auto">' +
            '<p class="fx-lead">Voxloop listens to your beat and each vocal, then adds <b>only what is needed</b>. If something already sounds good it is left alone, and you\'ll see why.</p>' +
            '<div class="fx-styles" role="radiogroup" aria-label="Style">' + styles.map((s) => '<button type="button" role="radio" aria-checked="' + (st.planStyle === s[0]) + '" class="fx-style' + (st.planStyle === s[0] ? " is-on" : "") + '" data-style="' + s[0] + '"><strong>' + s[1] + "</strong><small>" + s[2] + "</small></button>").join("") + "</div>" +
            '<details class="fx-flav"' + (Object.values(st.flavors).some(Boolean) ? " open" : "") + "><summary>Optional extras (style, not needs)</summary>" +
            fl.map((f) => '<label class="fx-chk"><input type="checkbox" data-flav="' + f[0] + '"' + (st.flavors[f[0]] ? " checked" : "") + "> " + f[1] + "</label>").join("") +
            '<div class="fx-intens"><span>How much:</span><div class="fx-seg" id="fx-intens" role="group" aria-label="How much">' + [["subtle", "Subtle"], ["normal", "Normal"], ["lots", "Lots"]].map((i) => '<button type="button" data-int="' + i[0] + '" class="' + (st.intensity === i[0] ? "is-on" : "") + '">' + i[1] + "</button>").join("") + "</div></div></details>" +
            '<button type="button" class="fx-btn fx-auto" id="fx-listen">✨ Listen & make a plan</button> <span class="fx-busy" id="fx-plan-busy" hidden></span>' +
            '<div id="fx-plan"></div></div>';
        body.innerHTML = html;
        $$(".fx-style", body).forEach((b) => b.addEventListener("click", () => { st.planStyle = b.dataset.style; renderAuto(); }));
        $$("[data-flav]", body).forEach((c) => c.addEventListener("change", () => { st.flavors[c.dataset.flav] = c.checked; }));
        $$("#fx-intens [data-int]", body).forEach((b) => b.addEventListener("click", () => { st.intensity = b.dataset.int; $$("#fx-intens button", body).forEach((x) => x.classList.toggle("is-on", x === b)); }));
        $("#fx-listen").addEventListener("click", makePlan);
        if (st.plan) renderPlan();
    }

    async function makePlan() {
        if (!window.VLBrain) { status("fxbrain.js is not loaded"); return; }
        const withClips = lanes().filter((l) => l.clips.some((c) => c.buffer));
        if (!withClips.length) { $("#fx-plan").innerHTML = '<div class="fx-empty">Record or import a vocal first, then I can listen to it.</div>'; return; }
        const busy = $("#fx-plan-busy"); busy.hidden = false; busy.textContent = "Listening to the beat…";
        $("#fx-listen").disabled = true;
        try {
            const plan = await window.VLBrain.planProject(withClips, beat().buffer, { style: st.planStyle, flavors: st.flavors, intensity: st.intensity, onProgress: (n) => { busy.textContent = "Listening to " + n + "…"; } });
            plan.lanes.forEach((e) => { e.include = true; });
            st.plan = plan; st.beatInfo = plan.beat || st.beatInfo; st.beatFor = beat().buffer;
            updateHeader();
        } catch (e) { console.warn(e); $("#fx-plan").innerHTML = '<div class="fx-empty">Something went wrong while listening: ' + esc(e.message || e) + "</div>"; }
        busy.hidden = true; $("#fx-listen").disabled = false;
        renderPlan();
    }

    function renderPlan() {
        const host = $("#fx-plan"); if (!host || !st.plan) return;
        const b = st.plan.beat || {};
        let html = (st.plan.vibe ? '<div class="fx-vibe"><b>What I hear in the beat:</b> ' + esc(st.plan.vibe) + "</div>" : "") + '<div class="fx-beatline">' + (beat().buffer ? "Beat: <b>" + (b.bpm ? Math.round(b.bpm) + " BPM" : "tempo unknown") + "</b> · <b>" + (b.key ? esc(b.key.label) : "key unknown") + "</b>" + (b.source && b.source.key ? " (" + esc(b.source.key) + ")" : "") + " · " + ((b.sections || []).length ? (b.sections.length + " big section" + (b.sections.length > 1 ? "s" : "")) : "no big sections found") : "No beat loaded, so I judged the vocals on their own.") + "</div>";
        st.plan.lanes.forEach((e, i) => {
            html += '<div class="fx-lane-plan"><label class="fx-lane-h"><input type="checkbox" data-inc="' + i + '"' + (e.include ? " checked" : "") + '> <strong>' + esc(e.laneName) + "</strong> <small>" + esc(e.clipName) + "</small></label>" +
                (e.vocal ? '<div class="fx-vocalline">I hear: ' + esc(e.vocal) + "</div>" : "") +
                '<ul class="fx-find">' + e.findings.map((f) => '<li class="' + (f.ok ? "ok" : "warn") + '">' + esc(f.text) + "</li>").join("") + "</ul>";
            if (e.chain.length) html += '<div class="fx-doing"><b>I\'ll add:</b> ' + e.chain.map((c) => '<span class="fx-pill" title="' + esc(c.reason) + '">' + esc(Fx.P[c.type].name) + "</span>").join("") + "</div>" + '<ul class="fx-reasons">' + e.chain.map((c) => "<li><b>" + esc(Fx.P[c.type].name) + ":</b> " + esc(c.reason) + "</li>").join("") + "</ul>";
            else html += '<div class="fx-doing"><b>Nothing needed</b>: this one already sounds good.</div>';
            if (e.extra.length) html += '<div class="fx-doing"><b>Extras (tap one to hear it):</b> ' + e.extra.map((z, zi) => '<button type="button" class="fx-pill alt fx-zone" data-lane="' + i + '" data-zone="' + zi + '" title="' + esc(z.chain[0].reason) + '">' + esc(z.label) + " @ " + fmtT(z.start) + "</button>").join("") + "</div>" + '<ul class="fx-reasons">' + e.extra.map((z) => "<li><b>" + esc(z.label) + ":</b> " + esc(z.chain[0].reason) + "</li>").join("") + "</ul>";
            if (e.skippedCrowd) html += '<div class="fx-doing"><b>Crowd skipped:</b> it rarely suits this style. Choose "Lots" if you want it anyway.</div>';
            html += '<button type="button" class="fx-btn fx-ghost" data-open="' + i + '">Open in rack to preview</button></div>';
        });
        html += '<div class="fx-plan-foot"><button type="button" class="fx-btn fx-apply" id="fx-plan-apply">Apply to checked vocals</button><span class="fx-hint">You can undo each clip afterwards.</span></div>';
        host.innerHTML = html;
        $$("[data-inc]", host).forEach((c) => c.addEventListener("change", () => { st.plan.lanes[+c.dataset.inc].include = c.checked; }));
        $$("[data-open]", host).forEach((b2) => b2.addEventListener("click", () => {
            const e = st.plan.lanes[+b2.dataset.open], f = findClip({ laneId: e.laneId, clipId: e.clipId });
            if (!f) return;
            st.chain = clone(e.chain); st.heard = e.findings; st.cache = []; st.tab = "chain";
            select({ laneId: e.laneId, clipId: e.clipId, start: 0, end: f.clip.duration });
            schedule();
        }));
        $$(".fx-zone", host).forEach((b3) => b3.addEventListener("click", () => {
            const e = st.plan.lanes[+b3.dataset.lane], z = e.extra[+b3.dataset.zone], f = findClip({ laneId: e.laneId, clipId: e.clipId });
            if (!f || !z) return;
            st.chain = clone(z.chain); st.heard = null; st.cache = []; st.tab = "chain";
            select({ laneId: e.laneId, clipId: e.clipId, start: Math.max(0, z.start - 0.4), end: Math.min(f.clip.duration, z.end + 0.2) });
            schedule();
            status("Press Preview to hear: " + z.label);
        }));
        $("#fx-plan-apply").addEventListener("click", applyPlan);
    }

    async function applyPlan() {
        const todo = st.plan.lanes.filter((e) => e.include && (e.chain.length || e.extra.length));
        if (!todo.length) { status("Nothing to apply"); return; }
        stopPreview();
        const btn = $("#fx-plan-apply"); btn.disabled = true;
        const busy = $("#fx-plan-busy"); busy.hidden = false;
        let done = 0;
        try {
            for (const e of todo) {
                const f = findClip({ laneId: e.laneId, clipId: e.clipId }); if (!f) continue;
                busy.textContent = "Processing " + e.laneName + " (" + (done + 1) + "/" + todo.length + ")…";
                const bi = st.beatInfo || {};
                if (e.chain.length) {
                    const seg = segAudio(f.clip, 0, f.clip.duration);
                    const r = await Fx.runChain(seg.channels, seg.sr, e.chain, { bpm: bi.bpm, key: bi.key ? { rootPc: bi.key.rootPc, scale: bi.key.scale } : null });
                    bake(f.clip, 0, seg.s1, r.channels, seg.sr, "Auto: " + e.chain.map((c) => Fx.P[c.type].name).join(" + "));
                }
                for (const z of e.extra) {
                    busy.textContent = "Adding " + z.label.toLowerCase() + " on " + e.laneName + "…";
                    const seg = segAudio(f.clip, z.start, z.end);
                    const r = await Fx.runChain(seg.channels, seg.sr, z.chain, { bpm: bi.bpm, key: null });
                    bake(f.clip, seg.s0, seg.s1 - seg.s0, r.channels, seg.sr, "Auto: " + z.label);
                }
                if (st.flavors.ride && window.VLAuto) { const lane = f.lane; busy.textContent = "Riding the fader on " + e.laneName + "…"; window.VLAuto.ride(lane); }
                done++;
            }
            refreshDaw(); afterRender();
            status("Auto-produce done on " + done + " clip" + (done === 1 ? "" : "s") + ". Select a clip to fine-tune or undo.");
            st.plan = null; st.out = null; st.pitch = null;
            renderAuto();
            $("#fx-plan").innerHTML = '<div class="fx-done">✓ Done. Press play to listen. Tap a clip to tweak or undo its effects.</div>';
        } catch (err) { console.warn(err); status("Auto-produce stopped: " + (err.message || err)); }
        busy.hidden = true; btn.disabled = false;
    }

    // ------------------------------------------------------------------ boot
    function init() {
        D = window.VocalVaultDAW;
        if (!D) { setTimeout(init, 200); return; }
        buildPanel(); injectToolbar(); bindSelection();
        $("#tr-play") && $("#tr-play").addEventListener("click", stopPreview);
        $$(".mode-btn").forEach((b) => b.addEventListener("click", () => { if (b.dataset.mode !== "studio") stopPreview(); }));
        window.addEventListener("vl-set-beat-studio", () => { st.beatInfo = null; st.beatFor = null; st.plan = null; setTimeout(() => { if (st.open) ensureBeatInfo(); }, 400); });
        afterRender();
    }
    // used by the Reference panel: drop a plugin into the draft chain with specific settings
    function addPluginWith(id, params, reason) {
        if (!Fx.P[id]) return;
        if (!st.open) openRack("chain");
        const it = chainItem(id);
        Object.assign(it.params, params || {});
        it.reason = reason || "";
        const same = st.chain.findIndex((p) => p.type === id);
        if (same >= 0) st.chain.splice(same, 1);             // replace, never stack two of the same suggestion
        if (id === "pitchedit" || id === "tune") st.chain.unshift(it); else st.chain.push(it);
        st.tab = "chain"; st.cache = [];
        renderAll(); schedule();
    }
    window.VLRack = { afterRender, select, open: openRack, state: st, addPlugin: addPluginWith };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
