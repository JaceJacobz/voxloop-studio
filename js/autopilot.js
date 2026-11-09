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
    function say(t) { const n = $("ap-now"); if (n) n.textContent = t; paint(); }

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
        if (!A.stepAuto.align) { note("align", "Using the position you set."); return; }
        const S = window.VLState, AD = window.AutoDecide;
        const d = AD.alignDecision(chans(S.vocalBuffer), S.vocalBuffer.sampleRate, chans(S.beatBuffer), S.beatBuffer.sampleRate, {});
        const slider = $("offset-slider"), v = Math.max(-15, Math.min(15, d.offsetSec));
        slider.value = v.toFixed(3); fire(slider, "input");
        const lines = d.why.slice(); if (Math.abs(d.offsetSec) > 15) lines.push("The offset was limited to 15 s.");
        note("align", lines); window.VLAutopilot.alignment = d;
    }
    async function stepAnalyze() {
        A.current = "analyze"; say("Listening: tempo, key and the voice…");
        $("continue-analysis-button").click();
        const S = window.VLState;
        await waitFor(() => shown("analysis-section"), 15000, "the analysis step");
        // done when the beat tempo is shown and the vocal pitch has been read (the key may legitimately stay unknown)
        await waitFor(() => { const b = $("beat-bpm"); return b && !/^[…\s]*$/.test(b.textContent) && b.textContent.trim() !== "—" && S.vocalPitch; }, 90000, "the analysis");
        await waitFor(() => S.beatKey || ($("beat-key") && $("beat-key").textContent.trim() !== "—" && $("beat-key").textContent.trim() !== "…"), 30000, "the key").catch(() => { /* unknown key is allowed */ });
        const bpm = S.beatBpm, k = keyOf(S.beatKey);
        const prof = await profileNow(); A.prof = prof;
        const lines = [];
        lines.push("Beat tempo " + (bpm ? Math.round(bpm * 10) / 10 + " BPM" : "not found") + (k ? ", key " + k.label : ", key not found") + ".");
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
        if (A.stepAuto.clean) {
            const d = AD.cleanDecision({ genreId: A.prof.genreId, delivery: A.prof.delivery });
            setCheck("prep-denoise", d.denoise); setCheck("prep-tempo", d.tempo);
            // timing needs a beat tempo
            const bpmOk = !!window.VLState.beatBpm; setCheck("prep-timing", d.timing && bpmOk);
            note("clean", d.why.concat(d.timing && !bpmOk ? ["Timing tighten skipped: the beat's tempo is not known."] : []));
        } else note("clean", "Using the clean-up options you ticked.");
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
        S.autopilotTuneCap = null;
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
    async function run(force) {
        if (A.running) return;
        buildCard();
        Object.keys(headline).forEach((k) => delete headline[k]); A.running = true; A.cancelled = false; A.error = null; A.summary = []; A.decisions = {}; A.skippedTune = false; A.state = "running"; A.runs++; startedAt = Date.now();
        window.VLAutopilot.alignment = null;
        paint();
        try {
            // restart from the Upload step when running again
            if (force && !shown("upload-section")) { const rail = document.querySelector('.step-rail-item[data-step="1"]'); if (rail) rail.click(); await sleep(300); }
            await stepLoad(); await stepAlign(); await stepAnalyze(); await stepClean(); await stepTune(); await stepMix();
            A.state = "done"; A.current = "mix"; say("Done. Your finished song is in the Mix step.");
            const mix = $("mix-section"); if (mix) mix.scrollIntoView({ behavior: "smooth", block: "start" });
        } catch (e) {
            if (e instanceof Cancelled) { A.state = "cancelled"; say("You took over. Every step is open for you to adjust."); }
            else { A.state = "error"; A.error = e.message || String(e); console.error("Autopilot stopped:", e); say("Stopped at " + (STEPS.find((s) => s[0] === A.current) || ["", "a step"])[1] + ": " + A.error + ". You can carry on by hand."); }
        } finally { A.running = false; paint(); }
    }
    function ready() {
        const v = $("vocal-input"), b = $("beat-input"), S = window.VLState;
        return !!(v && v.files && v.files[0] && ((b && b.files && b.files[0]) || (S && S.beatBuffer)));
    }
    let timer = null;
    function maybeStart() {
        if (!A.on || A.running || !ready()) return;
        const v = $("vocal-input").files[0], b = $("beat-input").files[0];
        const key = [v.name, v.size, b ? b.name + b.size : "lab"].join("|");
        clearTimeout(timer);
        timer = setTimeout(() => { if (A.on && !A.running && ready() && key !== runKey) { runKey = key; run(false); } }, 500);
    }

    window.VLAutopilot = { state: A, run, cancel: () => { A.cancelled = true; }, get summary() { return A.summary; } };
    document.addEventListener("DOMContentLoaded", () => {
        buildCard(); Object.keys(SECTION).forEach((s) => stepBar(s));
        ["vocal-input", "beat-input"].forEach((id) => { const e = $(id); if (e) e.addEventListener("change", maybeStart); });
        window.addEventListener("vl-set-beat", () => setTimeout(maybeStart, 200));
    });
})();
