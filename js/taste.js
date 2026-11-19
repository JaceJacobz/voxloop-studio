// =====================================================================
// The producer's memory of your taste.
// Every time you keep an instrument, or tap "More like this" / "Less like this" on a beat, the producer notes it for that
// role (bass, keys, pad...). Next time it picks, an instrument you liked scores up to 50% higher and one you did not like up
// to 50% lower, so the choice still has variety and a favourite never takes over. It lives only in this browser (localStorage).
// =====================================================================
const TASTE = (function () {
  const KEY = "vl-taste", STEP = 0.15, LIMIT = 4;
  let data = { v: 1, inst: {} };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "null");
    if (saved && saved.v === 1 && saved.inst && typeof saved.inst === "object") data = saved;
  } catch (err) { /* private mode or damaged data: start fresh */ }
  const ON_KEY = "vl-taste-on";
  const isOn = () => { try { return localStorage.getItem(ON_KEY) !== "0"; } catch (err) { return true; } };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (err) { /* not saved, still works this session */ } };
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const key = (role, id) => role + ":" + id;

  return {
    // The multiplier the producer applies to an instrument's score (1 = no opinion)
    factor(id, role) { if (!isOn()) return 1; return 1 + clamp((data.inst[key(role, id)] || 0) * STEP, -0.5, 0.5); },
    liked(id, role) { return isOn() && (data.inst[key(role, id)] || 0) >= 1; },
    vote(role, id, amount) {
      if (!role || !id || !amount) return;
      const k = key(role, id), next = clamp((data.inst[k] || 0) + amount, -LIMIT, LIMIT);
      if (Math.abs(next) < 1e-9) delete data.inst[k]; else data.inst[k] = next;
      save();
    },
    // One vote for every instrument of a beat's sound
    voteSound(sound, amount) {
      if (!sound || typeof SOUND_ROLES === "undefined") return;
      SOUND_ROLES.forEach(role => { const id = resolveInstrument(role, sound[role]); if (id && instrumentInfo(id)) this.vote(role, id, amount); });
    },
    enabled: isOn,
    setEnabled(on) { try { localStorage.setItem(ON_KEY, on ? "1" : "0"); } catch (err) { /* not saved */ } },
    // "Likes: Kalimba (pluck), ...  Goes easy on: Piano (pluck)": for the Settings page
    summary() {
      const nm = e => ((typeof instrumentInfo === "function" && instrumentInfo(e.id)) || { name: e.id }).name + " (" + e.role + ")";
      const l = this.list(), up = l.filter(e => e.score > 0).slice(0, 4).map(nm), down = l.filter(e => e.score < 0).slice(0, 4).map(nm);
      return (up.length ? "Likes: " + up.join(", ") + ". " : "") + (down.length ? "Goes easy on: " + down.join(", ") + "." : "") || "Nothing noted yet.";
    },
    count() { return Object.keys(data.inst).length; },
    reset() { data = { v: 1, inst: {} }; save(); },
    // For tests and the "what have you learned" line: [{ role, id, score }] strongest first
    list() { return Object.keys(data.inst).map(k => { const [role, id] = k.split(":"); return { role, id, score: data.inst[k] }; }).sort((a, b) => Math.abs(b.score) - Math.abs(a.score)); }
  };
})();

// Settings page wiring (Performance and taste)
(function () {
  const $ = id => document.getElementById(id);
  const light = $("st-light"), taste = $("st-taste");
  if (!light || !taste) return;
  const now = () => { $("st-taste-now").textContent = TASTE.enabled() ? TASTE.summary() : "Off: the producer ignores what you taught it (it is still remembered)."; };
  try { light.checked = localStorage.getItem("vl-light") === "1"; } catch (err) { /* no storage */ }
  taste.checked = TASTE.enabled();
  light.addEventListener("change", () => { try { localStorage.setItem("vl-light", light.checked ? "1" : "0"); } catch (err) { /* not saved */ } $("st-light-now").hidden = false; });
  $("st-light-reload").addEventListener("click", () => location.reload());
  taste.addEventListener("change", () => { TASTE.setEnabled(taste.checked); now(); });
  $("st-taste-reset").addEventListener("click", () => { TASTE.reset(); now(); });
  window.addEventListener("vl-taste-changed", now);
  now();
})();
