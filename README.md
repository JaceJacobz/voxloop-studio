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

## Host it on GitHub Pages (to test on a phone)

1. Create a new repository on github.com (public is simplest; Pages on private repos needs a paid plan).
2. Upload the *contents* of this folder (so `index.html` is at the top of the repository, not inside another folder). Easiest: on the repository page choose **Add file > Upload files** and drag everything in. Very large drops can time out, so if it does, upload in two or three batches (for example `samples/` and `fileaudio/` on their own), or use git on a computer: `git init`, `git add .`, `git commit -m "Voxloop"`, `git remote add origin <url>`, `git push -u origin main`.
3. In the repository: **Settings > Pages > Build and deployment > Source: Deploy from a branch**, Branch `main`, folder `/ (root)`, Save.
4. After a minute the app is at `https://<your-name>.github.io/<repository-name>/`. Open it on the phone. Microphone recording works there because it is https.
5. Updating: upload the changed files again (same names replace the old ones). The app keeps a copy for offline use and refreshes itself the next time it is opened with internet; if a phone still shows the old version, close the tab and open it again once.

`.nojekyll` (an empty file) is included so GitHub serves every file as it is. All paths in the app are relative, so it works under `/<repository-name>/` as well as at the top of a site. Total size is about 40 MB (the biggest single file is 350 KB), well inside GitHub's limits.

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

## Autopilot decisions (Pipeline)
- **Align** (`autodecide.js`): searches the whole song (up to ±30 s) for where the vocal's rhythm fits the beat, refines to 10 ms, and only makes a big move when the evidence is strong (or rhythm and first-sound agree). A vocal with no clear rhythm is left where it was recorded; it is never pushed seconds late on a guess.
- **Tone guard** (`studio.js restoreTop`, used in `automix-vl.js`): after clean-up, tuning and compression, the vocal's top end is compared with the untouched take; lost shine is put back (capped by take quality and beat brightness).
- **Mix polish**: clean R&B/Afrobeats takes use the lively "radio" tone; "natural" is only for rough takes.
- **Tune**: unclear sung/rapped → gentler strength cap (75%).
- Tests: `node tests/align.test.js`, `node tests/tone.test.js`.

## Octave brain (Pipeline, Tune step)
The Octave select (Auto / Raise one octave / Lower one octave / Off) is judged from THIS beat and THIS voice, not from fixed pitch numbers (`autodecide.js octaveBrain`):
- **Beat** (`pitchcorrect.js beatRegister`): the sustained bass and chord body (median spectrum over ~45 s from the middle), the beat's own gap above its bass, and where its chords sit (quartiles). Vibe (energy, space) comes from the mix brain.
- **Voice** (`octaveProfile`): the whole pitch distribution of the singing, per-line medians, and how much is steady held notes.
- For the voice where it is, one octave up and one octave down, it works out how much of the singing is ON the bass, UNDER the chords or far OVER them, and picks the placement that leaves the least. A move must fix most of the problem and beat the doubt in the measurement (short take, hard-to-read beat, lowering = rarer = more proof). A hard/busy beat asks for less proof to raise; a sparse one more. Lines the singer already sang an octave apart count as the singer's own evidence.
- Acts only on a sung vocal (unknown delivery needs more proof and some held notes); a rap is never moved; weaker evidence only suggests. Fixed numbers left: the physical limits of a lead vocal (C2..E6) and the relative weights of the three problems.
- Per line: lines already in the right register stay; moved lines keep their ups, downs and vibrato; unvoiced sounds pass through; pitch correction runs after.

