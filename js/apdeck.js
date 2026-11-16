/*
 * Autopilot deck: ONE card on screen at a time. A finished card swipes off to the left and the next one slides in from the right,
 * so progress is watched in one place; the page underneath never scrolls.
 *
 *   VLApDeck.open(steps, { onTakeover })      show the deck. steps = [{ key, label }] for the dots along the top
 *   VLApDeck.mark(key, "todo" | "now" | "done")
 *   VLApDeck.ask({ key, title, html, buttons: [{ id, label, sub, kind }], onMount(el) }) -> Promise<button id>
 *   VLApDeck.progress({ key, title, text })   -> { say(text), finish(lines, holdMs) -> Promise }
 *   VLApDeck.handBack({ title, text, resumeLabel }) -> Promise   hides the deck, shows a small "Continue" bar, resolves on tap
 *   VLApDeck.final({ title, html, buttons })  -> Promise<button id>   (the deck closes after the tap)
 *   VLApDeck.close()
 */
(function () {
    "use strict";
    if (typeof document === "undefined") return;

    const esc = (t) => String(t == null ? "" : t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const reduce = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let root = null, stage = null, dots = null, bar = null, current = null, isOpen = false, takeover = null, steps = [];

    function build() {
        if (root) return;
        root = document.createElement("div");
        root.id = "ap-deck"; root.className = "apd"; root.hidden = true;
        root.setAttribute("role", "dialog"); root.setAttribute("aria-modal", "true"); root.setAttribute("aria-label", "Autopilot");
        root.innerHTML = '<div class="apd-top"><strong class="apd-brand">Autopilot</strong><ol class="apd-dots" id="apd-dots"></ol></div><div class="apd-stage" id="apd-stage"></div>';
        document.body.appendChild(root);
        stage = root.querySelector("#apd-stage"); dots = root.querySelector("#apd-dots");
        bar = document.createElement("div");
        bar.id = "ap-resume"; bar.className = "apd-resume"; bar.hidden = true;
        bar.innerHTML = '<div class="apd-resume-text"><strong></strong><span></span></div><button type="button" class="primary-button apd-resume-btn"></button>';
        document.body.appendChild(bar);
    }

    function paintDots() {
        dots.innerHTML = steps.map((s) => '<li data-key="' + esc(s.key) + '" data-st="' + (s.st || "todo") + '"><span class="apd-dot"></span><span class="apd-dotlabel">' + esc(s.label) + "</span></li>").join("");
    }

    // put a new card on the stage; the previous one swipes off to the left
    function present(el) {
        const old = current;
        el.classList.add("apd-card", "is-enter");
        stage.appendChild(el);
        current = el;
        if (old) {
            old.classList.remove("is-in"); old.classList.add("is-out"); old.setAttribute("aria-hidden", "true");
            const kill = () => { if (old.parentNode) old.parentNode.removeChild(old); };
            old.addEventListener("transitionend", kill, { once: true }); setTimeout(kill, 700);
        }
        // next frame: slide the new card in
        requestAnimationFrame(() => requestAnimationFrame(() => { el.classList.remove("is-enter"); el.classList.add("is-in"); }));
        const h = el.querySelector(".apd-title"); if (h) { h.setAttribute("tabindex", "-1"); try { h.focus({ preventScroll: true }); } catch (e) { /* older browsers */ } }
    }

    function buttonsHtml(buttons) {
        return (buttons || []).map((b) => '<button type="button" class="apd-btn ' + (b.kind === "primary" ? "primary-button" : "secondary-button") + '" data-id="' + esc(b.id) + '"><span>' + esc(b.label) + "</span>" + (b.sub ? '<small>' + esc(b.sub) + "</small>" : "") + "</button>").join("");
    }

    const D = {
        open(list, opts) {
            build();
            steps = (list || []).map((s) => ({ key: s.key, label: s.label, st: "todo" }));
            takeover = opts && opts.onTakeover || null;
            stage.innerHTML = ""; current = null; paintDots();
            root.hidden = false; isOpen = true; bar.hidden = true;
            document.documentElement.classList.add("ap-deck-open");
        },
        close() {
            if (!root) return;
            root.hidden = true; bar.hidden = true; isOpen = false; stage.innerHTML = ""; current = null;
            document.documentElement.classList.remove("ap-deck-open");
        },
        get isOpen() { return isOpen; },
        mark(key, st) {
            if (!root) return;
            let hit = false;
            steps.forEach((s) => { if (s.key === key) { s.st = st; hit = true; } });
            if (hit && st === "now") { let seen = false; steps.forEach((s) => { if (s.key === key) seen = true; else if (!seen && s.st !== "done") s.st = "done"; }); }
            paintDots();
        },
        ask(spec) {
            build();
            if (spec.key) D.mark(spec.key, "now");
            return new Promise((resolve) => {
                const el = document.createElement("section");
                el.innerHTML = '<h2 class="apd-title">' + esc(spec.title) + "</h2>" + (spec.html || "") + '<div class="apd-actions">' + buttonsHtml(spec.buttons) + "</div>";
                el.querySelectorAll(".apd-actions .apd-btn").forEach((b) => b.addEventListener("click", () => { if (spec.onDone) { try { spec.onDone(el, b.dataset.id); } catch (e) { /* never block the flow */ } } resolve(b.dataset.id); }));
                present(el);
                if (spec.onMount) spec.onMount(el);
            });
        },
        progress(spec) {
            build();
            if (spec.key) D.mark(spec.key, "now");
            const el = document.createElement("section");
            el.classList.add("apd-progress");
            el.innerHTML = '<div class="apd-pulse" aria-hidden="true"><span></span></div><h2 class="apd-title">' + esc(spec.title) + '</h2><p class="apd-text" aria-live="polite">' + esc(spec.text || "") + '</p><ul class="apd-lines" hidden></ul>' +
                '<div class="apd-actions apd-quiet"><button type="button" class="apd-link" data-act="takeover">Take over</button></div>';
            const tk = el.querySelector('[data-act="takeover"]');
            tk.addEventListener("click", () => { if (takeover) takeover(); });
            present(el);
            const text = el.querySelector(".apd-text"), list = el.querySelector(".apd-lines");
            return {
                el,
                say(t) { text.textContent = t || ""; },
                finish(lines, holdMs) {
                    return new Promise((resolve) => {
                        el.classList.add("is-done");
                        el.querySelector(".apd-pulse").classList.add("is-done");
                        const L = (lines || []).filter(Boolean).slice(0, 3);
                        if (L.length) { list.innerHTML = L.map((t) => "<li>" + esc(t) + "</li>").join(""); list.hidden = false; }
                        text.textContent = "Done";
                        tk.parentNode.hidden = true;
                        if (spec.key) D.mark(spec.key, "done");
                        setTimeout(resolve, reduce() ? 300 : (holdMs == null ? (L.length ? 1700 : 600) : holdMs));
                    });
                }
            };
        },
        handBack(spec) {
            build();
            return new Promise((resolve) => {
                root.hidden = true;
                document.documentElement.classList.remove("ap-deck-open");
                bar.querySelector("strong").textContent = spec.title || "Your turn";
                bar.querySelector("span").textContent = spec.text || "";
                const btn = bar.querySelector("button"); btn.textContent = spec.resumeLabel || "Continue Autopilot";
                bar.hidden = false;
                if (spec.onHidden) { try { requestAnimationFrame(() => spec.onHidden()); } catch (e) { /* never block the flow */ } }
                const go = () => { btn.removeEventListener("click", go); bar.hidden = true; root.hidden = false; document.documentElement.classList.add("ap-deck-open"); resolve(); };
                btn.addEventListener("click", go);
            });
        },
        final(spec) {
            build();
            return new Promise((resolve) => {
                steps.forEach((s) => { s.st = "done"; }); paintDots();
                const el = document.createElement("section");
                el.classList.add("is-final");
                el.innerHTML = '<div class="apd-tick" aria-hidden="true">✓</div><h2 class="apd-title">' + esc(spec.title) + "</h2>" + (spec.html || "") + '<div class="apd-actions">' + buttonsHtml(spec.buttons) + "</div>";
                el.querySelectorAll(".apd-actions .apd-btn").forEach((b) => b.addEventListener("click", () => {
                    if (b.dataset.id === "details") { const d = el.querySelector(".apd-details"); if (d) { d.hidden = !d.hidden; b.querySelector("span").textContent = d.hidden ? "What Voxloop did" : "Hide details"; } return; }
                    resolve(b.dataset.id);
                }));
                present(el);
            });
        }
    };
    window.VLApDeck = D;
})();
