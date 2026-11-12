# Voxloop Studio (VL Studio)

Full browser-based music production: **generate beats → record / import vocals → analyze → clean → pitch-correct → mix → master**.

## Modes

| Mode | What it is |
|------|------------|
| **Beat Lab** | Former Beatsmith — procedural beat generation (Afrobeats, R&B, etc.), arrangement, humanize, auto-mix, WAV download |
| **Pipeline** | Former Voxloop Studio pipeline — Upload → Align → Analyze → Clean → Tune → Mix |
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
js/                 Engines (Voxloop Studio + Beatsmith + beatlab bridge)
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
New: `js/icons.js` (icon set, loaded first), `css/mobile.css` (loaded last). Edited: many small spots (emoji and symbol icons replaced with SVG icons), `index.html`, `js/studioui.js`, `js/automix-vl.js`, `js/studio.js`, `js/mixbrain.js`, `js/fxrack.js`, `js/automation.js`, `js/reference.js`.
- Phone: Studio is a slim mobile-DAW layout (icon toolbar strip, compact lanes with a "more" menu, one-row transport, FX Rack / Reference as bottom sheets). Beat Lab no longer overflows the screen. The Pipeline's bottom "Continue" bar hides while the in-page Continue button is visible, so it never shows twice.
- No emoji anywhere: every icon is inline SVG (`VLI("name")`).
- Mixing and mastering: the quiet-gap cleaner never touches a stretch where the beat is playing and lets go slowly; the phrase gate is shallower and slower (shaped by the beat); new calculated "Ambience between lines" option (default Auto) swells a soft wash after each line so the song keeps breathing when the singer stops.
- Fixed: the Auto tab's panel was painted solid violet (a class-name clash).

## Step 13 — Less "Voloco", more natural vocals
Edited: `js/fxrack-dsp.js`, `js/fxbrain.js`, `js/pitchcorrect.js`, `index.html`.
- Studio VL Tune used to snap EVERY note onto the grid by default (Flex-Tune 0, Humanize 0): on a test vocal ~80% of the singing
  ended up within 10 cents of a scale note, the same as the "Hard (T-Pain)" preset. Defaults are now retune 60 ms, Flex-Tune 40
  (notes within ~24 cents are left as sung), Humanize 40. The Hard preset is unchanged.
- The "Natural vibrato kept" knob actually ADDED a synthetic vibrato to held straight notes. It is now "Added vibrato (straight notes)",
  default 0 in the rack and in Auto; the Pipeline's "Natural" option adds about half as much as before.
- Auto (Studio): house retune speeds raised (afrobeats / amapiano / universal 55 ms, rnb 75, rap 50, trap 18), every style uses Flex-Tune,
  humanize raised. Pipeline Auto follows the same table; the Pipeline retune slider starts at 50 ms.
- Reverb predelay: Studio default 63 ms -> 30 ms; Auto 18-80 ms -> 16-38 ms (past ~40 ms the room is heard as a separate repeat).

## Step 14 — Better detection + the Music Brain

Everything that listens to a beat or a vocal was measured against 48 beats rendered by the Beat Lab (so key, tempo and style are known),
then improved. New file: `js/musictheory.js` (plain JS, also runs in Node). It is a **rule-based music-knowledge engine**, not a language
model: it knows scales and modes, chord roles, and how fast each style is played, and uses that to check what the detectors hear.

- **Beat key** (`MusicTheory.analyzeKey`, used by `detectKey`; the old detector stays as fallback):
  tuning is estimated first (so a beat that is 40 cents off pitch still reads correctly), drums are filtered out of the spectrum,
  the 7-note set is chosen, then the home note from the bass notes, chord loop, first chord and chord roles. Reports the mode
  (e.g. "D dorian feel") and the chord loop in Roman numerals (e.g. `i - VI - III - VII`). When a loop only plays two chords and several
  keys fit, common chord roles (vi-IV, not iii-I) break the tie. The key spelling always keeps the right 7 notes for pitch correction.
- **Beat tuning** (the "tuned to the beat, not A = 440" reference): measured on the pitched sound only, accurate to about 1 cent.
- **Tempo**: half/double-time is settled by the style's normal count (`MusicTheory.reconcileTempo`): slow-jam R&B is shown at 68, not 136;
  trap at 140, not 70. Only applied when the style call is confident, and never to a tempo the Beat Lab or the user set.
- **Bar start (beat 1)**: the fill engine now also looks at where the *chords change* (pitch content before vs after each beat), not
  only where drums hit. Correct bar phase went from 18 of 48 to 26 of 48 beats (off-beat anticipations in Afro grooves are still hard).
- **Genre**: fingerprints re-calibrated against what the sensor really measures; hand percussion (congas) is now used as evidence;
  the rule that kept calling Afropop "universal" was loosened. `classifyFeatures()` is a pure function so it can be tested without audio.
