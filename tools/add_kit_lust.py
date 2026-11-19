#!/usr/bin/env python3
"""Builds samples/afrolust/ (the Afro-Lust drum kit) by picking soft, round, warm one-shots from the existing kits.
Run from the project folder:  python3 tools/add_kit_lust.py
It copies WAVs and adds the kit's names to js/samplemap.js. Safe to run again."""
import json, os, re, shutil
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAP = os.path.join(ROOT, "js", "samplemap.js")
src = open(MAP).read()
m = re.search(r"const SAMPLE_LABELS = (\{.*?\n\});", src, re.S)
labels = json.loads(m.group(1))

def name(g, t, label):
    return labels[g][t].index(label) + 1

# (source kit, label) per type: soft, round, warm. Hat and open hat are the quiet drum-machine ones; the percussion
# is conga / tumba / quinto (low, wooden); the bell family is triangle / claves / agogo (small and dry).
PICK = {
 "kick":    [("rnb", "LinnDrum Bassdrum"), ("rnb", "OberheimDMX Bassdrum-02"), ("rnb", "RolandTR808 BD0025"), ("afrobeats", "YamahaRY30 Bassdrum-09"), ("amapiano", "BossDR660 Dull K")],
 "snare":   [("rnb", "OberheimDMX Snaredrum-02"), ("rnb", "OberheimDMX Snaredrum-01"), ("rnb", "EmuSP12 Snaredrum-09"), ("rnb", "AkaiMPC60 Snare 3"), ("afrobeats", "AkaiMPC60 Snare 2")],
 "clap":    [("rnb", "OberheimDMX Clap"), ("rnb", "RolandTR626 Clap"), ("rnb", "AlesisHR16 Clap"), ("rnb", "Acoustic SoloClap vl1"), ("afrobeats", "Acoustic SoloClap vl2")],
 "rim":     [("rnb", "LinnDrum Sidestick-03"), ("rnb", "EmuSP12 zRim Shot-02"), ("rnb", "AkaiMPC60 Rim Gated"), ("afrobeats", "AlesisHR16 Rim"), ("afrobeats", "LinnDrum Sidestick-01")],
 "hat":     [("rnb", "OberheimDMX Hat Closed"), ("rnb", "LinnDrum Hat Closed-01"), ("rnb", "EmuSP12 Hat Closed-02"), ("rnb", "RolandTR707 Hat Closed"), ("rnb", "YamahaRY30 Hat Closed-01")],
 "openhat": [("rnb", "OberheimDMX Hat Open"), ("rnb", "RolandTR707 Hat Open"), ("rnb", "AlesisHR16 Open Hat"), ("rnb", "RolandR8 Hat Open"), ("rnb", "RolandCompurhythm78 Hat Open-02")],
 "shaker":  [("afrobeats", "Acoustic Mid ShakerLowFaster Down rr1"), ("afrobeats", "Acoustic LShaker Hit rr1"), ("rnb", "Acoustic Mid ShakerDouble Up rr1"), ("rnb", "Acoustic Tamb1 Shake rr2"), ("afrobeats", "Acoustic Cabasa1 Hit rr1")],
 "perc":    [("afrobeats", "Acoustic Conga HitN v2 rr1"), ("afrobeats", "Acoustic Tumba HitN v2 rr1"), ("afrobeats", "Acoustic Quinto HitN v2 rr1"), ("rnb", "Acoustic Conga HitN v2 rr2"), ("rnb", "Acoustic Tumba HitN v1 rr2")],
 "bell":    [("rnb", "Acoustic Triangle6 HitM v2 rr2"), ("afrobeats", "Acoustic Claves1 Hit v2 rr1"), ("afrobeats", "Acoustic Agogo Low v2 rr1"), ("rnb", "Acoustic Triangle3 HitM v2 rr1"), ("rnb", "Acoustic Claves2 Hit v1 rr1")],
}
new = {}
for t, picks in PICK.items():
    d = os.path.join(ROOT, "samples", "afrolust", t)
    os.makedirs(d, exist_ok=True)
    new[t] = []
    for i, (g, label) in enumerate(picks, 1):
        n = name(g, t, label)
        shutil.copyfile(os.path.join(ROOT, "samples", g, t, "%d.wav" % n), os.path.join(d, "%d.wav" % i))
        new[t].append(label)
labels["afrolust"] = new
body = json.dumps(labels, indent=1)
src = src[:m.start(1)] + body + src[m.end(1):]
open(MAP, "w").write(src)
print("afrolust kit:", sum(len(v) for v in new.values()), "files")
