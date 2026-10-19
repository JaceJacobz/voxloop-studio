// Drives the real Studio-mode code (daw.js) in a fake page: import a beat and lanes, press "Send to Pipeline", inspect what arrives.
// Run: node test_daw.js [path/to/daw.js]      (needs studiolevels.js beside it)
const vm = require("vm"), fs = require("fs"), path = require("path");
const DAW = process.argv[2] || "./daw.js";
const SR = 44100;
let pass = 0, fail = 0;
const check = (l, ok, x = "") => { ok ? pass++ : fail++; console.log((ok ? "  PASS " : "  FAIL ") + l + (x ? "   " + x : "")); };

// ---------- a small fake browser ----------
function stubEl(id) {
  const t = { id, value: "", checked: false, textContent: "", innerHTML: "", hidden: false, disabled: false, files: null, width: 300, height: 100, children: [], listeners: {}, style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener(ty, f) { (this.listeners[ty] = this.listeners[ty] || []).push(f); },
    removeEventListener() {}, dispatchEvent(ev) { (this.listeners[ev.type] || []).forEach((f) => f(ev)); return true; },
    getContext() { return new Proxy({}, { get: () => () => {}, set: () => true }); }, getBoundingClientRect() { return { width: 300, height: 100, left: 0, top: 0 }; },
    querySelector() { return stubEl("q"); }, querySelectorAll() { return []; }, appendChild(c) { this.children.push(c); return c; }, append() {}, remove() {}, closest() { return null; } };
  return new Proxy(t, { get(o, p) { if (p in o) return o[p]; if (typeof p === "symbol" || p === "then") return undefined; return () => {}; }, set(o, p, v) { o[p] = v; return true; } });
}
const registry = new Map(); let nextId = 1;
function makeBuffer(data, sr = SR) { return { sampleRate: sr, length: data.length, numberOfChannels: 1, duration: data.length / sr, getChannelData() { return data; }, copyToChannel(src) { data.set(src); } }; }
function makeFile(name, data) { const id = nextId++; registry.set(id, makeBuffer(data)); const u = new Uint32Array([id, 0]); return { name, type: "audio/wav", size: 8, arrayBuffer: async () => u.buffer.slice(0) }; }
class FakeOffline {
  constructor(ch, length, sr) { this.length = length; this.sampleRate = sr; this.destination = { isDest: true }; this.sources = []; }
  createBufferSource() { const s = { buffer: null, next: null, when: 0, connect(n) { this.next = n; return n; }, start(w) { this.when = w || 0; } }; this.sources.push(s); return s; }
  createGain() { return { gain: { value: 1 }, next: null, connect(n) { this.next = n; return n; } }; }
  createBuffer(ch, n, sr) { return makeBuffer(new Float32Array(n), sr); }
  async startRendering() {
    if (FakeOffline.failNext && FakeOffline.failNext--) throw new Error("simulated render failure");
    const out = new Float32Array(this.length);
    for (const s of this.sources) { let g = 1, n = s.next; while (n && !n.isDest) { if (n.gain) g *= n.gain.value; n = n.next; } const d = s.buffer.getChannelData(0), a = Math.round(s.when * this.sampleRate); for (let i = 0; i < d.length && a + i < out.length; i++) out[a + i] += d[i] * g; }
    return makeBuffer(out, this.sampleRate);
  }
}
class FakeAudio { constructor() { this.state = "running"; this.currentTime = 0; } resume() {} async decodeAudioData(ab) { return registry.get(new Uint32Array(ab)[0]); } createBuffer(ch, n, sr) { return makeBuffer(new Float32Array(n), sr); } }

