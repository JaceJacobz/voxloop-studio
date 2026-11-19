"""Build voxloop-studio/samples/instruments/<id>/<n>.mp3|wav + js/instrumentmap.js
Usage: build_instruments.py <tji dir> <vcsl dir> <tdm machines dir> <out samples dir> <out js map file>"""
import sys, os, re, json, subprocess, wave, numpy as np
TJI, VCSL, TDM, OUT, MAPJS = sys.argv[1:6]
NOTE = {"C":0,"Cs":1,"C#":1,"D":2,"Ds":3,"D#":3,"E":4,"F":5,"Fs":6,"F#":6,"G":7,"Gs":8,"G#":8,"A":9,"As":10,"A#":10,"B":11}
def name2midi(n):
    m = re.match(r"([A-G][s#]?)(\d)$", n); return 12*(int(m.group(2))+1) + NOTE[m.group(1)]
SR = 44100
def load(path, sr=SR):
    r = subprocess.run(["ffmpeg","-v","error","-i",path,"-ac","1","-ar",str(sr),"-f","f32le","-"], capture_output=True)
    return np.frombuffer(r.stdout, dtype=np.float32).copy()

def tji(i):
    d = os.path.join(TJI, "samples", i)
    return {name2midi(f[:-4]): os.path.join(d, f) for f in os.listdir(d) if re.fullmatch(r"[A-G]s?\d\.mp3", f)}
def vcsl(sub, regex, prefer=None):
    d = os.path.join(VCSL, sub); out = {}
    for dp, _, fs in os.walk(d):
        for f in sorted(fs):
            m = re.search(regex, os.path.join(os.path.relpath(dp, d), f))
            if m and f.lower().endswith(".wav"):
                out.setdefault(name2midi(m.group(1)), os.path.join(dp, f))
    return out

I = "Idiophones/Plucked Idiophones/"; S = "Idiophones/Struck Idiophones/"
# id: (display name, notes{midi:path}, kind, seconds kept, spacing semitones, target RMS dBFS)
LIB = {
 "piano":      ("Grand piano",      tji("piano"),          "decay",   4.0, 4, -20),
 "epiano":     ("Electric piano",   vcsl("Electrophones/TX81Z/FM Piano", r"FMPiano_([A-G]#?\d)_vl2"), "decay", 3.5, 4, -20),
 "organ":      ("Organ",            tji("organ"),          "sustain", 4.0, 5, -22),
 "harmonium":  ("Harmonium",        tji("harmonium"),      "sustain", 4.0, 4, -22),
 "guitar-nylon":("Nylon guitar",    tji("guitar-nylon"),   "decay",   3.0, 4, -20),
 "guitar-acoustic":("Acoustic guitar", tji("guitar-acoustic"), "decay", 3.0, 4, -20),
 "guitar-electric":("Clean electric guitar", tji("guitar-electric"), "decay", 3.0, 4, -20),
 "harp":       ("Harp",             tji("harp"),           "decay",   3.0, 4, -20),
 "vibraphone": ("Vibraphone",       vcsl(S+"Vibraphone", r"Hard Mallets.Vibes_hard_([A-G]#?\d)_v2_rr1"), "decay", 3.5, 4, -21),
 "violin":     ("Violin",           tji("violin"),         "sustain", 4.5, 3, -22),
 "cello":      ("Cello",            tji("cello"),          "sustain", 4.5, 4, -22),
 "trumpet":    ("Trumpet",          tji("trumpet"),        "sustain", 3.5, 3, -21),
 "saxophone":  ("Saxophone",        tji("saxophone"),      "sustain", 3.5, 4, -21),
 "flute":      ("Flute",            tji("flute"),          "sustain", 3.5, 3, -21),
 "clarinet":   ("Clarinet",         tji("clarinet"),       "sustain", 3.5, 3, -21),
 "french-horn":("French horn",      tji("french-horn"),    "sustain", 4.0, 3, -22),
 "trombone":   ("Trombone",         tji("trombone"),       "sustain", 3.5, 4, -22),
 "kalimba":    ("Kalimba",          vcsl(I+"Kalimba, Tanzania", r"_Main_([A-G]#?\d)_"), "decay", 2.5, 4, -20),
 "mbira":      ("Mbira",            vcsl(I+"Mbira dzaVadzimu Nyamaropa, Zimbabwe, Low B", r"_Main_([A-G]#?\d)_"), "decay", 2.5, 4, -20),
 "marimba":    ("Marimba",          vcsl(S+"Marimba", r"Outrigger_([A-G]#?\d)_med_01"), "decay", 2.5, 4, -20),
 "balafon":    ("Balafon",          vcsl(S+"Balafon", r"Hard Mallet.EthnicXylo_hardM_([A-G]#?\d)_vl2_rr1"), "decay", 2.0, 4, -20),
 "xylophone":  ("Xylophone",        tji("xylophone"),      "decay",   2.0, 4, -21),
 "glockenspiel":("Glockenspiel",    vcsl(S+"Glockenspiel", r"glock_medium_([A-G]#?\d)_01"), "decay", 2.5, 4, -22),

 "bass-electric":("Electric bass",  tji("bass-electric"),  "decay",   3.0, 5, -19),
 "upright-bass":("Upright bass",    tji("contrabass"),     "sustain", 3.0, 5, -19),
 "tuba":       ("Tuba",             tji("tuba"),           "sustain", 3.0, 5, -20),
}
# 808 sub bass: a long TR-808 kick played as a pitched bass. (name, file, measured root frequency Hz)
EIGHT = {
 "808-boom":  ("808 boom",  "RolandTR808/rolandtr808-bd/BD0010.WAV", 2.2),
 "808-punch": ("808 punch", "RolandTR808/rolandtr808-bd/BD5010.WAV", 2.2),
 "808-deep":  ("808 deep",  "RolandTR808/rolandtr808-bd/BD2510.WAV", 2.2),
}
# notes whose recorded pitch did not match their label in the pitch check are left out
EXCLUDE = {"french-horn": [74, 77], "clarinet": [90], "mbira": [34], "kalimba": [76, 80, 85], "violin": [55], "glockenspiel": [84, 91, 96]}
def pick_notes(notes, spacing):
    ms = sorted(notes); keep = [ms[0]]
    for m in ms[1:]:
        if m - keep[-1] >= spacing: keep.append(m)
    if keep[-1] != ms[-1] and ms[-1] - keep[-1] >= 2: keep.append(ms[-1])
    return keep
