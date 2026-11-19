// =====================================================================
// Melody editor: a piano roll for the lead.
// The lead plays the song's hooks (beat.hooks.chorus / bridge / pre): { bars, notes: [{ bar, step, len, n }] } where n is
// a scale degree (0 = the key's root, 7 = the root an octave up). Editing a hook changes every section that plays it.
// One note at a time (a lead is a single line); a note never crosses its bar.
// =====================================================================
(function () {
  const panel = document.getElementById("bl-melPanel");
  if (!panel) return;
  const rollEl = document.getElementById("bl-roll"), kindEl = document.getElementById("bl-melKind");
  const lenEl = document.getElementById("bl-melLen"), resetEl = document.getElementById("bl-melReset"), hintEl = document.getElementById("bl-melHint");
  const KIND_NAMES = { chorus: "Chorus (and outro)", bridge: "Bridge", pre: "Pre-chorus" };
  const LOW = 0, HIGH = 13;                    // the rows drawn (scale degrees); notes outside are drawn too if there are any
  let kind = "chorus", dragging = null, moving = null;

  const hookOf = () => (current.hooks && current.hooks[kind]) || null;
  const sortNotes = hook => hook.notes.sort((a, b) => a.bar - b.bar || a.step - b.step);
  const absStep = n => n.bar * 16 + n.step;

  function kinds() {
    if (typeof isSong !== "function" || !current || !isSong(current) || !current.hooks) return [];
    const have = new Set(current.sections.map(s => s.kind));
    return ["chorus", "bridge", "pre"].filter(k => (have.has(k) || (k === "chorus" && have.has("outro"))) && current.hooks[k]);
  }

  window.syncMelodyRoll = function syncMelodyRoll() {
    const list = kinds();
    panel.hidden = !list.length;
    if (!list.length) return;
    if (!list.includes(kind)) kind = list[0];
    const sig = list.join();
    if (kindEl.dataset.sig !== sig) {
      kindEl.innerHTML = "";
      list.forEach(k => { const o = document.createElement("option"); o.value = k; o.textContent = KIND_NAMES[k]; kindEl.appendChild(o); });
      kindEl.dataset.sig = sig;
    }
    kindEl.value = kind;
    render();
  };

  function degreeRange(hook) {
    let lo = LOW, hi = HIGH;
    hook.notes.forEach(n => { lo = Math.min(lo, n.n); hi = Math.max(hi, n.n); });
    return [lo, hi];
  }

  function render() {
    const hook = hookOf();
    if (!hook) return;
    const [lo, hi] = degreeRange(hook), steps = hook.bars * 16;
    const sc = rollEl.parentElement, keepLeft = sc.scrollLeft;
    rollEl.style.gridTemplateColumns = "30px repeat(" + steps + ", 20px)";
    const covered = {};                       // "n:step" -> { head, end }
    hook.notes.forEach(n => { for (let k = 0; k < n.len; k++) covered[n.n + ":" + (absStep(n) + k)] = { head: k === 0, end: k === n.len - 1 }; });
    const frag = document.createDocumentFragment();
    for (let deg = hi; deg >= lo; deg--) {
      const label = document.createElement("div");
      label.className = "rl";
      label.textContent = midiToName(leadMidi(current.key, deg), current.key.flats);
      if (((deg % 7) + 7) % 7 === 0) label.className += " root";
      frag.appendChild(label);
      for (let s = 0; s < steps; s++) {
        const c = document.createElement("div");
        const cov = covered[deg + ":" + s];
        c.className = "rc" + (((deg % 7) + 7) % 7 === 0 ? " root" : "") + (s % 16 === 0 && s ? " bar" : s % 4 === 0 && s ? " b4" : "") +
          (cov ? " note" + (cov.head ? " head" : " tail") + (cov.end ? " end" : "") : "");
        c.dataset.d = deg; c.dataset.s = s;
        frag.appendChild(c);
      }
    }
    rollEl.replaceChildren(frag);               // one swap, so the page does not jump while you draw
    sc.scrollLeft = keepLeft;
    resetEl.hidden = !(current.hookBackup && current.hookBackup[kind]);
    hintEl.textContent = "Tap an empty box to add a note (on a computer, drag right to make it longer). Drag a note up or down to change its pitch; tap it to remove it. Changes the " + KIND_NAMES[kind].toLowerCase() + " everywhere it plays.";
  }

  function backup() {
    current.hookBackup = current.hookBackup || {};
    if (!current.hookBackup[kind]) {
      current.hookBackup[kind] = JSON.parse(JSON.stringify(hookOf()));
      // this beat gets its own copy, so an older beat (Back) that shares the melody is not changed behind your back
      current.hooks = Object.assign({}, current.hooks, { [kind]: JSON.parse(JSON.stringify(hookOf())) });
    }
  }
  function noteAt(hook, s) { return hook.notes.find(n => s >= absStep(n) && s < absStep(n) + n.len) || null; }
  function nextStart(hook, s) { const after = hook.notes.filter(n => absStep(n) > s).map(absStep); return after.length ? Math.min.apply(null, after) : Infinity; }
  function hear(deg) { try { ensureEngine(); Tone.start(); engine.previewLead(leadMidi(current.key, deg), current); } catch (e) { /* no sound yet */ } }
  function maxLen(hook, s) { return Math.min(16 - (s % 16), nextStart(hook, s) - s); }

  function cellOf(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    return el && el.classList && el.classList.contains("rc") ? el : null;
  }
  rollEl.addEventListener("pointerdown", e => {
    const el = e.target.classList.contains("rc") ? e.target : null;
    if (!el || !hookOf()) return;
    backup();                                     // (first edit makes this beat's own copy of the melody)
    const hook = hookOf();
    const deg = Number(el.dataset.d), s = Number(el.dataset.s);
    const hit = noteAt(hook, s);
    if (hit) {                                    // tap a note: remove it; drag it up or down: change its pitch
      moving = { note: hit, hook, moved: false };
      return;
    }
    const len = Math.max(1, Math.min(Number(lenEl.value) || 2, maxLen(hook, s)));
    const note = { bar: Math.floor(s / 16), step: s % 16, len, n: deg };
    hook.notes.push(note); sortNotes(hook);
    dragging = { note, s, hook };
    hear(deg);
    render();
  });
  rollEl.addEventListener("pointermove", e => {
    if (moving) {
      const el = cellOf(e); if (!el) return;
      const deg = Number(el.dataset.d);
      if (deg !== moving.note.n) { moving.note.n = deg; moving.moved = true; hear(deg); render(); }
      return;
    }
    if (!dragging) return;
    const el = cellOf(e); if (!el) return;
    const s = Number(el.dataset.s), d = dragging;
    if (s < d.s) return;
    const want = s - d.s + 1;
    const others = d.hook.notes.filter(n => n !== d.note && absStep(n) > d.s).map(absStep);
    const cap = Math.min(16 - (d.s % 16), others.length ? Math.min.apply(null, others) - d.s : Infinity);
    const len = Math.max(1, Math.min(want, cap));
    if (len !== d.note.len) { d.note.len = len; render(); }
  });
  rollEl.addEventListener("pointerup", () => {
    if (moving && !moving.moved) { moving.hook.notes.splice(moving.hook.notes.indexOf(moving.note), 1); render(); }   // a plain tap removes
    moving = null; dragging = null;
  });
  rollEl.addEventListener("pointercancel", () => { moving = null; dragging = null; });

  kindEl.addEventListener("change", () => { kind = kindEl.value; render(); });
  resetEl.addEventListener("click", () => {
    if (!current.hookBackup || !current.hookBackup[kind]) return;
    current.hooks[kind] = JSON.parse(JSON.stringify(current.hookBackup[kind]));
    delete current.hookBackup[kind];
    render();
  });

  // Playhead: shows where the song is in the melody while it plays (called by showStep in beatlab.js)
  let lastCol = -1;
  window.melodyPlayhead = function melodyPlayhead(step) {
    if (panel.hidden) return;
    rollEl.querySelectorAll(".rc.play").forEach(c => c.classList.remove("play"));
    lastCol = -1;
    if (step === null || typeof view === "undefined" || !view) return;
    const hook = hookOf();
    const plays = hook && (view.kind === kind || (kind === "chorus" && view.kind === "outro" && view.phraseBar < 2));
    if (!plays) return;
    const col = (view.phraseBar % hook.bars) * 16 + step;
    rollEl.querySelectorAll('.rc[data-s="' + col + '"]').forEach(c => c.classList.add("play"));
    lastCol = col;
    if (step === 0 && !dragging && !moving) {                  // keep the playing bar in view
      const sc = rollEl.parentElement, x = (col + 1) * 21;
      if (x < sc.scrollLeft + 30 || x > sc.scrollLeft + sc.clientWidth - 60) sc.scrollLeft = Math.max(0, x - 30);
    }
  };

  syncMelodyRoll();
})();
