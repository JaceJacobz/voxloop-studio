// Voxloop Studio: small phone-experience extras (v2.25.1). Loaded after blux.js. Adds only; it never changes how a button works.
//  - Studio start-up guide: steps 1-3 are buttons (they press the real Load beat / Add lane / Import buttons)
//  - A one-line key to the icon-only buttons in the Studio header, drawn from the buttons' own icons
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  function init() {
  const empty = $("studio-empty");
  if (!empty || empty.dataset.uxDone) return;
  empty.dataset.uxDone = "1";
  const guide = empty.querySelector(".studio-guide");
  if (guide) {
    ["studio-load-beat", "studio-add-lane", "studio-import-audio"].forEach((id, i) => {
      const li = guide.children[i]; if (!li || !$(id)) return;
      li.dataset.do = id; li.setAttribute("role", "button"); li.tabIndex = 0;
      const go = () => { const b = $(id); if (b && !b.disabled) b.click(); };
      li.addEventListener("click", go);
      li.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    });
  }
  // key to the icons (only if the buttons exist; each icon is a copy of the button's own)
  const KEY = [["rf-open-btn", "Reference mix"], ["fx-open-btn", "Effects"], ["fx-auto-btn", "Auto-produce"], ["studio-add-lane", "New lane"], ["studio-import-audio", "Import audio"], ["studio-to-pipeline", "Send to Pipeline"]];
  const items = KEY.map(([id, label]) => { const b = $(id), svg = b && b.querySelector("svg"); return svg ? { svg: svg.cloneNode(true), label } : null; }).filter(Boolean);
  if (items.length >= 3 && guide) {
    const p = document.createElement("p"); p.className = "studio-empty-legend"; p.setAttribute("aria-hidden", "true");
    items.forEach((it, i) => {
      it.svg.setAttribute("width", "14"); it.svg.setAttribute("height", "14"); it.svg.style.cssText = "vertical-align:-2px;margin-right:4px";
      const b = document.createElement("b"); b.textContent = it.label;
      const span = document.createElement("span"); span.style.whiteSpace = "nowrap"; span.append(it.svg, b);
      p.append(span); if (i < items.length - 1) p.append(document.createTextNode("  ·  "));
    });
    guide.insertAdjacentElement("afterend", p);
  }
  }
  // some Studio buttons are built by other scripts after this one runs, so wait for the page to finish loading
  if (document.readyState === "complete") init(); else window.addEventListener("load", init);
})();