def rms_db(x):
    if len(x) < 100: return -120
    w = int(0.5 * SR); best = 1e-9
    for s in range(0, max(1, min(len(x), int(1.5*SR)) - w), w // 4):
        best = max(best, np.sqrt(np.mean(x[s:s+w]**2)))
    return 20*np.log10(best)
def process(x, secs, kind, target):
    x = x - np.median(x)
    pk = np.max(np.abs(x)); idx = np.where(np.abs(x) > pk * 10**(-50/20))[0]
    x = x[max(0, idx[0] - int(0.004*SR)):]
    x = x[:int(secs*SR)].copy()
    fo = min(int(0.25*SR if kind == "sustain" else 0.4*SR), len(x)//2); x[-fo:] *= np.linspace(1, 0, fo)**2
    a = int(0.002*SR); x[:a] *= np.linspace(0, 1, a)
    g = 10**((target - rms_db(x))/20)
    g = min(g, 10**(-1.5/20)/np.max(np.abs(x)))
    return x*g
def write_mp3(path, x):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    pcm = (np.clip(x, -1, 1)).astype("<f4").tobytes()
    subprocess.run(["ffmpeg","-v","error","-y","-f","f32le","-ar",str(SR),"-ac","1","-i","-","-c:a","libmp3lame","-b:a","64k",path], input=pcm, check=True)
def write_wav(path, x, sr):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes((np.clip(x,-1,1)*32767).astype("<i2").tobytes())
manifest = {}; total = 0
for iid, (name, notes, kind, secs, spacing, target) in LIB.items():
    assert notes, iid
    notes = {m: p for m, p in notes.items() if m not in EXCLUDE.get(iid, [])}
    keep = pick_notes(notes, spacing); entry = {"name": name, "kind": kind, "ext": "mp3", "notes": keep}
    for m in keep:
        x = process(load(notes[m]), secs, kind, target)
        p = os.path.join(OUT, iid, f"{m}.mp3"); write_mp3(p, x); total += os.path.getsize(p)
    manifest[iid] = entry
    print(iid, len(keep), "notes", min(keep), "-", max(keep))
def steady_808(x, sr, secs):
    """The TR-808 kick glides down in pitch for its first ~0.4 s, so short bass notes played from it come out sharp.
    This keeps the recording's own click and its own loudness shape, but carries the note on the steady part of the
    same recording (cycle-aligned and looped), so the pitch is constant from the start."""
    x = x - np.median(x)
    pk = int(np.argmax(np.abs(x)))
    x = x[pk:]
    seg = x[int(0.55*sr):int(1.5*sr)]
    zc = [i for i in range(1, len(seg)) if seg[i-1] <= 0 < seg[i]]
    zc = [i - seg[i]/(seg[i]-seg[i-1]) for i in zc]
    K = max(2, int(0.35 / ((zc[-1]-zc[0]) / (len(zc)-1) / sr)))          # about 0.35 s of whole cycles
    a, b = zc[0], zc[K]
    period = (b - a) / K / sr; f0 = 1 / period
    cyc = np.interp(np.arange(a, b), np.arange(len(seg)), seg)
    cyc = cyc / np.sqrt(np.mean(cyc**2))
    n = int(secs*sr); L = len(cyc)
    # every cycle in the loop is whole, so tiling is click free
    carrier = np.tile(cyc, n // L + 1)[:n]
    env = np.convolve(np.abs(x[:n]), np.ones(int(0.012*sr))/int(0.012*sr), mode="same")[:n] * np.pi/2
    out = carrier * env
    click = int(0.012*sr)
    out[:click] = x[:click]*np.linspace(1, 0, click) + out[:click]*np.linspace(0, 1, click)
    return out, f0
for iid, (name, rel, secs) in EIGHT.items():
    x = load(os.path.join(TDM, rel), 22050)
    x, hz = steady_808(x, 22050, secs)
    midi = 69 + 12*np.log2(hz/440)
    x = x.copy(); f = int(0.3*22050); x[-f:] *= np.linspace(1,0,f)**2
    x *= min(10**(-1.5/20)/np.max(np.abs(x)), 10**(-14/20)/np.sqrt(np.mean(x[:22050]**2)))
    p = os.path.join(OUT, iid, "root.wav"); write_wav(p, x, 22050); total += os.path.getsize(p)
    manifest[iid] = {"name": name, "kind": "808", "ext": "wav", "notes": [round(float(midi), 2)], "rate": 22050}
    print(iid, "root midi %.2f (%.1f Hz)" % (midi, hz))
with open(MAPJS, "w") as f:
    f.write("// Generated by tools/build_instruments.py. Every recorded instrument: its name, kind and the notes (MIDI) that were sampled.\n")
    f.write("const INSTRUMENT_LIBRARY = " + json.dumps(manifest, indent=1) + ";\n")
print("ok %.1f MB" % (total/1e6))
