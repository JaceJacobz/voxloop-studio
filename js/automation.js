/**
 * Voxloop Studio — Volume automation
 *
 * Each vocal lane can have a volume curve drawn over the song (lane.auto.volume = [{ t: seconds, db }]).
 *  - Tap the automation button on a lane to open its automation row.
 *  - Tap empty space to add a point, drag to move, double-tap (or right-click / long-press) to delete.
 *  - Fade in / Fade out / Auto-ride (smooths loud and quiet phrases) / Undo / Clear.
 * The curve is used while the song plays (it updates live as you drag), when the mix is rendered for
 * the reference panel, and when "Send mix to Pipeline" builds the vocal, so what you hear is what is sent.
 *
 * daw.js calls VLAuto.has / .schedule / .afterRender.
 */
(function () {
    "use strict";

    const TOP = 6, BOT = -30, SILENT = -60;
    const ROW_H = 104, PAD_T = 12, PAD_B = 18, SILENT_ZONE = 12;
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const fmtT = (s) => { const m = Math.floor(s / 60); return m + ":" + (s - m * 60).toFixed(1).padStart(4, "0"); };
    const fmtDb = (db) => (db <= SILENT + 0.5 ? "silent" : (db < 0 ? "−" : db > 0 ? "+" : "") + Math.abs(db).toFixed(1) + " dB");
    const D = () => window.VocalVaultDAW;
    const api = () => (D() && D().api) || {};
    const status = (m) => { if (api().status) api().status(m); };

    // ------------------------------------------------------------------ the curve (shared with daw.js)
    const pts = (lane) => (lane && lane.auto && lane.auto.volume) || [];
    const has = (lane) => pts(lane).length > 0;
    const lin = (db) => (db <= SILENT + 0.01 ? 0 : Math.pow(10, db / 20));

    function dbAt(p, t) {
        if (!p.length) return 0;
        if (t <= p[0].t) return p[0].db;
        const last = p[p.length - 1];
        if (t >= last.t) return last.db;
        for (let i = 1; i < p.length; i++) {
            if (t <= p[i].t) {
                const a = p[i - 1], b = p[i], u = (t - a.t) / Math.max(1e-6, b.t - a.t);
                return a.db + (b.db - a.db) * u;     // straight line in dB, which sounds smooth
            }
        }
        return last.db;
    }

    /** Put the curve onto an AudioParam. Timeline seconds tFrom..tTo play at audio-clock time `when`... */
    function schedule(param, lane, base, tFrom, tTo, when) {
        const p = pts(lane);
        const g = (t) => base * lin(dbAt(p, t));
        param.setValueAtTime(g(tFrom), when);
        if (!(tTo > tFrom)) return;
        const times = [tFrom];
        p.forEach((q) => { if (q.t > tFrom + 1e-4 && q.t < tTo - 1e-4) times.push(q.t); });
        times.push(tTo);
        for (let i = 0; i < times.length - 1; i++) {
            const a = times[i], b = times[i + 1], steps = (b - a) > 0.03 ? 8 : 1;
            for (let k = 1; k <= steps; k++) {
                const t = a + (b - a) * k / steps;
                param.linearRampToValueAtTime(g(t), when + (t - tFrom));
            }
        }
    }

    // ------------------------------------------------------------------ editing helpers
    function ensure(lane) { if (!lane.auto) lane.auto = {}; if (!lane.auto.volume) lane.auto.volume = []; return lane.auto.volume; }
    function sortPts(lane) { ensure(lane).sort((a, b) => a.t - b.t); }
    function snapshot(lane) { lane.autoUndo = lane.autoUndo || []; lane.autoUndo.push(JSON.stringify(pts(lane))); if (lane.autoUndo.length > 12) lane.autoUndo.shift(); }
    function changed(lane, redraw) {
        sortPts(lane);
        if (redraw) redraw();
        refreshHead(lane);
        if (api().refreshAutomation) api().refreshAutomation();
    }
    function laneEnd(lane) {
        let e = 0; lane.clips.forEach((c) => { e = Math.max(e, c.start + c.duration); });
        return e || (api().totalDuration ? api().totalDuration() : 30);
    }
    function laneStart(lane) { let s = Infinity; lane.clips.forEach((c) => { s = Math.min(s, c.start); }); return isFinite(s) ? s : 0; }

    // ------------------------------------------------------------------ geometry
    const yOf = (db, H) => {
        const top = PAD_T, bot = H - PAD_B - SILENT_ZONE;
        if (db <= SILENT + 0.01) return H - PAD_B + 2;
        if (db >= BOT) return top + (TOP - clamp(db, BOT, TOP)) / (TOP - BOT) * (bot - top);
        return bot + (BOT - db) / (BOT - SILENT) * (H - PAD_B + 2 - bot);
    };
    const dbOfY = (y, H) => {
        const top = PAD_T, bot = H - PAD_B - SILENT_ZONE;
        if (y >= bot + SILENT_ZONE * 0.55) return SILENT;
        if (y >= bot) return BOT - (y - bot) / (SILENT_ZONE * 0.55) * 8;
        return TOP - clamp((y - top) / (bot - top), 0, 1) * (TOP - BOT);
    };
    const gridSec = () => {
        const b = window.VLRack && window.VLRack.state && window.VLRack.state.beatInfo;
        return b && b.bpm ? 60 / b.bpm / 4 : 0.05;
    };

    // ------------------------------------------------------------------ one automation row
    function buildRow(laneRow, lane) {
        const track = laneRow.querySelector(".studio-lane-track");
        const W = Math.max(300, parseFloat(track && track.style.minWidth) || (api().timelineWidth ? api().timelineWidth() : 1200));
        const row = document.createElement("div");
        row.className = "studio-lane studio-auto-row";
        row.dataset.autoFor = lane.id;
        row.innerHTML =
            '<div class="studio-lane-head auto-head">' +
            '<span class="lane-color" style="background:' + lane.color + '"></span>' +
            '<div class="auto-meta"><strong>Volume</strong><small>' + esc(lane.name) + "</small></div>" +
            '<div class="auto-btns">' +
            '<button type="button" data-a="fadein" title="Fade in" aria-label="Fade in">' + VLI("fadein", 14) + '<span class="btn-label"> Fade in</span></button>' +
            '<button type="button" data-a="fadeout" title="Fade out" aria-label="Fade out">' + VLI("fadeout", 14) + '<span class="btn-label"> Fade out</span></button>' +
            '<button type="button" data-a="ride" class="is-ai" title="Auto-ride: evens out loud and quiet phrases" aria-label="Auto-ride">' + VLI("sparkle", 14) + '<span class="btn-label"> Auto-ride</span></button>' +
            '<button type="button" data-a="undo" title="Undo last change" aria-label="Undo last change">' + VLI("undo", 14) + '</button>' +
            '<button type="button" data-a="clear" title="Clear" aria-label="Clear">' + VLI("trash", 14) + '<span class="btn-label"> Clear</span></button>' +
            '</div>' +
            '<label class="auto-snap" title="Snap points to the beat"><input type="checkbox" data-a="snap" checked>' + VLI("snap", 14) + '<span class="btn-label"> Snap to beat</span></label>' +
            "</div>" +
            '<div class="studio-lane-track auto-track" style="min-width:' + W + 'px"><canvas class="auto-canvas" width="' + W + '" height="' + ROW_H + '"></canvas></div>';
        laneRow.parentNode.insertBefore(row, laneRow.nextSibling);

        const cv = row.querySelector("canvas");
        const snapBox = row.querySelector('[data-a="snap"]');
        const state = { drag: null, hover: null, press: null, tip: "" };
        const redraw = () => draw(cv, lane, state);
        const pps = () => (api().pxPerSec ? api().pxPerSec() : 80);

        const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * (cv.width / r.width), y: (e.clientY - r.top) * (cv.height / r.height) }; };
        const hit = (p) => { const arr = pts(lane); for (let i = 0; i < arr.length; i++) { const dx = arr[i].t * pps() - p.x, dy = yOf(arr[i].db, ROW_H) - p.y; if (dx * dx + dy * dy <= 13 * 13) return i; } return -1; };
        const toPoint = (p) => {
            let t = Math.max(0, p.x / pps()), db = dbOfY(p.y, ROW_H);
            if (snapBox.checked) { const g = gridSec(); t = Math.round(t / g) * g; }
            if (Math.abs(db) < 0.8) db = 0;                      // magnet at 0 dB (unity)
            else if (db > SILENT + 1) db = Math.round(db * 2) / 2;
            return { t: Math.round(t * 1000) / 1000, db };
        };

        cv.addEventListener("pointerdown", (e) => {
            if (e.button > 0) return;
            const p = pos(e); let i = hit(p);
            snapshot(lane);
            if (i < 0) { const q = toPoint(p); ensure(lane).push(q); sortPts(lane); i = pts(lane).indexOf(q); }
            state.drag = { q: pts(lane)[i], id: e.pointerId, moved: false, x0: e.clientX, y0: e.clientY };
            // long press = delete (touch friendly)
            clearTimeout(state.press);
            state.press = setTimeout(() => { if (state.drag && !state.drag.moved) { const k = pts(lane).indexOf(state.drag.q); if (k >= 0) { pts(lane).splice(k, 1); state.drag = null; changed(lane, redraw); status("Point removed"); } } }, 650);
            try { cv.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
            e.preventDefault(); redraw();
        });
        cv.addEventListener("pointermove", (e) => {
            const p = pos(e);
            if (state.drag && e.pointerId === state.drag.id) {
                const d = state.drag;
                if (Math.abs(e.clientX - d.x0) + Math.abs(e.clientY - d.y0) > 4) { d.moved = true; clearTimeout(state.press); }
                const q = toPoint(p); d.q.t = q.t; d.q.db = q.db;
                state.tip = fmtDb(q.db) + "  @ " + fmtT(q.t);
                sortPts(lane); redraw();
                if (api().refreshAutomation) api().refreshAutomation();
                return;
            }
            const i = hit(p); state.hover = i; cv.style.cursor = i >= 0 ? "grab" : "crosshair"; redraw();
        });
        const up = (e) => {
            if (!state.drag || e.pointerId !== state.drag.id) return;
            clearTimeout(state.press);
            state.drag = null; state.tip = "";
            changed(lane, redraw);
        };
        cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
        cv.addEventListener("dblclick", (e) => { const i = hit(pos(e)); if (i >= 0) { snapshot(lane); pts(lane).splice(i, 1); changed(lane, redraw); } });
        cv.addEventListener("contextmenu", (e) => { e.preventDefault(); const i = hit(pos(e)); if (i >= 0) { snapshot(lane); pts(lane).splice(i, 1); changed(lane, redraw); } });
        cv.addEventListener("pointerleave", () => { state.hover = null; redraw(); });

        row.querySelector(".auto-btns").addEventListener("click", (e) => {
            const a = e.target.dataset && e.target.dataset.a; if (!a) return;
            if (a === "clear") { if (!has(lane)) return; snapshot(lane); lane.auto.volume = []; changed(lane, redraw); status("Volume automation cleared (press Undo to bring it back)"); }
            else if (a === "undo") { if (!lane.autoUndo || !lane.autoUndo.length) { status("Nothing to undo"); return; } lane.auto = { volume: JSON.parse(lane.autoUndo.pop()) }; changed(lane, redraw); }
            else if (a === "fadein") {
                snapshot(lane); const s = laneStart(lane), len = Math.min(1.2, (laneEnd(lane) - s) / 4);
                addPoints(lane, [{ t: s, db: SILENT }, { t: s + len, db: dbAt(pts(lane), s + len) > SILENT + 1 ? dbAt(pts(lane), s + len) : 0 }]); changed(lane, redraw);
            } else if (a === "fadeout") {
                snapshot(lane); const e2 = laneEnd(lane), len = Math.min(1.5, (e2 - laneStart(lane)) / 4), v = dbAt(pts(lane), e2 - len);
                addPoints(lane, [{ t: e2 - len, db: v > SILENT + 1 ? v : 0 }, { t: e2, db: SILENT }]); changed(lane, redraw);
            } else if (a === "ride") autoRide(lane, redraw);
        });
        redraw();
        return row;
    }
    function addPoints(lane, list) {
        const arr = ensure(lane);
        list.forEach((q) => { const near = arr.findIndex((x) => Math.abs(x.t - q.t) < 0.02); if (near >= 0) arr[near].db = q.db; else arr.push({ t: Math.round(q.t * 1000) / 1000, db: q.db }); });
        sortPts(lane);
    }

    function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

    // ------------------------------------------------------------------ drawing
    function draw(cv, lane, state) {
        const g = cv.getContext("2d"), W = cv.width, H = cv.height;
        const cs = getComputedStyle(document.documentElement);
        const col = (n, d) => cs.getPropertyValue(n).trim() || d;
        const pps = api().pxPerSec ? api().pxPerSec() : 80;
        g.clearRect(0, 0, W, H);
        // where the lane actually has audio
        g.fillStyle = "rgba(63,208,184,0.07)";
        lane.clips.forEach((c) => { g.fillRect(c.start * pps, PAD_T - 6, c.duration * pps, H - PAD_T - PAD_B + 12); });
        // dB grid
        g.font = "10px system-ui"; g.textBaseline = "middle";
        [6, 0, -6, -12, -24].forEach((db) => {
            const y = yOf(db, H);
            g.strokeStyle = db === 0 ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.07)";
            g.setLineDash(db === 0 ? [] : [3, 4]); g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(W, y + 0.5); g.stroke(); g.setLineDash([]);
            g.fillStyle = "rgba(198,194,216,0.55)"; g.fillText((db > 0 ? "+" : db < 0 ? "−" : "") + Math.abs(db), 6, y - 7);
        });
        g.fillStyle = "rgba(198,194,216,0.4)"; g.fillText("silent", 6, H - 7);

        const arr = pts(lane);
        if (!arr.length) {
            g.fillStyle = "rgba(198,194,216,0.6)"; g.font = "12px system-ui";
            g.fillText("Tap anywhere to add a volume point. Drag to move it, double-tap to remove.", 130, yOf(0, H) - 16);
            return;
        }
        // curve (flat before the first and after the last point)
        const ptsXY = arr.map((q) => [q.t * pps, yOf(q.db, H)]);
        const accent = col("--accent-hi", "#a894ff");
        g.beginPath(); g.moveTo(0, ptsXY[0][1]);
        ptsXY.forEach((q) => g.lineTo(q[0], q[1]));
        g.lineTo(W, ptsXY[ptsXY.length - 1][1]);
        g.lineTo(W, H - PAD_B + 2); g.lineTo(0, H - PAD_B + 2); g.closePath();
        g.fillStyle = "rgba(124,92,252,0.16)"; g.fill();
        g.beginPath(); g.moveTo(0, ptsXY[0][1]); ptsXY.forEach((q) => g.lineTo(q[0], q[1])); g.lineTo(W, ptsXY[ptsXY.length - 1][1]);
        g.strokeStyle = accent; g.lineWidth = 2; g.stroke(); g.lineWidth = 1;
        arr.forEach((q, i) => {
            const x = q.t * pps, y = yOf(q.db, H), on = (state.drag && state.drag.q === q) || state.hover === i;
            g.beginPath(); g.arc(x, y, on ? 7 : 5.5, 0, Math.PI * 2);
            g.fillStyle = on ? "#fff" : col("--bg", "#110f18"); g.fill();
            g.strokeStyle = accent; g.lineWidth = 2; g.stroke(); g.lineWidth = 1;
        });
        if (state.tip) {
            const q = state.drag && state.drag.q; if (q) {
                const x = q.t * pps, y = yOf(q.db, H), w = g.measureText(state.tip).width + 14;
                const bx = clamp(x - w / 2, 2, W - w - 2), by = y < 36 ? y + 14 : y - 32;
                g.fillStyle = "rgba(17,15,24,0.92)"; g.strokeStyle = accent;
                g.fillRect(bx, by, w, 20); g.strokeRect(bx + 0.5, by + 0.5, w - 1, 19);
                g.fillStyle = "#f1eff8"; g.font = "11px system-ui"; g.fillText(state.tip, bx + 7, by + 10.5);
            }
        }
    }

    // ------------------------------------------------------------------ Auto-ride: even out loud and quiet phrases
    function autoRide(lane, redraw) {
        const B = window.VLBrain;
        if (!B) { status("fxbrain.js is not loaded"); return; }
        const clips = lane.clips.filter((c) => c.buffer);
        if (!clips.length) { status("This lane has no audio yet"); return; }
        const rides = [];
        clips.forEach((c) => {
            const ch = []; for (let k = 0; k < c.buffer.numberOfChannels; k++) ch.push(c.buffer.getChannelData(k));
            const sr = c.buffer.sampleRate, m = ch[0], meas = B.measureVocal(ch, sr);
            (meas.phrases || []).forEach((p) => {
                const a = Math.floor(p.start * sr), b = Math.min(m.length, Math.floor(p.end * sr));
                let s = 0; for (let i = a; i < b; i++) s += m[i] * m[i];
                const db = 10 * Math.log10(Math.max(1e-12, s / Math.max(1, b - a)));
                rides.push({ t0: c.start + p.start, t1: c.start + p.end, db });
            });
        });
        if (rides.length < 2) { status("Not enough separate phrases to even out"); return; }
        const target = rides.reduce((t, r) => t + r.db, 0) / rides.length;      // aim for the average phrase loudness
        const list = [];
        let moved = 0, up = 0, down = 0;
        rides.forEach((r) => {
            const off = clamp((target - r.db) * 0.7, -4, 4);
            if (Math.abs(off) < 0.8) return;
            moved++; if (off > 0) up++; else down++;
            const v = Math.round(off * 2) / 2;
            list.push({ t: Math.max(0, r.t0 - 0.12), db: 0 }, { t: r.t0, db: v }, { t: r.t1, db: v }, { t: r.t1 + 0.15, db: 0 });
        });
        if (!moved) { status("This lane is already even. No rides needed."); return; }
        snapshot(lane);
        lane.auto = { volume: [] };
        // keep the first/last point at 0 dB where adjacent rides touch
        const dedup = [];
        list.sort((a, b) => a.t - b.t).forEach((q) => { const prev = dedup[dedup.length - 1]; if (prev && Math.abs(prev.t - q.t) < 0.02) prev.db = Math.abs(q.db) > Math.abs(prev.db) ? q.db : prev.db; else dedup.push({ t: Math.round(q.t * 1000) / 1000, db: q.db }); });
        lane.auto.volume = dedup;
        changed(lane, redraw);
        status("Auto-ride: raised " + up + " quiet phrase" + (up === 1 ? "" : "s") + " and dipped " + down + " loud one" + (down === 1 ? "" : "s") + " (of " + rides.length + "). Press Undo to revert.");
    }

    // ------------------------------------------------------------------ hooking into the lanes
    function refreshHead(lane) {
        const b = document.querySelector('.studio-lane[data-lane-id="' + lane.id + '"] [data-act="autoview"]');
        if (b) { b.classList.toggle("has-auto", has(lane)); b.classList.toggle("is-on", !!lane.autoOpen); }
    }

    function afterRender() {
        const lanes = (D() && D().lanes) || [];
        document.querySelectorAll(".studio-lane[data-lane-id]").forEach((laneRow) => {
            const lane = lanes.find((l) => l.id === laneRow.dataset.laneId); if (!lane) return;
            const btns = laneRow.querySelector(".lane-btns");
            if (btns && !btns.querySelector('[data-act="autoview"]')) {
                const b = document.createElement("button");
                b.type = "button"; b.className = "lane-btn lane-btn-auto"; b.dataset.act = "autoview"; b.innerHTML = VLI("automation", 16);
                b.title = "Volume automation: draw volume changes over the song";
                b.setAttribute("aria-label", "Volume automation for " + lane.name);
                b.addEventListener("click", () => { lane.autoOpen = !lane.autoOpen; if (api().renderLanes) api().renderLanes(); });
                btns.insertBefore(b, btns.firstChild);
            }
            refreshHead(lane);
            if (lane.autoOpen) buildRow(laneRow, lane);
        });
    }

    window.VLAuto = { has, schedule, afterRender, dbAt, lin, ride: (lane) => autoRide(lane, () => { if (api().renderLanes) api().renderLanes(); }) };
})();
