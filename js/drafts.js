/**
 * Voxloop Studio: Drafts
 *
 * Save a beat (Beat Lab) or a song in progress (Studio) to finish later, and open it again exactly as it was.
 *
 *   Beat draft   the beat as plain data: patterns, chords, sounds, seed, your settings. Tiny, and it opens fully editable.
 *   Song draft   the Studio project: the beat's audio, every lane and take (kept as 16-bit audio, as recorded), the melody,
 *                the corrected tempo and key, where the playhead was. Autopilot is told which takes it already produced, so
 *                it does not process them a second time.
 *
 * Kept on this device (IndexedDB), not uploaded. If the browser clears site data they are gone, so the screen says so.
 * Needs: beatlab.js (VLBeatLab), daw.js (VLDAW.api), nav.js (VLUI).
 */
(function (root) {
    "use strict";
    const $ = (id) => document.getElementById(id);
    const DB_NAME = "vl-drafts", VERSION = 1;
    const UI = () => root.VLUI;
    const api = () => (root.VLDAW && root.VLDAW.api) || {};
    const active = { beatlab: null, studio: null };           // the draft each workspace was opened from (saving offers to update it)
    const savedSig = { beatlab: "", studio: "" };

    // ---------------------------------------------------------------- storage
    let dbp = null;
    function db() {
        if (dbp) return dbp;
        dbp = new Promise((resolve, reject) => {
            if (!root.indexedDB) { reject(new Error("This browser cannot keep drafts (no storage).")); return; }
            const rq = indexedDB.open(DB_NAME, VERSION);
            rq.onupgradeneeded = () => { const d = rq.result; if (!d.objectStoreNames.contains("meta")) d.createObjectStore("meta", { keyPath: "id" }); if (!d.objectStoreNames.contains("data")) d.createObjectStore("data"); };
            rq.onsuccess = () => resolve(rq.result);
            rq.onerror = () => reject(rq.error || new Error("Could not open the drafts storage."));
        });
        return dbp;
    }
    const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    async function store(name, mode) { const d = await db(); return d.transaction(name, mode).objectStore(name); }
    async function listMeta() { const s = await store("meta", "readonly"); const all = await reqP(s.getAll()); return all.sort((a, b) => b.updatedAt - a.updatedAt); }
    async function getMeta(id) { return reqP((await store("meta", "readonly")).get(id)); }
    async function getData(id) { return reqP((await store("data", "readonly")).get(id)); }
    async function putBoth(meta, data) {
        const d = await db();
        await new Promise((res, rej) => {
            const tx = d.transaction(["meta", "data"], "readwrite");
            tx.objectStore("meta").put(meta); tx.objectStore("data").put(data, meta.id);
            tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error("Not saved"));
        });
    }
    async function putMeta(meta) { const s = await store("meta", "readwrite"); await reqP(s.put(meta)); }
    async function removeId(id) {
        const d = await db();
        await new Promise((res, rej) => { const tx = d.transaction(["meta", "data"], "readwrite"); tx.objectStore("meta").delete(id); tx.objectStore("data").delete(id); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    }
    const newId = () => "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    async function announce() { try { const n = (await listMeta()).length; window.dispatchEvent(new CustomEvent("vl-drafts-changed", { detail: { count: n } })); } catch (e) { /* no storage */ } }

    // ---------------------------------------------------------------- audio as compact PCM
    function pack(ab) {
        const ch = [];
        for (let c = 0; c < ab.numberOfChannels; c++) {
            const f = ab.getChannelData(c), i16 = new Int16Array(f.length);
            for (let i = 0; i < f.length; i++) { const v = f[i] < -1 ? -1 : f[i] > 1 ? 1 : f[i]; i16[i] = v < 0 ? v * 32768 : v * 32767; }
            ch.push(i16);
        }
        return { sr: ab.sampleRate, ch };
    }
    function unpack(p) {
        const ctx = api().ensureCtx(), len = p.ch[0].length, ab = ctx.createBuffer(p.ch.length, len, p.sr);
        p.ch.forEach((i16, c) => { const f = new Float32Array(len); for (let i = 0; i < len; i++) f[i] = i16[i] / (i16[i] < 0 ? 32768 : 32767); ab.copyToChannel(f, c); });
        return ab;
    }
    const bytesOf = (p) => (p ? p.ch.reduce((n, c) => n + c.byteLength, 0) : 0);

    // a small picture of the song: the beat in grey, the vocals in blue
    function thumb(snap) {
        try {
            const W = 240, H = 44, c = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d");
            const dur = Math.max(1, snap.beat && snap.beat.buffer ? snap.beat.buffer.duration : 1, ...snap.lanes.flatMap((l) => l.clips.map((k) => k.start + k.duration)));
            const peaks = (buf, from, to, cols) => { const d = buf.getChannelData(0), out = new Float32Array(cols), per = Math.max(1, Math.floor(d.length / Math.max(1, cols))); for (let i = 0; i < cols; i++) { let m = 0; for (let k = i * per; k < Math.min(d.length, (i + 1) * per); k += 16) m = Math.max(m, Math.abs(d[k])); out[i] = m; } return out; };
            const draw = (buf, start, color, half) => { const cols = Math.max(1, Math.round(buf.duration / dur * W)), x0 = Math.round(start / dur * W), p = peaks(buf, 0, buf.length, cols); g.fillStyle = color; for (let i = 0; i < cols; i++) { const h = Math.max(1, Math.min(1, p[i] * 2.2) * half); g.fillRect(x0 + i, H / 2 - h, 1, h * 2); } };
            if (snap.beat && snap.beat.buffer) draw(snap.beat.buffer, 0, "rgba(160,150,190,.55)", H * 0.38);
            snap.lanes.forEach((l) => l.clips.forEach((k) => draw(k.buffer, k.start, "rgba(90,210,235,.95)", H * 0.42)));
            return c.toDataURL("image/png");
        } catch (e) { return null; }
    }

    // ---------------------------------------------------------------- what is in each workspace right now
    function studioSignature() {
        const D = root.VLDAW; if (!D) return "";
        const m = api().getMelody && api().getMelody();
        return [D.beat.name || "", D.beat.duration || 0, D.lanes.map((l) => l.name + ":" + l.clips.map((c) => c.id + "@" + c.start.toFixed(2) + "+" + c.duration.toFixed(2)).join(",")).join("|"), m ? m.seed + ":" + m.on : ""].join("#");
    }
    function beatSignature() { try { const s = root.VLBeatLab.snapshot(); return s.beat.seed + ":" + s.beat.genre + ":" + s.beat.bpm + ":" + JSON.stringify(s.settings); } catch (e) { return ""; } }
    const kindNow = () => { const m = document.querySelector("#app-shell").className.match(/mode-(beatlab|studio)\b/); return m ? m[1] : null; };

    function defaultName(kind, summary) {
        if (kind === "beat") return [summary.style || summary.genreName || cap(summary.genre), summary.bpm + " BPM", summary.key].filter(Boolean).join(" · ");
        return (summary.beatName ? summary.beatName.replace(/\.[a-z0-9]+$/i, "") : "Untitled") + " (song)";
    }
    const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");
    const ago = (t) => { const s = (Date.now() - t) / 1000; if (s < 60) return "just now"; if (s < 3600) return Math.round(s / 60) + " min ago"; if (s < 86400) return Math.round(s / 3600) + " h ago"; if (s < 172800) return "yesterday"; return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" }); };
    const mmss = (s) => Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");
    const mb = (b) => (b < 1048576 ? Math.max(1, Math.round(b / 1024)) + " KB" : (b / 1048576).toFixed(b < 10485760 ? 1 : 0) + " MB");

    // ---------------------------------------------------------------- save
    async function writeDraft(kind, existing) {
        const now = Date.now();
        if (kind === "beat") {
            const snap = root.VLBeatLab.snapshot();
            const meta = { id: existing ? existing.id : newId(), kind: "beat", name: existing ? existing.name : defaultName("beat", snap.summary), createdAt: existing ? existing.createdAt : now, updatedAt: now, summary: snap.summary, bytes: JSON.stringify(snap).length };
            await putBoth(meta, { kind: "beat", snap });
            return meta;
        }
        const snap = api().snapshotProject();
        const dur = Math.max(snap.beat && snap.beat.buffer ? snap.beat.buffer.duration : 0, ...snap.lanes.flatMap((l) => l.clips.map((k) => k.start + k.duration)), 0);
        const data = {
            kind: "song",
            beat: snap.beat ? Object.assign({}, snap.beat, { buffer: pack(snap.beat.buffer) }) : null,
            lanes: snap.lanes.map((l) => Object.assign({}, l, { clips: l.clips.map((c) => Object.assign({}, c, { buffer: pack(c.buffer) })) })),
            melody: snap.melody ? Object.assign({}, snap.melody, { buffer: pack(snap.melody.buffer) }) : null,
            playhead: snap.playhead, zoom: snap.zoom
        };
        const bytes = bytesOf(data.beat && data.beat.buffer) + data.lanes.reduce((n, l) => n + l.clips.reduce((m, c) => m + bytesOf(c.buffer), 0), 0) + bytesOf(data.melody && data.melody.buffer);
        const takes = snap.lanes.reduce((n, l) => n + l.clips.length, 0);
        const summary = { beatName: snap.beat ? snap.beat.name : "", bpm: snap.beat ? Math.round(snap.beat.bpm) : 0, key: snap.beat ? snap.beat.keyLabel : "", lanes: snap.lanes.filter((l) => l.clips.length).length, takes, seconds: Math.round(dur), melody: !!snap.melody };
        const meta = { id: existing ? existing.id : newId(), kind: "song", name: existing ? existing.name : defaultName("song", summary), createdAt: existing ? existing.createdAt : now, updatedAt: now, summary, thumb: thumb(snap), bytes };
        await putBoth(meta, data);
        return meta;
    }

    async function save(kind, existing) {
        const ui = UI();
        try {
            ui.toast(kind === "song" ? "Saving your song…" : "Saving the beat…");
            const meta = await writeDraft(kind, existing);
            const k = kind === "song" ? "studio" : "beatlab";
            active[k] = meta.id; savedSig[k] = kind === "song" ? studioSignature() : beatSignature();
            await announce(); await render();
            ui.toast(existing ? "Draft updated: " + meta.name : "Saved to Drafts: " + meta.name, { label: "View", run: () => root.VLDAW.setMode("drafts") });
        } catch (e) {
            console.warn("save draft", e);
            ui.toast(e && e.name === "QuotaExceededError" ? "Not enough storage on this device. Delete an old draft and try again." : "Could not save the draft: " + (e && e.message ? e.message : "unknown error"));
        }
    }

    // the "Save to drafts" button: saves what you are looking at
    async function saveCurrent() {
        const ui = UI(), where = kindNow(); if (!where) return;
        const kind = where === "studio" ? "song" : "beat";
        if (kind === "song" && api().isEmpty && api().isEmpty()) { ui.toast("Nothing to save yet. Load a beat or record something first."); return; }
        const id = active[where];
        let existing = null; if (id) { try { existing = await getMeta(id); } catch (e) { existing = null; } }
        if (!existing) { await save(kind, null); return; }
        ui.sheet({
            title: "Save to Drafts",
            body: "This came from the draft “" + existing.name + "”. Update it, or keep it as it was and save this as a new one?",
            actions: [{ label: "Update “" + trunc(existing.name, 22) + "”", primary: true, run: () => save(kind, existing) }, { label: "Save as new draft", run: () => save(kind, null) }, { label: "Cancel" }]
        });
    }
    const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

    // ---------------------------------------------------------------- open
    async function open(id) {
        const ui = UI();
        try {
            const meta = await getMeta(id), data = await getData(id);
            if (!meta || !data) { ui.toast("That draft could not be found."); return; }
            if (meta.kind === "beat") {
                if (!root.VLBeatLab.restore(data.snap)) { ui.toast("Could not open that beat."); return; }
                active.beatlab = id; savedSig.beatlab = beatSignature();
                root.VLDAW.setMode("beatlab"); ui.toast("Opened “" + meta.name + "” in Beat Lab");
                return;
            }
            const go = () => {
                ui.toast("Opening your song…");
                setTimeout(() => {
                    const snap = {
                        beat: data.beat ? Object.assign({}, data.beat, { buffer: unpack(data.beat.buffer) }) : null,
                        lanes: data.lanes.map((l) => Object.assign({}, l, { clips: l.clips.map((c) => Object.assign({}, c, { buffer: unpack(c.buffer) })) })),
                        melody: data.melody ? Object.assign({}, data.melody, { buffer: unpack(data.melody.buffer) }) : null,
                        playhead: data.playhead, zoom: data.zoom
                    };
                    api().restoreProject(snap);
                    active.studio = id; savedSig.studio = studioSignature();
                    root.VLDAW.setMode("studio"); ui.toast("Opened “" + meta.name + "” in Studio");
                }, 30);
            };
            const dirty = api().isEmpty && !api().isEmpty() && studioSignature() !== savedSig.studio;
            if (!dirty) { go(); return; }
            ui.sheet({
                title: "Open this song?",
                body: "Studio has work in it that is not saved as a draft. Opening “" + meta.name + "” will replace it.",
                actions: [{ label: "Save it, then open", primary: true, run: async () => { const cur = active.studio ? await getMeta(active.studio) : null; await save("song", cur); go(); } }, { label: "Open without saving", danger: true, run: go }, { label: "Cancel" }]
            });
        } catch (e) { console.warn("open draft", e); ui.toast("Could not open the draft: " + (e && e.message ? e.message : "unknown error")); }
    }

    async function rename(id, name) { const m = await getMeta(id); if (!m) return; m.name = (name || "").trim() || m.name; await putMeta(m); await render(); }
    async function duplicate(id) {
        const m = await getMeta(id), d = await getData(id); if (!m || !d) return;
        const copy = Object.assign({}, m, { id: newId(), name: m.name + " (copy)", createdAt: Date.now(), updatedAt: Date.now() });
        await putBoth(copy, d); await announce(); await render(); UI().toast("Copied");
    }
    function remove(id, name) {
        UI().sheet({
            title: "Delete this draft?", body: "“" + name + "” will be deleted from this device. This cannot be undone.",
            actions: [{ label: "Delete", danger: true, run: async () => { await removeId(id); Object.keys(active).forEach((k) => { if (active[k] === id) active[k] = null; }); await announce(); await render(); UI().toast("Deleted"); } }, { label: "Keep it", primary: true }]
        });
    }

    // ---------------------------------------------------------------- the Drafts screen
    let filter = "all";
    const ICON = {
        beat: '<path d="M3 12V8M6.5 14V4M10 11V6M13.5 13V3" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
        song: '<rect x="6.5" y="1.8" width="5" height="9" rx="2.5" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M3.8 8.6a5.2 5.2 0 0 0 10.4 0M9 13.8v2.4" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>'
    };
    async function render() {
        const host = $("drafts-list"); if (!host) return;
        let list = [];
        try { list = await listMeta(); } catch (e) { host.innerHTML = '<p class="drafts-empty">' + (e.message || "Drafts are not available in this browser.") + "</p>"; return; }
        const total = list.reduce((n, m) => n + (m.bytes || 0), 0);
        const shown = list.filter((m) => filter === "all" || (filter === "beats" ? m.kind === "beat" : m.kind === "song"));
        $("drafts-count") && ($("drafts-count").textContent = list.length ? list.length + (list.length === 1 ? " draft" : " drafts") + " · " + mb(total) + " on this device" : "");
        document.querySelectorAll(".drafts-filter button").forEach((b) => b.classList.toggle("is-on", b.dataset.f === filter));
        if (!shown.length) {
            host.innerHTML = list.length
                ? '<p class="drafts-empty">No ' + (filter === "beats" ? "beats" : "songs") + " saved yet.</p>"
                : '<div class="drafts-empty"><strong>Nothing here yet</strong><p>Made a beat you like but not ready to use it? Working on a song and missing something? Press <b>Save to drafts</b> at the top and it waits here for you.</p><div class="drafts-empty-actions"><button type="button" class="primary-button" data-go="beatlab">Make a beat</button><button type="button" class="secondary-button" data-go="studio">Open Studio</button></div></div>';
            host.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => root.VLDAW.setMode(b.dataset.go)));
            return;
        }
        host.innerHTML = "";
        shown.forEach((m) => {
            const s = m.summary || {};
            const meta = m.kind === "beat"
                ? [s.genreName || cap(s.genre), s.bpm ? s.bpm + " BPM" : "", s.key, s.seconds ? mmss(s.seconds) : ""].filter(Boolean).join(" · ")
                : [s.takes ? s.takes + (s.takes === 1 ? " take" : " takes") : "no takes yet", s.bpm ? s.bpm + " BPM" : "", s.melody ? "melody" : "", s.seconds ? mmss(s.seconds) : ""].filter(Boolean).join(" · ");
            const card = document.createElement("article"); card.className = "draft-card"; card.dataset.id = m.id;
            card.innerHTML =
                '<div class="draft-top"><span class="draft-ico draft-ico-' + m.kind + '"><svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">' + ICON[m.kind === "beat" ? "beat" : "song"] + "</svg></span>" +
                '<div class="draft-text"><strong class="draft-name"></strong><span class="draft-meta"></span></div><span class="draft-kind">' + (m.kind === "beat" ? "Beat" : "Song") + "</span></div>" +
                (m.thumb ? '<img class="draft-thumb" alt="" src="' + m.thumb + '">' : "") +
                '<div class="draft-foot"><span class="draft-when">Saved ' + ago(m.updatedAt) + " · " + mb(m.bytes || 0) + "</span>" +
                '<div class="draft-actions"><button type="button" class="primary-button" data-a="open">Open</button>' +
                '<button type="button" class="draft-icon" data-a="rename" title="Rename" aria-label="Rename"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></button>' +
                '<button type="button" class="draft-icon" data-a="copy" title="Make a copy" aria-label="Make a copy"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg></button>' +
                '<button type="button" class="draft-icon draft-del" data-a="del" title="Delete" aria-label="Delete"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg></button></div></div>';
            card.querySelector(".draft-name").textContent = m.name;
            card.querySelector(".draft-meta").textContent = meta;
            card.querySelector('[data-a="open"]').addEventListener("click", () => open(m.id));
            card.querySelector('[data-a="copy"]').addEventListener("click", () => duplicate(m.id));
            card.querySelector('[data-a="del"]').addEventListener("click", () => remove(m.id, m.name));
            const startRename = () => {
                const nameEl = card.querySelector(".draft-name"), inp = document.createElement("input");
                inp.type = "text"; inp.className = "draft-rename"; inp.value = m.name; inp.maxLength = 60; inp.setAttribute("aria-label", "Draft name");
                nameEl.replaceWith(inp); inp.focus(); inp.select();
                let done = false; const fin = (ok) => { if (done) return; done = true; if (ok) rename(m.id, inp.value); else render(); };
                inp.addEventListener("keydown", (e) => { if (e.key === "Enter") fin(true); else if (e.key === "Escape") fin(false); });
                inp.addEventListener("blur", () => fin(true));
            };
            card.querySelector('[data-a="rename"]').addEventListener("click", startRename);
            card.querySelector(".draft-name").addEventListener("dblclick", startRename);
            host.appendChild(card);
        });
    }

    function init() {
        document.querySelectorAll(".drafts-filter button").forEach((b) => b.addEventListener("click", () => { filter = b.dataset.f; render(); }));
        window.addEventListener("vl-mode", (e) => { if (e.detail.mode === "drafts") render(); });
        announce();
        // opening the app on a beat from the old session is not "unsaved work": start both workspaces as clean
        savedSig.beatlab = beatSignature();
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();

    root.VLDrafts = { saveCurrent, open, list: listMeta, render, _pack: pack, _unpack: unpack };
})(window);
