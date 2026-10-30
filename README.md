# Voxloop Studio (VL Studio)

Full browser-based music production: **generate beats → record / import vocals → analyze → clean → pitch-correct → mix → master**.

## Modes

| Mode | What it is |
|------|------------|
| **Beat Lab** | Former Beatsmith — procedural beat generation (Afrobeats, R&B, etc.), arrangement, humanize, auto-mix, WAV download |
| **Pipeline** | Former Vocal Vault pipeline — Upload → Align → Analyze → Clean → Tune → Mix |
| **Studio** | Multi-lane DAW — record / import vocals on a beat, send composite to Pipeline |

## Handoff

1. In **Beat Lab**, generate a beat.
2. **Download full beat (WAV)** — standalone instrumental.
3. **Send to Pipeline** — renders the beat and loads it as the instrumental; upload a vocal and continue the steps.
4. **Open in Studio** — loads the beat as the session instrumental; add vocal lanes, record, then *Send mix to Pipeline*.

## Run

Serve the folder over HTTP (required for modules / AudioContext on some browsers):

```bash
cd voxloop-studio
python3 -m http.server 8080
```

Open `http://localhost:8080`.

## Structure

```
index.html          Unified shell (3 modes)
css/style.css       Voxloop design system + Beat Lab
js/                 Engines (Vocal Vault + Beatsmith + beatlab bridge)
lib/Tone.js         Beatsmith audio engine dependency
assets/logo.png
```

## Brand

- Full name: **Voxloop Studio**
- Short: **VL Studio**

## Step 6 — FX Rack + Auto-produce (Studio mode)

New files: `js/fxrack-dsp.js` (plugins), `js/fxbrain.js` (Auto), `js/fxrack.js` (panel, preview, pitch editor), `css/fxrack.css`.
Small edits: `js/daw.js` (clip ids, afterRender hook, getters + `api`, stereo-aware composite/WAV), `index.html` (css + 3 script tags).

Drag across a vocal clip to select a part (tap = whole clip) → pick a Quick start or plugins → Preview loops it over the beat
(Original / With effects) → Apply bakes it into that part only (Undo last / Back to original clip).
Plugins: VL Tune, VL Pitch Editor, VL EQ, VL Comp, VL De-Esser, VL Warmth, VL Limiter, VL Imager, VL Doubler, VL Crowd,
VL Hall, VL Echo (tail-end throw), VL Orbit, VL Voice Change. Easy / Pro switch in the panel header.

## Step 7 — UI polish
New: `js/studioui.js`, `css/ui-polish.css`. Edited: `index.html` (workspace tabs, 2 tags), `js/daw.js` (hooks).
- Workspace tabs (Beat Lab / Studio / Pipeline): icon tabs with an underline, peers rather than a step flow. Simple/Pro is smaller.
- Recording: live bar waveform in the armed lane (dB scale; teal good, amber loud, red clipping), dB readout + peak hold, timeline follows you.
- Ruler now scrolls with the lanes; playhead line runs through all lanes.
- Recorded clips use the same bar waveform.
- Fix: a take is no longer discarded when the beat ends (or a loop restarts) while recording.

## Step 8 — Volume automation + Reference & versions
New: `js/automation.js`, `js/reference.js`; styles appended to `css/ui-polish.css`.
Edited: `js/daw.js` (automation in playback / lane render / composite / lead reference, `renderMix()`, extra `api`), `js/fxrack.js` (`addPlugin`, Auto-ride option), `index.html` (2 script tags).
- ∿ button on each vocal lane opens a Volume row: tap to add points, drag, double-tap/right-click/long-press to delete, Fade in/out, ✨ Auto-ride, ↶ undo, Clear. Used live in playback, in the reference render and in "Send mix to Pipeline".
- 🎯 Reference: load a reference song, Save version (v1..v5), switch between Current mix / versions / reference at equal loudness; tone, loudness, width and punch comparison with plain-language tips and one-tap FX Rack fixes.

## Step 9 — Brain v2 (Auto decides from the vocal AND the beat)
Rewritten: `js/fxbrain.js`. Edited: `js/fxrack.js` (vibe line, "I hear" line, intensity Subtle/Normal/Lots, tap an extra to hear it), `css/ui-polish.css`.
- Beat: tempo, key, big sections, plus energy, brightness, low-end weight, how full it is, how much room it leaves (space), and the Pipeline's own genre sensor.
- Vocal: pitch range, sung / mixed / rapped, noise, clipping, room sound, and a take-quality score (rough takes get gentler boosts).
- Every setting is now computed: tune speed, de-ess strength, EQ (target curve + what the beat is crowding), compressor timing (tempo) and makeup, reverb size / amount / colour, widths.
- Extras are placed from the vocal's pauses and the beat's big moments, with echo time fitted to each pause.

## Step 12 — Phone layout, icons, and the ambience fix
New: `js/icons.js` (icon set, loaded first), `css/mobile.css` (loaded last). Edited: many small spots (emoji and symbol icons replaced with SVG icons), `index.html`, `js/studioui.js`, `js/automix-vv.js`, `js/studio.js`, `js/mixbrain.js`, `js/fxrack.js`, `js/automation.js`, `js/reference.js`.
- Phone: Studio is a slim mobile-DAW layout (icon toolbar strip, compact lanes with a "more" menu, one-row transport, FX Rack / Reference as bottom sheets). Beat Lab no longer overflows the screen. The Pipeline's bottom "Continue" bar hides while the in-page Continue button is visible, so it never shows twice.
- No emoji anywhere: every icon is inline SVG (`VLI("name")`).
- Mixing and mastering: the quiet-gap cleaner never touches a stretch where the beat is playing and lets go slowly; the phrase gate is shallower and slower (shaped by the beat); new calculated "Ambience between lines" option (default Auto) swells a soft wash after each line so the song keeps breathing when the singer stops.
- Fixed: the Auto tab's panel was painted solid violet (a class-name clash).
