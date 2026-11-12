/**
 * Voxloop Studio: autosave and recovery
 *
 * Phones close background pages without warning (a call, a low-memory moment, switching apps), and a recording is hard to repeat.
 * So the Studio project is saved by itself, quietly, a few seconds after anything changes, right after every recorded take, and
 * the moment the page is hidden. Next time the app opens with an empty Studio it offers to bring the work back.
 *
 *   Where    this device (IndexedDB, same store as Drafts). Never uploaded.
 *   What     the whole project: beat audio, every lane and take, the melody, tempo/key, the playhead and zoom.
 *   How      each piece of audio is stored once, under its own id, and only when it is new or changed, so a save after a small
 *            edit writes almost nothing. Unused audio is removed after each save.
 *   Not      while recording (the take is saved as soon as it ends).
 * Needs: drafts.js (VLDrafts._data, _pack, _unpack), daw.js (VLDAW.api.snapshotProject / restoreProject), nav.js (VLUI).
 */
(function (root) {
    "use strict";
    const KEY = "auto:studio", ASSET = "auto:asset:";
    const api = () => (root.VLDAW && root.VLDAW.api) || {};
    const D = () => root.VLDrafts && root.VLDrafts._data;

    const ids = new WeakMap(); let seq = 1;
    const idOf = (ab) => { let i = ids.get(ab); if (!i) { i = "a" + Date.now().toString(36) + (seq++).toString(36); ids.set(ab, i); } return i; };
    const known = new Set();            // audio already on disk, by id
    let lastSig = "", timer = 0, saving = false, again = false, persistAsked = false, hadWork = false, deciding = false, pending = false;

    function signature() {
        const dd = root.VLDAW; if (!dd) return "";
        const m = api().getMelody && api().getMelody();
        return [
            dd.beat.buffer ? idOf(dd.beat.buffer) + ":" + (dd.beat.bpm || 0) + ":" + (dd.beat.name || "") : "-",
            dd.lanes.map((l) => [l.id, l.name, l.type, l.muted ? 1 : 0, l.mixLevel || "", l.clips.map((c) => [c.id, c.start.toFixed(3), c.duration.toFixed(3), idOf(c.buffer), c.name].join("~")).join(",")].join(":")).join("|"),
            m ? idOf(m.buffer) + ":" + m.on : "-"
        ].join("#");
    }
    const isEmpty = () => !!(api().isEmpty && api().isEmpty());

    async function putAsset(buf) {
        const id = idOf(buf);
        if (!known.has(id)) { await D().put(ASSET + id, await root.VLDrafts._pack(buf)); known.add(id); }
        return id;
    }

    async function save() {
        if (!D() || !api().snapshotProject) return;
        if (saving) { again = true; return; }
        const dd = root.VLDAW;
        if (!dd || document.body.classList.contains("is-recording")) return;
        if (deciding) return;                      // the "bring your work back?" question is still open: do not touch what it refers to
        saving = true;
        try {
            if (isEmpty()) { if (hadWork) await clear(); lastSig = signature(); return; }   // (only forget a project the person emptied themselves)
            hadWork = true;
            const snap = api().snapshotProject();
            const struct = { v: 1, savedAt: Date.now(), playhead: snap.playhead, zoom: snap.zoom, beat: null, lanes: [], melody: null };
            if (snap.beat) struct.beat = Object.assign({}, snap.beat, { buffer: await putAsset(snap.beat.buffer) });
            for (const l of snap.lanes) {
                const lane = Object.assign({}, l, { clips: [] });
                for (const c of l.clips) lane.clips.push(Object.assign({}, c, { buffer: await putAsset(c.buffer) }));
                struct.lanes.push(lane);
            }
            if (snap.melody) struct.melody = Object.assign({}, snap.melody, { buffer: await putAsset(snap.melody.buffer) });
            struct.summary = { beatName: snap.beat ? snap.beat.name : "", takes: snap.lanes.reduce((n, l) => n + l.clips.length, 0), lanes: snap.lanes.filter((l) => l.clips.length).length };
            await D().put(KEY, struct);
            lastSig = signature();
            // remove audio that nothing uses any more
            const used = new Set(); if (struct.beat) used.add(struct.beat.buffer); struct.lanes.forEach((l) => l.clips.forEach((c) => used.add(c.buffer))); if (struct.melody) used.add(struct.melody.buffer);
            for (const k of await D().keys()) if (typeof k === "string" && k.startsWith(ASSET) && !used.has(k.slice(ASSET.length))) { await D().del(k); known.delete(k.slice(ASSET.length)); }
            pulse();
            if (!persistAsked && navigator.storage && navigator.storage.persist) { persistAsked = true; navigator.storage.persist().catch(() => {}); }   // asks the browser not to clear it when space is low
        } catch (e) {
            console.warn("autosave", e);
            if (e && e.name === "QuotaExceededError" && root.VLUI) root.VLUI.toast("Autosave is paused: this device is out of storage. Delete old drafts to free space.");
        } finally { saving = false; if (again) { again = false; schedule(1500); } }
    }
    async function clear() { const d = D(); if (!d) return; for (const k of await d.keys()) if (k === KEY || (typeof k === "string" && k.startsWith(ASSET))) await d.del(k); known.clear(); }

    function schedule(ms) { clearTimeout(timer); pending = true; timer = setTimeout(() => { pending = false; save(); }, ms); }
    function tick() {
        if (document.hidden || deciding) return;
        const s = signature();
        if (isEmpty() && !hadWork) { lastSig = s; return; }
        if (s && s !== lastSig && !pending) schedule(3000);        // (not while one is already waiting: that would push it back forever)
    }

    function pulse() {
        const el = document.getElementById("autosave-pill"); if (!el) return;
        el.textContent = "✓ Autosaved"; el.classList.add("is-on"); clearTimeout(pulse.t); pulse.t = setTimeout(() => el.classList.remove("is-on"), 2200);
    }

    // ---- recovery
    async function recover() {
        const d = D(), ui = root.VLUI; if (!d || !ui) return;
        let struct = null; try { struct = await d.get(KEY); } catch (e) { return; }
        if (!struct || !isEmpty()) return;
        deciding = true;
        const s = struct.summary || {}, ago = Math.max(1, Math.round((Date.now() - struct.savedAt) / 60000));
        const when = ago < 60 ? ago + " min ago" : ago < 1440 ? Math.round(ago / 60) + " h ago" : Math.round(ago / 1440) + " days ago";
        ui.sheet({
            title: "Bring your work back?",
            body: "Studio was closed with work in it: " + (s.beatName ? "“" + s.beatName.replace(/\.[a-z0-9]+$/i, "") + "”" : "a song") + (s.takes ? ", " + s.takes + (s.takes === 1 ? " take" : " takes") : "") + ", saved " + when + ".",
            actions: [
                { label: "Bring it back", primary: true, run: () => { deciding = false; restore(struct); } },
                { label: "Start fresh", danger: true, run: () => { deciding = false; clear(); } }
            ]
        });
    }
    async function restore(struct) {
        const prog = root.VLProgress ? root.VLProgress.start("Bringing your work back…") : null;
        try {
            const un = async (id) => root.VLDrafts._unpack(await D().get(ASSET + id));
            const snap = { beat: null, lanes: [], melody: null, playhead: struct.playhead, zoom: struct.zoom };
            if (struct.beat) snap.beat = Object.assign({}, struct.beat, { buffer: await un(struct.beat.buffer) });
            let k = 0; const total = struct.lanes.reduce((n, l) => n + l.clips.length, 0) || 1;
            for (const l of struct.lanes) {
                const lane = Object.assign({}, l, { clips: [] });
                for (const c of l.clips) { lane.clips.push(Object.assign({}, c, { buffer: await un(c.buffer) })); if (prog) prog.set(0.15 + 0.75 * (++k / total)); }
                snap.lanes.push(lane);
            }
            if (struct.melody) snap.melody = Object.assign({}, struct.melody, { buffer: await un(struct.melody.buffer) });
            api().restoreProject(snap);
            root.VLDAW.setMode("studio");
            hadWork = true; lastSig = signature();
            root.VLUI.toast("Your work is back");
        } catch (e) { console.warn("recover", e); root.VLUI.toast("Could not bring it back: " + (e && e.message ? e.message : "unknown error")); }
        finally { if (prog) prog.done(); }
    }

    function init() {
        setInterval(tick, 2500);
        window.addEventListener("vl-take-saved", () => schedule(600));
        document.addEventListener("visibilitychange", () => { if (document.hidden && signature() !== lastSig) { clearTimeout(timer); save(); } });
        window.addEventListener("pagehide", () => { if (signature() !== lastSig) save(); });
        setTimeout(recover, 1200);
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();

    root.VLAutosave = { save, clear, recover, signature };
})(window);
