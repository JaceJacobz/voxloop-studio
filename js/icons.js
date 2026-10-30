/**
 * Voxloop — icon set (inline SVG, currentColor).
 * VLI("play") returns the markup for an icon; VLI("play", 14) sets the size in px.
 * Used in place of emoji / symbol characters so icons look the same on every phone.
 */
(function (root) {
    "use strict";
    const S = 'fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"';
    const P = {
        play: '<path d="M8 5.2v13.6a.6.6 0 0 0 .9.5l10.6-6.8a.6.6 0 0 0 0-1L8.9 4.7a.6.6 0 0 0-.9.5z" fill="currentColor"/>',
        pause: '<rect x="6.5" y="5" width="3.8" height="14" rx="1.2" fill="currentColor"/><rect x="13.7" y="5" width="3.8" height="14" rx="1.2" fill="currentColor"/>',
        stop: '<rect x="6" y="6" width="12" height="12" rx="2.2" fill="currentColor"/>',
        record: '<circle cx="12" cy="12" r="6.5" fill="currentColor"/>',
        check: '<path ' + S + ' d="M5 12.5l4.2 4.2L19 7"/>',
        close: '<path ' + S + ' d="M6 6l12 12M18 6L6 18"/>',
        up: '<path ' + S + ' d="M6 14.5l6-6 6 6"/>',
        down: '<path ' + S + ' d="M6 9.5l6 6 6-6"/>',
        arrowUp: '<path ' + S + ' d="M12 19V6M6.5 11.5L12 6l5.5 5.5"/>',
        arrowDown: '<path ' + S + ' d="M12 5v13M6.5 12.5L12 18l5.5-5.5"/>',
        undo: '<path ' + S + ' d="M9 8L5 12l4 4"/><path ' + S + ' d="M5 12h9.5a4.5 4.5 0 0 1 0 9H12"/>',
        refresh: '<path ' + S + ' d="M19 11a7 7 0 1 0-1.6 5.2"/><path ' + S + ' d="M19.5 5v6h-6"/>',
        rewind: '<path ' + S + ' d="M11 7l-6 5 6 5zM19 7l-6 5 6 5z"/>',
        forward: '<path ' + S + ' d="M13 7l6 5-6 5zM5 7l6 5-6 5z"/>',
        sparkle: '<path d="M12 3.2l1.9 5.4 5.4 1.9-5.4 1.9L12 17.8l-1.9-5.4-5.4-1.9 5.4-1.9z" fill="currentColor"/><path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" fill="currentColor"/>',
        rack: '<path ' + S + ' d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle ' + S + ' cx="15" cy="7" r="2"/><circle ' + S + ' cx="9" cy="12" r="2"/><circle ' + S + ' cx="17" cy="17" r="2"/>',
        target: '<circle ' + S + ' cx="12" cy="12" r="8.5"/><circle ' + S + ' cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/>',
        folder: '<path ' + S + ' d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
        save: '<path ' + S + ' d="M5 4.5h11l3 3V19a1.5 1.5 0 0 1-1.5 1.5h-12A1.5 1.5 0 0 1 4 19V6a1.5 1.5 0 0 1 1-1.5z"/><path ' + S + ' d="M8 4.5v4.5h7V4.5M8 20.5v-6h8v6"/>',
        wave: '<path ' + S + ' d="M3 13c2.5 0 2.5-6 5-6s2.5 10 5 10 2.5-6 4-6 1.5 2 3 2"/>',
        automation: '<path ' + S + ' d="M3.5 17l5-8 4 5 3-6 4.5 9"/><circle cx="8.5" cy="9" r="1.5" fill="currentColor"/><circle cx="15.5" cy="8" r="1.5" fill="currentColor"/>',
        warning: '<path ' + S + ' d="M12 4.5l9 15.5H3z"/><path ' + S + ' d="M12 10.5v4.5M12 17.6v.2"/>',
        power: '<path ' + S + ' d="M12 3.5v8"/><path ' + S + ' d="M7 6.8a7 7 0 1 0 10 0"/>',
        trash: '<path ' + S + ' d="M4.5 7h15M9.5 7V4.8h5V7M7 7l.8 12.2h8.4L17 7M10.3 10.5v5.5M13.7 10.5v5.5"/>',
        plus: '<path ' + S + ' d="M12 5v14M5 12h14"/>',
        mic: '<rect ' + S + ' x="9" y="3.5" width="6" height="10.5" rx="3"/><path ' + S + ' d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.8M8.8 20.8h6.4"/>',
        dots: '<circle cx="5.5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="18.5" cy="12" r="1.8" fill="currentColor"/>',
        chevronRight: '<path ' + S + ' d="M9.5 6l6 6-6 6"/>',
        loop: '<path ' + S + ' d="M17 4l3 3-3 3M20 7H8a4 4 0 0 0-4 4M7 20l-3-3 3-3M4 17h12a4 4 0 0 0 4-4"/>',
        send: '<path ' + S + ' d="M4 12h15M13 6l6 6-6 6"/>',
        import: '<path ' + S + ' d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>',
        beat: '<path ' + S + ' d="M5 15v-4M9 19V5M13 16V8M17 14v-4M20.5 12.5v-1"/>',
        slider: '<path ' + S + ' d="M4 8h16M4 16h16"/><circle cx="9" cy="8" r="2.3" fill="var(--bg, #110f18)" stroke="currentColor" stroke-width="1.9"/><circle cx="15" cy="16" r="2.3" fill="var(--bg, #110f18)" stroke="currentColor" stroke-width="1.9"/>',
        fadein: '<path ' + S + ' d="M4 18L20 6"/><path ' + S + ' d="M4 18h16" opacity=".5"/>',
        fadeout: '<path ' + S + ' d="M4 6l16 12"/><path ' + S + ' d="M4 18h16" opacity=".5"/>',
        snap: '<path ' + S + ' d="M7 4v8a5 5 0 0 0 10 0V4"/><path ' + S + ' d="M7 7.5h3M14 7.5h3"/>',
        // one icon per plugin (used on the rack cards)
        "p-tune": '<path ' + S + ' d="M9 18V6l9-2v12"/><circle ' + S + ' cx="6.5" cy="18" r="2.5"/><circle ' + S + ' cx="15.5" cy="16" r="2.5"/>',
        "p-pitchedit": '<ellipse ' + S + ' cx="7" cy="15" rx="3.6" ry="2.3"/><ellipse ' + S + ' cx="16.5" cy="9" rx="3.8" ry="2.3"/><path ' + S + ' d="M10.5 14l2.5-3"/>',
        "p-eq": '<path ' + S + ' d="M3 15c3 0 3-6 6-6s3 8 6 8 3-5 6-5"/>',
        "p-comp": '<path ' + S + ' d="M4 8h5l3 4-3 4H4M20 8h-5l-3 4 3 4h5"/>',
        "p-deess": '<path ' + S + ' d="M7 9.5c0-1.7 1.4-2.5 3-2.5s3 .8 3 2.3c0 3.2-6 2.6-6 6 0 1.6 1.4 2.7 3.2 2.7s3.3-.9 3.3-2.5M17 6v8M17 18v.2"/>',
        "p-sat": '<path ' + S + ' d="M3 12c1.5 0 1.5-5 3-5s1.5 10 3 10 1.5-10 3-10 1.5 10 3 10 1.5-5 3-5"/>',
        "p-limit": '<path ' + S + ' d="M4 6h16"/><path ' + S + ' d="M6 18c1.5 0 1.5-8 3-8s1.5 6 3 6 1.5-5 3-5 1.5 7 3 7"/>',
        "p-imager": '<path ' + S + ' d="M12 5v14M8.5 8.5L5 12l3.5 3.5M15.5 8.5L19 12l-3.5 3.5"/>',
        "p-doubler": '<path ' + S + ' d="M5 8c3 0 3 8 6 8M9 8c3 0 3 8 6 8"/><path ' + S + ' d="M13 8c3 0 3 8 6 8" opacity=".5"/>',
        "p-resonance": '<circle ' + S + ' cx="12" cy="12" r="2.4"/><circle ' + S + ' cx="12" cy="12" r="5.6" opacity=".7"/><circle ' + S + ' cx="12" cy="12" r="8.8" opacity=".4"/>',
        "p-crowd": '<circle cx="7" cy="9" r="2.2" fill="currentColor"/><circle cx="12" cy="8" r="2.4" fill="currentColor"/><circle cx="17" cy="9" r="2.2" fill="currentColor"/><path ' + S + ' d="M3.5 18c.5-3 2-4 3.500-4M8.5 18c.6-3.4 2-4.6 3.500-4.600M20.500 18c-.5-3-2-4-3.500-4M15.500 18c-.6-3.400-2-4.600-3.500-4.600"/>',
        "p-voice": '<path ' + S + ' d="M5 12h2.5l2-5 3.500 10 2.500-8 1.500 3H19"/>',
        "p-orbit": '<ellipse ' + S + ' cx="12" cy="12" rx="9" ry="4.2" transform="rotate(-25 12 12)"/><circle cx="12" cy="12" r="2" fill="currentColor"/>',
        "p-delay": '<circle cx="6" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="12" r="1.7" fill="currentColor" opacity=".65"/><circle cx="17.500" cy="12" r="1.400" fill="currentColor" opacity=".4"/><circle cx="21" cy="12" r="1" fill="currentColor" opacity=".25"/>',
        "p-reverb": '<path ' + S + ' d="M12 4.5c-4.700 0-8.500 3.400-8.500 7.500s3.800 7.500 8.500 7.500 8.500-3.400 8.500-7.500"/><path ' + S + ' d="M12 8.500c-2.500 0-4.500 1.700-4.500 3.500s2 3.500 4.500 3.500" opacity=".7"/>'
    };
    function VLI(name, size) {
        const body = P[name];
        if (!body) return "";
        const px = size || 18;
        return '<svg class="ico ico-' + name + '" width="' + px + '" height="' + px + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + body + "</svg>";
    }
    root.VLI = VLI;
    root.VLIcons = { names: Object.keys(P), svg: VLI };
})(typeof window !== "undefined" ? window : globalThis);