function boot(file) {
  const els = {}, ready = [];
  const document = { readyState: "complete", getElementById: (i) => (els[i] = els[i] || stubEl(i)), createElement: () => stubEl("created"), querySelectorAll: () => [], querySelector: () => null, addEventListener(t, f) { if (t === "DOMContentLoaded") ready.push(f); }, body: stubEl("body") };
  const state = {};
  const win = { VocalVaultState: state, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }), innerWidth: 1200, AudioContext: FakeAudio, OfflineAudioContext: FakeOffline };
  win.window = win;
  const ctx = vm.createContext({ window: win, document, OfflineAudioContext: FakeOffline, AudioContext: FakeAudio, console: { log() {}, warn(...a) { ctx.__warns.push(a.map(String).join(" ")); }, error() {} }, Math, Float32Array, Float64Array, Uint32Array, Int16Array, Uint8Array, ArrayBuffer, DataView, Blob, File: class { constructor(parts, name, o) { this.parts = parts; this.name = name; this.type = (o || {}).type; this.size = parts.reduce((s, p) => s + (p.size || p.byteLength || 0), 0); this.__blob = parts[0]; } },
    DataTransfer: class { constructor() { this._f = []; this.items = { add: (f) => this._f.push(f) }; } get files() { return this._f; } }, Event: function (type) { this.type = type; }, performance: { now: () => 0 }, localStorage: { getItem: () => "pipeline", setItem() {} }, setTimeout, clearTimeout, requestAnimationFrame() { return 1; }, cancelAnimationFrame() {}, navigator: {}, Object, Array, Promise, parseFloat, parseInt, Number, String, Date, JSON, isFinite, Set, Map, Symbol });
  ctx.__warns = [];
  vm.runInContext(fs.readFileSync(path.join(__dirname, "studiolevels.js"), "utf8"), ctx);
  vm.runInContext(fs.readFileSync(file, "utf8"), ctx);
  return { win, els, state, ctx };
}

// ---------- test material ----------
function sing(n, spans, amp, f0) { const x = new Float32Array(n); let ph = 0; for (const [a, b] of spans) for (let i = Math.round(a * SR); i < Math.round(b * SR); i++) { const env = Math.min(1, (i - a * SR) / 900, (b * SR - i) / 900); ph += f0 / SR; ph -= Math.floor(ph); let s = 0; for (let h = 1; h <= 10; h++) s += Math.sin(2 * Math.PI * h * ph) / h; x[i] += amp * env * s * 0.5; } return x; }
const level = (x) => { const L = require("./studiolevels.js"); return L.activeLevel([{ data: x, sr: SR }]).db; };
const wavSamples = (blobParts) => { const ab = blobParts[0].__ab; return ab; };

async function session(file, setup) {
  const p = boot(file), D = p.win.VocalVaultDAW;
  const beat = new Float32Array(SR * 30); for (let i = 0; i < beat.length; i++) beat[i] = 0.1 * Math.sin(2 * Math.PI * 110 * i / SR);
  await D.loadBeatFile(makeFile("beat.wav", beat));
  const lead = sing(SR * 30, [[1, 5], [7, 11], [13, 17]], 0.2, 220), adlib = sing(SR * 6, [[0.2, 1.4], [2.5, 3.8]], 0.05, 330);   // adlib recorded ~12 dB under the lead
  D.addLane("main"); await D.importAudioFiles([makeFile("lead.wav", lead)]);
  p.els["tr-scrub"].value = "20000"; p.els["tr-scrub"].dispatchEvent({ type: "input" });          // the adlib lands at 20 s
  D.addLane("adlib"); await D.importAudioFiles([makeFile("adlib.wav", adlib)]);
  if (setup) setup(p, D);
  await D.sendToPipeline();
  return { p, D, lead, adlib, status: () => p.els["tr-status"].textContent };
}

