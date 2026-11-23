// Beat Lab "Melody" switch: off must leave NOTHING that plays a tune. Lead and pluck are silenced, and the bass and the log drum
// play the root note of the chord only; the chords stay (the key and chord changes are what the vocal and Studio build on).
// Records every note handed to the recorded instruments during offline renders. Needs the app served on :8080.  node nomelody.js
let chromium; try { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); } catch (e) { ({ chromium } = require('playwright')); }
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  await p.goto('http://localhost:8080/index.html'); await p.click('.mode-btn[data-mode="beatlab"]'); await p.waitForTimeout(1500);
  const r = await p.evaluate(async () => {
    const out = { cases: [] };
    // the switch itself
    const box = document.getElementById('bl-melody');
    box.checked = false; box.dispatchEvent(new Event('change'));
    out.flagOff = { play: playCtx.flatMelody, settings: currentRenderSettings().flatMelody, status: document.getElementById('bl-status').textContent };
    box.checked = true; box.dispatchEvent(new Event('change'));
    out.flagOn = { play: playCtx.flatMelody, settings: currentRenderSettings().flatMelody };
    const orig = SampledInstrument.prototype.triggerAttackRelease; let rec = null;
    SampledInstrument.prototype.triggerAttackRelease = function (n, d, t, v) { if (rec) rec.push(Array.isArray(n) ? n.join('+') : n); return orig.apply(this, arguments); };
    const base = currentRenderSettings();
    const picks = [['afrobeats', 'streetpop'], ['amapiano', 'classic'], ['afrohouse', 'deephouse'], ['rnb', 'neosoul'], ['trap', 'hardtrap'], ['afrolust', 'rap']];
    for (const [g, st] of picks) {
      const beat = generatePattern(g, { structure: 'loop', style: st }); await ensureBeatSound(beat.sound);
      const row = { g: g + '/' + st };
      for (const track of ['bass', 'logdrum', 'chords']) for (const flat of [false, true]) {
        rec = []; await renderSongBuffer(beat, Object.assign({}, base, { isAudible: n => n === track, flatMelody: flat }), () => {});
        row[track + (flat ? 'Off' : 'On')] = { hits: rec.length, distinct: new Set(rec).size };
      }
      out.cases.push(row);
    }
    SampledInstrument.prototype.triggerAttackRelease = orig;
    return out;
  });
  let bad = 0; const ok = (name, cond, extra) => { if (!cond) bad++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); };
  ok('switch off: live playback, downloads and Studio all get the flag', r.flagOff.play === true && r.flagOff.settings === true);
  ok('switch off: the status says what was removed', /root note/.test(r.flagOff.status), r.flagOff.status.slice(0, 60));
  ok('switch on: flag cleared', r.flagOn.play === false && r.flagOn.settings === false);
  for (const c of r.cases) {
    const bassOk = c.bassOff.hits === c.bassOn.hits && c.bassOff.distinct <= c.bassOn.distinct && c.bassOff.distinct <= 4;
    ok(c.g + ': bass keeps its rhythm, plays roots only', bassOk, `${c.bassOn.distinct} notes -> ${c.bassOff.distinct} (${c.bassOn.hits} hits)`);
    ok(c.g + ': log drum keeps its rhythm, plays roots only', c.logdrumOff.hits === c.logdrumOn.hits && c.logdrumOff.distinct <= 3, `${c.logdrumOn.distinct} notes -> ${c.logdrumOff.distinct} (${c.logdrumOn.hits} hits)`);
    ok(c.g + ': chords unchanged (key and changes stay)', c.chordsOff.hits === c.chordsOn.hits && c.chordsOff.distinct === c.chordsOn.distinct && c.chordsOff.hits > 0, `${c.chordsOff.hits} hits`);
  }
  const riffs = r.cases.filter(c => /afrobeats|amapiano|afrohouse/.test(c.g));
  ok('beats with riffs really get simpler', riffs.every(c => c.bassOff.distinct < c.bassOn.distinct || c.logdrumOff.distinct < c.logdrumOn.distinct));
  console.log(errs.length ? errs.join('\n') : 'no page errors'); if (errs.length) bad++;
  await b.close(); process.exit(bad ? 1 : 0);
})();
