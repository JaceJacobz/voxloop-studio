/* =========================================================
   VOXLOOP STUDIO — "ALSO FITS" ON THE BEAT KEY CARD (v2.25.5)
   Some beats cannot tell one key from another: a loop like Am - F - C - Dm never plays B or B-flat, so "A minor" and
   "F major" are both right as far as the notes go. The detector picks the likelier one and lists the other as `alsoFits`.
   This file shows that under the key card and gives a one-tap switch. Switching records the key as "set by you", which
   Autopilot, the tuner and the mixer then treat as exact (nothing second-guesses it afterwards).

   Needs: window.VLState (script.js). Optional: tune.js listens for "vl-key-changed".
   Globals: window.VLKeyFits = { render, swapTo, undo }.
   ========================================================= */
(function () {
    "use strict";
    var NN = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    var $ = function (id) { return document.getElementById(id); };
    var label = function (k) { return k.key + " " + k.scale; };
    var pcOf = function (name) { return NN.indexOf(name); };

    function cardEl() { var kv = $("beat-key"); return kv ? kv.parentElement : null; }
    function notesText(pcs) { var n = { 10: "B♭", 11: "B", 1: "C#", 3: "E♭", 6: "F#", 8: "A♭" }; return (pcs || []).map(function (p) { return n[p] || NN[p]; }).join(" or "); }

    function setStatus(text) {
        var kv = $("beat-key"), sm = kv && kv.parentElement && kv.parentElement.querySelector("small");
        if (sm) sm.textContent = text;
    }

    /** Draw (or remove) the "also fits" row under the key card. */
    function render() {
        var host = cardEl(); if (!host) return;
        var row = host.querySelector(".key-fits"), S = window.VLState, bk = S && S.beatKey;
        var alts = bk && Array.isArray(bk.alsoFits) ? bk.alsoFits.filter(function (a) { return a && a.key && a.scale; }) : [];
        var undo = bk && bk.swappedFrom;
        if (!bk || (!alts.length && !undo) || (bk.source === "Beat Lab")) { if (row) row.remove(); return; }
        if (!row) { row = document.createElement("div"); row.className = "key-fits"; host.appendChild(row); }
        row.textContent = "";
        var p = document.createElement("p"); p.className = "key-fits-text";
        if (undo) {
            p.textContent = "You switched this from " + label(undo) + ".";
            row.appendChild(p);
            row.appendChild(button("Switch back to " + label(undo), function () { window.VLKeyFits.undo(); }, true));
            return;
        }
        var why = bk.tieNotes && bk.tieNotes.length ? " The beat never plays " + notesText(bk.tieNotes) + ", so the notes alone cannot tell them apart." : "";
        var rel = alts.filter(function (a) { return a.relative; })[0];
        var relNote = rel ? " " + label(rel) + " is the same seven notes: which one counts as home can come out either way depending on where the file starts, so the same beat saved in two files can show two different keys. Tuning is the same for both." : "";
        p.textContent = "Also fits: " + alts.map(label).join(" or ") + "." + why + relNote;
        row.appendChild(p);
        alts.slice(0, 2).forEach(function (a) { row.appendChild(button("Use " + label(a), function () { window.VLKeyFits.swapTo(a); }, false)); });
    }

    function button(text, fn, quiet) {
        var b = document.createElement("button"); b.type = "button"; b.className = "key-fits-btn" + (quiet ? " is-quiet" : ""); b.textContent = text;
        b.addEventListener("click", fn); return b;
    }

    function announce() { try { window.dispatchEvent(new CustomEvent("vl-key-changed")); } catch (e) { /* ignore */ } }

    /** Make `alt` ({key, scale}) the beat's key. It is recorded as "set by you": exact, never second-guessed. */
    function swapTo(alt) {
        var S = window.VLState, bk = S && S.beatKey; if (!bk || !alt || pcOf(alt.key) < 0) return false;
        var minor = String(alt.scale).toLowerCase().indexOf("min") === 0;
        var kv0 = $("beat-key"), sm0 = kv0 && kv0.parentElement && kv0.parentElement.querySelector("small");
        var before = { statusText: sm0 ? sm0.textContent : "", key: bk.key, scale: bk.scale, source: bk.source, confidence: bk.confidence, alsoFits: bk.alsoFits, alsoAllow: bk.alsoAllow, mode: bk.mode, modeRoot: bk.modeRoot };
        S.beatKey = Object.assign({}, bk, {
            key: alt.key, scale: minor ? "Minor" : "Major", rootPc: pcOf(alt.key), mode: minor ? "aeolian" : "ionian", modeRoot: alt.key,
            confidence: 1, source: "set by you", alsoFits: [], alsoAllow: [], swappedFrom: before
        });
        var kv = $("beat-key"); if (kv) kv.textContent = alt.key + " " + (minor ? "Minor" : "Major");
        setStatus("Set by you • exact");
        render(); announce();
        return true;
    }

    /** Back to what was detected. */
    function undo() {
        var S = window.VLState, bk = S && S.beatKey, b = bk && bk.swappedFrom; if (!b) return false;
        S.beatKey = Object.assign({}, bk, {
            key: b.key, scale: b.scale, rootPc: pcOf(b.key), mode: b.mode, modeRoot: b.modeRoot, confidence: b.confidence, source: b.source,
            alsoFits: b.alsoFits, alsoAllow: b.alsoAllow, swappedFrom: null
        });
        var kv = $("beat-key"); if (kv) kv.textContent = b.key + " " + b.scale;
        setStatus(b.statusText || (b.source === "listened" || !b.source ? "Detected • " + Math.round((b.confidence || 0) * 100) + "% confidence" : String(b.source)));
        render(); announce();
        return true;
    }

    window.VLKeyFits = { render: render, swapTo: swapTo, undo: undo };
})();