(async () => {
  console.log("DAW file:", DAW);
  console.log("1) lead + adlib, 'Relatively lower', send to Pipeline");
  let s = await session(DAW, (p, D) => { D.lanes[1].mixLevel = "lower"; });
  console.log("   status:", s.status());
  check("the send succeeds (no 'Render failed')", /^Sent 2 lane/.test(s.status()), s.status());
  const stack = s.p.state.studioStack;
  check("Pipeline is handed the lead on its own (studioStack) with 1 extra lane", !!stack && stack.extras === 1 && stack.leadReference && stack.leadReference.getChannelData, stack ? "extras " + stack.extras : "no studioStack");
  const vocalFile = s.p.els["vocal-input"].files && s.p.els["vocal-input"].files[0];
  check("the composite vocal file was placed into the pipeline's vocal input", !!vocalFile && /composite/.test(vocalFile.name), vocalFile && vocalFile.name);
  if (stack) {
    const ref = stack.leadReference.getChannelData(0);
    check("the lead reference is the lead alone: same level as the lead, silent where the adlib is (20 s+)", Math.abs(level(ref) - level(s.lead)) < 0.3 && ref.slice(20 * SR, 24 * SR).every((v) => Math.abs(v) < 1e-6), level(ref).toFixed(1) + " vs " + level(s.lead).toFixed(1));
  }
  // the composite as it will be heard: read the WAV that was handed over and check the adlib really sits 3.5 dB under the lead
  if (vocalFile) {
    const ab = await vocalFile.__blob.arrayBuffer(), dv = new DataView(ab), n = (ab.byteLength - 44) / 2, x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = dv.getInt16(44 + i * 2, true) / 32768;
    const leadPart = x.slice(0, 18 * SR), adPart = x.slice(19 * SR, 25 * SR);
    const rel = level(adPart) - level(leadPart);
    console.log(`   in the composite file the adlib sits ${rel.toFixed(1)} dB vs the lead (asked: -3.5)`);
    check("the composite file has the adlib 3.5 dB under the lead (within 0.8 dB)", Math.abs(rel + 3.5) < 0.8, rel.toFixed(2) + " dB");
    check("the composite is as long as the lead reference (same timeline)", n === stack.leadReference.length, n + " vs " + stack.leadReference.length);
  }

  console.log("2) a lane that must not break the send");
  FakeOffline.failNext = 0;
  let s2 = await session(DAW, (p, D) => { FakeOffline.failNext = 0; });
  check("a second normal session also succeeds", /^Sent 2 lane/.test(s2.status()));
  // the lead-reference render fails (the composite render is the first startRendering; the reference is the second)
  FakeOffline.failNext = 0;
  const origStart = FakeOffline.prototype.startRendering; let calls = 0;
  FakeOffline.prototype.startRendering = async function () { calls++; if (calls === 2) throw new Error("simulated lead-reference failure"); return origStart.call(this); };
  let s3 = await session(DAW, (p, D) => { calls = 0; });
  FakeOffline.prototype.startRendering = origStart;
  console.log("   status:", s3.status());
  check("if only the lead reference fails, the composite is still sent (not 'Render failed')", /^Sent 2 lane/.test(s3.status()), s3.status());
  check("...and Pipeline is told there is no lead reference (studioStack null), so it evens as it always did", s3.p.state.studioStack === null);
  check("...and the summary tells the person their lane levels may be evened out", /lead reference|evened/i.test(s3.status()), s3.status().slice(-120));

  console.log("3) the lead is muted");
  let s4 = await session(DAW, (p, D) => { D.lanes[0].mixLevel = "mute"; });
  console.log("   status:", s4.status().slice(0, 130));
  check("the send succeeds", /^Sent /.test(s4.status()));
  check("a muted lead is NOT handed to Pipeline as the reference (it is not in the composite)", s4.p.state.studioStack === null, s4.p.state.studioStack ? "studioStack was set" : "null");

  console.log("3b) the lead is muted, but two other lanes are sent");
  const s4b = await (async () => {
    const p = boot(DAW), D = p.win.VocalVaultDAW;
    await D.loadBeatFile(makeFile("beat.wav", new Float32Array(SR * 30)));
    D.addLane("main"); await D.importAudioFiles([makeFile("lead.wav", sing(SR * 30, [[1, 5], [7, 11]], 0.2, 220))]);
    p.els["tr-scrub"].value = "20000"; p.els["tr-scrub"].dispatchEvent({ type: "input" });
    D.addLane("adlib"); await D.importAudioFiles([makeFile("ad.wav", sing(SR * 6, [[0.2, 1.4]], 0.05, 330))]);
    D.addLane("tag"); await D.importAudioFiles([makeFile("tag.wav", sing(SR * 6, [[2, 3.4]], 0.05, 300))]);
    D.lanes[0].mixLevel = "mute"; await D.sendToPipeline(); return p;
  })();
  console.log("   status:", s4b.els["tr-status"].textContent.slice(0, 120));
  check("a muted lead is not the reference even when two other lanes are sent (it is not in the composite)", /^Sent 2 lane/.test(s4b.els["tr-status"].textContent) && s4b.state.studioStack === null, s4b.state.studioStack ? "studioStack was set, extras " + s4b.state.studioStack.extras : "null");

  console.log("4) a single lane");
  const p5 = boot(DAW), D5 = p5.win.VocalVaultDAW; await D5.loadBeatFile(makeFile("beat.wav", new Float32Array(SR * 10)));
  D5.addLane("main"); await D5.importAudioFiles([makeFile("solo.wav", sing(SR * 10, [[1, 5]], 0.2, 220))]); await D5.sendToPipeline();
  check("one lane: sent, and no studioStack (nothing to balance)", /^Sent 1 lane/.test(p5.els["tr-status"].textContent) && p5.state.studioStack === null, p5.els["tr-status"].textContent);

  console.log("5) a genuine render error shows its reason");
  FakeOffline.failNext = 1;
  const s6 = await session(DAW, null);
  console.log("   status:", s6.status());
  check("the message names the cause instead of just 'Render failed'", /Render failed: /.test(s6.status()) && /simulated/.test(s6.status()), s6.status());
  FakeOffline.failNext = 0;
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("HARNESS ERROR", e); process.exit(2); });
