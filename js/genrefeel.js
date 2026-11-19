// Genre feel (v2.10.0): what each genre does over the length of a song, and how its harmony parts are filtered.
// TEMPLATES[g].rules is the genre's own layer of section rules. resolveTemplate (beatgen.js) merges three layers:
// the shared SECTION_RULES (templates.js), then this, then the style's own `rules`. So a style can still override.
// `sec.cut` is the open fraction of the low-pass on chords, pad, pluck and lead (engine.js, E.setCut):
// 1 = fully open, 0.5 = half the cutoff. Sources: the producer guides for each genre (see the README, v2.10.0).
(() => {
  const set = (genre, rules) => { if (typeof TEMPLATES !== "undefined" && TEMPLATES[genre]) TEMPLATES[genre].rules = rules; };
  const cut = c => ({ cut: c });

  // Afrobeats: bright and open all through; only the quietest sections close a little
  set("afrobeats", {
    intro: { sec: cut(0.7) }, verse: { sec: cut(0.85) }, pre: { sec: cut(0.95) },
    bridge: { sec: cut(0.8) }, outro: { sec: cut(0.7) }
  });

  // Amapiano: filtered keys and shakers first, the log drum is the star of the main section, then the keys step back
  set("amapiano", {
    intro:  { presence: { snare: 0, clap: 0, hat: 0.4, logdrum: 0, bass: 0, pluck: 0.3 }, sec: cut(0.45) },
    verse:  { presence: { logdrum: 0.5, pluck: 0.5 }, sec: cut(0.7) },
    pre:    { sec: cut(0.85) },
    chorus: { presence: { chords: 0.65, pad: 0.5, pluck: 0.35 }, sec: cut(1) },
    bridge: { presence: { kick: 0.2, snare: 0, clap: 0, logdrum: 0, chords: 1, pad: 1 }, sec: cut(0.5) },
    outro:  { sec: cut(0.5) }
  });

  // Afro house: a long, patient build: closed and dark, opening towards the drop, shut again for the breakdown
  set("afrohouse", {
    intro:  { sec: cut(0.4) }, verse: { sec: cut(0.65) }, pre: { sec: cut(0.8) },
    bridge: { presence: { kick: 0.2, snare: 0, clap: 0, openhat: 0, bass: 0.6 }, sec: cut(0.4) }, outro: { sec: cut(0.5) }
  });

  // R&B: the intro is only the chords (and a pad); pads sit under a low-pass (about 6 kHz) in the verse; the bridge is stripped
  set("rnb", {
    intro:  { presence: { kick: 0, snare: 0, clap: 0, rim: 0, hat: 0, openhat: 0, shaker: 0, perc: 0, bass: 0, logdrum: 0, pad: 1, pluck: 0.5 }, sec: cut(0.6) },
    verse:  { sec: cut(0.75) },
    pre:    { sec: cut(0.88) },
    bridge: { presence: { kick: 0.3, snare: 0, clap: 0, hat: 0.3, openhat: 0, shaker: 0.3, perc: 0.3, bass: 0.6, logdrum: 0 }, sec: cut(0.6) },
    outro:  { sec: cut(0.6) }
  });

  // Trap: spare and dark; the verse is darker still, the hook opens up
  set("trap", {
    intro: { sec: cut(0.5) }, verse: { sec: cut(0.7) }, pre: { sec: cut(0.85) },
    bridge: { sec: cut(0.6) }, outro: { sec: cut(0.55) }
  });

  // Air: a gentle high shelf on the master (dB at 9 kHz, engine.js). R&B and Afro-Lust measure very dark (under 1% of the
  // energy above 6 kHz, the others 2-4%), and the R&B guides ask for air around 10 kHz.
  const AIR = { afrobeats: 1, rnb: 3, trap: 1, afrolust: 3.5 };
  Object.keys(AIR).forEach(g => {
    if (typeof TEMPLATES === "undefined" || !TEMPLATES[g]) return;
    Object.keys(TEMPLATES[g].styles).forEach(id => {
      const st = TEMPLATES[g].styles[id];
      st.fx = Object.assign({}, st.fx, { air: AIR[g] });
    });
  });
})();