## Key second opinion (Autopilot, Analyze step)
A beat can be ambiguous between a major key and its relative minor (A major / F# minor: the same seven notes). `AutoDecide.keyDecision` lets the singer's melody (where phrases land and rest) vote, weighed against the beat's own tonic confidence. Never overrides a Beat Lab key, never acts if the melody's seven notes differ. Tuning is unaffected either way (same notes).

## Other data-driven decisions
- Tuning strength cap for unclear delivery scales with how sure the voice check is.
- Tone guard brightness floor = the beat's own top-end level (not a fixed dB), boost cap scales with take quality.
- Tests: `node tests/octave.test.js` (voice, beat, key and lowering), `node tests/tone.test.js`, `node tests/align.test.js`. Synthetic audio only; tone/timbre still needs ears.

## Autopilot deck (Pipeline)
- `js/apdeck.js` + `css/apdeck.css`: one full-screen card at a time; a finished card swipes off to the left, the next slides in from the right. The page underneath never scrolls while Autopilot drives (`window.VLNoAutoScroll` makes the step-reveal `scrollIntoView` calls a no-op for the five step sections).
- After **Send mix to Pipeline** (Studio sets `window.__vlFromStudio` and fires `vl-sent-from-studio`) a card asks **Autopilot or Manual**. Manual closes the deck and starts nothing. Autopilot loads the audio, proposes an alignment, asks you to **confirm it** (nudge -100/-10/+10/+100 ms, hear it), then asks **which parts you want to do yourself** (Clean-up, Tune, Mix & master: Auto / Me).
- A part set to "Me": the deck steps aside, the page goes to that step once, a small "Continue Autopilot" bar waits. If you ran the step yourself, your result is kept, not redone.
- Direct uploads with the Autopilot switch on skip the first question (the switch is the choice) but still confirm the alignment and the parts.
- Tested in a real browser at phone size (`/tmp`-style scripts, see tests/e2e/run.js for the existing flow, which now taps through the deck).

## Corrections made in Studio carry to the Pipeline
Studio keeps a corrected key/tempo ("Not right? Correct it") in its own beat info; the Pipeline used to re-detect both from the audio file it received. Now `sendToPipeline` (daw.js) puts what is exact (set by you, or told by the Beat Lab) into `window.VLKnownBeat` with a `fileKey` (name|size of the beat file), and `script.js knownBeatFor()` recognises the beat by that file. The Pipeline then shows "Set by you in Studio • exact", the Tune step uses it, and Autopilot does not second-guess it with the melody vote. Detected (not corrected) values are not carried: the Pipeline detects as before.

## Melodic flow vs rap (Tune step)
Found on a real Afrobeats cover: 194 of 219 notes were classed "speech-like" (each short note slides) and left exactly as sung, so only 64% of the vocal ended up in the beat's key. The per-note speech test (fixed wobble thresholds) cannot tell fast melodic flow from rap.
- `pitchcorrect.js planCorrection` now judges each LINE (notes with no 0.35 s gap): how **pitched** it is (tracker certainty), how much of it is **held notes** (stays within 35 cents for 120 ms; a melody has them, a rap contour only glides: 0.48 on the real vocal, 0.42-0.75 on sung synthetics, 0.00 on three synthetic raps), and how much of it **clashes** with the key. Lift = melodic x clash; speech-like notes on a lifted line are tuned in proportion to it. Rap-like lines stay as performed.
- Tune step: new switch "Tune melodic lines that clash with the beat" (on by default; `spokenAuto`), the status line now says why notes were left alone (close to the key already / rap-like / lifted), and a one-tap "Tune the N rap-like notes too". Autopilot's summary carries the same "Why".
- Real vocal through the app: in the beat's key 59% -> 87%; melody's own key D# major -> A major (the beat's key); big pitch jumps 30 -> 25. Tests: `node tests/spoken.test.js`.

## Land every note on the key (Tune step switch, on by default)
Goal: every HELD note of a melodic line sits on a note of the key, and it still sounds sung. Measured on a real cover (126 held notes, the app's own settings: strength 85%, retune 50 ms, flatten 40%):
| | within 5 c | within 10 c | within 25 c | frames in key | big pitch jumps | vibrato kept |
|---|---|---|---|---|---|---|
| raw vocal | 6% | 13% | 29% | 59% | 30 | 100% |
| app before | 21% | 44% | 81% | 87% | 25 | 71% |
| app now | 70% | 83% | 95% | 90% | 20 | 61% |
What it does (`pitchcorrect.js planCorrection`, options `lockMelodic`, `settleShortNotes`, `glideShort`):
- **Lock**: a confidently melodic, clashing line (lift >= 0.5) is pulled the whole way onto the key, whatever the strength slider and the line's zone strength say; those still govern every other note.
- **Short notes settle**: one retune time cannot land a 90 ms note. A note's retune time is capped at 14% of its own length (floor 8 ms); long notes, scoops, slides and vibrato keep the slow glide. 14% is where accuracy stops improving and vibrato starts to be squashed (10% -> 48% vibrato kept, 4% -> 42%).
- **Fragments glide**: bits too short to settle on (under ~57 ms with the settle clock; otherwise under twice the retune time) get no target of their own; the correction glides through them between the real notes before and after.
- Every frame in key is impossible by design: the slides between notes pass through other pitches. The aim is every held note.
- Known limits: the misses left (about 17% beyond 10 cents, 5% beyond 25) are mostly 70-120 ms notes and notes that slide inside themselves. Tone/timbre after tuning needs ears. Tests: `node tests/spoken.test.js`.
- Diagnostics: the app keeps the full options of the last tune in `VLState.tuneOptionsUsed`.

## Beat Lab drums are recordings now (v2.4)

**What changed.** Beat Lab no longer synthesizes its drums. Every kick, snare, clap, rim, hi-hat, open hat, shaker, percussion and bell is a real recording (drum-machine hits and acoustic hand percussion) in `samples/<genre>/<type>/<1-5>.wav`. Each genre has **5 recordings per type**, and every new beat picks one of the five for each type at random, never the one the last beat used. The synth drum kits, the extra kit table, the percussion/bell/shaker synth kinds and the drum parts of the sound packs were removed. The Record-your-vocal panel was removed from Beat Lab (recording stays in Studio).

**Still synthesized:** keys, pad, bass, lead, pluck, log drum and the impact/crash transition effects. These follow the chords, which one recording cannot do. The sound packs (`js/packs.js`) now cover these tonal parts only.

**Files.** `js/samplebank.js` (picking, loading, caching), `js/samplemap.js` (generated: original name of each file), `samples/CREDITS.md` (sources and licences), `tools/build_samples.py` (rebuilds `samples/` from the source libraries; the curated list of 180 files is at the top). A beat stores its picks as `beat.sound.drums`, so Studio and every download play the same files. Sound panel, "Drum samples": one select per type, "Auto" (new pick every beat) or a fixed number. Locking the drums, hats or percussion group keeps their recordings. `DRUM_MAKEUP_DB` in `engine.js` sets each type's level against the mixer.

**Licence note.** Hand percussion and claps are CC0 (VCSL). The drum-machine hits come from a community collection that states no licence: see `samples/CREDITS.md` before publishing the app.

**Checked** in Chromium: all four genres load, every new beat changes every type, picks stay when fixed, playback and the offline download render play the drums (no clipping, drums and bass within a few dB). Not checked by ear.

## v2.5: real instruments, a producer brain and Trap
- Beat Lab now plays **recorded instruments** (piano, e-piano, organ, guitars, strings, trumpet, sax, flute, kalimba, marimba, 808 bass, upright/electric bass and more) next to the synths. A beat stores them as sound ids like `s-piano`.
- **js/producer.js** is the "producer": it picks the vibe (or uses the one you choose in Sound > Vibe), then scores every instrument for every part by genre, style, key (minor/major), tempo and vibe, and only uses a recording where one fits. It follows mixing rules (no two instruments of one family, no instrument twice, parts moved into the instrument's range) and writes a note saying what it chose and why. It is a rule-based system written as music knowledge, not a language model.
- New **Trap** genre (Hard Trap, Melodic Trap, Drill): half-time snare, rolling hats, a pitched/gliding 808, and its own drum kit (samples/trap).
- Recorded instruments are downloaded the first time a beat uses them (about 150-400 KB each) and cached by the service worker.

### v2.5.1: nothing is synthesized any more
- Every sound in Beat Lab is a recording: drums, percussion, all tonal parts, the log drum (recorded marimba / balafon / mbira, played short), the crash and the impact. The synth classes and presets are removed; beats saved by an older version map their synth sounds to the nearest recording.
- The instrument packs are gone: the producer (js/producer.js) chooses every part, guided by the Vibe selector. The melody tool's trumpet is the recorded trumpet, and the Studio "fill" tool adds recorded drums and instruments (kit samples for the beat's genre, recorded piano / cello / bass / marimba) instead of generated ones.
- Mixing: js/mixcal.js re-sets the starting faders for the recordings (measured against each genre's balance targets); the live auto-mix still fine-tunes during playback.

### v2.5.2: checked and fixed
- French horn: removed its two highest notes (a 14-semitone hole in the recordings); higher notes now fold down an octave.
- 808s: the raw TR-808 kick glides in pitch for 0.4 s, which made short bass notes sound up to 2.5 semitones sharp. They are now built on the steady part of the same recording and measure within a few cents of the written note from 0.1 s on.
- Violin, trumpet and sax get a gentler top end (they were harsh in the 2-6 kHz range when stacked); bass levels were re-matched.

### v2.5.3: the producer arranges, too
- After choosing instruments, the producer reviews which parts play in each section (js/producer.js, producerArrangeSong): one voice owns the melody in calm vibes, hard/dark verses stay bare with the pad arriving as a lift, calm bridges thin out, and the last chorus always brings the lead in. What it changed is listed in the beat's note.

### v2.5.4: Variation and "Make it ..." buttons (Beat Lab)
- **Variation** keeps the key, chords, drums and instruments; two of hats / percussion / bass line (random) and the arrangement are new.
- **Make it Darker / Brighter / More bounce / Calmer / More romantic / Harder / Dreamier** keeps the key, chords, drums, hats and bass line; the producer picks new instruments and a new arrangement for that mood (never repeating the last instrument for a part).

## v2.5.5
- Mix Doctor checked against the new recorded instruments: it works on all five genres. It is a mix checker, separate from the producer brain, so it was kept as is.
- Trap now has its own low-end limit (68%) because an 808 is meant to carry more weight, so Mix Doctor no longer trims the bass for that.
- Open hats get a little more level in the starting mix.

## v2.5.6
- Cleanup: removed 21 unused old synth `sound:` lists from the genre templates (nothing read them since every sound is a recording now). All genres re-tested.

## v2.5.7
- Melodies: the chorus and bridge hooks now ask and answer. Bars 1-2 end open (on the 3rd or 5th of the chord, like a question), bar 3 turns the same moves upside down, and the last note settles home. Checked on 200 generated beats across all genres.
- Faster generation: while a beat plays, Beat Lab quietly fetches the instruments the producer is most likely to pick next for that genre, one recording at a time. It is skipped on data-saver and low-memory phones.

## v2.5.9
- Song form editing is now per part, on the timeline itself. Tap a block (Intro, Verse, Chorus, ...) and use the bar under the timeline to change its type, make it shorter or longer (2 bars at a time), move it earlier or later, duplicate it, or remove it.
- A removed part goes greyed into a "Removed" corner under the timeline. Tap it to bring it back where it was, with the same tracks it had. The tray empties when a new beat is made.
- "More form tools" keeps: add a part, start with the chorus, shuffle the parts, new random form.
- Songs are different every time ("Auto (varied)" is the default Form): can open with the chorus, skip intro/pre/bridge, parts of different lengths.

## v2.5.10
- "No sound" help. Every sound is a recording now, so if the sound files cannot be loaded the beat is silent. Beat Lab now says why in the status line: page opened from a folder (file://) instead of a web address, sound files that failed to download, or the browser holding audio back.
- iPhone/iPad: Play now tells the phone it is playing media, so the ring/silent switch no longer mutes the beat.

## v2.5.11
- Works when you double-click index.html (file://). Browsers refuse to load audio files from a folder, which made Beat Lab silent. The audio now also ships as small script files in `fileaudio/` (made by `python3 tools/build_fileaudio.py`), and the app reads from those when opened from a folder. Over a web address nothing changes. Keep the `fileaudio` and `samples` folders next to index.html.
- If you add or replace a sample, run `python3 tools/build_samples.py` / `build_instruments.py` as before and then `python3 tools/build_fileaudio.py`.

## v2.6.0
- Two downloads instead of one big one, so the audio is never shipped twice (about 13-14 MB each, down from 26 MB):
  - **folder edition** (`-folder.zip`): for double-clicking index.html. Audio as `fileaudio/*.js` only.
  - **web edition** (`-web.zip`): for hosting online. Audio as `samples/` only.
  Build both with `python3 tools/package.py <version> <out_dir>`.
- Real log drum importer for amapiano: `python3 tools/add_logdrum.py <folder> "licence note"`. Drop one recording per note in a folder (name them with the note, e.g. `C2.wav`, or the MIDI number, or let it measure the pitch). It trims and levels them, registers `log-drum`, matches its starting level to the marimba, makes the producer prefer it for amapiano's log drum, and rebuilds `fileaudio/` and the service worker. Tested with synthetic tones, not real recordings.

## v2.6.1
- "Why these sounds?" under Instruments: for every instrument of the beat, what the producer saw in it, and how well it suits the genre and the mood ("a perfect fit", "a good fit", "an unusual choice", "a bold choice"), plus how the song is arranged.
- Mix-drift test: `tests/mixdrift.js` renders beats of every genre and fails if a main track moves more than 4 dB (pluck/pad 6.5 dB) from `tests/mix-baseline.json`, drifts too far from its target, or the mix loses headroom (peak above -1 dBFS). After a deliberate sound change, run it with `--update` to accept the new levels. Needs Playwright and a server (see the top of the file).
- Hi-hats of afrobeats and afrohouse start a little louder (they measured quiet).

## v2.6.2
- **Keep instrument**: a row of buttons under the Lock row, one per instrument of the beat (e.g. "Bass: 808 punch", "Lead: Trumpet"). Press one and New beat keeps that instrument while the producer builds the rest around it. Checked: the bass stayed the same over 8 new beats while the lead kept changing.
- **Back** button next to Play: steps back through the beats you had before (the last 30), including form edits. Useful when the beat you liked is gone.

## v2.6.3
- Memory guard for weak devices. Decoded instruments are large (all 29 at once is about 140 MB), so the app now keeps a memory budget for them (45 MB on a 1 GB device, 60 MB on 2 GB, 110 MB when the browser does not say, 200 MB on 8 GB or more). When it is passed, the instruments you used longest ago are freed (the current beat and the one before it are never freed, and a freed instrument just downloads again if needed). On devices reporting 2 GB or less, the big instruments load every second note (the app re-pitches the rest). Background warm-up now only runs when there is room.
- Measured with the CPU slowed 4x and 6x: no main-thread freeze over 200 ms while playing and pressing New beat; the longest pause was about 0.1 s.

## v2.7.0
- **Loading indicator**: while a beat's drums and instruments are being fetched, a pill under the buttons shows "Loading sounds 12/40" with a small progress bar, and hides when the beat is ready. The first beat's sounds start loading as soon as Beat Lab opens.
- **New look for the grid** (the rows at the bottom, one per sound): colour by family (drums, hats, percussion, low end, harmony), beat numbers (1 2 3 4) above, a small gap between beats, the playing step highlighted in every row, the instrument's name under each melodic row, hits glow and show how hard they are played.
- **Edit pattern**: press "Edit pattern" above the grid, then tap or drag the boxes of the drum and percussion rows (kick, snare, clap, rim, hat, open hat, shaker, percussion, bell) to add or remove hits. In a song, pick which part you are changing (Chorus, Verse, ...) or tap that part on the timeline; the change applies to every part of that kind. A new hit sounds when you tap it, and the beat plays it from the next bar. "Reset pattern" puts it back as it was. The rows that play notes (bass, log drum, chords, pad, pluck, lead) follow the chords and melody, so they are shown but not drawn by hand; use New beat, Variation or Keep instrument for those.

## v2.7.1
- Edit pattern now covers more rows: besides the drums and percussion you can draw hits for the **bass, log drum, chords, pad and pluck**. Only the lead stays read-only (its notes are written note by note, so a new hit would have no note). Checked by rendering each row before and after an edit: the sound changes every time.
- New **Pitch tool** (next to Hits): in edit mode, bass and log drum hits show their note (R = root, 3, 5, 7, 8 = octave); tap a hit with the Pitch tool to step it to the next note. A new bass or log drum hit starts on the root. Where a style has a written bass or log drum riff, the change edits that riff (so it applies wherever the riff plays).

## v2.7.2 (loading can no longer get stuck)
- Fixed: the "Loading sounds" bar could sit still and the page could freeze on a slow computer opened straight from the folder.
- Sound files now load a few at a time (not dozens at once), newest beat first, each with a time limit. A file that never answers counts as failed, so the bar always finishes.
- The same file is never read twice at once; the automatic "try again" for a beat's sound is capped at 3 tries with a short pause (it could loop before).
- A beat never waits more than 60 s for its sounds: it plays with whatever has loaded.

## v2.8.0 (melody editor, and a producer that learns your taste)
- **Melody editor.** A new Melody panel under the step grid is a piano roll for the lead. Pick the part (chorus, bridge or pre-chorus), tap an empty box to add a note (drag right to make it longer; "New note" sets the starting length), tap a note to remove it. You hear each note as you add it. The melody you edit is the one the song plays, so a change to the chorus applies to every chorus (and the outro). "Reset melody" brings the original back. Only available for songs (a plain loop has no lead).
- **The producer learns your taste.** Keeping an instrument counts as a vote for it. In "Why these sounds?" you can also tap "More like this" or "Less like this" for a whole beat (tap again to take it back). Next time the producer picks, instruments you liked score up to 50% higher and ones you did not up to 50% lower, so there is still variety. "Forget my taste" clears it. It is stored only in your browser (`js/taste.js`).

## v2.8.1 (melody editor upgrades)
- Drag a note up or down to change its pitch (it plays as you move); tap it without moving to remove it.
- The rows are labelled with real note names (A3, C#4...) so the octave is clear.
- A playhead follows the song through the melody while it plays, and the roll scrolls to keep the playing bar in view.
- Fixed: drawing a note in a later bar no longer snaps the roll back to the start.

## v2.25.0 (Spice: every beat gets its own signature)

Beats felt alike: the same wall of hats and shaker, the same percussion, the same lead-in to every chorus. Now every beat rolls a **spice**, in three parts, and pressing New beat in the same style gives a different one.

- **Main spice (the character), one of twelve**, chosen from a list written for each of the 28 styles: *Clave pulse* (a 3-2 / rumba / bossa clave that flips every bar), *Talking drums* (two percussion voices ask and answer), *Triplet rolls* (hat rolls with the in-between hats thinned so they pop), *Bounce kicks* (off-beat kick patterns, the bass locks to them), *Half-time chorus*, *Off-beat stabs* (short keys instead of held chords), *Stop-and-go* (a beat of near silence at phrase ends), *Lazy pocket* (snare behind the beat, extra swing, ghost notes, thinner hats), *Four-floor drive* (off-beat open hats, four-on-the-floor chorus kick, off-beat bass), *Ghost-note groove*, *Bouncing bass* (octave jumps, syncopation), *Log drum bounce* (Amapiano).
- **Lift (how it leans into a chorus):** reverse cymbal swell, filter sweep, both, a one-beat stop, a two-beat stop, or a bar where the hats and percussion hush.
- **Extra (a habit at phrase ends):** snare drags, percussion fills, bass runs, open-hat lifts, or none.
- **The beat always differs from the last ones of its style:** the choice avoids the last three used in that style and never repeats the spice of the beat it follows; each choice also rolls its own details (which clave, which kick pattern, which drum plays it), so 8 beats of one style gave 4 to 8 different main spices.
- **The spice always has its instrument:** the tracks a spice plays on are switched on in verses, pre-choruses and choruses (the layer cap then drops the least important other layer, so beats do not pile up). The tracks that carry the backbeat are never used for clave or talking drums.
- **On screen:** Beat Lab has a "Spice" line (name, lift, extra, and what they do in plain words) and a **More spice** button that keeps everything and rolls only the spice. "Make it darker / brighter ..." keep the spice; **Variation** and **New beat** roll a new one. The "Why these sounds?" panel also lists it.
- **Beats made around a voice (Vocal Sketch)** get a gentler version: no half-time chorus, 30% to 45% less strength, and nothing added in bars where the singer is busy (five or more notes); lifts and stops still apply. The timing push of Lazy pocket is not used there.
- **New files / changes:** `js/spice.js` (new: `spiceRoll`, `spiceApply`, `spiceFeel`, `spiceClaim`, `spiceRespice`, `spiceLine`, constants `SPICE_*`); `js/beatgen.js` (rolls the spice in `generatePattern`, `loopSpice`, a hook in `songBarView` and `loopBarView`, short stab lengths, lead lengths follow cut hits; `beat.spice` is plain JSON and `beat.swing` may be set by it); `js/engine.js` (`E.fx.reverse`, reversed crash cached in `E._revBuf`, filter sweep in `playBarStart`, `stopAll` also stops the swell); `js/beatlab.js` (`refreshSpiceUI`, "More spice" button, `keepSpice` for the Make-it chips); `index.html` (script tag after beatgen.js, `#bl-spice` row); `css/style.css` (`.beatlab-spice*`); `sw.js` rebuilt; `tools/spice-audit/` (not part of the app).
- **Measured (a stand-in for listening):** 28 styles x 8 beats: zero invalid bars, spice audible in at least 97% of verse and chorus bars, the same bar is identical every time it is asked for, old drafts without spice still play and can get one with More spice. Roughly a quarter of the note positions differ from the same beat without spice. In a render, the reverse swell lifts the sound above 3 kHz by about 13 dB across the last half bar before a chorus, and the filter sweep takes about 19 dB out of the keys' top end before it opens on the chorus.
- **Not checked by ear:** whether each spice sounds good in every style. The weights are my judgement of what fits where; tell me which ones you like or dislike and I will change the lists. Backbeat can disappear in about 10% of Afro house bars on purpose (stops at phrase ends).

## v2.24.0 (Beat Lab replaced inside your updated Voxloop, ready for GitHub)

Your updated Voxloop (with your own Studio and Pipeline changes) is the base. The Beat Lab from v2.4 to v2.23.0 replaces the old Beat Lab section, and nothing else of yours was touched.

- **Kept exactly as you had it:** `js/studio.js`, `js/daw.js` (merged, no conflicts), `js/autopilot.js`, `js/autodecide.js`, `js/apdeck.js`, `css/apdeck.css`, `js/fxrack.js`, `js/pitchcorrect.js`, `js/tune.js`, `js/script.js`, `js/automix-vl.js` (merged) and all your tests (`align`, `tone`, `octave`, `spoken`, `tests/e2e/`).
- **Replaced by the new Beat Lab:** `js/beatgen.js`, `js/beatlab.js`, `js/engine.js`, `js/export.js`, `js/templates*.js`, `js/blux.js`, `js/vocalsketch.js`, `js/vocaldsp.js`, `js/producer.js`, `js/taste.js`, `js/melodyroll.js`, `js/lustguide.js`, `js/genrefeel.js`, `js/mixcal.js`, the sample banks and maps, the `samples/instruments/` and `fileaudio/` folders, `css/blux.css`, `css/vocalsketch.css`.
- **Moved out of the way (not loaded any more):** the old sound-pack picker `js/packs.js` and the old "Record your vocal" panel `js/vocalrec.js` (with its `#vr-panel`). They are in `archive/old-beatlab/` in case you want anything from them. Vocal Sketch (Sketch tab in Beat Lab) now does the job of singing a part to get a beat. `beatlab.js` still calls `window.VoxloopVocal.refreshSections()` only if it exists, so nothing breaks without it. The older README sections about packs and the vocal recorder below are history.
- **`index.html`:** the CSS links are `apdeck.css`, `vocalsketch.css`, `blux.css`; the script list is the new Beat Lab scripts in their working order, then your `apdeck.js`, `autodecide.js` and `autopilot.js` at the end. **`sw.js`** was regenerated with `python3 tools/build-sw.py` (357 files cached; the big sample folders download the first time each sound is played).
- **Checked:** page loads with no errors and no missing files, also from a sub-folder address like GitHub Pages uses, and the service worker installs there; your Pipeline test (`tests/e2e/run.js rap_inSync`) ends "done" with no page errors; `align`, `tone`, `octave`, `spoken`, `brain`, `phrase`, `gate`, `voiceid`, `master`, `harmony` pass or print the same as before; Vocal Sketch builds a beat from a real voice note and plays it with the voice.
- **Not caused by the merge, but you should know:** `tests/key.test.js` prints "WRONG notes" for 6 major-key cases, and it does so on your own zip as well. `tests/e2e/studio.js` clicks a Studio button that is hidden at phone width, so it stops at the first step in your version too. `beat1.test.js` shows `afroOffbeat 7/8` or `8/8` between runs (random).
- Not checked by ear. Microphone recording on https is still untested.

## v2.23.0 (found by a beat audit: loudness, too many layers, voice buried)

A new measuring tool (kept outside the app, in `audit/`) renders real beats, then measures the audio: loudness (LUFS), balance, kick and snare punch, timing against the grid, which notes ring, how many layers play, and how loud each section is. It also draws a spectrogram. What it found, and what changed:

- **Normal Afrobeats (Smooth and Afropop), 4 beats:** 19 to 20 LUFS quiet (finished beats sit around -14 to -9), 11.5 to 12.2 layers playing at once in verses and choruses, the chorus only 1.7 to 2.2 dB louder than the verse. The notes themselves are in key: all played notes are chord tones, and the "major third over a minor chord" the audio showed was the 5th overtone of the bass recording, not a wrong note. The instrument recordings are in tune (all within 25 cents except the kalimba and mbira, which are naturally uneven).
- **`js/beatgen.js`**: `rollPresence` can now cap the number of tracks playing at once (`t.maxLayers`, per kind of section, plus one for the final chorus); the least important tracks step out first (new `LAYER_PRIORITY`: kick, snare, bass, chords, hat, shaker, clap, pluck, pad, perc, rim, log drum, lead, bell, open hat).
- **`js/templates.js`**: `maxLayers: { default: 8, chorus: 9, bridge: 6, intro: 5, outro: 5 }` on the Afrobeats template only (both styles). Measured after: 8.2 to 8.4 layers (was 11.5 to 12.2). Every other genre is unchanged.
- **`js/vocalsketch.js`** (Vocal Sketch beat for a voice): `masterBeat(buf, target, makeRoom)` brings the beat to about -15 LUFS (BS.1770 K-weighted, gated loudness measured by `lufsOf`) with a look-ahead peak limiter (`limitChannels`, ceiling -1.5 dB) and a 3.5 dB dip around 2.4 kHz (`carve`) so a voice is clear. The "Hear it with your voice" mix puts the voice about 4 LU above the beat (measured on the sung part, `MIX.vgain`; the slider moves it from there) and brings the whole mix to -15 LUFS. Saving "the beat alone" saves this finished beat.
- Measured on Tempo114 (Late Night, dark): beat -24 to -25 LUFS before, -16 now, true peak -1.2 dBTP. Voice against beat in the 1 to 4 kHz zone: the voice was 5 dB under the beat (median) with the old preview mix, now +1.6 dB over it (the worst tenth of the bars: -8.5 dB before, -0.6 dB now).
- Not changed (only measured): the chorus lift is still small (about 2 dB); the Afrobeats beats are bass-heavy (the low-mid band 150 to 400 Hz is the loudest); kick timing wobble of about 9 ms is the humanize setting working as designed.
- Not checked by ear.
- No new files in the app. New names in `vocalsketch.js` (inside the closure): `biquad`, `kWeighted`, `lufsOf`, `limitChannels`, `carve`, `masterBeat`. New globals in `beatgen.js`: `LAYER_PRIORITY`.

## v2.22.0 (Afrobeats: the pluck plays a riff, not a wandering run)

- Reported on the normal Beat Lab Afrobeats: the plucks sounded random and out of place. Cause, checked on generated beats: the pluck used `arp: "up"`, a run that climbs through the chord tones, wraps back down by up to two octaves, and starts on a different note every bar (`bar % 3`), so no figure ever came back.
- **`js/beatgen.js`**: new mode `"riff"` in `arpNotes(hits, c1, c2, mode, bar, kind, seed)` (two new trailing arguments, passed from `finishView` as `p.kind` and `beat.seed`). New `PLUCK_RIFFS` (six 8-step figures), `riffPool(chord)` (the chord's own notes within one octave from A4, plus the octave above) and `riffNotes(...)`: each step of the bar has its own place in the figure (a hit that is left out does not move the others), the figure comes back every bar and follows the chord (the second half of a two-chord bar uses the second chord), choruses use another figure than verses, the figure is picked by the beat's seed, and every fourth bar the second half lifts by one chord note as a small answer. Notes only move by a step or two of the chord.
- **`js/templates.js`**: Afrobeats styles Smooth and Afropop: `arp: "riff"` (was `"up"`). Every other genre and style keeps its arp.
- Checked on generated beats (4 keys, both styles): the same notes come back in every bar of a section, all notes are chord tones of the chord playing, all notes within A4 to about A6.
- Not checked by ear (no way for me to listen): a quick A/B render, old and new, of the same beat is in the delivery. The pluck rhythm itself (which steps play) is unchanged and still varies a little per bar, by design.
- Tests: harmony, brain, phrase, vocaldsp pass; beat1 shows afroOffbeat 7/8 as before (not related).
- No new files. New globals: `PLUCK_RIFFS`, `riffPool`, `riffNotes`.

## v2.21.1 (Vocal Sketch: the voice in "Hear it with your voice" no longer sounds like static)

- Cause: `take.pcm` is the 16 kHz copy made for the pitch analysis (`D.resample16k`, a box average: no sound above 8 kHz and aliasing noise). v2.21.0 laid that copy on the beat, so the voice sounded thin and crackly.
- **`js/vocalsketch.js`**: `addTake` now keeps `t.hi = { x, sr }`, the take as it was recorded or imported (full band, mono). `placeVoice` reads `t.hi` and resamples with a cubic interpolation (it falls back to the 16 kHz copy, also cubic, for takes restored from a draft, because drafts only store the 16 kHz copy, so a restored draft still sounds duller until the voice is imported again). The fade at both ends is now 15 ms in, 5 ms out.
- Checked on Tempo114: energy of the voice in the mix between 8 and 12 kHz went from 0.9% to 13% (the original note: 9.5% in a different 20 s window), so the top end is back.
- Not done: drafts do not store the full-quality voice (it would make a draft about 6 times larger).
- No new files, no new globals.

## v2.21.0 (Vocal Sketch: hear your voice with the beat, nudge it, save it aligned)

- **`js/vocalsketch.js`**: new card 5 "Hear it with your voice" (`vs-mixcard`, shown after a build). `ensureMixBeat()` renders the beat once with the same path as the Download button (`renderBeatForOutput`, so the same sound and mix, bar 1 at time 0 for Vocal Sketch beats) and keeps it until `current` changes. `placeVoice(beat, rate, withNudge)` lays every take on the beat's own time: the take's time 0 sits at (start of the part + nudge - the take's bar-1 offset), so a pickup sung before "1" is kept; each take is cut after its bars + 0.4 s, with a short fade at both ends. `mixBuffer()` adds the voice (x1.5 x the "Voice louder or softer" slider) to the beat (x0.8) and always scales the mix to a peak of 0.9. Buttons: Hear my voice with the beat / Stop, nudge (10 ms per tap, -500 to +500; default +10 ms because the kick samples peak a little after the grid), Save voice + beat (.wav) and Save the beat alone (.wav) (`encodeAudioBufferWav(buf, 16)` + `downloadBlob`, named like the normal export, with `-with-voice`). The preview restarts when the nudge or the level changes; `stopAll()` also stops it. State is in `MIX` (inside the Vocal Sketch closure); test hooks `VocalSketch._mix`, `_mixBuffer`, `_placeVoice`.
- **`css/vocalsketch.css`**: width for `#vs-nudgeval`.
- Uses existing globals only: `renderBeatForOutput`, `bootAudio`, `encodeAudioBufferWav`, `downloadBlob`, `exportFileName`, `current`.
- Checked on Tempo114 (headless): the first sung sound lands at 7.415 s against 7.403 s expected (bar 4 at 8.446 s minus the 1.036 s offset plus the 10 ms nudge); two nudge taps move the voice by exactly 20 ms and restart the playback; both saves work; the saved mix peaks at -0.9 dB. All earlier tests pass.
- Not checked: playback through a real phone speaker; that the saved mix sounds the same as the in-app preview was not compared sample by sample (both come from `mixBuffer`).
- No new files, no new globals.

## v2.20.2 (Vocal Sketch: a groove you can nod to)

- Reason: the Light beat of v2.20.1 was about 80% low bass (20 to 120 Hz) with almost no snap, and in some builds the snare entered only after 2 to 4 bars or was missing, and the top percussion was a sparse, random tick. Nothing to nod to.
- **`js/beatgen.js`** (only beats with `beat.voice.groove`; every other beat is unchanged): new `applyGroove(beat, bar, tracks, probs, present, skip)`, called LAST in `songBarView` (after `applyVoice` and `applyVariety`, so the thinning cannot remove it): the backbeat never drops (every snare step with probability 0.5 or more, and the clap with it), the kick always lands on one, the bass lands with it, the top percussion (hat, else shaker) plays a steady 8th-note pulse (under a very busy line, 35% of the off-beat 8ths of that bar may drop; with `groove.calm` the 16ths between are mostly removed). New `shapeGroove(beat, velocities, present)`, called in `finishView`: kick on one x1.18, snare x1.15, clap x1.1, top percussion: off-beat 8ths x1.25, beats x0.85, 16ths x0.55 (x0.85 more in a calm mood). In `songBarView` the kick, snare, clap, bass, chords, hat and shaker are present from the first bar of every sung part (no slow entrance; the intro keeps its own build-up).
- **`js/vocalsketch.js`**: `beat.voice.groove = { calm }` (calm for chill, romantic, dreamy, soulful, or dark with low energy). `trimLayers` now always switches on kick, snare, bass, chords in sung parts, and guarantees one top percussion (hat is kept for every mood in Light; the shaker only in Medium and Full).
- Checked on Tempo114 with 24 builds (Afro-Lust, R&B, Trap, 8 builds each, all different seeds): in every verse bar the snare is present, the kick is on one, and the top percussion has at least 5 hits (usually 8). Rendered Light beat: energy 20 to 120 Hz from 81% to 64%, overall level up from 0.063 to 0.094 RMS (about +3.5 dB).
- Tests: vocaldsp, brain, harmony, phrase, align, master, vstest3 and tp pass. beat1 shows afroOffbeat 7/8; it does not use Vocal Sketch, and `generatePattern` was not changed.
- No new files; two new globals in beatgen.js: `applyGroove`, `shapeGroove`.

## v2.20.1 (Vocal Sketch: a lighter beat, "How full")

- Reason: a beat built under a voice had 9 to 10 layers playing at once in the verse (kick, snare, rim, hat, shaker, perc, bass, chords, pad, plus pluck), some of them wrong for the mood.
- **`js/vocalsketch.js`**: new `trimLayers(beat, entries, vibeKey, level)`, called in `build()` after the calm-palette step and before `beat.voice` is set. New select `vs-full` ("How full": Light (default), Medium, Full). Light keeps kick, snare, bass, chords and ONE top percussion (hat for a driving mood: hard, party, uplifting with energy 0.55 or more, or dark with energy 0.6 or more; shaker otherwise); the pad only in a chorus/bridge, the intro and the outro; drops rim, perc, open hat, pluck, bell, log drum (unless the mood is driving, and then only rim/perc stay off as set by the level). Medium keeps both top percussions and one small extra in the verses. Full changes nothing.
- Checked on Tempo114 (Afro-Lust, Late Night): verse layers per bar 9 to 10 before; Light 5 to 6 (kick, snare, hi-hat/shaker, bass, chords, plus the answering lead in the pauses); Medium 8 to 9; Full 8 to 9. Each build is seeded differently, so exact counts move a little between builds.
- All earlier tests pass. No new files, no new globals (`trimLayers` stays inside the Vocal Sketch code). Beats outside Vocal Sketch are untouched.

## v2.20.0 (Vocal Sketch: tap-along, groove from the voice, calmer mood reading, answering melody)

- **`js/vocaldsp.js`** (all exported on `window.VocalDSP`): `fitTaps(times, bpm0)` gives tempo + beat line from a person's taps; `swingOf(notes, bpm)` measures how far the off-beat 8ths of a voice sit late (`{s, offset, r, on, off}`, with a confidence gate); `fitTriads`/`triadFit` (chords that follow the sung notes) and `takeFeatures`/`energyOf`/`vibeOf` (mood). `vibeOf` was rebalanced: "Soulful" no longer wins every voice (weights now expressive 0.55, sustain 0.25, wide 0.25, leaps 0.2, minus energy 0.15).
- **`js/vocalsketch.js`**: tap-along (`startTap/tapNow/finishTap`, test hooks `VocalSketch._tapNow/_finishTap`); `voiceGroove()` sets `beat.swing` only when the singing is clearly on the beat; new `answerLine(entries, beat)` makes `beat.answer = { bars: { <bar>: [{ step, len, midi }] }, level: 0.75 }`: in a pause of the singer (5 or more steps; in every second bar, or in any bar with 9 or more steps of rest; never in the last bar of a part) the lead plays 2 or 3 notes that follow the contour of the last notes sung (steps capped at 5 semitones), shifted up whole octaves to sit above the voice (92nd percentile + 2), each snapped to the chord under it. New checkbox `vs-answer` ("Answer my singing with a short melody in the pauses", on by default). The lead is switched on only in the parts that have an answer.
- **`js/beatgen.js`**: in `songBarView`, a beat with `beat.answer` no longer plays the hook melody; it plays only the answer notes (not on build or fill bars); `finishView` scales the lead velocity by `beat.answer.level`. Beats without `beat.answer` are unchanged.
- **`js/beatlab.js`**: `applyBeatSound` uses `beat.swing` when set, else the style's swing.
- **`css/vocalsketch.css`**: `.vs-hear`, `.vs-tappad`, `.vs-tapbtn`, `.vs-tapcount`.
- Checked on Tempo114: 3 answers (bars 7, 11 and, before the last-bar rule, 15), all above the sung range (sung G2 to E3, answers G3 to C4), none overlapping a sung step. All earlier tests pass.
- Honest limits: tap-along gives the tempo and beat line, the position of "1" may still need the arrow chips; swing was not applied to Tempo114 (too loose); mood, swing and answer rules are calibrated on one real voice plus synthetic voices.
- Correction: the Producer already picks instrument sounds by mood (Vocal Sketch passes `options.vibe`), so "sounds come from the style" in v2.18.0 was only partly true.
- No new files, new globals: `answerLine` stays inside the Vocal Sketch closure.

## v2.19.0 (Vocal Sketch: less repetition, no clock-like ticks)

- **`js/beatgen.js`**: new `applyVariety(beat, bar, tracks, present, skip)`, called after `applyVoice` at the end of `songBarView`; only beats with `beat.voice` (set `variety: false` to switch it off). For the small percussion (perc, rim, shaker, bell, log drum): the groove is a two-bar loop (bars 1 and 3 alike, 2 and 4 alike) in which off-beat hits drop out (28%) or slide a step later (18%); the percussion sits out the second half of every fourth bar (70%); a new hit appears now and then (never next to another). Rim, perc and bell keep at most one hit on a beat; the others come a step early, because a dry tick on every beat sounds like a metronome. Kick and snare are never touched. Seeded per bar.
- **`js/vocalsketch.js`**: `beat.voice` now carries `variety: true`.
- Checked on the Tempo114 note: bars that repeat the previous bar exactly, in the 12-bar verse, perc 2 to 0, shaker 0 to 0 (it was already varied), rim 10 to 7 on one build.
- Checked on three other (synthetic) voices, to see that nothing is tuned to one recording: bright, fast, loud, major (G) reads Soulful/Hard/Party, built a dance style, chords Em7 Em Dmaj7 D...; slow, soft, minor (A) reads Soulful/Chill/Dreamy, built Airy, chords up an octave; mid-tempo, wide, major (Eb) reads Soulful/Uplifting/Party, built Highlife. Chord fit 66 to 77%. Known limit: a relative key (A minor vs C major) or a neighbouring key (Eb vs Bb) can be read for the key; the chords still follow the notes.
- No new files, no new globals other than `applyVariety`.

## v2.18.0 (Vocal Sketch: chords clear of the voice, calm palette, change chords without rebuilding)

- **`js/vocalsketch.js`**: the chord step of `build()` is now `harmonize(beat, entries, key)`, so it can be run again on a beat already built. New `liftChords(beat, chords)`: the lowest chord note must clear the top of the sung range (92nd percentile of the sung pitches + 3 semitones); if not, every chord moves up whole octaves together (voice leading stays smooth). Before, a low voice (Tempo114 sings G2 to D#3) sat in the same notes as the keys, strings and plucks (from C3 up). The shift is in `S.lifted`.
- Changing the **Chords** select (`vs-harm`) after a build now swaps only the chords of the current beat (`harmonize` + `useBeat`): same drums and sounds, so "follow my notes" and "one key" can be compared fairly. `beat.vocalSketch.entries` now stores the form entries for that.
- **Calm palette**: with a chill, romantic, dreamy or soulful mood (or dark with low energy), `build()` turns off the log drum and the bell (the bright, percussive instruments).
- No new files, no new globals. Beats outside Vocal Sketch are untouched.
- Not done: the instrument sounds (e-piano, strings, nylon guitar, balafon...) still come from the style, not from the voice; groove/swing is not read from the voice; the bass and pluck patterns are the style's own.

## v2.17.0 (Vocal Sketch: chords that follow the notes actually sung)

The chords used to be picked among the 7 chords of one detected key. A casual singer wanders by up to a semitone, so on a real voice note (Tempo114) the key was ambiguous (C minor, G# minor and others all explained the notes about equally) and only 53% of the sung notes (by length) sat on the chord under them.

- **`js/vocaldsp.js`**: new `fitTriads(notes, bpm, offsetSec, bars, slotsPerBar, keyHint)` (any of the 24 major/minor triads per bar, scored on the real, unrounded pitches; notes a semitone off a chord tone count against it; a smooth Viterbi path with three levels of movement; the key only adds a small bonus) and `triadFit(chords, notes, ...)` (0..1: how much of the sung material sits on the chord under it). Exported in `VocalDSP`. Tests added to `tests/vocaldsp.js` (a sharp, wobbly Am-F-C-G tune comes out right).
- **`js/vocalsketch.js`**: `build()` now builds each part's chords from `fitTriads` (new `absChords()` makes chord objects like `buildChord` for any triad, with optional 7th, then `voiceLead`). New select **Chords** in the Build card (`vs-harm`): "Follow my notes (closest)" (default) or "Keep to one key (simpler)" (the old way). The status line says how well it fits: "75% of what you sang sits on the chord under it (staying in one key it would be 53%)". The key's degrees are still kept in `beat.harmony.degrees` (used for hooks); intro/outro borrow the first bars of the verse chords. If the Beat Lab key or chords are regenerated afterwards, they are rebuilt from the degrees (the note-following chords are replaced).
- No new files, no new globals. Tempo114: C minor key, chords Cm7 Cm7 Cm7 Fmaj7 Abm7 Abm7 Cm7 Cm7 Abm Abm7 Ebmaj7 Eb.

## v2.16.0 (Vocal Sketch: the beat gives room to the voice, and starts exactly on the bar)

- **Exact start (`js/export.js`, `renderSongBuffer`)**: the render keeps its 0.05 s of silence for Tone's sake, but for a beat made by Vocal Sketch (`beat.vocalSketch` is set) it is cut off again, so the first bar starts at 0:00 in the WAV (and in the stems, which use the same render). Every other beat is unchanged. Before, the file started ~70 ms before the first drum hit, which made the beat sound late when laid under a recording at the bar start.
- **Decimal tempo (`js/vocalsketch.js`, `setBpm`)**: tempo has one decimal (113.9). The tempo box has `step="0.1"`; the - and + buttons go to the next whole number from a decimal. A singer at 113.9 against a 114 beat drifted ~37 ms over 20 bars.
- **The beat listens to the singing (`js/beatgen.js`, new `applyVoice`, called at the end of `songBarView`)**: `beat.voice = { bars: { <bar>: { act: [16] } } }` (1 = a note starts on that step, 2 = still held, 0 = silent), built by `voiceBars(entries)` in `js/vocalsketch.js` from each take's notes (rap: `flow.onsetT`, new field in `VocalDSP.flow`). A producer's rules:
  - busy singing (4+ note starts in a bar): the small percussion (shaker, perc, rim, bell, pluck, log drum, open hat) loses off-beat hits, the hats lose some 16ths, and from 6+ starts the bass stops chattering (steps 0 and 8 always stay). Kick and snare are never touched.
  - a pause of a beat or more: a short answer in it (two ticks on perc/rim/shaker/hat, plus an open hat leading into the next phrase when the pause runs to the end of the bar), at most 2 per bar.
  - a whole bar of rest: hats and percussion open up.
  - fill and build-up bars are left alone. Seeded per bar, so playing, looping and downloading give the same notes.
- No new files, no new globals other than the function `applyVoice` (beatgen.js) and `voiceBars` (inside the Vocal Sketch closure). Beats without `beat.voice` behave exactly as before.

## v2.15.0 (Vocal Sketch: the beat matches the voice's mood)

Before this, the beat fitted the melody (key, tempo, form, chords) but its drums, mood and energy were chosen from the genre and a random style. Now they are read from the voice too.

- **`js/vocaldsp.js`**: new `takeFeatures(pcm, notes, bpm, rapDensity)` (notes per beat, median note length in beats, pitch range, average leap, loudness, how much the loudness moves), `energyOf(features)` (0 calm .. 1 driving, from tempo, busyness and loudness) and `vibeOf(list, scale)` (scores the eight producer moods: chill, romantic, dreamy, soulful, dark, hard, party, uplifting; returns `top`, `order`, `scores`, `energy` and plain-words `traits`). Exported in `VocalDSP`. Tests: `tests/vocaldsp.js`.
- **`js/vocalsketch.js`**: `readVibe()` (runs after the key is read; fills `S.vibe` and each take's `energy`), `bestStyle(genre, vibe)` (picks the style of the chosen genre whose `STYLE_VIBES` fit the voice; leaves the choice to the generator when nothing fits), a "What I hear" line and a "Beat mood" select (`vs-hear`, `vs-mood`) in the Build card. Style "Auto" now means best match for the voice. `build()` passes `opts.vibe` to `generatePattern`; a part sung calmer than the others (energy 0.1 below the median) loses its percussion and open hats.
- **`css/vocalsketch.css`**: `.vs-hear`.
- Needs `STYLE_VIBES` (producer.js) as a global; without it only `opts.vibe` is passed.
- No new files, no name clashes (new globals: none; new members of `VocalDSP`: `takeFeatures`, `energyOf`, `vibeOf`). Generated files: none changed.
- Calibration is by measurement on one real voice (the Tempo114 note: soft, low, minor, mid-tempo reads Dark / Romantic / Soulful) and synthetic voices; the weights are judgement and need more voices.

## v2.14.6 (Vocal Sketch: calibration from a real voice)

`js/vocalsketch.js`. Ground truth from one real voice note (a male voice, 114 BPM, sung with a pick-up before the bar): the singer found by ear that the beat grid sits at 113.9 BPM and the bar starts 1.036 s into the note. With `P_SHIFT` 0.16 the automatic beat grid matched the real one to within about 2 ms; the automatic bar-start guess did not (it picked a bar start one beat early, because this singer starts phrases before the 1). So the bar start is still a guess: the status asks the singer to confirm it by ear (higher click = the 1) and the two arrows move it a beat. `P_SHIFT` is now 0.14.

## v2.14.5 (Vocal Sketch: which beat is the 1)

`js/vocalsketch.js`, `css/vocalsketch.css`. Finding: a click can line up on every beat and still be a few beats away from the real bar start, so drums and chord changes land in the wrong places. Imported takes now (1) guess the bar start from where phrases start and long notes are held (`downbeatOf`; a guess, check by ear), (2) allow a pick-up of up to about two beats before bar 1, (3) put the beat lines 0.09 s after the detected pitch start (`P_SHIFT`; measured on one voice only), (4) replace "my first note is on beat N" with "Where does the bar start? 1 beat earlier / later" (the higher click is the 1). Play with click uses the higher click on the bar start.

## v2.14.4 (Vocal Sketch: type where the first bar starts)

`js/vocalsketch.js`. Imported takes get a "First bar starts at (seconds)" box, so a position found elsewhere (for example in the Voice Aligner page, or by ear) can be typed in. Found with a real voice note: the singer started about 1.2 s (2.3 beats) before the first beat, and the auto placement (first note = beat 1) put the voice late. Also `window.VocalSketch.setOffset(id, seconds)`.

## v2.14.3 (Vocal Sketch: timing check for imported voice notes)

`js/vocalsketch.js`, `css/vocalsketch.css`. Imported takes: the beat line is now fitted to where the singing really sits (not simply "first note = beat 1"); new "My first note is on beat 1 / 2 / 3 / 4" choice (pick-up notes); "Fit tempo to my singing" (looks +/-10% around the tempo); each take shows "timing: on the beat / a little loose / loose", and the status warns when the singing does not follow the tempo (measured with a beat-lock score). Recorded takes are unchanged (their start is known from the count-in).

## v2.14.2 (Vocal Sketch fixes from the first real voice note)

`js/vocalsketch.js` only. (1) Importing a voice note no longer overwrites the tempo you set with a guessed one (the guess was 147 for a note sung at 114); it only shows a hint. (2) An intro/outro with no take of its own now borrows only the first bars of the verse chords, cut to its length (it used to get the whole verse list). (3) The waveform in each lane is scaled to the loudness of the take so quiet voices are visible.

## v2.14.1 (producer parts hidden until asked for)

Changed only `js/blux.js` and `css/blux.css`. The pattern grid (Lock / Keep instrument / drum steps) is wrapped in a closed "Pattern editor" box, the melody piano roll in a closed "Melody editor" box, each with a one-line "for producers" hint. The Sound tab starts with a short note that everything there is optional; the mixer title reads "Mixer (volume of each sound)". The wrapping moves the existing elements, so their code and ids are unchanged. New ids: `bl-patternAdv`, `bl-melAdv`.

## v2.14.0 (easier Beat Lab + Vocal Sketch as a small timeline)

- **Beat Lab tabs:** Beat | Sound | Sketch | Export. Nothing removed, the long page is split. (`js/blux.js`, `css/blux.css`)
- **Transport bar that stays on screen:** Play / Pause (Resume continues from the same bar), Stop, Back, New beat, Variation, and the status line (it used to be at the very bottom). Space bar plays/pauses on a computer. The old hero buttons are moved into this bar (same elements, same code).
- **Vocal Sketch** is now its own tab and a small timeline: hear the click before recording (tempo +/- / type / tap, click or shaker, volume, count-in), record or import a part, each take is a lane with waveform and found notes against the beat lines. Drag a take left/right (or 10 ms buttons, or Snap to beat) to line it up, Play with the click to check. No bars anywhere: the length of each part is measured from the take. "Try a demo take" makes a melody that is 0.11 s late so it can be tested without a microphone or a file.
- New files: `js/blux.js`, `css/blux.css`. Changed: `js/vocalsketch.js`, `css/vocalsketch.css`, `js/vocaldsp.js` (gate fix), `index.html` (blux.css link, blux.js script after vocalsketch.js). Globals: `window.VLBLUX {show(tab), sync(), tab()}`, `window.VocalSketch`. blux.js moves existing elements (`#bl-back`, `#bl-regen`, `#bl-variation`) into the bar and hides `.beatlab-hero` via CSS; it reads beatlab.js globals `startPlayback`, `stopPlayback`, `bar`.

## v2.13.0 (Vocal Sketch: sing it, get the beat)

New Beat Lab panel "Vocal Sketch". Sing or rap one part at a time (intro, verse, pre-chorus, chorus, bridge, outro) to a click or soft shaker with a 4-beat count-in, or import a voice note. Beat Lab listens on the phone (nothing is uploaded), finds the notes and the key, and builds a beat only (no voice in it) in the key and BPM you sang, with the form taken from your takes in order and the chords fitted to your melody. Rap takes use flow only (syllables a bar). Takes can be repeated x1-x4, reordered, played back, deleted. The takes are saved with the draft (Drafts) and come back when you reopen it.
- Microphone recording needs https (e.g. GitHub Pages). "Import a voice note" works anywhere.
- New files: `js/vocaldsp.js`, `js/vocalsketch.js`, `css/vocalsketch.css`, `tests/vocaldsp.js`. Changed: `index.html` (1 css link, 2 script tags after lustguide.js). Pipeline and Studio untouched.
- Globals added: `window.VocalDSP`, `window.VocalSketch`. Wraps `window.VLBeatLab.snapshot/restore` to add a `vocal` field (drafts.js not edited). DOM ids use the `vs-` prefix and `bl-vsPanel`.

## v2.12.4 (Afro-rave pushed towards Ozeba and Kelebu)

`A.styles.afrorave` in `js/templates-afro.js`:
- Tempo 104-112 to **108-120 BPM** (fast).
- Hook style `chant` (a repeating crowd line, the existing street-pop cells), carried by a **brass lead** (`STYLE_PREFS.afrorave` in `js/producer.js`: trumpet, trombone, sax up; flute down), lead notes short (`gate.lead.max 2`).
- Harder bass: a busier bass riff and a second `bassExtra` variant; `808-punch` / `808-boom` up, bass guitar and upright down.
- Fast but not flat out: its own `rules`. The intro and verse pull back (no open hat, lighter hats, percussion and shaker, a closed filter in the verse); the pre-chorus builds; the chorus brings everything. Measured on 6 songs: about 25 drum hits a bar in the verse, about 43 in the chorus.
- Sources: Wikipedia pages for Ozeba and Kelebu (genre, "frenetic percussion, horns, brash bass, repeated chorus hooks"). Their BPM and keys were not found, so the tempo range is a judgement.

## v2.12.3 (New Afrobeats style: Afro R&B, the Rema "Bout U" lane)

- **New style `afrorb` = "Afro R&B (sparse, sung)"** in the Afrobeats genre (`js/templates-afro.js`, added to `A.styleOrder` after `afrofusion`). Built from the published facts about "Bout U"
  (94 BPM, D major, a sparse arrangement around an infectious guitar riff, raw close vocal): 92-97 BPM, mostly major, one chord a bar, a repeating clean-guitar riff on the pluck
  (every section, no separate lead, so the voice sings the tune), soft backbeat, light shaker, short bass, no clave or log drum. It copies `afrofusion` and overrides the groove, so the two stay separate.
- `js/producer.js`: `STYLE_VIBES.afrorb`, `STYLE_PREFS.afrorb` (electric / nylon guitar riff, Rhodes, bass guitar).
- Why the lead is off in the style's rules: the producer's calm-vibe rule (`producerArrangeSong`) mutes the pluck whenever a lead plays in a pre-chorus, chorus or bridge, which would have removed the riff.

## v2.12.2 (Trap calmer in the song, Afro-Lust renamed and a Rap style)

- **Trap, full song** (`js/templates-trap.js`): the Melodic Trap chorus pluck played rolling 8th notes (`"x.x. x.x. x.x. x.x."`) with the chords and the lead stacked on top, which sounded like piano rolls.
  Now the chorus pluck is a sparse bell phrase (`pluckChorus` for all three styles), chorus pluck presence 0.7 to 0.45 and chord presence 1 to 0.8, so the lead carries the hook.
- **Afro-Lust** (`js/templates-lust.js`): styles are named for what they are for. The ids stay the same (saved beats and merges keep working), only `name` changes:
  `velvet` = Classic (sung), `tide` = Airy (soft vocals), `moonlit` = Highlife (light), `smoke` = Late Night (dark), `slowwine` = Slow Wine (dance).
  **New style `rap` = Rap (bars)**: 90-100 BPM, swing .2, the heartbeat kick kept, a steady soft snare and clap on 2 and 4, 8th-note hats, a gliding 808 (long bass notes), chords and pad kept low in the verse so the voice has room.
- `js/producer.js`: `STYLE_VIBES.rap`, `STYLE_PREFS.rap` (808 bass up, bass guitar down, cello pad, nylon-guitar lick).

## v2.12.1 (Trap kept cold, Afrobeats timing; Boom Bap withdrawn)

v2.12.0 added a Boom Bap style inside Trap. That was a wrong reading of the request (the problem was that Trap sounded like hip hop), so it is **removed again**: no `boombap` style, no `style.kit`, no `STYLE_BORROW`. Hip hop is not a genre in Beat Lab.

- **Trap sound** (`js/producer.js`, `GENRE_PREFS.trap`): the warm, soulful picks that made Trap read as hip hop are pushed down
  (sax lead x.25, trumpet x.2, piano chords x.5, nylon-guitar chords/plucks x.4, vibes x.5, kalimba x.6, electric-guitar chords 1.5 to 1.0)
  and the cold ones pushed up (harp chords x2.5). Across 120 generated trap beats: pad is cello / French horn / violin, pluck is mostly glockenspiel, chords are electric guitar or harp, bass is always an 808.
- **Afrobeats** (`js/templates.js`, kept from 2.12.0): shaker accent on the off-beats (steps 2, 6, 10, 14); swing smooth .17 to .13, afropop .12 to .10;
  the 3-3-2 kick keeps step 3 on most variants; the keys get one more verse and chorus rhythm (long chord on 1, stab 7, short 11, hit 13).

## v2.11.0 (better hooks, a brighter R&B and Afro-Lust, a page that fits the phone)

Each part was measured before and after (generated 120 hooks per genre; rendered the same beat with and without the shelf; audited Beat Lab in a 390px phone viewport).

- **Hooks** (`js/beatgen.js`, `buildHook`; new helpers `hookStep`, `fitHookLine`): the hook is now one motif that is said (bar 1), repeated on the next chord with the same shape (bar 2), answered by a contrast that lifts (bar 3) and said once more, settling on the root or fifth (bar 4). Before, bar 2 repeated the rhythm but not the melody (the contour matched 14-19% of the time, now 55-69%), notes piled up against the top of the range (about 4 equal notes in a row, now about 2) and leaps over a fifth were common in the answer bar (now 2-13% of hooks). Existing hooks in saved drafts are untouched; the melody editor works as before.
- **Air** (`js/engine.js`): a gentle high shelf (`airShelf`, 9 kHz) ahead of the master compressor, set per genre by `fx.air` in `applyFx` (R&B +3 dB, Afro-Lust +3.5, Afrobeats and Trap +1, others 0). R&B and Afro-Lust measured very dark (under 1% of the energy above 6 kHz). On the same beat the shelf adds about 40-80% more energy above 6 kHz in those two, with loudness and peak unchanged. The amounts are set in `js/genrefeel.js` (`AIR`).
- **Phone** (`css/mobile.css`, appended): the hidden checkbox of the Melody toggle was 390px wide and made the whole Beat Lab page 417px wide on a 390px phone (the browser zoomed out or scrolled sideways); `.toggle` is now positioned and its checkbox is 1px. Tap targets under 36px (instrument chips, panel summaries, mixer buttons, the nav button) are now 36-40px; labels under 10.5px are about 11px; the song-section bar scrolls sideways with 40px-wide sections instead of squeezing ten of them into one row. The step-grid row labels stay 28px high on purpose (17 rows).
- No new files. New globals: `hookStep`, `fitHookLine` (beatgen.js). Name clash to check: `airShelf` on the engine object. Generated files: none changed.

## v2.10.0 (each genre sounds more like itself)

Researched from producer guides (Soundtrap, Beatstorapon, Audeobox, Native Instruments) and compared with what the generator produced. The drum patterns and tempos were mostly right. What was wrong: every genre reached for the same instruments (flute lead, violin pad, electric bass), the arrangements were the same shape, and nothing moved over the length of a song.

- **`js/genrefeel.js` (new)**: `TEMPLATES[g].rules`, the genre's own layer of section rules, with the filter amount per section (`sec.cut`, uses the v2.9.1 engine filter). Amapiano: filtered keys and shakers first (no snare, clap or bass in the intro), the log drum leads the main section while the keys step back, a quiet breakdown. Afro house: a long closed, dark build that opens at the drop. R&B: the intro is only chords and pad, pads sit under a low-pass, a stripped bridge. Trap: darker verse, open hook. Afrobeats: bright, barely filtered.
- **`js/beatgen.js`, `resolveTemplate`**: section rules now merge in three layers (shared, then genre, then style); `sec` merges field by field. No change for a genre that has no `rules`.
- **`js/producer.js`**: new `GENRE_PREFS` (a multiplier per "role:instrument" per genre), used in `producerScore` next to `STYLE_PREFS`. Afrobeats: guitars, keys, wood-percussion plucks, a played bass. Amapiano: piano chords, a sub under the log drum. Afro house: organ and keys, harmonium pads, a rolling sub. R&B: Rhodes and piano, a played bass instead of an 808, warm pads. Trap: bells, harp, dark strings, a guitar loop, no flute or Rhodes. `STYLE_PREFS.trapsoul` gets its 808 back.
- **Bass lines**: R&B slow jam and pop R&B walk between root, fifth and third; hard trap and melodic trap use a simple root and fifth 808 line (`bassTones` in `templates.js` and `templates-trap.js`).
- **Tempo**: Afro house deep house now starts at 118 BPM (was 120).
- No name clashes: new globals are `GENRE_PREFS` (producer.js). `genrefeel.js` has no globals. Generated files: none changed. New script tag in `index.html` after `templates-lust.js`.

## v2.9.1 (section filter for Afro-Lust)

The engine already had a low-pass filter on the chords, pad, pluck and lead, but it was set once per instrument and never moved. Now a section can close it a little and open it again:

- `js/engine.js`: `E.setCut(cut, time)` and the `E.cutBase` table (the open cutoff of the current instruments, filled in `E.applySound`). `E.setSection` calls it with `sec.cut`. A section with no `cut` means fully open, so every other genre sounds exactly as before. The filter eases to its target over about a second (`setTargetAtTime`, constant 0.25 s), with a floor of 400 Hz. The bass and the drums are not filtered.
- `js/templates-lust.js`: every section rule gets `sec: { harm, drums, cut }` (harm and drums keep the shared values). Cut: intro 0.5, verse 0.65, pre 0.8, chorus 1, breakdown 0.55, outro 0.5. The two styles that override the verse or chorus rules pass `sec` through.
- No new files, no new globals other than the two engine members above.

## v2.9.0 (Afro-Lust, a more trap-like Trap, Light mode)
- **New genre: Afro-Lust** (Beat Lab only; Studio and Pipeline are untouched). Afrobeats rebuilt for slow, close, late-night music. See `js/templates-lust.js` for the full explanation. In short: 85-100 BPM with a deep swing; sparse drums with their own soft kit (`samples/afrolust/`, built by `tools/add_kit_lust.py` from existing one-shots); congas, tumba, shaker and a log-drum touch kept low and off the beat; a long warm 808 / bass under the kick; the backbeat leans BEHIND the beat (new `lateMs` in the humanize settings); long reverb and a soft echo; a slow intro and a breakdown (bridge) of only bass and percussion; no lead melody by default (the beat is made to be sung on).
- **The signature ("tag")** in every Afro-Lust beat: a heartbeat (the kick and the bass answer each other on steps 0 and 3 of every bar, from the first bar of the intro) and one muted nylon-guitar lick (the same figure in every pack, goes away with the Melody switch).
- **Five sound packs** (styles): Velvet Sway, Slow Tide, Moonlit Highlife, Smoke Room, Slow Wine. Each has its own groove, tempo, swing and space, and the producer gives each its own taste in instruments (`STYLE_PREFS` in `js/producer.js`).
- **Singing guide**: `docs/afro-lust-singing-guide.md`, also shown in Beat Lab when the genre is Afro-Lust.
- **Trap**: hat rolls now play in verses too (they were chorus-only, which made verses sound like boom-bap); more broken kick patterns; verses stay bare and the keys come and go; the producer now prefers bells, harp, flute and dark strings over warm piano and electric piano for trap.
- **Settings > Performance and taste**: Light mode (fewer sounds loaded at once, a small memory budget, half the notes; for slow phones and PCs; applies after a reload) and a switch for the producer's learned taste, with a short list of what it has noted.

## v2.25.1 (Phone walk-through: fixes and a smoother first use)

I opened every page at phone width (400 px: Beat Lab and its four tabs, Vocal Sketch, Studio empty and with a beat, all six Pipeline steps and a full Autopilot run, Drafts, Settings, the menu), took screenshots, and ran automatic checks (sideways scrolling, tap sizes, tiny text, unnamed buttons, broken images, cut-off text, console errors). No page scrolled sideways and no image was broken. What I found and changed:

- **Beat Lab tabs slid behind the top bar** when you scrolled, so you could not switch tab without scrolling up. They now stay visible just under the top bar (`blux.js` measures the bar's height into `--vl-topbar-h`).
- **"Saved to Drafts" covered the Play buttons.** The message now sits above the bar at the bottom (Beat Lab player or Studio transport); wider on a phone too (`nav.js` `toast()`).
- **Song-part chips said "Ver…", "Cho…".** They now wrap onto a second row and show full names (Verse 1, Verse 2, Chorus 1, Bridge, Final).
- **Cut-off drop-downs.** Drum sample and instrument lists are one column on a phone so names fit; three long option labels were shortened (Settings: "Off (cleanest for singing)", "Auto (lifts a quiet take)"; Mix: "Auto (from your beat and take)"). The values did not change.
- **Collapsed sections looked different** (Sound, Melody editor, Mixer, "More form tools", "Why these sounds?", "More settings"). They now share one look with an arrow that shows they open.
- **Vocal Sketch takes:** the three drop-downs (Verse / Sing / Once) sit in one row; Play, nudge and Snap, and the Up / Down / Delete buttons, are in a tidy grid instead of a ragged wrap.
- **Export tab:** grouped as Options, Download, Keep working; the repeated "Ready. Tap Play." line is shown once.
- **Drafts** said "Press Save to drafts", but the phone button says "Save". The text now says "Save".
- **Studio start-up guide:** steps 1 to 3 are buttons (they press the real Load beat / Add lane / Import audio buttons); a one-line key names the icon-only buttons in the header (using their own icons); the playhead line no longer cuts through the text.
- **Tap sizes:** menu button 44 px, close button, Drafts filter, Studio header buttons, editing toolbar, transport buttons, Autopilot pills and the Sketch zoom buttons are at least 36 to 44 px.
- **New / changed files:** `css/ux.css` (new, loaded last: every visual change above), `js/ux.js` (new: Studio guide steps and icon key), `js/blux.js` (top-bar height, `data-blux-on` on the layout), `js/nav.js` (`toast()` lift), `js/drafts.js` (one sentence), `js/mixui.js` (one label), `index.html` (ux.css and ux.js tags, Export tab grouping, two option labels). No Studio or Pipeline behaviour changed. New names: CSS variable `--vl-topbar-h`, attribute `data-blux-on`, class names `beatlab-export-*`, `studio-empty-legend`; no new globals.
- **Checked:** all unit tests (align, tone, octave, spoken, brain, phrase, gate, master, voiceid, harmony; `key.test` still prints the same six "WRONG" lines it printed before), the Beat Lab edge cases, a full Studio run with a beat and a vocal, a full Autopilot run, and Vocal Sketch demo take to beat. Pre-existing, left alone: `tests/e2e/studio.js` clicks the hidden top-bar Studio button at phone width.
- **Not done:** the Studio editing toolbar is still icon-only (a legend explains the header icons only), and the small round "i" info buttons keep their small look (their tap area is already larger). I have not tested on a real phone or by ear.

## v2.25.2 (Studio melody: the recorded trumpet was silent, now fixed; plus the phone leftovers)

- **Studio melody: found and fixed a real bug.** Studio's "Add melody" only ever uses recordings (the recorded trumpet, and the Beat Lab sample-pack instruments the beat itself uses); nothing is made up in code. But the recorded-trumpet path produced **no sound at all**: `renderTrumpet` in `js/melody.js` stopped at the very first sample (a note's fade-in starts at zero, and the "is it over?" check read that zero as "the note has ended"), so every trumpet note was empty, while the panel still said a melody had been added. Fixed. Checked in the browser by counting what actually sounds (sound present, written notes at the written pitch: trumpet mode 12 of 12; Auto mode 12 of 13, the 13th being a bell/pluck sparkle one octave low, which is how that voice is written).
- **If the recordings cannot be loaded** (offline, blocked), Studio melody now says so ("The instrument recordings could not be loaded, so there is nothing to play yet…") instead of saying a melody was added. It never falls back to a code-made sound. The trumpet loader (`ensureTrumpet` in `melody.js`) now loads just the trumpet recording (`samples/instruments/trumpet`) and says plainly when it is missing; before, it went through the general beat-sound loader (`ensureInstruments`), which also pulls in the default instruments for the other parts and gave no clear answer when the trumpet itself was absent.
- **Wording:** "the built-in trumpet" is now "the recorded trumpet" in the panel text and comments.
- **New test:** `tests/trumpet.test.js` (7 checks: a written note sounds from a recording, nothing before it starts, fades out after it ends, plays the written pitch, a note longer than the recording is held, a short note sounds, no recordings gives silence and no invented sound). It fails on the old code and passes now.
- **Studio editing toolbar** (Effects, Take check, Undo, Redo, Split, Copy, Cut, Paste, Delete, Zoom out, Zoom in, Fit): on a phone each icon now has its name under it (it was icon-only below 720 px). The bar still scrolls sideways when it does not fit. Wider screens are unchanged (`css/ux.css` section 9).
- **The small round "i" help buttons** are bigger (30 px, icon 20 px) with a soft ring so they look like buttons; the invisible tap area around them is still larger than the ring (`css/ux.css` section 10).
- **`tests/e2e/studio.js` works at phone width.** Two reasons it failed: it clicked the top-bar Studio button, which is hidden on a phone (it now opens the menu and taps Studio, as a person would); and its story was out of date, because Studio autopilot no longer starts by itself when a take appears; it runs once from "Send mix to Pipeline". The test now starts it the way that button does, and it ends with PASS/FAIL and an exit code. No app behaviour was changed for this.
- **Not changed (still true):** the Vocal Sketch "demo take" (the example voice shown before you sing) is still code-made, and so is its metronome click and Settings' test tone. They are stand-ins, not music. Say the word if the demo voice should use a recorded instrument instead.
- **Files:** `js/melody.js` (changed), `css/ux.css` (sections 9 and 10 added), `tests/trumpet.test.js` (new), `tests/e2e/studio.js` (changed), `README.md`, `sw.js` (rebuilt). No new globals or names; nothing else touched.

## v2.25.3 (Studio melody: "Full band", more instruments than the trumpet)

- **Why:** until now Studio's melody used the trumpet plus the beat's own lead / keys / pluck / chime, and nothing else of the instrument library, so it felt like "trumpet and a bell". A new **Sounds: Full band** option (now the default; "Match the beat" and "Trumpet only" are still there) brings in **guest instruments the beat does not use**, all taken from the recorded library (`samples/instruments/*`). Nothing is synthesized.
- **Who can be a guest** (per style, see `GUESTS` in `js/melody.js`): answering lines (sax, clarinet, flute, violin, electric piano, vibraphone, marimba, kalimba, harp), small fills (kalimba, mbira, nylon guitar, balafon, marimba, harp, vibraphone, xylophone), the chime on a phrase end (glockenspiel, vibraphone, xylophone, harp) and the long soft notes under yours when "Support long notes" is on (cello, violin, organ, harmonium, French horn). Each take picks two answering voices, one fill, one chime and one support instrument from the style's list; **never an instrument the beat already plays, and never the same line-up for every seed** ("Regenerate" brings others). The answering voices take turns with the beat's own and the trumpet, and which one answers first changes with the seed (before, the trumpet always went first).
- **How they are played** (`renderRecorded` in `js/melody.js`; `renderTrumpet` is now a one-line wrapper that keeps the trumpet exactly as it was): the nearest recording re-pitched to the written note. Held instruments (sax, flute, cello, organ...) loop their steady middle on long notes; struck or plucked ones (kalimba, vibraphone, harp...) ring as recorded and are damped after the note. Every recording is levelled to the same loudness first (they were recorded at very different levels); chimes sit 7 dB under answers, fills 3 dB. The same rules as before still apply: only in gaps where the beat has room, never over your singing, a cap on notes per minute, melody kept under the voice and the beat.
- **If a guest cannot be loaded** it is left out and the melody is written with the rest; if nothing at all can be loaded, the panel says so instead of adding a silent melody.
- **Panel:** the Sounds row has three choices (Full band / Match the beat / Trumpet only); the report lists the guest instruments used ("Guest instruments the beat does not use: Clarinet, Xylophone...") and the intro text was updated.
- **New test:** `tests/guests.test.js` (19 checks: every guest is a real recording with a range, never an instrument the beat uses, the seed changes the line-up, held and struck instruments sound and stop correctly, missing recordings play nothing).
- **Checked in a browser:** every guest instrument sounds and is re-pitched (38 test notes across the instruments; held and plucked ones read within about 15 cents; the tuned-percussion ones with clashing overtones (kalimba, balafon, mbira, glockenspiel, xylophone) cannot be read reliably by an automatic pitch detector, so those four need an ear); the melody runs in Full band with no oscillators created by the melody; with the recordings blocked it refuses clearly.
- **Files:** `js/melody.js` (changed: new tables `GUESTS`, new functions `chooseGuests`, `seatGuests`, `ensureRecorded`, `renderRecorded`, `recordingGain`, `isRecorded`; `REG` has more entries; `_internal` exposes a few more), `tests/guests.test.js` (new), `README.md`, `sw.js` (rebuilt). No new globals outside `VLMelody`; nothing else touched. Studio, Pipeline and Beat Lab behaviour is unchanged except that Autopilot's automatic melody now defaults to Full band too.

## v2.25.4 (Autopilot alignment you can really judge by ear; recorded clicks and demo voice; octave fix for six guest instruments)

- **Autopilot, "Is the vocal lined up?" card: reported problem.** You could only hear about five seconds, then silence, and the button still said "Stop", so the line-up could not be judged before the mix. Cause (reproduced): the old "Hear it" played a fixed ten-second stretch once and then stopped by itself without updating the card.
- **What the card does now** (`js/alignplay.js`, new; used by `confirmAlignment()` in `js/autopilot.js`): it plays the **whole song** (beat and vocal together), starting 1.5 s before the vocal comes in. A wave strip shows the beat and the vocal with a playhead; tap it to jump anywhere. **Loop 6 s** repeats a few seconds from where you are so you can nudge in the same spot. The nudge buttons (-100 -10 -1 +1 +10 +100 ms) move **only the vocal, live**: the beat does not restart, the vocal is re-timed with a tiny crossfade so it does not click. There is Play / Pause, an Undo, and the button always matches what you hear (it goes back to "Play" when the song ends). Both tracks sit on the audio clock, so the gap between them is exact.
- **Phones:** the card was made to fit short and narrow screens (checked at 360 x 640).
- **Clicks:** the count-in and metronome clicks in Settings, the Studio count-in and Vocal Sketch now use **recordings** (`js/clicksound.js`, new, `window.VLClick`: rim shots and a shaker from the drum sample folders) instead of code-made beeps. If the recordings cannot be loaded, recording says "The count-in click recordings could not be loaded, so there is no count-in" and still records.
- **Vocal Sketch demo voice:** now a **recorded saxophone** (`demoVoice` in `js/vocalsketch.js`), no longer a code-made tone. If the saxophone recordings cannot be loaded it says so and does not play a fake voice. Settings' test tone is still a plain code-made tone (it is a speaker check, not music).
- **Studio "Full band": octave fix for six instruments** (`OCTAVE_UP` in `js/melody.js`). The labels in the instrument library are one octave below the real sounding pitch for marimba, vibraphone, kalimba, mbira, balafon and glockenspiel, so guest notes played by these came out an octave too high. The guest player now compensates (checked by spectrum: 82 of 90 test notes within 25 cents; the rest are kalimba and mbira, whose tines are tuned a little off by design, up to about 50 cents, and the glockenspiel, which is shifted by design when a note is below its range). **A person has to listen to these two** (kalimba and mbira).
- **NOT changed, on purpose, and needs your decision:** the **Beat Lab** engine plays the same six instruments from the same labels, so beats made in Beat Lab with them are probably an octave too high. Fixing it would change how existing beats and saved drafts sound, so it was left alone. See the report that came with this version.
- **Also checked, not changed (report only):** the key reading (A minor vs F major) and the tuning of high voices. Findings and proposed fixes are in the report that came with this version; **no code was changed for them**.
- **New and extended tests:** `tests/alignplay.test.js` (22 checks: plays the whole song, nudges move only the vocal, no restart, loop, seek, pause, end of song, no sound before the vocal), `tests/guests.test.js` (28 checks, now includes the octave fix), `tests/e2e/studio.js` (passes at 400 px).
- **Files:** `js/alignplay.js` (new, `window.VLAlignPlay`), `js/clicksound.js` (new, `window.VLClick`), `js/autopilot.js`, `js/settings.js`, `js/daw.js`, `js/vocalsketch.js`, `js/melody.js`, `css/ux.css` (section 11 and the short-phone rules), `index.html` (two new script tags: `alignplay.js` before `apdeck.js`, `clicksound.js` before `settings.js`), `tests/alignplay.test.js` (new), `tests/guests.test.js`, `README.md`, `sw.js` (rebuilt). New globals: `VLAlignPlay`, `VLClick`. No name clashes found.
- **Honest limits:** I cannot hear audio; everything above is checked by measurement and by tests, and the sound itself must be judged by ear. Nothing has been tested on a real phone, only in a phone-sized browser.

## v2.25.5 (the key you correct is the key Autopilot tunes to; A minor vs F major; ringing remover; high voices; Beat Lab octaves)

Everything in this version answers the report that came with v2.25.4 ("Sure fix everything") plus one new rule from you: **if you corrected the key in Studio, Autopilot must tune to that key, not to what Voxloop first detected.**

- **A key you set (or the Beat Lab gave) is now final everywhere.** Found and fixed a real hole: Studio Autopilot could still overrule a "set by you" key when the singing looked like another key (it did this whenever the sung notes fitted another key more than 18 points better). Now `analyzeClip` in `js/fxbrain.js` never replaces a key whose source is "set by you" or "Beat Lab" (`beatKeyConfidence` is passed by both callers in `js/fxrack.js` and by `planProject`). A key that was only *listened* can still be corrected by clear singing, as before. The Pipeline already protected such a key (`autodecide.keyDecision`, `autopilot.js`); that is now covered by a test too. **Checked in the real app, start to end:** beat read as A minor, you set F major in Studio, the Studio Autopilot plan tunes to F major (not A minor), "Send to Pipeline" hands over F Major "set by you", the Pipeline key card says "F Major, Set by you in Studio, exact", the tune step is set to F major and the Autopilot summary says "key F major".
- **A minor or F major: fixed the cause.** A loop like Am - F - C - Dm never plays B or B-flat, so "A minor / C major" and "F major / D minor" fit the notes equally well; the old detector picked between them on leftover noise from drums and bass (B 0.024 against B-flat 0.044). `analyzeKey` in `js/musictheory.js` now finds every key set that holds all the notes that really sound and differs only by a note that hardly ever sounds (new "presence" measure: the 90th-percentile share of a note over time; played notes are at 0.17 or more, leakage at 0.09 or less). Those are a **tie**, settled the way a musician does: the first chord that holds, the chord the loop rests on, the bass, and the chord share (`evalSet`). Results: Am F C Dm, Am Dm F C and Am F C Dm (any seed) read **A minor** (before: F major); F C Dm Am (starts on F) reads F major; C - F reads **C major** (before: F major, wrong in all six test cases). `tests/key.test.js` now reads **30 of 30** home notes (before 24 of 30). A beat that plays all seven notes is untouched (not a tie).
- **"Also fits" and one-tap switch** (new `js/keyfits.js`, `window.VLKeyFits`): when the detector had a tie, the key card says what else fits ("Also fits: F Major. The beat never plays B-flat or B, so the notes alone cannot tell them apart.") with a **Use F Major** button. Switching records the key as **"set by you", exact**, so nothing second-guesses it later; the tune step follows (key selects change, an old tuned result is cleared with "The key changed. Run pitch correction again"); a **Switch back** button undoes it. Autopilot's summary mentions it too. The result of `analyzeKey` gained `ambiguous`, `alsoFits`, `alsoAllow` (the extra notes) and `tieNotes`; modal results now say "A phrygian feel (same notes as F Major)" instead of looking like a different key.
- **Tuner leaves B and B-flat alone when the key is a toss-up** (`alsoAllow`): `scaleMask(root, scale, also)` and `o.alsoAllow` in `js/pitchcorrect.js`, PhraseBrain's key set (`js/phrasebrain.js`), `tune.js` (`alsoAllowFor()`, only while the chosen key is still the detected one) and Studio's tune stage (`js/fxrack-dsp.js`, `js/fxrack.js`, `js/fxbrain.js`). Test: a sung B is pulled away without it and kept with it, and the same for B-flat (`tests/keyfits.test.js`).
- **Ringing remover no longer dips the singer's own notes** (`deResonate` in `js/studio.js`). Cause (measured): it assumed sung partials average out over a take, but in a song built on a few notes the same partials pile up and looked like room ringing, so it dipped up to 4.7 dB on the voice. On clean synthetic takes the old version "found" 3 to 5 ringing frequencies every time; the new one finds none. It now files every frame under the note being sung and only counts a bump that is there in (nearly) every note (30th percentile across note groups), and does nothing if fewer than four different notes were sung. **Trade-off, stated plainly:** it is now cautious; my synthetic room-ring tests are found only some of the time (a 2.5 kHz ring: yes; some others: no), and broad boxiness was never its job (that is the auto-EQ). I could not test real room recordings. `tests/ringing.test.js` (6 checks).
- **High voices: the pitch tracker now follows singing up to about E6** (1.4 kHz instead of 1 kHz: above about C6 it used to report one octave too low). Tested notes C5 to E6; above that it stops tracking (safe) instead of guessing an octave. All 20 unit test files still pass with the change.
- **Beat Lab octave fix for marimba, vibraphone, kalimba, mbira, balafon and glockenspiel.** Re-measured every recording first (pitch tracker on all of them; the six are 12 semitones above their labels, controls such as xylophone and harp are exact). The correction now lives in one place, `instrumentSet()` in `js/instrumentbank.js` (`INSTRUMENT_SOUNDS_ABOVE_LABEL`), which every player uses, so the Beat Lab, fills and Studio's guest instruments all play the note that was asked for (rendered through the real Beat Lab engine: all within a semitone, spectrum peak checked for the glockenspiel). The Studio-only `OCTAVE_UP` in `js/melody.js` is removed (otherwise it would be applied twice). **Effect on what you already have:** beats and saved drafts that use these six now sound **one octave lower** than before (drafts store notes, not audio); log-drum lines on marimba or balafon move into the real log-drum register. **A person has to listen to this.**
- **Also fixed on the way:** `js/analysis.js` had `const confidence` that the loop-repeat fallback reassigns, so on some vocals the whole tempo read failed with "Assignment to constant variable" ("Vocal tempo analysis failed" in the console); it is `let` now (it also showed up in v2.25.4 on a synthetic take).
- **New tests:** `tests/keyset.test.js` (set-by-you and Beat Lab keys survive a clear opposite-key vocal; a listened key can still be corrected; the Pipeline decision), `tests/keyfits.test.js` (16: the loops above, a beat with all notes is not a tie, and the tuner keeps B / B-flat), `tests/ringing.test.js` (6). `tests/guests.test.js` now loads the real `instrumentbank.js`. All 20 unit test files pass, `tests/e2e/studio.js` passes at 400 px.
- **Files:** `js/musictheory.js`, `js/keyfits.js` (new, `window.VLKeyFits`), `js/fxbrain.js`, `js/fxrack.js`, `js/fxrack-dsp.js`, `js/daw.js` (clears the "tie" flag when you set a key), `js/script.js`, `js/autopilot.js`, `js/tune.js`, `js/pitchcorrect.js`, `js/phrasebrain.js`, `js/studio.js`, `js/analysis.js`, `js/instrumentbank.js`, `js/melody.js`, `css/ux.css` (end of file), `index.html` (one new script tag, `keyfits.js` before `autodecide.js`), tests above, `README.md`, `sw.js` (rebuilt). New globals: `VLKeyFits`, `INSTRUMENT_SOUNDS_ABOVE_LABEL`. `S.beatKey` gained optional fields `alsoFits` (now an array of `{key, scale, rootPc}`; Autopilot used to put a text there), `alsoAllow`, `tieNotes`, `swappedFrom`. No name clashes found.
- **Honest limits:** I cannot hear audio. The key results are checked on synthetic beats (every chord progression I tested), not on your real songs; the ringing remover could not be checked on real room recordings; nothing has been tested on a real phone, only in a phone-sized browser. If a real beat still reads wrong, the "Also fits" button is the one-tap answer, and your correction is then final.

## v2.25.6 (memory: why a long song could crash the page on a phone)

You reported "Aw, Snap!" on a Tecno Pop 20 (and a "Wait / Exit" page on a Samsung). Chrome shows "Aw, Snap" when the page's process is killed, almost always for lack of memory; "page unresponsive" is the same cause one step earlier (the page is too busy to answer). It is not GitHub (GitHub only serves the files). I measured the app with a **3-minute beat and a 3-minute vocal** (a real song's length) in a desktop browser, with every large array counted by where it is made. Findings, then what changed. **Nothing here changes how anything sounds**: every changed function was compared with the old one bit for bit on test audio and gives exactly the same numbers.

- **Measured before the change (3-minute song, desktop):** opening the app about 250 MB. After Studio Autopilot 2.1 GB at its peak and 1.3 GB left over afterwards; the page was frozen (no screen updates) for 18.7 s in total, 4.9 s in one go. The Pipeline's mixing step peaked at 3.0 GB with a 9.5 s freeze and 58 s of freezing in total; its filter code alone made 8.5 GB of short-lived song-length arrays (334 of them). A phone with 3 to 4 GB for everything cannot do that.
- **Measured after the change (same song):** Studio Autopilot peak 1.8 GB, 0.9 to 1.3 GB left afterwards (it depends on when Chrome clears its garbage; before: 1.3 GB), 8.5 to 9 s frozen in total. The Pipeline starts from 0.9 GB instead of 1.2 GB, peaks at 2.6 to 2.7 GB (three runs), and freezes about 50 s in total (longest 8.4 to 9 s). **That is better but not safe for a 3-minute song on a 4 GB phone.** The Pipeline's mix step really holds about 2.3 GB of live audio at its peak (checked by forcing garbage collection: it does not go away), because it keeps many full-length copies; fixing that means restructuring the mixer and is not done here.
- **Filter chains reuse one array** (`runCascade`, `runBiquad` in `js/studio.js`): a chain of filters made a new song-length array per filter; now the first filter makes the result and the rest work inside it (each sample is read before it is written, so the numbers are identical). Band-pass pairs (`runCascade(runCascade(x, A), B, true)`) reuse the temporary too: new optional third argument `inPlace`. `runBiquad(x, k, into)` gained an optional output array. Also used by `js/fill.js`: the genre/instrument analysis (run three times on the beat) filtered 10 frequency bands into 10 fresh arrays each time; it now uses one scratch array (`bandpass(x, lo, hi, sr, scratch)`).
- **Studio effect steps copy the clip once, not twice** (`bake` in `js/fxrack.js`): the new audio is written straight into the new buffer instead of first into a temporary and then copied.
- **Undo history has a memory budget** (`historyBudgetBytes`, `trimHistory` in `js/fxrack.js`): each Autopilot step kept the whole clip from before it, up to 10 of them (about 620 MB for a 3-minute stereo vocal). The budget is 150 MB when the browser reports 4 GB of memory or less, 400 MB otherwise, and at least the latest step is always kept. On a 3-minute stereo vocal that is 2 undo steps on a small phone and 6 on a computer (before: 10 on both); short clips keep all 10. **"Remove all effects" always goes back to the original.** Checked: Undo last and Remove all effects work after the change.
- **The automatic melody waits for Autopilot to finish** (`VLStudioAutopilot.busy`, new, read by `autoTick` in `js/melody.js`): it used to start while Autopilot was still working, then start again when the vocal changed length, so it was written twice per run. It also builds with three fewer song-length arrays (the left and right results are written over the instrument arrays; the loudness is measured as it goes). Output compared bit for bit, including the "keep under the voice" step.
- **Tests:** all 18 unit test files and `tests/e2e/studio.js` pass. Bit-for-bit comparisons against the v2.25.5 code (scratch scripts, not shipped): the filter, de-esser, glue, limiter, master, low-end tidy, vocal prepare/finish, calm-voice, de-strain, de-resonate and top-end functions; the fill analysis on four beat styles; the melody mixer's left and right audio and level numbers.
- **Files:** `js/studio.js`, `js/fill.js`, `js/fxrack.js`, `js/melody.js`, `README.md`, `sw.js` (rebuilt). New property `VLStudioAutopilot.busy`; no new globals or files; no name clashes.
- **What I could not do:** reproduce it on a Tecno or a Samsung (the numbers above are from a desktop browser, so the phone figures are estimates), or hear anything. I do not know at which step it crashes for you. If you tell me (opening the page, importing, Autopilot, mixing, exporting) and how long your songs are, I can aim the next change there. Practical things that help today: close other tabs and apps (you had 39 tabs open), and keep takes and beats to the part you need.

## v2.25.7 (voice type, key by file format, "No melody" check, Pipeline clean-up that really cleans, and a producer check after mastering)

Everything here answers your five points of 21 Nov.

- **Voice type (Autopilot's sung / rapped / mixed decision) is better at "rap + sung hook"** (`js/voiceid.js`). Before, the decision came from the whole clip, so a rap verse with a short sung hook averaged out to "sung". Now, when the whole clip does not say "mixed" and there are at least 8 s of voice with notes, the clip is also read in windows: a take that has clearly rapped stretches AND clearly sung stretches is called mixed (`d.windows`, `d.mixedFrom = "windows"`). Measured on 210 synthetic voices (sung slow, sung fast runs, talking, rap at 5, 6.5 and 8 syllables a second, rap + sung hook; four voice ranges; clean, room and noisy): **92 % right before, 96 % now**; the rap + sung hook cases that are called mixed went from **16 of 30 to 24 of 30**; nothing else got worse. The 2 "unknown" results (very noisy deep rap at 8/s, no usable pitch) are unchanged.
- **Same beat, different file format, different key (MP4 = F major, M4A = D minor, BandLab = A minor).** Found the cause first: it is **not the codec**. The detector weighs where the file *starts* (the first notes) and where it ends; MP4 and M4A files of the same beat usually start a few milliseconds apart (encoder padding), so the first chord is not the same slice, and for a loop such as Am - F - C - Dm that never plays B or B-flat the notes fit "A minor / C major" and "F major / D minor" equally well, so the tie was decided by the start. Nothing I could change in the weights was better than what you have (I swept the weights on synthetic loops: no setting gave more right answers), so the detector is **not made to guess harder**. What changed is what you are told: when the evidence from the rest of the song (everything but the start and the end) is a near tie between a key and its relative major or minor, the key card now lists the relative key as **"Also fits"** with its one-tap switch (`relative: true` in `alsoFits`, `js/musictheory.js`; text in `js/keyfits.js`), and `ambiguous` is true only for the genuine note-set tie (A minor / F major kind). Both files now show the same pair of keys; which one is on top can still differ between two files that start in different places. Beat Lab beats still arrive with their exact key ("set by you").
- **"No melody" box in Beat Lab: checked, it works, with one limit you should know.** I rendered every instrument alone and measured what the box does: it removes the **lead** and the **pluck** (the two melody-carrying instruments), and the Pipeline/Studio then treat the beat as having no melody (`beat.noMelody` -> `loadBeatBuffer` -> `beatHasMelody` bypass in `js/melody.js`), so the Studio melody writer writes its own line **from the notes you sang** in the beat's key and chords (the existing melody code, not changed). It does **not** remove the **chords/pads, the bass, the bell, or the log-drum riff** in amapiano: those are harmony and rhythm, not a tune you would sing over, but a log drum riff can sound like a melody. If you want, the box can also drop the riff and the bell; I did not change this without asking.
- **Pipeline Step 04: all three toggles checked in the real app.**
  - **The real reason "it always leaves the noise as it is":** ticking the boxes and pressing **Continue** (without pressing **Apply**) did nothing at all, so the vocal went on untouched. Continue now applies whatever is ticked (and was not yet applied, or was changed since, or a new vocal was loaded) first (`needsRun`, `boxKey`, `runPrep` in `js/prep.js`); a hint says so when you tick a box.
  - **Noise cleanup was too timid and is now presence-aware** (`createDenoiseEngine` in `js/prep.js`): it takes steady hiss and hum down by up to 12 dB **between the lines** and by only up to 7 dB under the voice (heavy cleaning under the voice adds a watery "static" sound), opening a few milliseconds before a syllable and closing slowly. Measured in the app on a noisy rap take (noise at about -43 dBFS): the quiet parts went from **-43.3 to -55.1 dBFS (11.9 dB quieter)** while the singing level moved **-15.92 -> -15.91 dBFS**. A noise floor below -55 dBFS, or less than 10 dB under the voice, is still skipped on purpose.
  - **Tighten timing** works: on the same take 154 of 178 syllable starts were moved onto the beat's grid and the typical slip went **from 10 ms to 2 ms**; starts more than about 45 ms from any grid line are left alone on purpose (that is groove, not a slip), and the report says how many. **Match speed** only changes the vocal when its tempo differs from the beat's (it said "already at the beat's speed" on this take, which is right). Ticking nothing leaves the vocal exactly as recorded.
- **After mastering, the mix now listens to itself like a producer and fixes what is off** (new `js/mixreview.js`, `window.VLMixReview`; limits from the producer brain: `VLMixBrain.review(ctx)`; wired into `listenAndCorrect` in `js/automix-vl.js`). The old listen pass measured only the peak and a very bright top, so it nearly always said "no extra changes". The new check compares the finished mix with **the beat the singer was given**: **bass** (40-120 Hz) against the body of the music (500 Hz-2 kHz), **low-mids** (200-500 Hz) against the body, **sub-bass rumble** under 22 Hz, and **left/right balance**.
  - **It measures where you are NOT singing** (intros, breaks, outros; the singing time comes from the finished vocal and the alignment offset, with 1.5 s of echo tail counted as singing). Reason, measured: a voice on top hides bass problems (a sung song reads 2 to 6 dB *less* bassy than its beat even when nothing is wrong), but where there is no voice the finished mix is the beat plus whatever the mixing and mastering did to it, so any difference is the chain's doing. On ten real beats the master alone moves bass by -0.2 to -0.4 dB and low-mids by 0.0 dB, so tight limits are safe there.
  - **Limits (dB over what your beat had):** bass **+2.0** (trap **+3.0**, rap and amapiano **+2.5**), low-mids **+2.0** (R&B and afrobeats **+2.5**), left/right **1 dB**, rumble **-24 dB**. If there is not at least about 1.5 s of music without the voice (a voice over the whole song), it measures the whole song instead and allows more (bass **+1 dB** more, low-mids **+2 dB** more, **+2.5** for a low voice), so in that case only bigger faults are caught.
  - **What it does:** when something is over, it is cut by just enough (worked out from one measurement, so it is cheap on a phone and makes no copies of the song): at most 4.5 dB of bass (shelf below 120 Hz) or 4.5 dB around 320 Hz, rumble with a steep filter at 22 Hz, balance by moving both sides. It measures again, takes a fix back out if it did not help, gives back up to 1 dB of the lost loudness without passing -1.2 dBFS, and writes **what it heard and what it did** in the report ("Producer check: ..."), including when everything was fine and when a cut could not go further without thinning the voice or the kick.
  - **Tested:** on real beats with faults put in on purpose (boomy bass, muddy low-mids, rumble, one side quieter, and the low-mid and bass faults together, which interact: cutting the middle also lowers the body the bass is measured against, so the two are planned together): each is found and brought inside the limit, and a normal amount of vocal body is left alone. In the real app (Autopilot runs on synthetic rap and sung songs): a normal run where the voice-free parts could be measured came out **inside the limits, nothing changed** (bass -0.7 dB, low-mids +0.4 dB against the beat); the two runs with a voice over almost the whole song were measured over the whole song and also passed untouched; and a run where the master was made boomy, muddy and lopsided on purpose was caught, fixed and explained.
- **New test:** `tests/mixreview.test.js` (22 checks). All 19 unit test files pass; the Autopilot end-to-end runs (rap, sung, noisy rap) finish without page errors.
- **Files:** `js/mixreview.js` (new, `window.VLMixReview`), `js/mixbrain.js` (new `review`), `js/automix-vl.js` (`listenAndCorrect(channels, sr, harshness, ref)`, `beatAsGiven`, `state.mixReport.producerCheck`), `js/prep.js`, `js/voiceid.js`, `js/musictheory.js`, `js/keyfits.js`, `js/fxbrain.js`, `js/autodecide.js` (one text string), `index.html` (new script tag, one sentence in the noise cleanup text), `tests/mixreview.test.js` (new), `README.md`, `sw.js` (rebuilt). New globals: `VLMixReview`, `VLMixBrain.review`. No name clashes.
- **Honest limits:** I cannot hear audio, so the **sound** of the new clean-up and of the producer check's fixes must be judged by your ear. The limits of the producer check were chosen from synthetic beats and voices and from the master's own effect on ten real beats; on a real song a "muddy" or "boomy" fix is the first thing to listen to, and a song with the voice over everything is only checked for bigger faults. The numbers are in one place: `review` in `js/mixbrain.js` and `LIMITS` in `js/mixreview.js`. The key behaviour is checked on synthetic beats, not on your real files. Nothing has been tested on a real phone, only in a phone-sized browser.

## v2.25.8 (Beat Lab "Melody" switch now removes every part that plays a tune)

You said the generated beats make it hard to sing: the beat already pushes you to sing one particular way, and the "no melody" switch was meant to take that away. In v2.25.7 the switch only silenced the **lead** and the **pluck**. I checked what else in a generated beat plays a tune, by recording every note the beat hands to its instruments in offline renders of every genre and style (28 of them): the **bass** line and the **log drum** play riffs that move over the chord (in a short loop the bass plays 4 to 11 different notes in Afrobeats, Afro house, trap, R&B and Afrolust styles), and in Amapiano the log drum riff is the most tune-like part of the whole beat. The **bell** is a drum recording with no pitch, so it stays.

- **Melody off now means:** lead and pluck silent (as before); the **bass and the log drum keep their rhythm and the chord they sit under, but play the root note only** (no riff, no step up or down); **chords, pad, drums and percussion are untouched**, so the **key and the chord changes are all still there** for your vocal and for the Studio melody writer (it still writes its own line from the notes you sang, in the beat's key and chords; that part did not change).
- **Measured:** with the switch off, the bass went from 4 to 11 different notes per loop to 2 to 4 (the 2 to 4 are the chord roots, nothing else), the Amapiano and Afrobeats log drum from 5 to 8 notes to 2 or 3, the number of bass and log drum hits did not change, and the chord notes were identical on and off. Six genres and styles are in the new test (`tests/e2e/nomelody.js`: 21 checks, all pass); the 28-style recording above covers every style.
- **It follows the switch everywhere:** live playback, the downloaded song, the stems, the Mix Doctor and "Send to Studio / Pipeline" all render with the same flag, so what you hear is what you get.
- **Files:** `js/engine.js` (bass and log-drum voices read a new `c.flat`; `playTrackStep` sets it from `ctx.flatMelody`), `js/beatlab.js` (the `Melody` switch sets `playCtx.flatMelody`; `currentRenderSettings()` carries `flatMelody`; new status text), `js/export.js` (render context takes `settings.flatMelody`), `index.html` (the switch's tooltip), `tests/e2e/nomelody.js` (new), `README.md`, `sw.js` (rebuilt). No new globals, no name clashes (`flatMelody` is a new property on the existing play context and render settings).
- **Honest limits:** I cannot hear audio, so whether a root-only bass and log drum now feel free to sing over is for your ear to judge. The **chords still play their pattern** (strums on the beat's rhythm): they carry the key, so I kept them. If the chord rhythm still pushes you, the next step would be an option to turn the chords into long held chords; say so and I will add it. Nothing was tested on a real phone, only in a browser.

## v2.25.9 (Studio: tap, hold and drag a clip; Autopilot knows every plugin)

You asked to drag a clip, select it, drop it, to tap it again for the plugin icon, and for Autopilot to know how to use every plugin (and any new one) so it never uses one wrongly.

- **A swipe over a vocal now scrolls.** It used to draw a selection, which is why the timeline fought you. A swipe picks nothing and moves nothing (20 emulated swipes in the test: 20 scrolled, 0 picks, 0 moves).
- **Tap** a clip to pick all of it. **Tap it again** and a plugin icon appears next to the finger; tap the icon to open Effects for the pick. Picking never opens the Effects panel by itself. There is no "select" switch to turn on: picking is always available.
- **Press and hold** a clip (about 0.4 s, finger still): it lifts and buzzes a little, follows your finger, and **lets go where you drop it**. A read-out above the finger says the bar and beat and how far it moved ("Bar 2 · beat 3 · +120 ms"). Moving more than 10 px before the hold completes counts as a swipe, so nothing lifts. Dragging near either screen edge scrolls the timeline. The clip stays on its lane, cannot start before 0:00, overlaps layer as before, and the beat and melody never move.
- **Snap** (edit bar, on by default) clicks the clip's start or end onto the beat, the playhead or another clip's edge when within 10 px. **Earlier / Later** nudge the picked clip by 10 ms or 100 ms (the step button switches); Shift + Left/Right does the same from a keyboard. **Undo** puts the clip back exactly (a run of nudges is one undo step).
- **Part of a clip:** the picked clip shows a **grip at each end** (44 px wide to hit); drag one to pick just a part. A mouse can still drag across a clip, and press and hold also lifts the clip with a mouse.
- **A moved clip is mixed, heard, exported and sent to the Pipeline from its new place.** Verified on the rendered mix: a +120 ms move puts the clip's first sample exactly 120 ms later. If the song is playing, the clip is heard from its new place at once; a running effect preview lines up with the beat again.
- **Autopilot policy for every plugin** (`js/autopolicy.js`, new): each of the 18 plugins has a line that says whether Autopilot decides it for a whole clip, places it only on part of a clip, or never touches it, plus when it is used and when it is left alone. The Auto tab shows the list ("What Autopilot does with each plugin").
  - The **Pitch editor is a hand tool**: Autopilot never adds it, changes your moves or switches it off. "Auto this" keeps a Pitch editor already on the chain. A clip whose notes you fixed by hand is marked, and Autopilot **does not tune it again** (the plan says so).
  - Pressing **Auto on one plugin** used to switch off anything the brain did not pick, with "this audio does not need it". For the extras (doubler, delay, harmony, crowd, voice, orbit, resonance) that was wrong, because the brain places them on parts of a song, not on the whole clip. Now it says what the plugin is for and leaves it as you set it.
  - **Adding a plugin later:** put it in `VLFx.ORDER` and add a line to `POLICY` in the same change. `tests/autopolicy.test.js` fails if a plugin has no line, if the brain puts a hand tool or an extra on a whole clip, or if what Autopilot turns on by itself disagrees with its line. A plugin with no line counts as a hand tool, so it is left alone rather than used wrongly.
- **Files:** new `js/clipgesture.js` (VLClipGesture), new `js/autopolicy.js` (VLAutoPolicy), `tests/autopolicy.test.js`, `tests/e2e/clipgesture.js`. Changed: `js/fxrack.js` (the old pointer selection removed; grips painted; `bake` takes a `meta` argument that marks hand edits; `autoThis`, `autoPlugin` and the Auto tab use the policy; `VLFxRack` gains `paint` and `realign`), `js/editing.js` (`moveClip`, `nudge`, Snap state, four edit-bar buttons, Shift+arrows; `VLEdit` gains `moveClip`, `nudge`, `snapOn`, `setSnap`), `js/daw.js` (one line: `api.reschedule`), `js/fxbrain.js` (one line in `planProject`), `css/fxrack.css`, `css/ui-polish.css`, `index.html` (two script tags), `sw.js`.
- **Tested:** unit tests (20 files) and `tests/e2e/clipgesture.js` with emulated touch through the browser's own input pipeline: swipes, tap, tap again, the icon, hold and drag, a 12 px wobble that cancels the hold, drag before 0:00, snap, the beat never lifting, the grips, nudge and undo, the +120 ms render, pinch zoom and ruler scrubbing.
- **Honest limits:** this was **not tried on a real phone**. The emulation reproduces scrolling, long press and pointer cancel but not finger size, a cheap touchscreen or a slow CPU, so the 0.4 s hold and the 10 px wobble limit may need a tweak on a Tecno Pop 20 (both are constants at the top of `js/clipgesture.js`). A clip dragged all the way past the end of the beat extends the song. **The Pipeline's own tuning step does not know about hand-fixed notes** (the Studio plan does): a note you moved off the key on purpose could be pulled back there. I did not change the Pipeline without asking.

## v2.26.0 (Autopilot works like a producer: it draws the notes first, treats each part of a take on its own, and mixes the harmonies)

You asked that Autopilot use the Pitch editor (the Melodyne-style note graph) **before** auto-tune, so a singer in a different octave or key still lands on the right notes against the beat; that a part sung differently (a hum, a belted line, a whisper) gets its own tuning and effects; and that harmonies are found, set to a sensible volume, doubled and panned, and given their own effects, without you doing any of it.

- **The notes are drawn first.** Autopilot now puts the Pitch editor on the chain **before** VL Tune. It listens to the beat's key, finds the one shift (in semitones) that puts the most of the sung melody in key, then moves each note that is still off to the nearest note that fits the beat. VL Tune then only has the small leftovers. A vocal sung in the wrong key (tested: 4 semitones out) goes from about 30% of the notes in key to about 95%. A note that sits half way between two good notes keeps its character: Autopilot leaves a bent note alone when it is already close enough.
- **Your own hand work is still protected.** Autopilot marks everything it draws (`by: "autopilot"`). A Pitch editor you set up yourself, or a clip where you moved notes by hand, is never changed. This replaces v2.25.9's "the Pitch editor is a hand tool": now it is Autopilot's own drawing, kept apart from yours.
- **Each part of a take is judged on its own** (`js/passages.js`, new). Autopilot cuts the singing at quiet points into at most 4 parts and names each one:
  - **Hum:** a closed, dark, steady sound. In an intro, or a whole take that is mostly hum.
  - **Whisper:** very soft and breathy.
  - **Belt:** louder and brighter than the rest of the take.
  - **Falsetto:** much higher than the rest, and soft.
  Each part gets its own chain and its own note plan, and the plan card says why:
  - **Hum:** no gate, no noise clean-up (it would take the steady tone for a fan), no presence or air boost, no de-esser; tuning a little slower and lighter; about a third more reverb with a darker top; trimmed so it sits 6 to 7 dB under the normal singing.
  - **Whisper:** no tuning at all (there is no pitch), no gate or noise clean-up (they would eat the breath), low cut only, a gentler de-esser, less reverb, and a small lift only if it is much quieter than the singing.
  - **Belt:** slower and looser tuning (belted notes bend on purpose), more de-essing, presence taken back 1 dB, the compressor catches it sooner, a shorter reverb, a safety limiter; eased down a little if it is far above the rest.
  - **Falsetto:** gentle, slow tuning, no presence boost, more air and reverb, a lighter compressor, and a small lift if it is much softer than the rest.
  The clip is split at each cut, so each piece is produced separately. The tail of a hum's reverb can overlap the verse clip.
- **A hum never gets loud.** Hum pieces are marked (`clip.humPart`) and the automatic fader ride never lifts them; the singing around them is still evened out.
- **Harmonies are found and mixed by the brain.** A lane counts as a harmony when most of its notes sit on good intervals above or below the lead (a 3rd, 4th, 5th, 6th, 7th; not a clash such as a 2nd or a tritone), even when it was not labelled. Autopilot then:
  - sets its **level** under the lead (`lane.autoRelDb`, between -14 and -3.5 dB) from the genre, how busy the beat is, how loud the lead is, where the harmony sits in pitch, how much of the song it covers and how many harmonies there are;
  - fits its **notes to the lead**, so a harmony follows the lead's shift and never sits on a clashing interval;
  - with **one harmony**, makes a left and right pair (a double with the centre empty); with **two or more**, pans them to opposite sides;
  - gives it **its own effects**: low cut at 170 Hz or above, a softer presence, a little more de-essing, compression, and a wetter and darker reverb than the lead, and takes the stereo widener off it.
  An explicit level you set in the mixer always wins. "Auto" is the only mode that lets the brain's level apply.
- **Calculated once, used when needed.** `planProject` listens to the whole song first (so a harmony can be fitted to the lead), then produces every clip. "Send mix to Pipeline" and Autopilot no longer produce a clip it already produced.
- **Files:** new `js/passages.js` (VLPassages), `tests/producer.test.js`, `tests/e2e/producer.js`, `tests/e2e/producer-auto.js`, `tests/e2e/mkprod.js`. Changed: `js/fxbrain.js` (`harmonyLevelDb`, `harmonyProduce`, `partProduce`, `noteSpans`, `rawSpans`, `againstLead`, `sliceCh`; `planProject` rewritten in two passes; `listen`, `produce` and `analyzeClip` exported), `js/fxrack-dsp.js` (the `planNotes` task, a `level` plugin, the doubler's `centre` and a "Left + right pair" preset), `js/fxrack.js` (`planBlockHtml`, `renderPlan`, `applyPlan` splits clips and sets `humPart` and the lane level, `apRunNow`), `js/autopolicy.js` (`isHandItem`; Pitch editor and `level` lines), `js/studiolevels.js` and `js/daw.js` (`autoRelDb` used in auto mode), `js/automation.js` (hum-aware ride), `js/editing.js` (`VLEdit.splitAt`), `js/icons.js`, `index.html` (one script tag), `tests/autopolicy.test.js`, `tests/synth-voice.js`, `sw.js`.
- **Tested:** `tests/producer.test.js` (48 checks: wrong-key vocal, hum/whisper/belt/falsetto finding, harmony roles, intervals, levels, pair and pan, ride), `tests/autopolicy.test.js`, the earlier unit tests, and two browser runs: `tests/e2e/producer.js` (the Studio plan and Apply) and `tests/e2e/producer-auto.js` (Send mix to Pipeline: the lead cut into hum and verse, both produced, the harmony lane levelled, a second pass changes nothing).
- **Honest limits:**
  - **I cannot hear anything.** Every check measures the audio with numbers. Whether it sounds good is for your ears.
  - The hum, belt, whisper and falsetto thresholds were tuned on **synthetic voices**. Real voices are brighter and messier, so a belt may be missed or a bright verse may be taken for one. Check the plan card (it names each part) before you apply it.
  - A tune with only five notes can fit more than one key shift; Autopilot takes the smaller move.
  - Not tried on a real phone.
  - **The Pipeline's own tuning step still does not know about hand-fixed notes** (the Studio plan does).
- **Ideas not built yet:** harmony timing alignment (nudging a harmony to the lead's note starts), breath-noise control, a per-lane "lock" so Autopilot skips a lane, and held chords from several harmony notes.

## v2.26.1 (Measure my delay: Studio and Vocal Sketch take off the real delay of your earbuds)

When you sing over a beat you hear the beat a moment late (speaker or Bluetooth earbuds) and the phone hears you a moment late (the mic). Voxloop removes that delay from every take so your voice lands on the beat. Until now that delay was a **guess**: what the browser reports, or 170 ms plus 30 ms when it sees wireless earbuds. Bluetooth varies from 80 ms to over 300 ms, so the guess was often wrong. Vocal Sketch was worse: it only used the output side and had its own hand-typed Delay box.

- **"Measure my delay" (new `js/latency.js`, `VLLatency`).** It sits in Settings (a new card under Timing), in Vocal Sketch ("More settings" > Measure my delay), and in a pop-up the app offers once after a take when wireless earbuds are only guessed. Two ways:
  - **Earbuds: clap along.** Put the earbuds in. 10 clicks play; clap (or say "ta") on each. The first 2 are warm-up; the other 8 are compared with the clicks. Accurate to about 15 ms (a person is not a metronome).
  - **Speaker: listen test.** Earbuds out, phone on a table, quiet room. It plays 8 short beeps and finds them again in the recording by matching the beep's shape (to about 1 ms). The beeps are unevenly spaced so a very long delay cannot pass for a short one.
  Both use the **same recorder and the same microphone as a real take**, so the number is what a take actually has. The result is saved on this device (it is **not** wiped by "Back to defaults" in Settings) and is used by Studio and Vocal Sketch. It applies to the same kind of earbuds (wireless or not); a wired mic never uses a wireless measurement.
- **It refuses what it cannot trust.** Too few beeps or claps heard, claps or beeps that land at different times, a silent microphone, or an impossible number each give a plain reason and a tip instead of a number. Cancel stops cleanly, closes the mic and saves nothing.
- **Studio:** the take's report line says "measured" when it used the number. If you only have the guess and use wireless earbuds, a toast offers "Measure" once per visit.
- **Vocal Sketch now records like Studio.** It uses the same recorder (audio worklet) that tells the exact start time of the recording, and takes off the same delay. The old script-processor capture stays as a fallback for a browser without worklets. **Because the delay is now taken off automatically, set Vocal Sketch's old Delay box (now called "Extra delay") back to 0 after measuring**; before, people used it to do this job by hand.
- **Settings wording:** the Timing note now says which way to slide (voice behind the beat: minus; ahead: plus). The old note said Bluetooth "usually needs a positive value", which was not reliable.
- **Files:** new `js/latency.js`, `tests/latency.test.js` (49 checks), `tests/e2e/latency.js` (16 checks). Changed: `js/daw.js` (`recordingDelay` asks `VLLatency.delayFor`; report line; `api.makeRecEngine`; the toast hint), `js/vocalsketch.js` (worklet capture, `delayFor`, the Measure button, "Extra delay"), `index.html` (Settings card, one script tag), `css/ux.css` (card and pop-up), `README.md`, `sw.js`.
- **Globals:** `VLLatency` (`get`, `save`, `clear`, `delayFor`, `describe`, `run`, `mount`, `openDialog`, `hint`, `onChange`). `localStorage` key `vl-latency`. No name clashes found. `VLDAW.api.makeRecEngine` is now exported (it already existed inside `daw.js`).
- **Tested:** the analysis finds known delays from 12 to 470 ms in synthetic recordings (to 1 ms for the beeps, within 15 ms for claps), also with room noise, a steady hum, echo, a missed beep, and a bump; it refuses recordings with no beeps, with tones and speech-like sound, with beeps all over the place, and claps buried in noise or too uneven. A pretend phone with a known delay is driven through the whole run (it finds 172 ms and 236 ms, closes the mic, and Cancel works). In a real browser with a fake microphone at phone width: the card, the test from tap to result, Cancel, a saved number reaching a Studio take and a Vocal Sketch take, the pop-up, and no page errors.
- **Honest limits:** 
  - **Nothing was tried on a real phone or real earbuds.** The fake microphone cannot hear the beeps, so the browser run only proves the screens and the wiring. Whether your earbuds give a steady number is for you to find out; measure twice and compare.
  - The Claude preview cannot use a microphone, so the test only works once the new version is hosted.
  - The speaker test cannot hear earbuds. With earbuds use "clap along". If the phone's speaker is very quiet or the room is loud the speaker test will say it could not hear the beeps.
  - A clap is only as steady as the clapper: a good run says "steady to about ±N ms". People tend to clap a little early, so the number can be 10 to 20 ms low. Fine-tune with the Timing slider if needed.
  - Bluetooth delay can change between sessions (different codec, a different phone). Measure again when your earbuds or phone change. A saved number is per device and browser.
- **Ideas not built:** an automatic "check this take against the beat" that suggests a nudge, remembering one number per named earbud, and a visual test where you watch a flash and tap.

## v2.26.2 (Long songs: Autopilot is much faster, the screen stays alive, and there is a real progress bar with Cancel)

A 4.5-minute song used to take about 3 minutes to produce, with the screen freezing for up to 5 seconds at a time and nothing to tell you how far along it was. The slow engine already ran in the background; the problem was how the app used it: one clip at a time, waiting for each, and reading the same pitch off the same audio two or three times. Nothing the producer decides was changed: the plan and the sound come out the same (see "How it was checked").

- **A real progress bar with step names and a Cancel button.** A bar under the top bar says what is happening ("Listening to Lead (1 of 3)…", "Fitting Harmony to the lead…", "Processing Lead (1/3)…", "Riding the fader…") and only moves forward. Autopilot's bar covers listening AND producing in one. It only appears when there is more than about 20 seconds of audio (nothing to wait for otherwise).
  - **Cancel while it listens:** nothing is changed. **Cancel while it produces:** every take is either finished or left exactly as it was (a take is never left half done, and Undo is on each clip). The take being worked on stops between plugins; a take that has parts that sound different finishes its pieces first. "Send mix to Pipeline" then says "Stopped. Nothing was sent."; tapping Send again carries on, and takes that were already finished are not produced a second time.
- **Several takes are listened to and produced at the same time** where the phone can afford it. A cap on how many engine workers run at once (cores minus one, at most 3) and a memory allowance for the audio they hold (96 MB on a 2 GB phone, 160 MB on 4 GB, 256 MB above). A take bigger than the allowance still runs, alone. So on a small phone a 4-minute song is still processed one take at a time, but it no longer waits for itself.
- **The pitch is read once per take.** The key check, the note plan and the harmony re-plan each used to read the pitch off the audio again; they now reuse the first reading (the same numbers, about half the engine time, and the audio is not copied to the engine again).
- **Fewer and shorter screen freezes.** The hum check (a 50/60 Hz test) computed a cosine for every sample; it now uses one table (about 5 times quicker, same numbers) and gives the screen a turn in between. The EQ measurement, the "double / echo / halo" layer, and putting a processed take back into the clip (which went sample by sample and froze the screen for about a second on a long song) now work in slices or in block copies, sample for sample the same result.
- **Volume riding** now runs once per lane after all of that lane's clips are done (it used to run again after every clip). For a lane with one clip, which is the usual case, the result is identical.
- **Measured** (a Chromium on a 2-core cloud machine, synthetic songs, full Autopilot run of "listen, produce, ride"; before = v2.26.1):
  - 62 s song: **41.7 s → 26.5 s** (listening 19.8 s → 8.2 s); longest freeze 1.2 s → 0.6 s.
  - 273 s (4.5 min) song: **176 s → 90 s** (listening 86 s → 25 s); longest freeze **4.9 s → 0.9 s**; freezes of a second or more: 6 → 0; time the screen was frozen in total 20.7 s → 8.8 s.
  - The same 62 s song with the processor slowed 4 times (a stand-in for a slow phone): **55 s → 37 s**, longest freeze 3.8 s → 1.0 s, freezes of a second or more 3 → 0.
- **How it was checked:** the full plan for three synthetic projects (a lead with a harmony, a take with hum and falsetto parts, a take sung in another key, a backing take with no harmony label) is **byte for byte the plan v2.26.1 makes**; the layer from "double / echo / halo" is sample for sample the same; putting a piece back is sample for sample the same across 400 random cuts; the note plan from a saved pitch track equals the one from the audio. `tests/speed.test.js` (39 checks): the worker cap, the memory allowance, cancel while waiting and while running, a slice of a buffer not copied whole, the fallback when a worker fails, side by side equals one by one, progress only moves forward, cancel while planning. `tests/e2e/speed.js` (22 checks, phone width, real clicks): the bar, the Cancel button (44 px tall), cancel while listening changes nothing, cancel while producing leaves nothing half done, a later run does not redo finished takes.
- **Files:** new `tests/speed.test.js`, `tests/e2e/speed.js`. Changed: `js/fxrack-dsp.js` (the scheduler in `runTask`; `analyze`/`planNotes` accept `track`; `runChain` stops between plugins when asked; `util.mixInto`; the resonance task awaits `buildAsync`), `js/fxbrain.js` (`planProject` side by side with `onStep`/`signal`/`parallel`; `measureVocal` is now a generator with a quick `measureVocalAsync`; `detectHum` table; `trackArgs`), `js/fxrack.js` (`newJob`, `makePlan`/`applyPlan`/`apRunNow` with one bar and Cancel; `bake` uses `mixInto`), `js/studio.js` (`bandSpectrumSteps`), `js/resonance.js` (`buildSteps`/`buildAsync`), `js/yield.js` (`VLProgress.start(text, { onCancel })`), `js/daw.js` (Send stops when Cancel is tapped), `css/nav.css` (the Cancel button), `README.md`, `sw.js`.
- **Globals:** new `VLFx.schedStats`, `schedReset`, `workerLimit`, `byteBudget`, `VLFx.util.mixInto`, `VLBrain.measureVocalAsync`, `pmap`, `parallelFor`, `VLResonance.buildAsync`, and the studio engine's `bandSpectrumSteps`. `VLProgress.start` takes an optional second argument. `planProject` and `VLStudioAutopilot.runNow` keep their old calls; `runNow` can now also return `"cancelled"` (it returned `true` or `false`). Knobs for testing, all optional: `window.VL_TASK_CONCURRENCY`, `VL_TASK_BYTES`, `VL_LONG_SEC`, `VL_APPLY_PARALLEL`. No name clashes found.
- **Honest limits:**
  - **Nothing was tried on a real phone.** The numbers above come from a 2-core cloud machine. A phone with more cores will gain more in the listening step; a phone with little memory will run one take at a time, so it gains less there (it still gains from the pitch being read once, the shorter freezes and the progress bar).
  - **Cancel is not instant while producing.** The take in progress stops at the next plugin, and one plugin on a 4-minute take can take several seconds, so "Stopping…" can show for up to about 10 seconds.
  - **Freezes of up to about a second remain** in the listening step (the check for parts that sound different, the background-noise measurement). They are shorter and rarer, not gone.
  - The beat's own analysis and loading were not changed.
  - The checks use synthetic songs and voices; nothing here proves the sound is better or worse on a real recording, only that it is the same as before.
- **Ideas not built:** run the background-noise measurement inside the engine workers too, a "Resume" that continues exactly where a cancelled run stopped, and showing an estimated time left.

## v2.27.0 (Every beat gets its own sound: a kit designer for the drums, a second percussion voice, and a reverb and tone of its own)

You said two things: every Beat Lab beat is recognisable as a Beat Lab beat, and Afrobeats does not sound like Afrobeats or the other Afro-influenced styles. I cannot hear audio, so I measured what the beats are made of before changing anything. What I found:

- **The drum kit is a retro hip-hop kit.** The Afrobeats, amapiano and Afro house kits are mostly 1980s and 90s drum machines (the Sound panel shows them: EmuSP12 Bassdrum, RolandTR707 Snare, LinnDrum Sidestick, Compurhythm78 Hat, MPC60, DR660, TR-808 and 909). Measured over all 270 drum files: the kicks have 91 to 100 percent of their energy under 150 Hz (a soft sub thud, no beater click), the snares sit around 1.3 to 1.9 kHz (boom-bap), and the percussion is the soft, dark take of a conga or bongo (centre about 130 to 430 Hz, nothing above 6 kHz). A modern Afrobeats, amapiano or Afro house record uses tuned, tight, clicky kicks, snares and claps with air, and bright percussion.
- **Only five recordings per drum, the same in every beat.** 270 files, 209 of them different, so after a few beats the ear knows the kit.
- **Every beat of a style had the same room.** The same reverb size, reverb amount, delay amount and instrument tone for each style, in every beat.
- **Spectrum:** across 77 test beats, two beats of the same style (different seeds) were as far apart in spectrum (3.1 dB) as two beats of different genres (3.3 dB). The styles were not told apart by their sound, only by their notes.
- **Not changed:** the beats sit around -20 LUFS with about 17 dB between average and peak. That is on purpose (room for the vocal mix) and is a real difference from a finished record at -9 or -10 LUFS. Mastering and loudness were left alone, because the Studio and Pipeline levels are built on them.

What changed:

- **A kit design for every beat (new `js/kitdesign.js`).** When a beat is made it gets, for each drum, its own tuning, ring-out time, brightness tilt, drive, beater click (kicks, snares, rims, percussion) and snare/clap tail, drawn from ranges that belong to the genre (modern Afrobeats at the centre; amapiano rounder; Afro house tighter and brighter; R&B softer and darker; trap harder with a longer kick). The recordings stay the starting point; each one is reshaped once, when the beat's sound is applied. The design is stored on the beat (`sound.drums.dsn`), so what you hear, the download, and a beat sent to Studio are the same sound.
- **A second percussion and bell (`perc2`, `bell2`).** A pattern now answers itself high and low like a real conga pair: hits on the beat play one recording, hits between the beats the other. Before, the same drum was nudged up in pitch.
- **A mix of its own (`sound.mix`).** Each beat gets its own reverb size and amount, delay amount, air, drum-bus drive and drum-bus glue (within about 25 percent either way).
- **A tone of its own (`sound.tone`).** The keys, pad, pluck and lead each get their own filter, chorus, attack and release, and the bass its own amount of warmth.
- **"New kit" button** in Beat Lab, Sound panel, under the drum choices: draws another kit design, mix and tone for the beat on screen and plays a kick, hat, snare, hat so you hear it. The notes, the pattern and the chosen recordings stay.
- **Nothing else moves.** The designer is made from the beat's own seed and never draws a random number, so a seed makes exactly the notes, patterns, sections, tempo and sound choices it made before (checked on 94 seeded beats, loops and songs, 11 styles, and 4 variations with locks: the same as v2.26.2 apart from the new fields). A beat saved by an older version has none of the new fields and plays exactly as before (raw recordings, the style's own reverb, the same drum nudged up on the in-between hits). Choosing another drum in the Sound panel, locking groups and "keep sound" variations keep the design they should.
- **Measured** (the Afrobeats kit; the drum recordings through the designer, 40 designs each):
  - Kick: the 2 to 6 kHz attack is 13.5 dB under the peak raw, 8.3 dB designed (about 5 dB more bite); the weight under 90 Hz is within 0.3 dB of the recording. Trap kick bite: 21 dB under, 11 dB under designed.
  - Snare: centre 1.7 kHz raw, 2.4 kHz designed. Clap: 2.2 kHz raw, 3.5 kHz designed, and it now rings on.
  - Percussion: bite 18.5 dB under raw, 12.7 dB designed.
  - Ring-out is tighter on average (open hat 0.28 s to 0.19 s, snare 0.14 s to 0.11 s) and varies from beat to beat (the kick's ring-out spread is 0.058 s).
  - A reshaped hit weighs the same as the recording (mean -0.1 to -0.8 dB over its first 150 ms, worst case 2.7 dB; one very short shaker 5 dB).
  - Whole beats, the same eight beats with and without the designer (same notes, rendered through the app's own download): loudness changes by -0.07 dB on average (range -0.7 to +0.6), the 20 to 60 Hz band by -0.3 dB, and the 4 to 16 kHz bands by +0.2 dB; the band balance moves by up to 1 to 2 dB on single beats.
  - Two beats of the same style (different seeds) are now 3.5 dB apart in spectrum against 2.9 dB before (15 test beats); different genres 3.6 dB against 3.3 dB.
- **Tests:** new `tests/kitdesign.test.js` (28 checks: same seed same design, no `Math.random`, every number inside its genre's range, reshaped hits finite and never past full scale and the recording never changed, click and tail and ring-out do what they say, a kick keeps its sub-bass, keeping a locked type, older beats untouched, damaged numbers clamped) and `tests/e2e/kit.js` (22 checks in a browser: a new beat carries everything, designs and mixes are all different, the engine plays reshaped drums and the second percussion on the in-between hits, an older beat plays as it did, the Sound panel and variations keep the design, New kit, the download renders). The earlier unit tests (24 files) and the Beat Lab and Studio checks (`nomelody`, `producer`) still pass.
- **Files:** new `js/kitdesign.js`, `tests/kitdesign.test.js`, `tests/e2e/kit.js`. Changed: `js/samplebank.js` (`drumVoices`; loading, ready check and `sampleBuffer` know perc2/bell2), `js/instrumentbank.js` (the loading progress counts them), `js/engine.js` (`applySound` reshapes the drums, sets the mix and tone; `applyFx` uses the mix; `drumHit` alt buffer; perc and bell use the second recording), `js/beatgen.js` (the seed is drawn just before the beat object, in the same place of the random stream as before; `kitApply` adds the design), `js/beatlab.js` (New kit button), `js/export.js` (the download engine starts with the beat's own reverb size), `index.html` (script tag, button and hint), `README.md`, `sw.js` (rebuilt).
- **Globals:** new `kitdesign.js` globals: `KIT_VERSION`, `KIT_BASE`, `KIT_LEAN`, `KIT_TONE_ROLES`, `KIT_CACHE`, `kitRng`, `kitRound`, `kitDb`, `kitBiquad`, `kitResample`, `kitPeak`, `kitRms`, `kitOnset`, `kitProcess`, `kitBuffer`, `kitHit`, `kitDesign`, `kitApply`, `kitClamp`, `kitMixValues`, `kitToneValues`; in `samplebank.js` `drumVoices`. `E.mix` and `E.kitSamples.perc2/bell2` on the engine. Beat fields: `sound.drums.dsn`, `sound.drums.perc2`, `sound.drums.bell2`, `sound.mix`, `sound.tone`. No name clashes found (searched for every name before adding).
- **Honest limits:**
  - **I cannot hear.** Everything above is measured, not listened to. The numbers say the drums are punchier, tuned differently from beat to beat and brighter on the attack; they cannot say whether that sounds like a real Afrobeats record. Please listen and tell me which part still gives it away.
  - **The recordings are still the vintage ones.** The designer reshapes them; it does not replace a 1980s snare with a modern one, and it cannot make a dark conga bright (the click gives it a slap, not a conga's real top end). A real fix is new recordings, which I cannot download here.
  - **The notes and patterns are unchanged on purpose.** If the groove itself is what does not sound like Afrobeats, that is the next thing to look at, with your help on what is wrong.
  - **Loudness is untouched** (about -20 LUFS, the vocal pipeline is built on it).
  - Nothing was tried on a real phone. The Sound panel was checked at 400 px width (the button is 48 px tall and fits).
  - Two downloads of the same beat are never sample for sample identical (the reverb builds its tail from fresh noise, in v2.26.2 and now); they match in length and loudness.
- **Ideas not built:** a finished-record loudness option for downloads ("Loud master", off by default), synthesized modern kick, snare and clap layers, genre-correct groove variations (more kick and snare backbones per style), a "heard something wrong" button that records what you disliked and steers the next beat, and more instrument recordings.
