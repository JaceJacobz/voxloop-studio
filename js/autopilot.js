/**
 * Voxloop — Autopilot (Pipeline)
 *
 * Pick a vocal and a beat and Voxloop does the rest: align, analyze, clean up, tune, mix and master.
 * It drives the SAME steps a person would (their buttons and their controls), so everything it does can still be seen
 * and changed afterwards. Each step has an Auto switch: on = Voxloop decides, off = it uses the settings you chose.
 * Touching any control in a step switches that step's Auto off by itself, the way touching the wheel takes over a
 * self-driving car. "Take over" stops the run and leaves the steps for manual use.
 *
 * Decisions come from autodecide.js (pure, tested in Node) plus the existing brains (mixbrain, genre, voice id).
 */
(function () {
    "use strict";
    if (typeof document === "undefined") return;

    const $ = (id) => document.getElementById(id);
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const STEPS = [["load", "Load"], ["align", "Align"], ["analyze", "Analyze"], ["clean", "Clean-up"], ["tune", "Tune"], ["mix", "Mix & master"]];
    const SECTION = { align: "alignment-section", analyze: "analysis-section", clean: "prep-section", tune: "tune-section", mix: "mix-section" };
    const KEY = "vl-autopilot";
    const Deck = () => window.VLApDeck;
    const DECK_STEPS = [{ key: "align", label: "Align" }, { key: "parts", label: "Choose" }, { key: "analyze", label: "Analyze" }, { key: "clean", label: "Clean-up" }, { key: "tune", label: "Tune" }, { key: "mix", label: "Mix" }];
    const TITLES = { align: "Align", analyze: "Analyze", clean: "Clean-up", tune: "Tune", mix: "Mix & master" };
    // While Autopilot drives, nothing may scroll the page to the section it just opened (that is what made you chase the progress up and
    // down the page). The steps still open underneath; only the jump is skipped. A part you do yourself scrolls there once, on purpose.
    window.VLNoAutoScroll = false;
    (function guardScroll() {
        const orig = Element.prototype.scrollIntoView;
        Element.prototype.scrollIntoView = function () {
            if (window.VLNoAutoScroll && this && this.id && /^(upload|alignment|analysis|prep|tune|mix)-section$/.test(this.id)) return;
            return orig.apply(this, arguments);
        };
    })();

    const prefs = (() => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { return {}; } })();
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ on: A.on, stepAuto: A.stepAuto })); } catch (e) { /* private mode */ } };
    const A = {
        on: prefs.on !== false,
        stepAuto: Object.assign({ align: true, analyze: true, clean: true, tune: true, mix: true }, prefs.stepAuto || {}),
        running: false, cancelled: false, state: "idle", current: null, error: null, summary: [], decisions: {}, runs: 0
    };
    class Cancelled extends Error { }

    // ------------------------------------------------------------------ small helpers
    async function waitFor(cond, ms, what) {
        const t0 = Date.now();
        for (;;) {
            if (A.cancelled) throw new Cancelled("Taken over");
            let v; try { v = cond(); } catch (e) { v = false; }
            if (v) return v;
            if (Date.now() - t0 > ms) throw new Error("Timed out waiting for " + what);
            await sleep(120);
        }
    }
    const shown = (id) => { const e = $(id); return !!e && !e.classList.contains("hidden"); };
    const fire = (el, type) => el && el.dispatchEvent(new Event(type, { bubbles: true }));
    function setSelect(id, value) { const e = $(id); if (!e) return false; if (![...e.options].some((o) => o.value === String(value))) return false; e.value = String(value); fire(e, "change"); return true; }
    function setCheck(id, on) { const e = $(id); if (!e) return; if (e.checked !== !!on) { e.checked = !!on; } fire(e, "change"); }
    // the key engine reports { key: "A", scale: "Minor", confidence } (names, not numbers)
    const PC = { C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11 };
    function keyOf(k) { if (!k || !k.key || PC[k.key] == null) return null; const sc = String(k.scale || "major").toLowerCase(); return { rootPc: PC[k.key], scale: sc.indexOf("min") === 0 ? "minor" : "major", label: k.key + " " + (sc.indexOf("min") === 0 ? "minor" : "major"), confidence: k.confidence }; }
    const chans = (b) => { const o = []; for (let c = 0; c < Math.min(2, b.numberOfChannels); c++) o.push(b.getChannelData(c)); return o; };
    const headline = {};   // the step bar shows the first decision of a step, not the last line added
    function note(step, lines) { const L = Array.isArray(lines) ? lines : [lines]; L.forEach((l) => A.summary.push({ step, text: l })); A.decisions[step] = (A.decisions[step] || []).concat(L); if (!headline[step]) { headline[step] = true; stepBar(step, L[0]); } }

    // ------------------------------------------------------------------ UI
    let card = null;
    function buildCard() {
        if (card) return card;
        const rail = $("step-rail"); if (!rail) return null;
        card = document.createElement("section");
        card.id = "autopilot-card"; card.className = "ap-card"; card.dataset.state = "idle";
        card.setAttribute("aria-label", "Autopilot");
        card.innerHTML =
            '<div class="ap-head"><div><strong class="ap-title">Autopilot</strong><span class="ap-sub" id="ap-sub"></span></div>' +
            '<label class="toggle ap-toggle" title="Autopilot on or off"><input type="checkbox" id="ap-toggle"><span class="toggle-ui"></span><span class="sr-only">Autopilot</span></label></div>' +
            '<ol class="ap-steps" id="ap-steps">' + STEPS.map((s) => '<li data-ap="' + s[0] + '"><span class="ap-dot"></span>' + s[1] + "</li>").join("") + "</ol>" +
            '<p class="ap-now" id="ap-now" aria-live="polite"></p>' +
            '<div class="ap-actions"><button type="button" class="secondary-button small" id="ap-takeover" hidden>Take over</button><button type="button" class="secondary-button small" id="ap-again" hidden>Run Autopilot again</button></div>' +
            '<details class="ap-summary" id="ap-summary" hidden><summary><span id="ap-summary-title">What Voxloop did</span></summary><div id="ap-summary-body"></div></details>';
        rail.parentNode.insertBefore(card, rail.nextSibling);
        const tg = $("ap-toggle"); tg.checked = A.on;
        tg.addEventListener("change", () => { A.on = tg.checked; save(); paint(); if (A.on) maybeStart(); });
        $("ap-takeover").addEventListener("click", () => { A.cancelled = true; });
        $("ap-again").addEventListener("click", () => run(true));
        paint(); return card;
    }
    function paint() {
        if (!card) return;
        card.dataset.state = A.state;
        const sub = $("ap-sub");
        sub.textContent = !A.on ? "Off: you drive each step" : A.state === "running" ? "Driving" : A.state === "done" ? "Finished" : A.state === "error" ? "Stopped" : A.state === "cancelled" ? "You took over" : "On: choose a vocal and a beat";
        const order = STEPS.map((s) => s[0]), cur = order.indexOf(A.current);
        card.querySelectorAll("#ap-steps li").forEach((li) => {
            const i = order.indexOf(li.dataset.ap); let st = "todo";
            if (A.state === "done") st = "done"; else if (A.current) st = i < cur ? "done" : i === cur ? (A.state === "error" ? "error" : "now") : "todo";
            li.dataset.st = st;
        });
        $("ap-takeover").hidden = A.state !== "running";
        $("ap-again").hidden = !(A.state === "done" || A.state === "error" || A.state === "cancelled");
        const total = A.summary.length;
        const box = $("ap-summary"); box.hidden = !(A.state === "done" && total);
        if (!box.hidden) {
            $("ap-summary-title").textContent = "What Voxloop did (" + total + " edit" + (total === 1 ? "" : "s") + ")";
            const by = {}; A.summary.forEach((x) => (by[x.step] = by[x.step] || []).push(x.text));
            const names = Object.fromEntries(STEPS);
            $("ap-summary-body").innerHTML = Object.keys(by).map((k) => "<h4>" + (names[k] || k) + "</h4><ul>" + by[k].map((t) => "<li>" + t.replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</li>").join("") + "</ul>").join("");
        }
    }
    function say(t) { const n = $("ap-now"); if (n) n.textContent = t; if (A.card) A.card.say(t); paint(); }

    // per-step "Auto" bars: the same switch exists at every step
    function stepBar(step, text) {
        const sec = $(SECTION[step]); if (!sec) return;
        let bar = sec.querySelector(".ap-stepbar");
        if (!bar) {
            bar = document.createElement("div"); bar.className = "ap-stepbar";
            bar.innerHTML = '<button type="button" class="ap-pill" aria-pressed="true" title="Auto: Voxloop decides this step. Tap to take over.">Auto</button><span class="ap-chose"></span>';
            const head = sec.querySelector(".step-heading");
            head ? head.after(bar) : sec.prepend(bar);
            bar.querySelector(".ap-pill").addEventListener("click", () => { A.stepAuto[step] = !A.stepAuto[step]; save(); stepBar(step); });
            // touching any control takes the wheel: this step's Auto goes off
            sec.addEventListener("input", (ev) => takeWheel(ev, step));
            sec.addEventListener("change", (ev) => takeWheel(ev, step));
        }
        const on = A.stepAuto[step];
        const pill = bar.querySelector(".ap-pill"); pill.setAttribute("aria-pressed", String(on)); pill.classList.toggle("is-on", on);
        pill.textContent = on ? "Auto" : "Manual";
        if (text != null) bar.querySelector(".ap-chose").textContent = text;
        else if (!on) bar.querySelector(".ap-chose").textContent = "Using your settings";
    }
    function takeWheel(ev, step) {
        if (!ev.isTrusted || A.running) return;
        if (ev.target.closest && ev.target.closest(".ap-stepbar")) return;
        if (A.stepAuto[step]) { A.stepAuto[step] = false; save(); stepBar(step); }
    }

    // ------------------------------------------------------------------ the deck: ask, confirm, hand back
    const clip = (t) => (String(t).length > 150 ? String(t).slice(0, 147) + "…" : String(t));
    async function runStep(key, fn) {
        const D = Deck();
        const h = D && D.isOpen ? D.progress({ key, title: TITLES[key] || key, text: "" }) : null;
        A.card = h;
        try { await fn(); } finally { A.card = null; }
        if (h) await h.finish(A.summary.filter((x) => x.step === key).map((x) => clip(x.text)));
    }
    // a part the person chose to do themselves: hide the deck, take them to that step once, wait for "Continue"
    async function manualGate(key) {
        const D = Deck(); if (!D || !D.isOpen) return;
        const sec = $(SECTION[key]), name = (STEPS.find((x) => x[0] === key) || [0, key])[1];
        window.VLNoAutoScroll = false;
        // the deck locks the page's scroll; take the person to the step once the deck is out of the way
        await D.handBack({ title: "Your turn: " + name, text: "Do it your way, then tap Continue.", resumeLabel: "Continue Autopilot", onHidden: () => { if (sec) sec.scrollIntoView({ behavior: "auto", block: "start" }); } });
        window.VLNoAutoScroll = true;
        if (A.cancelled) throw new Cancelled();
    }
    // a few seconds of the vocal against the beat at the chosen offset, so the alignment can be judged by ear
    function startPreview(offsetSec) {
        const S = window.VLState, ctx = S && S.audioContext, vb = S && S.vocalBuffer, bb = S && S.beatBuffer;
        if (!ctx || !vb || !bb) return null;
        try { if (ctx.state === "suspended") ctx.resume(); } catch (e) { /* ignore */ }
        const vd = vb.getChannelData(0); let pk = 0; for (let i = 0; i < vd.length; i += 64) pk = Math.max(pk, Math.abs(vd[i]));
        let first = 0; for (let i = 0; i < vd.length; i++) if (Math.abs(vd[i]) >= pk * 0.1) { first = i / vb.sampleRate; break; }
        const t0 = Math.max(0, offsetSec + first - 1.5), dur = 10, now = ctx.currentTime + 0.05, nodes = [];
        const play = (buf, startAt, offIn, gain) => { const src = ctx.createBufferSource(), g = ctx.createGain(); src.buffer = buf; g.gain.value = gain; src.connect(g); g.connect(ctx.destination); src.start(now + startAt, Math.max(0, offIn), dur - startAt); nodes.push(src); return src; };
        play(bb, 0, t0, 0.7);
        const vOff = t0 - offsetSec;                                           // where in the vocal to start
        play(vb, Math.max(0, -vOff), Math.max(0, vOff), 1);
        return { stop() { nodes.forEach((n) => { try { n.stop(); } catch (e) { /* already ended */ } }); } };
    }
    const fmtOffset = (v) => (Math.abs(v) < 0.0005 ? "exactly as recorded" : Math.abs(v).toFixed(3) + " s " + (v > 0 ? "later" : "earlier"));
    // The "Is the vocal lined up?" card. You hear the WHOLE song (beat and vocal) from where the vocal comes in, can tap the picture to
    // jump anywhere, loop a few seconds, and every nudge moves only the vocal while it plays (js/alignplay.js). v2.25.4: before, "Hear it"
    // played ten seconds once and went silent while the button still said "Stop".
    const WAVE_BEAT = "rgba(255, 255, 255, .38)";
    function peaksOf(buf, n) {
        const d = buf.getChannelData(0), step = Math.max(1, Math.floor(d.length / n)), out = new Float32Array(n); let mx = 1e-6;
        for (let i = 0; i < n; i++) { let m = 0; const a0 = i * step, b0 = Math.min(d.length, a0 + step), st = Math.max(1, (b0 - a0) >> 4); for (let k = a0; k < b0; k += st) { const v = Math.abs(d[k]); if (v > m) m = v; } out[i] = m; if (m > mx) mx = m; }
        for (let i = 0; i < n; i++) out[i] /= mx;
        return out;
    }
    async function confirmAlignment() {
        const D = Deck(); if (!D || !D.isOpen) return;
        const S = window.VLState, slider = $("offset-slider"), d = window.VLAutopilot.alignment || { confidence: 0, why: [] };
        const suggested = parseFloat(slider.value) || 0;
        let player = null;
        const stopPlayer = () => { if (player) { try { player.destroy(); } catch (e) { /* ignore */ } player = null; } };
        const NUDGES = [-100, -10, -1, 1, 10, 100];
        await D.ask({
            key: "align", title: "Is the vocal lined up?",
            html: '<p class="apd-text">' + (d.why && d.why[0] ? d.why[0].replace(/&/g, "&amp;").replace(/</g, "&lt;") : "") + (d.confidence < 0.45 ? " I am not very sure about this one, so listen and nudge it if it feels off." : "") + "</p>" +
                '<div class="apd-align-offset" id="apd-off" aria-live="polite"></div>' +
                '<div class="apd-wavebox"><canvas id="apd-wave" class="apd-wave" role="img" aria-label="The beat (top) and your vocal (bottom). Tap or drag to jump to another part of the song."></canvas>' +
                '<div class="apd-time"><span id="apd-pos">0:00</span><span class="apd-tag">tap the picture to jump</span><span id="apd-len">0:00</span></div></div>' +
                '<div class="apd-transport"><button type="button" class="secondary-button apd-btn apd-preview" id="apd-prev" aria-pressed="false"><span>▶ Play the song</span></button>' +
                '<button type="button" class="secondary-button apd-toggle" id="apd-loop" aria-pressed="false">Loop 6 s</button>' +
                '<button type="button" class="secondary-button apd-toggle" id="apd-jump">Jump to vocal</button></div>' +
                '<div class="apd-nudge" role="group" aria-label="Nudge the vocal">' + NUDGES.map((ms) => '<button type="button" class="secondary-button" data-ms="' + ms + '">' + (ms > 0 ? "+" : "−") + Math.abs(ms) + "</button>").join("") + "</div>" +
                '<p class="apd-hint">Nudge the vocal earlier (−) or later (+), in milliseconds. You hear it change while the song plays.</p>' +
                '<button type="button" class="apd-link" id="apd-undo" hidden>Back to the spot Autopilot chose</button>',
            buttons: [{ id: "ok", label: "Looks right", kind: "primary" }],
            onMount(el) {
                const q = (sel) => el.querySelector(sel);
                const off = q("#apd-off"), playBtn = q("#apd-prev"), loopBtn = q("#apd-loop"), jumpBtn = q("#apd-jump"), undo = q("#apd-undo"), cv = q("#apd-wave"), posEl = q("#apd-pos"), lenEl = q("#apd-len");
                const offset = () => parseFloat(slider.value) || 0, fmtT = (t) => Math.floor(t / 60) + ":" + String(Math.floor(t % 60)).padStart(2, "0");
                const ctx = S && S.audioContext, vb = S && S.vocalBuffer, bb = S && S.beatBuffer, AP = window.VLAlignPlay;
                const show = () => { off.textContent = fmtOffset(offset()); undo.hidden = Math.abs(offset() - suggested) < 0.0005; };
                show();
                if (!ctx || !vb || !bb || !AP) { playBtn.disabled = loopBtn.disabled = jumpBtn.disabled = true; return; }
                lenEl.textContent = fmtT(bb.duration);
                const BN = 480, VN = 960, bp = peaksOf(bb, BN), vp = peaksOf(vb, VN);
                let shown = 0, dragPos = null;
                const accent = (getComputedStyle(cv).getPropertyValue("--accent") || "").trim() || "#7c5cff";
                function draw(posSec) {
                    shown = posSec;
                    const w = cv.clientWidth, h = cv.clientHeight, dpr = window.devicePixelRatio || 1; if (!w || !h) return;
                    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
                    const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
                    const dur = bb.duration, m1 = h * 0.27, m2 = h * 0.73, amp = h * 0.21, o = offset();
                    const lr = player && player.loopRegion();
                    if (lr) { g.fillStyle = "rgba(255, 255, 255, .10)"; g.fillRect(lr.a / dur * w, 0, (lr.b - lr.a) / dur * w, h); }
                    for (let x = 0; x < w; x++) {
                        const t = x / w * dur, v = bp[Math.min(BN - 1, Math.floor(t / dur * BN))];
                        g.fillStyle = WAVE_BEAT; g.fillRect(x, m1 - Math.max(0.5, v * amp), 1, Math.max(1, v * amp * 2));
                        const tv = t - o;
                        if (tv >= 0 && tv < vb.duration) { const u = vp[Math.min(VN - 1, Math.floor(tv / vb.duration * VN))]; g.fillStyle = accent; g.fillRect(x, m2 - Math.max(0.5, u * amp), 1, Math.max(1, u * amp * 2)); }
                    }
                    g.fillStyle = "rgba(255, 255, 255, .55)"; g.font = "10px system-ui, sans-serif"; g.fillText("Beat", 4, 11); g.fillText("Vocal", 4, h - 4);
                    const px = Math.max(1, Math.min(w - 1, posSec / dur * w)); g.fillStyle = "#fff"; g.fillRect(px - 1, 0, 2, h);
                    posEl.textContent = fmtT(posSec);
                }
                player = AP.create({
                    ctx, beat: bb, vocal: vb, getOffset: offset,
                    onTick: (t) => { if (dragPos == null) draw(t); },
                    onState: (on) => { playBtn.querySelector("span").textContent = on ? "❚❚ Pause" : "▶ Play the song"; playBtn.setAttribute("aria-pressed", on ? "true" : "false"); }
                });
                const start0 = player.startPoint(); draw(start0);
                requestAnimationFrame(() => draw(player ? player.position() : start0));
                window.addEventListener("resize", () => { if (player) draw(player.position()); });
                playBtn.addEventListener("click", () => player && player.toggle());
                loopBtn.addEventListener("click", () => { if (!player) return; const on = loopBtn.getAttribute("aria-pressed") !== "true"; loopBtn.setAttribute("aria-pressed", on ? "true" : "false"); player.setLoop(on); draw(player.position()); });
                jumpBtn.addEventListener("click", () => { if (!player) return; player.seek(player.startPoint()); });
                const changed = () => { show(); if (player) { player.retime(); draw(player.position()); } };
                el.querySelectorAll("[data-ms]").forEach((b) => b.addEventListener("click", () => {
                    const v = Math.max(-15, Math.min(15, offset() + parseInt(b.dataset.ms, 10) / 1000));
                    slider.value = v.toFixed(3); fire(slider, "input"); changed();
                }));
                undo.addEventListener("click", () => { slider.value = suggested.toFixed(3); fire(slider, "input"); changed(); });
                // tap or drag the picture to jump: while dragging only the marker moves, the song jumps when you let go
                const at = (e) => { const r = cv.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width))) * bb.duration; };
                cv.addEventListener("pointerdown", (e) => { dragPos = at(e); try { cv.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ } draw(dragPos); });
                cv.addEventListener("pointermove", (e) => { if (dragPos != null) { dragPos = at(e); draw(dragPos); } });
                const up = () => { if (dragPos == null) return; const t = dragPos; dragPos = null; if (player) player.seek(t); };
                cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
            },
            onDone() { stopPlayer(); }
        });
        stopPlayer();
        if (A.cancelled) throw new Cancelled();
        const v = parseFloat(slider.value) || 0;
        note("align", "Confirmed: vocal placed " + fmtOffset(v) + ".");
    }
    const PARTS = [["clean", "Clean-up", "Noise, tempo and timing of your recording"], ["tune", "Tune", "Pitch correction, octave and key"], ["mix", "Mix & master", "Balance, tone, effects and loudness"]];
    async function pickParts() {
        const D = Deck(); if (!D || !D.isOpen) return;
        const pick = {}; PARTS.forEach((x) => { pick[x[0]] = A.stepAuto[x[0]] !== false; });
        await D.ask({
            key: "parts", title: "Anything you want to do yourself?",
            html: '<p class="apd-text">Autopilot does the rest. For the parts you pick, it stops and waits for you.</p><div class="apd-parts">' +
                PARTS.map((x) => '<div class="apd-part" data-part="' + x[0] + '"><strong>' + x[1] + "</strong><small>" + x[2] + '</small><span class="apd-seg" role="group" aria-label="' + x[1] + '"><button type="button" data-v="auto" aria-pressed="' + pick[x[0]] + '">Auto</button><button type="button" data-v="me" aria-pressed="' + !pick[x[0]] + '">Me</button></span></div>').join("") + "</div>",
            buttons: [{ id: "go", label: "Start", kind: "primary" }],
            onMount(el) {
                el.querySelectorAll(".apd-part").forEach((row) => row.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
                    pick[row.dataset.part] = b.dataset.v === "auto";
                    row.querySelectorAll("button").forEach((o) => o.setAttribute("aria-pressed", String(o === b)));
                })));
            },
            onDone() { PARTS.forEach((x) => { A.stepAuto[x[0]] = !!pick[x[0]]; }); A.stepAuto.align = true; A.stepAuto.analyze = true; save(); Object.keys(SECTION).forEach((k) => stepBar(k)); }
        });
        if (A.cancelled) throw new Cancelled();
        const mine = PARTS.filter((x) => !A.stepAuto[x[0]]).map((x) => x[1]);
        if (mine.length) note("align", "You are doing " + mine.join(", ") + " yourself.");
    }

    // ------------------------------------------------------------------ the steps
    async function profileNow() {
        const S = window.VLState; let genreId = "universal", delivery = "unknown", voice = null, keyKnown = false, quality = null;
        try {
            const MB = window.VLMixBrain;
            if (MB && MB.ready && MB.ready()) {
                const kk = keyOf(S.beatKey), key = kk ? { rootPc: kk.rootPc, scale: kk.scale } : undefined;
                const ctx = await MB.profile(S, { beat: S.beatBuffer, vocal: S.preparedVocal || S.vocalBuffer, styleId: "auto", key });
                if (ctx) { if (ctx.prof) { delivery = ctx.prof.delivery || delivery; voice = ctx.prof.voice || null; quality = ctx.prof.quality; } if (ctx.genre && ctx.genre.id) genreId = ctx.genre.id; }
            }
        } catch (e) { console.warn("Autopilot: profile failed", e); }
        try { if (genreId === "universal" && window.VLGenre) { const g = window.VLGenre.detect(chans(S.beatBuffer).map((c) => c.subarray(0, Math.min(c.length, S.beatBuffer.sampleRate * 120))), S.beatBuffer.sampleRate, { bpm: S.beatBpm || 100 }); if (g && g.decided) genreId = g.styleId; } } catch (e) { /* keep universal */ }
        keyKnown = !!keyOf(S.beatKey);
        return { genreId, delivery, voice, keyKnown, vocalQuality: quality, voiceConfidence: voice ? voice.confidence : null };
    }

    async function stepLoad() {
        A.current = "load"; say("Loading your audio…");
        const btn = $("start-alignment-button");
        if (shown("upload-section")) { btn.click(); await waitFor(() => shown("alignment-section"), 60000, "the audio to load"); }
        await sleep(200);
    }
    async function stepAlign() {
        A.current = "align"; say("Lining the vocal up with the beat…");
        stepBar("align");
        const S = window.VLState, AD = window.AutoDecide;
        const d = AD.alignDecision(chans(S.vocalBuffer), S.vocalBuffer.sampleRate, chans(S.beatBuffer), S.beatBuffer.sampleRate, {});
        const slider = $("offset-slider"), v = Math.max(-15, Math.min(15, d.offsetSec));
        slider.value = v.toFixed(3); fire(slider, "input");
        const lines = d.why.slice(); if (Math.abs(d.offsetSec) > 15) lines.push("The offset was limited to 15 s.");
        lines.push("Placed the vocal " + (Math.abs(v) < 0.0005 ? "exactly where it was recorded" : (v > 0 ? "later" : "earlier") + " by " + Math.abs(v).toFixed(3) + " s") + " (" + Math.round(d.confidence * 100) + "% sure).");
        note("align", lines); window.VLAutopilot.alignment = d;
    }
    // A second opinion on which note is home: the singer's melody. The beat alone can be ambiguous between a major key and its
    // relative minor (same seven notes), so where the melody lands and rests gets a vote (AutoDecide.keyDecision weighs the two).
    async function refineKey(S) {
        A.keyNotes = null;
        try {
            const MT = window.MusicTheory, Fx = window.VLFx, vb = S.preparedVocal || S.vocalBuffer, bk = S.beatKey;
            if (!MT || !MT.keyFromMelody || !Fx || !Fx.runTask || !vb || !bk || !bk.key || bk.source === "Beat Lab" || bk.source === "set by you") return;      // told to it: not second-guessed
            const sr = vb.sampleRate, d = vb.getChannelData(0), mono = Float32Array.from(d.subarray(0, Math.min(d.length, Math.round(90 * sr))));
            const r = await Fx.runTask("analyze", { mono, sr });
            if (!r || !r.notes || r.notes.length < 6) return;
            const g = MT.keyFromMelody(r.notes, r.hop / r.sr);
            const bkO = keyOf(bk);
            if (!g || !bkO) return;
            const dec = window.AutoDecide.keyDecision({ beat: { rootPc: bkO.rootPc, scale: bkO.scale, tonicConfidence: bk.tonicConfidence, source: bk.source }, singer: { rootPc: g.rootPc, scale: g.scale, tonicConfidence: g.tonicConfidence }, notes: r.notes.length });
            if (dec.change) {
                const NN = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
                S.beatKey = Object.assign({}, bk, { key: NN[dec.to.rootPc], scale: dec.to.scale, rootPc: dec.to.rootPc, mode: dec.to.scale === "Minor" ? "aeolian" : "ionian", modeRoot: NN[dec.to.rootPc], source: "beat + melody", alsoFits: [{ key: bk.key, scale: String(bk.scale).toLowerCase().indexOf("min") === 0 ? "Minor" : "Major", rootPc: bkO.rootPc }].concat(Array.isArray(bk.alsoFits) ? bk.alsoFits : []) });
                const kv = $("beat-key"); if (kv) { kv.textContent = NN[dec.to.rootPc] + " " + dec.to.scale; const sm = kv.parentElement && kv.parentElement.querySelector("small"); if (sm) sm.textContent = "Chords and melody together • also fits " + dec.alsoFits + " (same notes)"; }
                if (window.VLKeyFits) window.VLKeyFits.render();
            }
            A.keyNotes = dec.why;
        } catch (e) { console.warn("Key second opinion failed, kept the beat's key:", e); }
    }
    async function stepAnalyze() {
        A.current = "analyze"; say("Listening: tempo, key and the voice…");
        $("continue-analysis-button").click();
        const S = window.VLState;
        await waitFor(() => shown("analysis-section"), 15000, "the analysis step");
        // done when the beat tempo is shown and the vocal pitch has been read (the key may legitimately stay unknown)
        await waitFor(() => { const b = $("beat-bpm"); return b && !/^[…\s]*$/.test(b.textContent) && b.textContent.trim() !== "—" && S.vocalPitch; }, 90000, "the analysis");
        await waitFor(() => S.beatKey || ($("beat-key") && $("beat-key").textContent.trim() !== "—" && $("beat-key").textContent.trim() !== "…"), 30000, "the key").catch(() => { /* unknown key is allowed */ });
        await refineKey(S);
        const bpm = S.beatBpm, k = keyOf(S.beatKey);
        const prof = await profileNow(); A.prof = prof;
        const lines = [];
        lines.push("Beat tempo " + (bpm ? Math.round(bpm * 10) / 10 + " BPM" : "not found") + (k ? ", key " + k.label : ", key not found") + ".");
        if (A.keyNotes && A.keyNotes.length) A.keyNotes.forEach((t) => lines.push(t));
        { const bk = S.beatKey, fits = bk && bk.source !== "set by you" && bk.source !== "Beat Lab" && Array.isArray(bk.alsoFits) ? bk.alsoFits : [];
          if (fits.length) lines.push("Also fits: " + fits.map((f) => f.key + " " + f.scale).join(" or ") + " (the same chords read either way). I tuned so that neither " + (bk.tieNotes && bk.tieNotes.length ? "unplayed note" : "reading") + " gets pulled; tap \"Use " + fits[0].key + " " + fits[0].scale + "\" under the key if you know it is that one."); }
        if (prof.voice) lines.push("Heard: " + prof.voice.label + ".");
        lines.push("Style heard in the beat: " + prof.genreId + ".");
        note("analyze", lines);
    }
    async function stepClean() {
        A.current = "clean"; say("Cleaning up the recording…");
        $("continue-prep-button").click();
        await waitFor(() => shown("prep-section"), 15000, "the clean-up step");
        stepBar("clean");
        const AD = window.AutoDecide;
        const stC = $("prep-status"), beforeC = stC.textContent;
        if (!A.stepAuto.clean) await manualGate("clean");
        const ranC = !A.stepAuto.clean && stC.textContent !== beforeC && /Done|Nothing/i.test(stC.textContent) && !$("prep-run-button").disabled;
        if (A.stepAuto.clean) {
            const d = AD.cleanDecision({ genreId: A.prof.genreId, delivery: A.prof.delivery });
            setCheck("prep-denoise", d.denoise); setCheck("prep-tempo", d.tempo);
            // timing needs a beat tempo
            const bpmOk = !!window.VLState.beatBpm; setCheck("prep-timing", d.timing && bpmOk);
            note("clean", d.why.concat(d.timing && !bpmOk ? ["Timing tighten skipped: the beat's tempo is not known."] : []));
        } else note("clean", ranC ? "You ran the clean-up yourself; Autopilot kept your result." : "Using the clean-up options you ticked.");
        if (ranC) return;
        const st = $("prep-status"); st.textContent = "";
        $("prep-run-button").click();
        await waitFor(() => /Done|Nothing|failed/i.test(st.textContent) && !$("prep-run-button").disabled, 240000, "the clean-up");
        const rep = [...document.querySelectorAll("#prep-report li")].map((l) => l.textContent);
        if (rep.length) note("clean", rep); else if (/Nothing/i.test(st.textContent)) note("clean", "Clean-up checked the recording: nothing needed changing.");
    }
    async function stepTune() {
        A.current = "tune"; say("Correcting pitch…");
        $("continue-from-prep-button").click();
        await waitFor(() => shown("tune-section"), 15000, "the pitch step");
        stepBar("tune");
        const S = window.VLState, AD = window.AutoDecide;
        S.autopilotTuneCap = null; S.autopilotDelivery = A.prof.delivery;
        const stT = $("tune-status"), beforeT = stT.textContent;
        if (!A.stepAuto.tune) await manualGate("tune");
        const ranT = !A.stepAuto.tune && stT.textContent !== beforeT && /done|Tuned|corrected/i.test(stT.textContent) && !$("tune-run-button").disabled && !!S.tunedVocal;
        if (ranT) { note("tune", "You corrected the pitch yourself; Autopilot kept your result."); return; }
        if (A.stepAuto.tune) {
            const d = AD.tuneDecision({ delivery: A.prof.delivery, voiceConfidence: A.prof.voiceConfidence });
            setCheck("tune-auto", true); setCheck("tune-auto-key", true); setCheck("tune-phrases", true);
            note("tune", d.why);
            if (!d.on) { A.skippedTune = true; return; }
            S.autopilotTuneCap = d.strengthCap;
        }
        const st = $("tune-status"); st.textContent = "";
        $("tune-run-button").click();
        await waitFor(() => /done|Tuned|failed|corrected/i.test(st.textContent) && !$("tune-run-button").disabled, 300000, "pitch correction");
        note("tune", st.textContent);
        if (S.tuneWhy && S.tuneWhy.length) note("tune", "Why: " + S.tuneWhy.join("; ") + ".");
        const oc = S.octaveResult;
        if (oc && (oc.heard || oc.why)) note("tune", ["Octave check. " + (oc.heard || []).join(" ")].concat(oc.why || []));
        const pr = S.phraseResult;
        if (pr) {
            note("tune", "Listened line by line: " + pr.summary.lines + " lines" + (pr.summary.changedKey ? ", " + pr.summary.changedKey + " use notes outside the plain key" : ", all inside the beat's key") + (pr.summary.rapped ? ", " + pr.summary.rapped + " rapped (left alone)" : "") + ".");
            if (pr.lines.length) note("tune", pr.lines);
        }
    }
    async function stepMix() {
        A.current = "mix"; say("Mixing and mastering…");
        $("continue-mix-button").click();
        await waitFor(() => shown("mix-section"), 15000, "the mix step");
        stepBar("mix");
        const AD = window.AutoDecide;
        const stM = $("automix-status"), beforeM = stM ? stM.textContent : "";
        if (!A.stepAuto.mix) await manualGate("mix");
        const ranM = !A.stepAuto.mix && stM && stM.textContent !== beforeM && /complete/i.test(stM.textContent) && !$("automix-button").disabled;
        if (ranM) { note("mix", "You mixed it yourself; Autopilot kept your result."); return; }
        if (A.stepAuto.mix) {
            const d = AD.mixDecision({ genreId: A.prof.genreId, delivery: A.prof.delivery, keyKnown: A.prof.keyKnown, vocalQuality: A.prof.vocalQuality });
            setSelect("mix-style", "auto"); setSelect("mix-ambience", "auto"); setSelect("mix-resonance", "auto"); setSelect("mix-calm", "auto");
            setSelect("mix-polish", d.polish); setSelect("mix-balance", d.balance); setSelect("instrument-balance", d.instrumentBalance); setSelect("harmony-select", String(d.harmony));
            setCheck("beat-enhance", d.beatEnhance); setCheck("fill-instruments", d.fillInstruments);
            note("mix", d.why);
        } else note("mix", "Using the mix options you chose.");
        const st = $("automix-status"); if (st) st.textContent = "";
        $("automix-button").click();
        await waitFor(() => st && /complete|failed|error/i.test(st.textContent) && !$("automix-button").disabled, 600000, "the mix and master");
        if (/failed|error/i.test(st.textContent)) throw new Error(st.textContent);
        const S = window.VLState;
        // what the mix and master actually did (the same lines the report shows)
        const lines = ((S.mixReport && S.mixReport.lines) || []).slice();
        if (lines.length) note("mix", lines);
    }

    // ------------------------------------------------------------------ run
    let startedAt = 0, runKey = "";
    async function run(force, opts) {
        if (A.running) return;
        opts = opts || {};
        buildCard();
        Object.keys(headline).forEach((k) => delete headline[k]); A.running = true; A.cancelled = false; A.error = null; A.summary = []; A.decisions = {}; A.skippedTune = false; A.state = "running"; A.runs++; startedAt = Date.now();
        window.VLAutopilot.alignment = null;
        const D = Deck();
        if (D && !D.isOpen) D.open(DECK_STEPS, { onTakeover: () => { A.cancelled = true; } });
        window.VLNoAutoScroll = true;
        paint();
        try {
            // restart from the Upload step when running again
            if (force && !shown("upload-section")) { const rail = document.querySelector('.step-rail-item[data-step="1"]'); if (rail) rail.click(); await sleep(300); }
            await runStep("align", async () => { await stepLoad(); await stepAlign(); });
            await confirmAlignment();                                           // you confirm the line-up first
            await pickParts();                                                  // then choose what you want to do yourself
            await runStep("analyze", stepAnalyze);
            await runStep("clean", stepClean);
            await runStep("tune", stepTune);
            await runStep("mix", stepMix);
            A.state = "done"; A.current = "mix"; say("Done. Your finished song is in the Mix step.");
            window.VLNoAutoScroll = false;
            if (D && D.isOpen) {
                const by = {}; A.summary.forEach((x) => (by[x.step] = by[x.step] || []).push(x.text));
                const names = Object.fromEntries(STEPS), safe = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;");
                const details = Object.keys(by).map((k) => "<h4>" + (names[k] || k) + "</h4><ul>" + by[k].map((t) => "<li>" + safe(t) + "</li>").join("") + "</ul>").join("");
                const pick = await D.final({ title: "Your song is ready", html: '<p class="apd-text">Autopilot finished every step. Open the mix to listen, or see what it decided and why.</p><div class="apd-details" hidden>' + details + "</div>", buttons: [{ id: "mix", label: "See my mix", kind: "primary" }, { id: "details", label: "What Voxloop did" }] });
                D.close();
                const mix = $("mix-section"); if (mix) mix.scrollIntoView({ behavior: "smooth", block: "start" });
            } else { const mix = $("mix-section"); if (mix) mix.scrollIntoView({ behavior: "smooth", block: "start" }); }
        } catch (e) {
            window.VLNoAutoScroll = false;
            if (e instanceof Cancelled) { A.state = "cancelled"; say("You took over. Every step is open for you to adjust."); if (D) D.close(); }
            else {
                A.state = "error"; A.error = e.message || String(e); console.error("Autopilot stopped:", e);
                const where = (STEPS.find((s) => s[0] === A.current) || ["", "a step"])[1];
                say("Stopped at " + where + ": " + A.error + ". You can carry on by hand.");
                if (D && D.isOpen) { await D.ask({ title: "Autopilot stopped at " + where, html: '<p class="apd-text">' + String(A.error).replace(/&/g, "&amp;").replace(/</g, "&lt;") + " You can carry on by hand from here.</p>", buttons: [{ id: "ok", label: "Carry on by hand", kind: "primary" }] }); D.close(); }
            }
        } finally { A.running = false; A.card = null; window.VLNoAutoScroll = false; paint(); }
    }
    function ready() {
        const v = $("vocal-input"), b = $("beat-input"), S = window.VLState;
        return !!(v && v.files && v.files[0] && ((b && b.files && b.files[0]) || (S && S.beatBuffer)));
    }
    let timer = null;
    function maybeStart() {
        if (window.__vlFromStudio) return;                                     // sent from Studio: the person is asked first (below)
        if (!A.on || A.running || !ready()) return;
        const v = $("vocal-input").files[0], b = $("beat-input").files[0];
        const key = [v.name, v.size, b ? b.name + b.size : "lab"].join("|");
        clearTimeout(timer);
        timer = setTimeout(() => { if (A.on && !A.running && ready() && key !== runKey) { runKey = key; run(false); } }, 500);
    }

    // After "Send mix to Pipeline": ask how to finish. Autopilot goes on to confirm the alignment and choose the parts; Manual leaves
    // every step to the person (and these files are not started automatically).
    function fileKey() { const v = $("vocal-input") && $("vocal-input").files[0], b = $("beat-input") && $("beat-input").files[0]; return v ? [v.name, v.size, b ? b.name + b.size : "lab"].join("|") : ""; }
    async function askHowToFinish() {
        const D = Deck();
        if (!D) { window.__vlFromStudio = false; maybeStart(); return; }
        if (A.running) { window.__vlFromStudio = false; return; }
        buildCard();
        D.open(DECK_STEPS, { onTakeover: () => { A.cancelled = true; } });
        const choice = await D.ask({
            title: "Sent to Pipeline", html: '<p class="apd-text">How do you want to finish this song?</p>',
            buttons: [{ id: "auto", label: "Autopilot", sub: "I line it up, you confirm, then you pick what you want to do yourself", kind: "primary" }, { id: "manual", label: "Manual", sub: "You drive every step" }]
        });
        window.__vlFromStudio = false;
        runKey = fileKey();                                                    // these files are decided here; do not auto-start them again
        if (choice === "manual") { D.close(); return; }
        run(false);
    }
    window.addEventListener("vl-sent-from-studio", askHowToFinish);

    window.VLAutopilot = { state: A, run, startPreview, cancel: () => { A.cancelled = true; }, get summary() { return A.summary; } };
    document.addEventListener("DOMContentLoaded", () => {
        buildCard(); Object.keys(SECTION).forEach((s) => stepBar(s));
        ["vocal-input", "beat-input"].forEach((id) => { const e = $(id); if (e) e.addEventListener("change", maybeStart); });
        window.addEventListener("vl-set-beat", () => setTimeout(maybeStart, 200));
    });
})();
