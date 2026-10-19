// Does the page send what the controls say?  Run: node test_tunepage.js   (needs tune.js beside it)
const vm = require("vm"), fs = require("fs");
let pass = 0, fail = 0;
const check = (l, ok, x = "") => { ok ? pass++ : fail++; console.log((ok ? "  PASS " : "  FAIL ") + l + (x ? "   " + x : "")); };
function makeEl(id) {
  return { id, value: "", checked: false, textContent: "", disabled: false, hidden: false, style: {}, dataset: {}, children: [], options: [], listeners: {}, width: 300, height: 100,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
    dispatchEvent(ev) { (this.listeners[ev.type] || []).forEach(f => f(ev)); },
    appendChild(o) { this.children.push(o); this.options.push(o); if (this.options.length === 1 && !this.value) this.value = o.value; },
    scrollIntoView() {}, setAttribute() {}, removeAttribute() {}, focus() {}, querySelector() { return null; }, querySelectorAll() { return []; },
    getContext() { return new Proxy({}, { get: () => () => {}, set: () => true }); }, getBoundingClientRect() { return { width: 100, height: 100, left: 0, top: 0 }; } };
}
function boot(beatTuning) {
  const els = {}, ready = [], seen = { options: null };
  const document = { getElementById: (i) => (els[i] = els[i] || makeEl(i)), createElement: () => ({ value: "", textContent: "" }), addEventListener(t, f) { if (t === "DOMContentLoaded") ready.push(f); }, querySelectorAll: () => [], body: makeEl("body") };
  const S = { beatKey: { key: "A", scale: "Minor", confidence: 0.9 }, beatBuffer: {}, vocalBuffer: { numberOfChannels: 1, getChannelData: () => new Float32Array(1000), sampleRate: 44100, length: 1000, duration: 0.02 } };
  const win = {
    VocalVaultState: S, addEventListener() {}, requestAnimationFrame() {},
    VocalVaultTune: { noteNames: ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"], estimateBeatTuning: () => beatTuning, tuneVocal: async (ch, sr, o) => { seen.options = o; throw new Error("captured"); } }
  };
  win.window = win;
  vm.runInContext(fs.readFileSync(__dirname + "/tune.js", "utf8"), vm.createContext({ window: win, document, console: { log() {}, error() {} }, Math, Float32Array, parseFloat, parseInt, Number, Object, Array, Promise, Event: function (type) { this.type = type; }, setTimeout, clearTimeout, requestAnimationFrame() {}, cancelAnimationFrame() {}, AudioBuffer: function () {}, Blob: function () {}, URL: { createObjectURL: () => "" } }));
  ready.forEach(f => f());
  return { els, S, seen };
}
async function press(p, set) {
  for (const [id, v] of Object.entries(set)) { p.els[id] = p.els[id] || makeEl(id); if (typeof v === "boolean") p.els[id].checked = v; else p.els[id].value = String(v); }
  p.seen.options = null;
  (p.els["tune-run-button"].listeners.click || []).forEach(f => f());
  await new Promise(r => setTimeout(r, 5));
  return p.seen.options;
}
(async () => {
  const p = boot({ cents: -18, strength: 0.9 });
  (p.els["continue-tune-button"].listeners.click || []).forEach(f => f());
  console.log("1) opening the step reads the beat");
  check("the key comes from the beat (A minor)", p.els["tune-root"].value === "9" && p.els["tune-scale"].value === "minor", p.els["tune-root"].value + " " + p.els["tune-scale"].value);
  check("a confident key reading ticks 'Match vocal key to the beat'", p.els["tune-auto-key"].checked === true);
  check("the beat's tuning (-18c) is shown", /-18/.test(p.els["tune-ref"].textContent), p.els["tune-ref"].textContent);

  console.log("2) every control reaches the engine");
  let o = await press(p, { "tune-strength": 70, "tune-retune": 0, "tune-flatten": 65, "tune-shift": -3, "tune-selective": false, "tune-natural": false, "tune-auto-key": false, "tune-spoken": true, "tune-test": true });
  console.log("   sent:", JSON.stringify(o));
  check("key root and scale", o.rootPc === 9 && o.scale === "minor");
  check("beat tuning", o.refCents === -18);
  check("Correction strength 70 % -> 0.7", Math.abs(o.strength - 0.7) < 1e-9);
  check("Retune speed 0 (Instant) -> 0, and the engine is told not to add a hidden minimum", o.retuneMs === 0 && o.minRetuneMs === 0);
  check("Flatten 65 % -> 0.65", Math.abs(o.flatten - 0.65) < 1e-9);
  check("Move the whole vocal -3 -> -3 semitones", o.manualSemitones === -3);
  check("Selective unticked -> false", o.selective === false);
  check("Natural singing feel unticked -> natural and adaptive both false", o.natural === false && o.adaptive === false);
  check("Match vocal key unticked -> autoTranspose false", o.autoTranspose === false);
  check("Spoken to sung ticked -> true", o.spokenSung === true);
  check("Test mode ticked -> testDetune true", o.testDetune === true);
  o = await press(p, { "tune-strength": 100, "tune-retune": 120, "tune-flatten": 0, "tune-shift": 2, "tune-selective": true, "tune-natural": true, "tune-auto-key": true, "tune-spoken": false, "tune-test": false, "tune-root": 2, "tune-scale": "major" });
  check("the opposite settings arrive as the opposite values", o.strength === 1 && o.retuneMs === 120 && o.minRetuneMs === 120 && o.flatten === 0 && o.manualSemitones === 2 && o.selective === true && o.natural === true && o.autoTranspose === true && o.spokenSung === false && o.testDetune === false && o.rootPc === 2 && o.scale === "major");

  console.log("3) the read-outs say the truth");
  p.els["tune-retune"].value = "0"; p.els["tune-retune"].dispatchEvent({ type: "input" });
  check("Retune 0 reads 'Instant'", p.els["tune-retune-value"].textContent === "Instant");
  p.els["tune-retune"].value = "45"; p.els["tune-retune"].dispatchEvent({ type: "input" });
  check("Retune 45 reads '45 ms'", p.els["tune-retune-value"].textContent === "45 ms");
  p.els["tune-shift"].value = "0"; p.els["tune-auto-key"].checked = true; p.els["tune-shift"].dispatchEvent({ type: "input" });
  check("Move the whole vocal 0 with the automatic match ON reads '0 (automatic)'", p.els["tune-shift-value"].textContent === "0 (automatic)");
  p.els["tune-auto-key"].checked = false; p.els["tune-auto-key"].dispatchEvent({ type: "change" });
  check("...and with the automatic match OFF reads '0 (no move)' (it used to say automatic)", p.els["tune-shift-value"].textContent === "0 (no move)", p.els["tune-shift-value"].textContent);
  p.els["tune-shift"].value = "-1"; p.els["tune-shift"].dispatchEvent({ type: "input" });
  check("-1 reads '-1 semitone' (singular)", p.els["tune-shift-value"].textContent === "-1 semitone");

  console.log("4) an unclear beat tuning is ignored");
  const q = boot({ cents: 40, strength: 0.1 });
  (q.els["continue-tune-button"].listeners.click || []).forEach(f => f());
  const o2 = await press(q, {});
  check("a weak tuning reading is not used (refCents 0, A = 440)", o2.refCents === 0 && q.els["tune-ref"].textContent === "A = 440");
  const r = boot({ cents: 10, strength: 0.9 }); r.S.beatKey = { key: "C", scale: "Major", confidence: 0.4 };
  (r.els["continue-tune-button"].listeners.click || []).forEach(f => f());
  check("an uncertain key reading does NOT tick the automatic key match", r.els["tune-auto-key"].checked === false);
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