- **Vocal key** (when the beat's key is unknown): the singer's overall tuning offset is removed first, held notes count by duration, and
  the notes phrases come to rest on decide the home note.

How well it works is measured on synthetic Beat Lab beats only (Afrobeats and R&B). Real recordings will differ: treat the numbers as a
regression check, not a promise.

## Step 15 — Exact key landing + no "ocean" noise after tuning

**1. The tuner now lands every note exactly on the key it names.** The softer settings added in Step 13 left notes within about 24 cents of a
scale note untouched, so the median sung note ended up 14-17 cents off the key (measured). Changed:
- Flex-Tune default 40 → 6 (notes within 4 cents are left as sung; everything else is pulled onto the key). Natural preset 8, Modern pop 4.
- Auto (Studio) and the Pipeline's auto settings use the same tight 4-6 cent zone. The "adaptive" logic used to widen that zone for rough
  takes (12-34 cents), so the rougher the singing the less it was fixed; it can no longer loosen it.
- Auto no longer skips tuning because a take is "within a quarter-tone"; it skips only when nearly every note is within 10 cents.
- Studio / Auto-mix now tune to the beat's real pitch (the tuning offset measured from the beat), not only to A = 440, so a beat that sits
  20 cents sharp still gets a vocal that is in tune with it.
- Speed (retune ms) and Humanize still control how the note is *reached*, so the glide between notes stays natural; they no longer decide
  whether the note lands on the key.

**2. Noise cleanup after retuning (`cleanNoise` in `pitchcorrect.js`, "Noise cleanup" on VL Tune).** Shifting pitch re-spaces tiny grains of the
voice, which brought room noise back a few dB louder and swishy *only while the singer sings* (the gaps were untouched), so the singer seemed
to bring the noise. After tuning, the noise between the voice's harmonics is now lowered using the note's own tracked pitch (the harmonics are
left alone), plus a light broad noise cut learned from the quiet gaps (fading out above 5 kHz so S sounds and air are kept). It switches itself off
when the take has no clear gap or is already clean. Default 60% = 10 dB between harmonics, 3 dB broad.

Measured on synthetic sung vocals (not by ear): sung-note noise 4-10 dB louder than the gaps before, about level with them now; voice peaks
unchanged (0.07 dB); S sounds 1-2 dB lower; note centres median 2 cents from the key, 98-100% within 10 cents on every path.


## Step 16 — Voice type, plugin accuracy, VL Harmony, bar-start fix

Everything below was measured with the scripts in `tests/` (run with `node tests/<name>.test.js`). They use **synthetic** voices and beats
(`tests/synth-voice.js`, `tests/synth-beat.js`): treat them as regression checks, not a promise about real recordings.

**1. Voice type (`js/voiceid.js`, new).** The brain used to call a voice low / mid / high from one number (median pitch) and sung / rapped from
the share of held notes. Now it measures: pitch range (low edge, median), the voice's *own* S-sound frequency (4-10 kHz), how clean the harmonics
are (breathiness), and sung / mixed / rapped from held notes + pitch plateaus + syllables per second. Every voice-dependent setting follows a
measurement: low cut = 0.62 x the lowest note, de-esser centre = the measured S frequency, presence centre from it, air held back on breathy takes.
It reports a **confidence**; under 50% the brain uses neutral settings (and an unsure "rapped" can no longer switch tuning off). The Auto panel has a
**Voice** row (Auto / Sung / Rapped / Low / Mid / High) to correct a wrong call in one tap. Findings now say what was detected and how sure it is.
Measured on 11 synthetic voices (bass to soprano, sung and rapped): sung/rapped right on 11/11; the S frequency lands within ~200 Hz.
Known limits: pitch alone cannot separate a high male voice from a low female one, so the middle bands say "tenor / low alto" instead of guessing
(a formant-based voice-size estimate was tried and **removed**: the same synthetic vocal tract read 1.03 to 1.21 depending on the pitch sung).
Alternating sung and rapped lines read "mixed", fast short sung notes can still look sung only because they are held.

**2. Plugin accuracy.** Found by measuring each plugin, then fixed:
- **VL Comp** under-compressed (it read raw sample values, so the gain recovered between waveform peaks): at 4:1, -2 dB in gave -14.3 instead of -15.5. Now a peak-hold detector; the curve is within 0.1 dB.
- **Limiter** let the first few ms of any audio through (a loud start passed at +5.4 dB with a -1 dB ceiling). Fixed; also fixes the master.
- Checked and fine: de-esser (3/6/9 dB setting cuts the S by 2.98/5.94/8.89 dB, leaves vowels untouched), delay timing (250.0 ms at 1/8 and 120 BPM), imager, orbit, master true-peak (never above -1 dB on 4 test mixes).
- Not testable in Node (need a browser audio engine): EQ, Hall, Doubler, Crowd. Listen to those.

**3. VL Harmony (new plugin, category Pitch).** There was no plugin called "path"; this was read as "pitch" and adds the missing pitch tool: up to three backing voices, each moved by
*scale steps* (3rd, 4th, 5th, 6th, octave, above or below) in the beat's key, so a harmony cannot land on a wrong note (tested: every note in A minor, exact intervals).
Auto can place it in the big sections only (flavour "Key-locked backing harmonies"), never on a rapped vocal or an unknown key; high voices get the part below.
If the plugin meant something else (phaser, pan, pad, gate...), say which.

**4. Bar start (beat 1).** On synthetic beats the grid could lock half a beat late on off-beat Afro grooves (hats on the "and"). Now chord changes decide: the grid moves half a beat
only when the chord changes are clearly sharper there and concentrated on one beat of the bar (a drums-only beat is left alone).
Measured (24 beats each, original -> now): normal 20 -> 23, chords every 2 bars 20 -> 23, noisy 24 -> 24, drums only 14 -> 14. An attempt using kick/bass evidence was worse and was dropped.

**5. Still open (measured, not fixed).** Major two-chord loops (I-IV, e.g. C - F) are called the wrong key (F major) on all 6 test keys; a change that let the home-note evidence choose between the tied
key sets fixed none of them and broke minor two-chord loops (6/6 -> 2/6), so it was **not** shipped. Minor two-chord loops and every four-chord loop are right (`tests/key.test.js`).
The original 48-beat Beat Lab set is not in this zip, so the 26/48 figure above could not be re-measured; the numbers here are from my own synthetic beats.


## Step 17 — Autopilot: pick a vocal and a beat, Voxloop does the rest

Goal: like a self-driving car. Everything can still be seen and changed, but nobody has to. Numbers below were measured with `tests/` (Node) and
`tests/e2e/` (a real Chromium driving the real app, on synthetic vocals and beats). They are regression checks, not a promise about real recordings.

**How it works.** `js/autopilot.js` drives the SAME Pipeline steps a person would (their buttons and controls), so nothing is hidden: load, align, analyze, clean-up, tune,
mix and master. Pick a vocal and a beat and it starts by itself (a beat sent from Beat Lab also starts it). A card under the step bar shows progress; **Take over** stops it at any
step. `js/autodecide.js` (pure, tested in Node) holds the decisions; the existing brains (mix brain, genre, Voice ID) still make the mix and master choices.

**Auto at every level.**
- Pipeline: every step (Align, Analyze, Clean-up, Tune, Mix) has an **Auto** pill and a line saying what it chose. Touching any control in a step switches that step to **Manual**
  by itself (like touching the wheel); Autopilot then uses your settings for that step. The Autopilot switch (top card) turns the whole thing off. Both are remembered.
- Studio: **Autopilot** switch in the Auto tab. A take that is recorded or imported is listened to and produced by itself once a beat is loaded (baked into the clip, so it can be undone).
- Plugins: every plugin card has an **Auto** button. It listens to the selected audio and sets only that plugin; if the audio does not need it, it switches the plugin off and says why.

**New decisions (autodecide.js).**
- *Align* (the old Auto-align just lined up the first sound of each file, so a vocal that was already in sync was moved 2+ seconds): now compares the vocal's rhythm with the beat's rhythm.
  Measured on 20 cases (in sync, 90 ms late, 40 ms early, cut to the first word, cut + late; 4 beats): error 4-10 ms on all 20. A vocal with no rhythm (held notes) is left as recorded.
- *Clean-up*: noise and speed match are allowed (the engines act only when needed); timing tighten only for rap or tight styles.
- *Tune*: a rap is left untuned, a mixed sing/rap line is tuned at 65%, an unsure sung line a little lighter (`S.autopilotTuneCap`, read by tune.js).
- *Mix*: polish and voice level from the style and delivery; a quiet third-above harmony only for a sung vocal in a known key in R&B / Afrobeats / Amapiano.

**New detection and plugin.** `detectHum` (50 / 60 Hz mains hum, read in the quietest parts of a take, must be a clear peak AND audible, louder than about -68 dBFS) and **VL Gate**
(look-ahead expander so word starts are not chopped, plus a hum notch that is pre-settled so the first second of a clip does not leak). The Studio brain adds it only for audible
noise (above about -56 dBFS between lines) or hum, and keeps it shallow over a sparse beat. Tests: gap quieted by its range (-12.2 of 14 dB), voice untouched (0.00 dB), word start within 1.3 dB,
hum found at 50 and 60 Hz, not found on a clean or hissy take, removed by the notch.

**Summaries are closed dropdowns.** The edit list after mastering ("What Voxloop changed (N edits)"), the Autopilot recap ("What Voxloop did (N edits)") and Beat Lab's auto-mix table
stay closed until tapped.

**Measured in Chromium (Autopilot, all six steps, no taps):** rap in sync: aligned within 4 ms of truth, rap left untuned, timing tightened 155 of 181 syllables; rap recorded 90 ms late: moved earlier 96 ms;
noisy rap: light noise clean-up applied; sung vocal: tuned 29 notes to A minor. Each finished in about 30 s with no page errors.

**Not done / honest limits.**
- Not run on real recordings or on a phone. Real vocals have much less regular rhythm than the synthetic raps used for the alignment numbers.
- Major two-chord loops (I-IV, e.g. C then F) are still read as the wrong key (Step 16 note). Autopilot inherits this: on such a beat it can tune to the wrong scale.
- Beat Lab's beat generation has no Autopilot (it makes the beat; Autopilot starts when you send it to the Pipeline).
- Mastering stays cautious on purpose (a few dB of lift at most); it does not chase a loudness number.


## Step 18 — Line by line: the notes each line is allowed to use

A singer is not locked to the seven notes of the beat's key. Lines borrow notes: the flat 5th (blue note), a raised 6th or 7th, the major colour of a minor key, a lift to the
4th or 5th. Forcing the whole vocal onto one key bends those notes the wrong way. Voxloop now listens **line by line**.

**What it does (`js/phrasebrain.js`, pure, tested in Node).**
- Splits the vocal into lines (a breath of 0.35 s or more starts a new line) and measures each: the notes sung, whether it is sung / mixed / rapped, and where it sits in the singer's range.
- For each line it asks which allowed set explains what was sung with the least correction. The candidates: the beat's key (the default), blues, dorian / mixolydian, harmonic minor, lydian,
  the parallel major or minor, and a lift to the 4th or 5th. The key only loses when a line spends at least 0.7 s (and a tenth of the line) on notes more than 0.7 of a semitone outside the key
  that land exactly on another set. A singer who is merely flat is not "borrowing", and one stray note cannot change a line.
- Each line becomes a zone for the tune engine (`zones` in `pitchcorrect.js`: allowed notes + strength per time range; new sets: blues, major blues, harmonic minor, pentatonics, and any exact set via `"mask:101011010101"`).
  A rapped line gets strength 0 (left as performed); a mixed line 0.55.
- If most of the vocal is in a different key altogether (under 55% of notes in the beat's key), line by line steps aside and the old whole-vocal move is used.

**Where it runs.** Pipeline Tune step ("Listen line by line", on by default; a closed dropdown "How each line was handled" lists the decisions), the Autopilot recap, and the Studio's VL Tune plugin
(new "Line by line: auto / off" option). The Studio brain also uses the lines to keep harmony off rapped sections.

**Measured.** `tests/phrase.test.js` (Node, real tune engine): five lines (in key, blue note, lift to the 4th, rapped, major colour), each slightly out of tune. Every line was classified right, and
the notes ended up this far (cents) from what the singer meant: blue note line 2 (one key: 24), lift line 3 (one key: 26), major colour line 2 (one key: 44), in-key line 2 (as sung: 11).
In Chromium, through Autopilot on a beat in A minor: 5 lines found, 3 allowed other sets, 1 rapped line untouched, notes 1-3 cents from the target.

**Extras now chosen by Autopilot (not left off).** `VLBrain.autoFlavors`: fader ride, shimmer (it decides itself), doubles in the beat's biggest sections, a short echo on line endings, and a key-locked
harmony only for a sung vocal in R&B / Afrobeats / Amapiano with a known key. Harmony is skipped for sections that are mostly rapped lines.

**What I tried and removed.** Per-line EQ (each line's tone against the rest of the vocal). On test material the same voice swung by up to +-25 dB in a band between lines purely from the notes and vowels sung, so EQ driven by that
would have made the timbre uneven, the opposite of a studio result. The existing dynamic harshness control already handles real problems. Not shipped.

**Honest limits.** Chord-by-chord awareness (what the beat's chord is at that moment) is not used: sets come from the beat's key only. Tested on synthetic singing; real singers are less steady, so the 0.7 s / 0.7-semitone
evidence rules are conservative on purpose and may leave some borrowed notes pulled to the key. The octave / register of a line is reported ("a high part") but does not yet change its processing.


## Beat Lab sound library and genres (v2)

**What changed.** Beat Lab used to have five near-identical kits and two Afrobeats styles, so everything sounded alike. Now:

- **Genres:** Afrobeats (7 styles: Smooth, Afropop, Afro-fusion/Alté, Afroswing, Afro-rave, Street-pop, Afro-highlife), **Amapiano** (Classic, Private School, Sgija), **Afro House** (Deep Afro House, Gqom), and R&B (unchanged).
- **11 drum kits** that really differ (kick pitch/click/length, snare body vs rattle, clap spread, noise vs 808-metal hats): soft, punch, boom, tight, vintage, **afro, ama, dembow, highlife, house, gqom**.
- **Percussion instruments:** congas, bongos, djembe, talking drum (pitch-bending), floor tom. Each plays open / closed / slap / muted strokes depending on where in the bar it lands and how hard.
- **Bells & shakers:** agogo, cowbell, clave; shaker, shekere, caxixi, tambourine. Agogo and cowbell are fixed-pitch like the real instruments.
- **Log drum** (amapiano): classic / amapiano / wooden, with an octave layer and wooden click.
- **New keys, pads, basses, leads, plucks:** piano, clean guitar, house stab, strings, choir, plucked bass, deep sub, growl, rolling house bass, flute, horn, whistle, afro guitar, kora, marimba, nylon guitar, piano runs.
- **Sound panel** in Beat Lab (under the Genre/Style bar): change any part live, or keep "Style default". Your picks stay when you press New beat.

**Written, not rolled.** Styles can define:

- `riffs` (bass and log drum): `RIFF("x..x ..x. ..x. x.x.", "r r 5 8 5 3")` is a rhythm plus the chord note each hit plays (r root, 3, 5, 7, 8 octave, 9, 4, l low fifth, b step below). The line follows the chords.
- `kickB`, `percB`, `pluckVerseB`, ... : "B" parts that play on the answer bar of every two-bar phrase, so a groove asks and answers instead of repeating or adding random hits.
- `rules`: per-style section behaviour (e.g. amapiano intros start without the log drum and kick).

**Files.** `js/templates-afro.js` (all new genres/styles, easiest place to add more), `js/engine.js` (new kits and instruments, search "Extra sound libraries"), `js/beatgen.js` (riffs, answer bars, sound picks), `js/beatlab.js` + `index.html` (Sound panel).

Not in the new styles yet: samples. Everything is still synthesized in the browser, so no audio files were added; to add real samples later, hook them in where the kit voices are triggered in `engine.js` (`E.voices`).

---

## Mixing and the Mix Doctor (v2.1)

**Mix Doctor** (Mixer panel, "Check & fix my mix", `js/mixdoctor.js`): renders four bars of the chorus, listens to each instrument alone and to the whole mix, then checks: silent instruments, balance under the kick, low-end weight (share of energy under 150 Hz), bass/keys/pad crowding the singer's 1-4 kHz range, headroom (loudest peak aimed at -6 dBFS) and clipping, and stereo width. It fixes what it can with level trims and the master level, measures again (up to 4 passes, and the report always comes from the final measurement), and lists anything it cannot fix in plain words. Its limits (`MIXDOC` at the top of the file) come from the original Afrobeats and R&B genres.

**Loudness matching.** `LEVEL_DB` in `engine.js` holds a dB offset for each new sound so that changing a kit or instrument changes the sound, not the level. Only new sounds are listed; the originals are untouched. After changing a preset, re-measure and update the table.

**Engine fix.** A drum hit again while still ringing used to stay at full volume until the next hit when the browser lacked `cancelAndHoldAtTime` (Firefox) or handled it differently. `holdParam` now replaces the old decay with the same exponential curve, cut at the level the maths gives. This affects every drum and envelope, and should sound identical where the old way worked.

**Tuned after measuring.** Amapiano bass and log drum targets lowered (the mix was 72% under 150 Hz), and the gqom bass made darker (it was the loudest thing in 1-4 kHz).

**Known limits.** The mix is nearly mono (left/right match 94-98%, also in the original genres). Keys, plucks and leads vary by about 3 dB between measurements because of random detune, so only large level mismatches were corrected for them. Nothing here has been judged by ear.

---

## v2.2: your samples, stems, a checked download

- **Your own samples** (Beat Lab, Sound panel, "Your own samples"): load a WAV/MP3/M4A (up to 10 s) onto the kick, snare, clap, rim, hi-hat, open hat, shaker, percussion or bell. It replaces the synthesized sound, runs through the same fader, pan and effects, and is used by the Mix Doctor and every download. While a sample is loaded, the track's synth filter is opened up so the sample is not coloured by it. Samples are kept in memory only (`USER_SAMPLES` in `engine.js`), so they are gone when the page reloads. Tonal tracks (bass, keys, pad, lead, pluck, log drum) cannot take a sample, because one recording cannot follow the chords.
- **Stems** (Export panel, "Download stems (zip)"): four same-length WAV files (Drums, Percussion, Bass, Music) in one zip, at the same levels as the full mix. Each stem is rendered, encoded and released one at a time (a phone cannot hold four full songs in memory), and the zip is deflate-compressed where the browser supports it (about half the size). The impact and crash are on the drums stem only. Stems are not guaranteed to add up exactly to the full mix, because the master processing reacts to what it hears.
- **Check my mix first** (Export panel, on by default): runs the Mix Doctor before every download, stems and send to Pipeline/Studio. If the Doctor fails, the old auto-mix is used so the download still works.
- **The stop** (`stopBeforeChorus` in a style): on the last beat before a chorus the listed tracks drop out. It only applies where a chorus follows a section that has no snare-roll build, so you will notice it rarely.
- Zip writer and stem code: `export.js` (`renderStems`, `makeZip`).

Not built yet: a motif-based hook writer, a click/count-in, key-by-vocal-range, and learning from thumbs up/down.

---

## Melody toggle

Beat Lab makes a melody by default (the lead hook, the pluck, and a chime-type bell that plays chord notes). The **Melody** checkbox in the toolbar turns that off: the lead, pluck and chime bell stop, and the chords, pad, bass, log drum and all drums and percussion (agogo, cowbell, clave included) keep playing. It is a setting, not part of a beat, so it stays off when you press New beat, and it applies to playback, downloads, stems and the Mix Doctor (the Doctor only checks what will be heard). Code: `melodyOn` and `isMelodyTrack` in `beatlab.js`.


---

## Sound packs (v2.3)

`js/packs.js` holds 31 packs: Afrobeats 10, Amapiano 9, Afro House 8 and R&B 5. A pack is a matched set of drum kit, keys, pad, bass, lead, pluck, percussion, bell, shaker and log drum. A beat now picks one pack, and each style offers only the packs that suit it (every style has at least 5). The "Sound pack" picker at the top of the Sound panel chooses Auto (a different pack each beat) or one pack; a chosen pack stays when you press New beat and resets when you change genre. In Auto mode about 1 beat in 4 borrows one colour part (lead, pluck, percussion, bell or shaker) from another pack that suits the style; kit, bass, keys, pad and log drum are never borrowed. The Sound panel part pickers still let you override any single part.

Every pack was run through the Mix Doctor (peak about -6 dBFS, low end 21-59%). Two packs (Alté Dreams, Sunday Jazz) crowded the singer's range with wurlitzer keys and were switched to rhodes. Judged by measurement only, not by ear. To add a pack, add an entry to `PACKS` (ids must exist in `SOUND_MENU`) and run the Mix Doctor on it.


## Settings tab, Studio recording timing (v3)

- **New Settings tab** (4th tab, gear icon; also a gear button on the Studio transport and a link in Beat Lab's record panel). Saved on the device (`js/settings.js`).
  - **Microphone:** Earbuds mic (default) or the phone's own mic. Picked by device name; the tab shows which mic will be used, a Test mic button shows its level, and recording says if it had to fall back.
  - **Mic cleanup:** Auto (off for earbuds, on for the phone mic) / always on / always off. Replaces the old "Raw mic" toggle.
  - **Count-in:** off by default, 1 or 2 bars. Now real clicks in the beat's tempo (the old one was a silent 2-second wait). Beat Lab sends its BPM to Studio; a loaded file uses 100 BPM.
  - **Timing nudge:** -300..+300 ms on top of the automatic delay removal.
- **Latency (Studio):** takes were placed at the playhead with no correction, so they landed late. Now the mic is recorded in the audio thread (AudioWorklet) with the exact audio-clock time of its first sample, and the output + input delay is removed. Lossless instead of opus. Wireless earbuds use an estimated 200 ms when the browser reports almost none. Fallback without worklets: MediaRecorder (approximate timing).
- Tested in Chromium with a fake mic (settings, mic fallback, record, count-in, gear). Not tested on a real phone or with real earbuds.


## Timeline, quiet singers, background noise (v4)

- **Timeline like a DAW:** bar numbers and beat ticks when the tempo is known (Beat Lab beats), seconds otherwise; the grid behind the clips matches the ruler. ONE playhead over the ruler and all lanes (flag on top), placed from the scroll position so it cannot drift. Drag the ruler to scrub (snaps to the beat, edge-drag scrolls), the view follows while playing and recording. Red playhead = recording starts here / is recording.
- **Quiet singing:** the take level is now worked out from how loud the SINGING is, lifted up to +30 dB (Settings > Quiet singing: Auto / Normal / Off) or brought down when too loud; stray peaks go through a small limiter instead of holding the whole take back. (`polishTake` in daw.js.)
- **Background noise: VL Clean** (`js/vlclean.js`, new plugin, first in the chain). Autopilot listens to every take and decides: steady noise (fans, air-con, hiss, hum), wind and rumble (a low cut that only closes while the rumble is there), sudden noises between lines (kids shouting, horns, cars, dogs). It follows a changing noise over time, cuts less while you sing, and leaves a clean take alone. Not possible: removing a shout at the same moment as the singing, or a noise as loud as the singing. Tested on synthetic scenes only (fan, wind, shouting, clean), not on real recordings.


## Editing, zoom, beat read-out (v5)

- **Beat read-out:** every beat loaded in Studio is listened to (tempo, key, style, big parts) with the same analysis Autopilot decides from (`listenToBeat` in daw.js). Beat Lab beats send their exact BPM and key. The result drives the bar grid and the count-in, and shows as a chip beside the beat's name; tap it to correct tempo (with ½ / ×2) or key, and Autopilot uses the corrected values. The Auto tab says what Autopilot is working from.
- **Edit bar (`js/editing.js`):** Effects, Undo/Redo, Split at playhead, Copy, Cut, Paste, Delete, Zoom -/+/Fit. Delete removes only the selected part; Paste adds a NEW clip at the playhead on the active lane (tap a lane name or empty lane space; follows the armed lane) and never replaces: overlapping clips show in rows and both play. Pasted/split pieces of a take Autopilot already produced are not produced again. Selecting a clip no longer opens the Effects panel over the timeline: use the Effects button. Keys: Ctrl/Cmd+Z, Shift+Z, C, X, V, Delete, S.
- **Zoom:** pinch, Ctrl+wheel or buttons, around the pinch point; waveforms are drawn in 2048 px tiles so zoomed-in clips work on phones. Lane rebuilds keep the scroll position.


## Melody that fits the vocal (v6)

- **`js/melody.js`**: listens to the main vocal lanes (notes, rests, range, the key sung), reads the beat's chords per half-bar (chroma against major/minor triads, boosted for the key), writes short TRUMPET lines and mixes them. "Answer": a reply after a sung line, only in the gaps (never over singing), 2-4 short notes + a landing note on a chord tone, shape taken from the line just sung (inverted or kept), on key notes only. "Support" (optional): soft muted trumpet doubling (octave up) or harmonising (a third up) long sung notes. Amount: Subtle / Normal / Lots (default Subtle: about every second line).
- **Mix:** trumpet is a built-in synth (scoop, brass bloom, late vibrato, breath), high-passed at 170 Hz, 2.5 kHz pocket for the voice, -5 dB while the singer sings, short plate reverb, level set 8 dB under the beat and about 11-14 dB under the vocal, then checked against the vocal in 1-4 kHz and against headroom (the melody is lowered, never the beat). The report is shown in the Melody panel.
- **Where it lives:** one stereo buffer kept beside the beat (`VLDAW.api.setMelody`). Plays with the beat, is in the Studio mix render, and goes to the Pipeline merged into the instrumental. Melody row under the Beat lane (hide / remove). Regenerate = new seed. Undo.
- **Autopilot:** adds it by itself once the vocal is produced, if the beat has no melody (Beat Lab sends `noMelody` when its Melody toggle is off; a loaded beat counts as sparse when the analysis finds it not busy). Settings > Autopilot, and the checkbox in the Melody panel, switch that off. Removing the melody stops Autopilot re-adding it until a new beat is loaded.
- **Not claimed:** that it sounds good by ear (everything is judged by measurement: in key, on chord tones, off the singing, under the voice), or that the pitch tracker reads every real phone vocal correctly. Needs real takes to tune.

- **Any beat, not just Beat Lab's:** Autopilot listens to the beat for an existing lead line (pitch tracker on 350 Hz-3.5 kHz: a pitched line present 30% of the time with 2.5+ note changes a bar = a melody; chords and bass change about once a bar). No melody found = it adds one; a melody found = it leaves the beat alone (the Melody button still adds one on request). Tested with imported WAV files, with and without a lead line.


## Menu and Drafts (v7)

- **Navigation:** on phones a menu button (three lines) opens a drawer: Beat Lab, Studio, Pipeline | Drafts (with a count), Settings, and the Simple / Pro switch. The top bar shows only the menu button, the screen you are on, and Save. On laptops the top bar keeps labelled tabs in two groups (make music | your stuff) plus a "Save to drafts" button. (`js/nav.js`, `css/nav.css`)
- **Drafts** (`js/drafts.js`): "Save to drafts" in Beat Lab saves the beat as plain data (patterns, chords, sounds, seed, settings: tiny, reopens fully editable); in Studio it saves the song (beat audio, every lane and take as 16-bit audio, the melody, corrected tempo/key, playhead; takes Autopilot already produced stay marked as done). Kept in this browser's IndexedDB. The Drafts screen lists them (All / Beats / Songs) with Open, Rename, Copy, Delete; saving from a draft offers Update or Save as new; opening a song over unsaved Studio work asks first.
- **Not saved in a draft:** the FX-panel per-take undo history, and effect settings as editable chains (takes are kept as they sound, after processing).


## Rename and Pipeline tempo fix (v8)

- **Name:** the app is Voxloop Studio (short: VL Studio). Every "Vocal Vault" in the UI, file headers, download names (`voxloop-master...wav`, `VoxloopStudio_composite_...`) is updated. Code names: `VocalVaultX` globals are now `VLX` (`VLDAW`, `VLState`, `VLStudio`, ...), `vv-` events, classes and storage keys are `vl-`, `automix-vv.js` is `automix-vl.js`. Saved preferences (last screen, Simple/Pro, settings) are carried over from the old keys once, on first open.
- **Footer:** now just "Voxloop Studio".
- **Pipeline, "Vocal tempo: doesn't match the beat" on a vocal that was in time:** the check searched only +/-20% around the beat tempo and needed a clear peak there; a cover sung over a beat that still had the original vocals in it gave a flat tempogram, so it failed even though the vocal's overall tempo (94) equalled the beat's (94). Now, if the vocal's overall tempo is within 6% of the beat's it counts as a match. The message is also truthful now: it says half-time / double-time, "more than 20% away", or "close but not steady enough to be sure" as the case is.

- **Simple / Pro removed (v9):** it only hid three Pipeline controls (retune speed and friends, auto-enhance beat, higher harmony). They are now always shown; the switch, its script and its styles are gone from the header and the menu.

## Recording quality (v10)

- **Mic cleanup now defaults to Off** (and "Auto" from older versions means Off): the phone's call-style processing (noise suppression, echo cancel, auto-gain) dulls and squashes a singing voice, and on cheap phones it is a likely reason a vocal sounds thin next to a studio vocal. Turn it On only if the beat leaks into the mic.
- **Take check** (`js/takecheck.js`): after each recording the raw take is measured (level, background noise, clipping, how much top end was captured, the mic's own sample rate, the beat leaking into the mic, whether call-style processing was on). A toast offers "See tips" with plain advice; the edit bar has a Take check button for any recorded take. Thresholds were set on synthetic recordings, not real phone takes: treat them as a guide.
- **Phone speaker preview** (Phone button in the Studio transport): plays the mix through a small-speaker model (no low end, upper-mid push, mono, soft distortion) so the mix can be judged where many people will listen. Playback only, never the exported files.

## Safe work and offline (v11)

- **Responsive on slow phones:** noise cleaning, melody writing, saving a take, and drafts packing now yield to the screen every ~12 ms (`js/yield.js`) and show a progress bar with what they are doing. The work takes a little longer in total, but touches and scrolling keep working and the phone does not offer to close the page. Results are identical to before (same tests, same numbers).
- **Autosave and recovery** (`js/autosave.js`): the Studio project is saved quietly 3 s after any change, 0.6 s after a take is saved, and when the page is hidden. Each piece of audio is stored once, only when new or changed. Opening the app with an empty Studio offers "Bring your work back?". Stored on the device with Drafts, never uploaded. It also asks the browser to protect the storage from automatic clearing.
- **Offline and install** (`js/pwa.js`, `sw.js`, `manifest.webmanifest`, `icons/`): after one visit with internet the app opens and works with none. Installable (home-screen icon, opens full screen). Settings > "Install and offline" shows the status, the Install button (or the steps on iPhone), storage used, and "Protect my drafts".
- **IMPORTANT when you change any file:** run `python3 tools/build-sw.py` before publishing. It rewrites `sw.js` with a new version name, which is how phones know to fetch the update. Upload the new folders too (`icons/`, and `sw.js`, `manifest.webmanifest` next to `index.html`). The very first open must be online.
- Fonts come from Google Fonts: offline they fall back to the system fonts until they have been loaded once.

## More than a trumpet: lines that match the beat (v12)

- **Instruments:** the melody now uses the beat's own lead, pluck, chime bell and keys (the very parts Beat Lab's Melody switch removes), rendered offline through Beat Lab's engine, plus the built-in trumpet. A Beat Lab beat sends its own sound pack, so the added lines use exactly the sounds it was made with; any other beat gets the pack that suits its style (analysis genre, or from its tempo: slow = R&B, about 90-108 = Afrobeats, 108-118 = Amapiano, 118+ = Afro House), so it still matches. Settings: Melody panel > Sounds: "Match the beat" or "Trumpet only". If the engine is not available the lines fall back to a muted trumpet.
- **Jobs, each only where needed** (`write()` in `js/melody.js`): *answer* in the bigger gaps (trumpet / lead / keys by style), *fill* a 2-3 note pluck figure in a gap the answer did not take (a pickup into the next line or a small echo), *sparkle* a chime on the landing note when a verse or chorus ends, *support* (optional) a soft double or harmony of long notes in the loudest lines. A line is skipped where the beat is already busy in the mids (400 Hz-4 kHz, measured per 100 ms). A cap on notes per minute drops the least important first. Nothing plays over the singing.
- **Match:** notes are in the key and land on the chord's notes; pitch register differs per instrument and sits above the voice; a light swing from the beat's groove; fuller replies after louder sung lines; keys play a two-note chord; all lines are levelled together against the beat and the vocal and checked in the 1-4 kHz band.
- Beat Lab now sends the beat's sound, style and swing to Studio.
- Tested with a synthetic beat and vocal (in key, none over the singing, fills skipped where the beat is busy, levels about 12-13 dB under the voice). NOT heard by ear.
