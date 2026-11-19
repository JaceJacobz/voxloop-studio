#!/usr/bin/env python3
"""Adds REAL log drum recordings as the instrument "log-drum" (run from the project root):

    python3 tools/add_logdrum.py <folder-with-recordings> ["licence / source note"]

 - Put one recording per note in the folder (wav, mp3, flac, aiff). Name each file with its note, e.g. C2.wav,
   F#1.wav, Log Drum G2.wav, or its MIDI number (36.wav). If a name has no note, the pitch is measured from the sound.
 - 6 or more different notes work best, spread over about two octaves (the app re-pitches a few semitones).
 - It trims, levels and encodes them, registers "log-drum" in the instrument library, gives it a starting level
   (matched to the marimba stand-in), teaches the producer to prefer it for the amapiano log drum, rebuilds
   fileaudio/ and the service worker. Safe to run again: it replaces the previous log-drum.
 - Then listen once and tell me if the level or the notes need adjusting."""
import json, os, re, shutil, subprocess, sys
import numpy as np

SR = 44100
NAMES = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}

def decode(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype="<f4").copy()

def midi_from_name(fn):
    base = os.path.splitext(os.path.basename(fn))[0]
    m = re.search(r"(?<![A-Za-z])([A-Ga-g])([#b]?)(-?\d)(?!\d)", base)
    if m:
        n = NAMES[m.group(1).upper()] + (1 if m.group(2) == "#" else -1 if m.group(2) == "b" else 0)
        return 12 * (int(m.group(3)) + 1) + n
    m = re.search(r"(?<!\d)(\d{2,3})(?!\d)", base)
    if m and 12 <= int(m.group(1)) <= 108:
        return int(m.group(1))
    return None

def measure_midi(x):
    seg = x[int(0.02 * SR): int(0.52 * SR)]
    seg = seg * np.hanning(len(seg))
    spec = np.abs(np.fft.rfft(seg, 1 << 17)); freqs = np.fft.rfftfreq(1 << 17, 1 / SR)
    hps = spec.copy()
    for h in (2, 3):
        d = spec[::h]; hps[:len(d)] *= d
    lo, hi = np.searchsorted(freqs, 30), np.searchsorted(freqs, 500)
    f = freqs[lo + int(np.argmax(hps[lo:hi]))]
    return int(round(69 + 12 * np.log2(f / 440)))

def process(x, secs=1.5):
    x = x - np.mean(x)
    peak = np.max(np.abs(x)) or 1.0
    on = np.argmax(np.abs(x) > 0.02 * peak)                 # start at the hit, not at the silence before it
    x = x[max(0, on - int(0.004 * SR)):][: int(secs * SR)]
    fade = int(0.15 * SR)
    if len(x) > fade: x[-fade:] *= np.linspace(1, 0, fade)
    return x * (0.89 / (np.max(np.abs(x)) or 1.0))

def rms_db(x):
    return 10 * np.log10(np.mean(x ** 2) + 1e-12)

def write_mp3(path, x):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "-", "-c:a", "libmp3lame", "-b:a", "96k", path], input=x.astype("<f4").tobytes(), check=True)

def main():
    if len(sys.argv) < 2 or not os.path.isdir(sys.argv[1]):
        sys.exit(__doc__)
    folder, note = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else "supplied by the project owner")
    files = sorted(f for f in os.listdir(folder) if f.lower().endswith((".wav", ".mp3", ".flac", ".aif", ".aiff", ".ogg")))
    notes = {}
    for f in files:
        x = decode(os.path.join(folder, f))
        if len(x) < SR * 0.1: print("skipped (too short):", f); continue
        m = midi_from_name(f)
        how = "name"
        if m is None: m, how = measure_midi(x), "measured"
        if m in notes: print("skipped (same note as another file):", f, m); continue
        notes[m] = process(x)
        print("%-40s note %3d (%s)" % (f, m, how))
    if len(notes) < 3:
        sys.exit("Need at least 3 different notes; found %d." % len(notes))
    midis = sorted(notes)
    out = "samples/instruments/log-drum"
    shutil.rmtree(out, ignore_errors=True)
    for m in midis: write_mp3("%s/%d.mp3" % (out, m), notes[m])

    # level: match the marimba stand-in (same loudness in the mix as before)
    ref = []
    for f in os.listdir("samples/instruments/marimba"):
        ref.append(rms_db(decode("samples/instruments/marimba/" + f)[: int(1.5 * SR)]))
    mine = np.mean([rms_db(notes[m]) for m in midis])
    lvl = float(round(8.8 + (np.mean(ref) - mine), 1))

    s = open("js/instrumentmap.js").read()
    lib = json.loads(s[s.index("= ") + 2: s.rindex(";")])
    lib["log-drum"] = {"name": "Log drum", "kind": "decay", "ext": "mp3", "notes": midis}
    head = s[: s.index("const INSTRUMENT_LIBRARY")]
    open("js/instrumentmap.js", "w").write(head + "const INSTRUMENT_LIBRARY = " + json.dumps(lib, indent=1) + ";\n")

    b = open("js/instrumentbank.js").read()
    m = re.search(r"const SAMPLED_LEVEL = (\{.*?\});\n", b)
    table = json.loads(m.group(1)); table["log-drum"] = {"log": lvl}
    b = b.replace(m.group(0), "const SAMPLED_LEVEL = " + json.dumps(table, separators=(",", ":")) + ";\n", 1)
    b = re.sub(r'(log:\s+\{[^}]*?ama: ")[a-z0-9-]+(")', r'\1log-drum\2', b, count=1)
    open("js/instrumentbank.js", "w").write(b)

    p = open("js/producer.js").read()
    p = re.sub(r'  "log-drum":.*?\}\),\n', "", p, flags=re.S)          # replace an earlier one
    entry = '''  "log-drum": _I("perc", { log: 1.5 },
    { afrobeats: .6, amapiano: 1.6, afrohouse: .8, rnb: .05, trap: .05 },
    { party: 1, uplifting: .9, chill: .8, dreamy: .7, soulful: .7, romantic: .5, dark: .5, hard: .3 },
    { why: "the log drum is the amapiano signature, a real recording" }),
'''
    assert '  "marimba":' in p
    p = p.replace('  "marimba":', entry + '  "marimba":', 1)
    open("js/producer.js", "w").write(p)

    with open("samples/CREDITS.md", "a") as c:
        c.write("\n## Log drum (log-drum)\nFiles: %s. Notes (MIDI): %s. Source / licence: %s.\n" % (", ".join(files), midis, note))
    subprocess.check_call([sys.executable, "tools/build_fileaudio.py"])
    subprocess.check_call([sys.executable, "tools/build-sw.py"])
    print("\nlog-drum added: %d notes %s, starting level %.1f dB. Reload the app and make a few amapiano beats." % (len(midis), midis, lvl))

main()
