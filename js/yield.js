/**
 * Voxloop Studio: keep the screen responsive during heavy work.
 *
 *   await VLYield()        gives the screen a turn if more than ~12 ms went by since the last turn (cheap to call in a loop)
 *   VLProgress.start(txt)  a thin progress bar under the top bar with a label; returns { set(fraction, text), done() }
 *
 * Phones like the Tecno Pop 20 have slow processors: noise cleaning, melody writing and saving take seconds there. Without
 * yielding, the page freezes for those seconds and the phone may offer to close it. With it, the work takes a little longer
 * but touches, scrolling and the progress bar keep moving.
 */
(function (root) {
    "use strict";
    let last = 0;
    const now = () => (root.performance ? root.performance.now() : Date.now());
    async function VLYield() {
        if (now() - last < 12) return;
        if (root.scheduler && root.scheduler.yield) await root.scheduler.yield(); else await new Promise((r) => setTimeout(r, 0));
        last = now();
    }

    let bar = null, depth = 0, hideTimer = 0;
    function ensure() {
        if (bar || typeof document === "undefined") return bar;
        bar = document.createElement("div");
        bar.id = "vl-progress"; bar.className = "vl-progress"; bar.setAttribute("role", "progressbar"); bar.setAttribute("aria-live", "polite");
        bar.innerHTML = '<div class="vl-progress-label"></div><div class="vl-progress-track"><i></i></div>';
        document.body.appendChild(bar);
        return bar;
    }
    const VLProgress = {
        start(text) {
            const el = ensure(); if (!el) return { set() {}, done() {} };
            depth++; clearTimeout(hideTimer);
            el.classList.add("is-on");
            const lab = el.querySelector(".vl-progress-label"), fill = el.querySelector("i");
            lab.textContent = text || "Working…"; fill.style.width = "4%"; el.removeAttribute("aria-valuenow");
            let closed = false;
            return {
                set(frac, t) { if (closed) return; if (t) lab.textContent = t; const p = Math.max(4, Math.min(100, Math.round(frac * 100))); fill.style.width = p + "%"; el.setAttribute("aria-valuenow", String(p)); },
                done() { if (closed) return; closed = true; depth = Math.max(0, depth - 1); if (!depth) { fill.style.width = "100%"; hideTimer = setTimeout(() => el.classList.remove("is-on"), 350); } }
            };
        }
    };
    root.VLYield = VLYield;
    root.VLProgress = VLProgress;
})(typeof window !== "undefined" ? window : this);
