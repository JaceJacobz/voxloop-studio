// Beat Lab easier to use (v2.14.0). Beat Lab only. Loaded after beatlab.js.
//  - Tabs: Beat | Sound & Mix | Sketch | Export (the long page is split; nothing is removed)
//  - A transport bar that stays on screen: Play / Pause, Stop, Back, New beat, Variation, and what is happening
//  - Pause really pauses (it remembers the bar); the space bar plays and pauses on a computer
// It only moves existing elements around, so every existing button keeps its own code.
(function () {
  "use strict";
  const layout = document.querySelector("#mode-beatlab .beatlab-layout");
  const playBtn = document.getElementById("bl-play");
  if (!layout || !playBtn || typeof startPlayback !== "function" || typeof stopPlayback !== "function") return;
  const $ = id => document.getElementById(id);
  const TABS = [["beat", "Beat"], ["sound", "Sound"], ["sketch", "Sketch"], ["export", "Export"]];
  const where = el => {
    if (el.dataset && el.dataset.bluxTab) return el.dataset.bluxTab;
    if (el.id === "bl-vsPanel" || el.id === "bl-lustGuide") return "sketch";
    if (el.id === "bl-soundBox" || el.id === "bl-melAdv" || el.id === "bl-melPanel" || el.id === "bl-mixerBox") return "sound";
    if (el.classList.contains("beatlab-export")) return "export";
    return "beat";
  };
  let tab = "beat";
  try { const s = localStorage.getItem("vl-bl-tab"); if (TABS.some(t => t[0] === s)) tab = s; } catch (e) { /* storage blocked */ }

  // ---------- tabs ----------
  const tabsEl = document.createElement("div");
  tabsEl.className = "blux-tabs"; tabsEl.setAttribute("role", "tablist"); tabsEl.setAttribute("aria-label", "Beat Lab");
  tabsEl.innerHTML = TABS.map(t => '<button type="button" role="tab" class="blux-tab" data-tab="' + t[0] + '">' + t[1] + "</button>").join("");
  layout.insertBefore(tabsEl, layout.firstChild);
  // the tab bar sticks just under the top bar (which is sticky too), not behind it
  const topBar = document.querySelector(".top-bar");
  const syncBarH = () => { try { document.documentElement.style.setProperty("--vl-topbar-h", (topBar ? topBar.offsetHeight : 46) + "px"); } catch (e) { /* no style access */ } };
  syncBarH(); window.addEventListener("resize", syncBarH);
  if (topBar && window.ResizeObserver) { try { new ResizeObserver(syncBarH).observe(topBar); } catch (e) { /* older browser */ } }
    function show(name, scroll) {
    if (!TABS.some(t => t[0] === name)) name = "beat";
    tab = name;
    layout.dataset.bluxOn = name;
    [...layout.children].forEach(el => { if (el === tabsEl || el === dock) return; el.classList.toggle("blux-hidden", where(el) !== name); });
    tabsEl.querySelectorAll(".blux-tab").forEach(b => { const on = b.dataset.tab === name; b.classList.toggle("is-on", on); b.setAttribute("aria-selected", on ? "true" : "false"); });
    if (name === "sketch") { const v = $("bl-vsPanel"); if (v && v.tagName === "DETAILS") v.open = true; }
    try { localStorage.setItem("vl-bl-tab", name); } catch (e) { /* storage blocked */ }
    if (scroll !== false) { try { tabsEl.scrollIntoView({ block: "start" }); } catch (e) { /* no scroll */ } }
    document.dispatchEvent(new CustomEvent("blux-tab", { detail: name }));
  }
  tabsEl.addEventListener("click", e => { const b = e.target.closest(".blux-tab"); if (b) show(b.dataset.tab); });

  // ---------- the transport bar ----------
  const ico = {
    play: '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l13-7.5z" fill="currentColor"/></svg>',
    pause: '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z" fill="currentColor"/></svg>',
    stop: '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><rect x="5.5" y="5.5" width="13" height="13" rx="2" fill="currentColor"/></svg>',
    back: '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7 4 12l5 5M4.5 12H15a5 5 0 0 1 0 10h-2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" transform="translate(0 -3)"/></svg>'
  };
  const dock = document.createElement("div");
  dock.className = "blux-dock"; dock.setAttribute("role", "group"); dock.setAttribute("aria-label", "Playback");
  dock.innerHTML = '<div class="blux-now" id="blux-now" aria-live="polite"></div><div class="blux-btns">' +
    '<button type="button" class="blux-play" id="blux-play"></button>' +
    '<button type="button" class="blux-icon" id="blux-stop" aria-label="Stop" title="Stop">' + ico.stop + "</button>" +
    '<span class="blux-slot" data-slot="back"></span><span class="blux-slot blux-grow" data-slot="regen"></span><span class="blux-slot blux-grow" data-slot="variation"></span></div>';
  layout.appendChild(dock);
  [["back", "bl-back"], ["regen", "bl-regen"], ["variation", "bl-variation"]].forEach(([slot, id]) => {
    const b = $(id), s = dock.querySelector('[data-slot="' + slot + '"]'); if (b && s) s.appendChild(b);
  });
  const back = $("bl-back"); if (back) { back.innerHTML = ico.back; back.setAttribute("aria-label", "Go back to the previous beat"); back.classList.add("blux-icon"); }
  const playEl = $("blux-play"), stopEl = $("blux-stop"), nowEl = $("blux-now");

  let pausedAt = null;                                          // the bar we stopped on, while paused
  const isPlaying = () => { try { return Tone.Transport.state === "started"; } catch (e) { return false; } };
  function sync() {
    const on = isPlaying();
    playEl.innerHTML = (on ? ico.pause : ico.play) + "<span>" + (on ? "Pause" : pausedAt !== null ? "Resume" : "Play") + "</span>";
    playEl.classList.toggle("is-on", on);
    stopEl.disabled = !on && pausedAt === null;
    const st = $("bl-status"); if (st && nowEl.textContent !== st.textContent) nowEl.textContent = st.textContent;
  }
  async function toggle() {
    if (isPlaying()) { pausedAt = Math.max(0, typeof bar === "number" ? bar : 0); stopPlayback("Paused. Tap Resume to carry on from this bar."); }
    else if (pausedAt !== null) {
      const from = pausedAt; pausedAt = null;
      try { await Tone.start(); startPlayback(from); } catch (e) { console.warn(e); playBtn.click(); }
    } else playBtn.click();                                     // the normal start: audio unlock, sound check
    setTimeout(sync, 60);
  }
  playEl.addEventListener("click", toggle);
  stopEl.addEventListener("click", () => { pausedAt = null; if (isPlaying()) stopPlayback("Stopped."); else { stopPlayback("Stopped."); } setTimeout(sync, 60); });
  ["bl-regen", "bl-variation", "bl-back"].forEach(id => { const b = $(id); if (b) b.addEventListener("click", () => { if (!isPlaying()) pausedAt = null; setTimeout(sync, 60); }); });
  playBtn.addEventListener("click", () => { pausedAt = null; setTimeout(sync, 120); });
  new MutationObserver(sync).observe(playBtn, { childList: true, characterData: true, subtree: true });
  const st0 = $("bl-status"); if (st0) new MutationObserver(sync).observe(st0, { childList: true, characterData: true, subtree: true });
  setInterval(sync, 700);
  document.addEventListener("keydown", e => {
    if (e.code !== "Space" || e.target.closest("input,select,textarea,button,[contenteditable]")) return;
    const panel = $("mode-beatlab"); if (!panel || panel.classList.contains("hidden") || panel.getAttribute("aria-hidden") === "true") return;
    e.preventDefault(); toggle();
  });

  // ---------- producer parts stay hidden until asked for ----------
  // Beat Lab makes the drum pattern, levels and sounds by itself. Someone who only wants a beat never has to open these.
  const kids = [...layout.children];
  const pat = kids.find(e => e.classList.contains("panel-card") && !e.id && /^\s*Lock/.test(e.textContent));
  if (pat) {
    const d = document.createElement("details"); d.className = "blux-adv"; d.id = "bl-patternAdv";
    d.innerHTML = '<summary><span class="blux-adv-title">Pattern editor</span><span class="blux-adv-hint">For producers. Beat Lab already made the drums and instruments. Open this only to change single hits, lock parts or swap instruments by hand.</span></summary>';
    pat.parentNode.insertBefore(d, pat); d.appendChild(pat);
  }
  const mel = $("bl-melPanel");
  if (mel && mel.tagName !== "DETAILS") {
    const d = document.createElement("details"); d.className = "blux-adv"; d.id = "bl-melAdv";
    d.innerHTML = '<summary><span class="blux-adv-title">Melody editor</span><span class="blux-adv-hint">For producers. Beat Lab already wrote the melody. Open this only to move or add single notes.</span></summary>';
    mel.parentNode.insertBefore(d, mel); d.appendChild(mel);
  }
  const intro = document.createElement("p"); intro.className = "blux-intro"; intro.dataset.bluxTab = "sound";
  intro.textContent = "Optional. Beat Lab sets the sounds and the volume of every instrument for you. Open a section below only if you want to change something yourself.";
  const mixSum = document.querySelector("#bl-mixerBox > summary .panel-title"); if (mixSum) mixSum.textContent = "Mixer (volume of each sound)";
  const soundBox = $("bl-soundBox"); if (soundBox) layout.insertBefore(intro, soundBox); else layout.appendChild(intro);

  show(tab, false);
  sync();
  window.VLBLUX = { show, sync, tab: () => tab };
})();
