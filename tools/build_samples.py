"""Build voxloop-studio/samples/<genre>/<type>/<n>.wav from the curated lists below.
Usage: build_samples.py <tdm machines dir> <vcsl dir> <out samples dir> <out js map file>"""
import sys, os, json, subprocess, wave, numpy as np
SR = 44100
T_DIR, V_DIR, OUT, MAPJS = sys.argv[1:5]
V = "Membranophones/Struck Membranophones/"; I = "Idiophones/Struck Idiophones/"
def t(machine, folder, fn): return ("T", f"{machine}/{machine.lower()}-{folder}/{fn}", f"{machine} {fn.rsplit('.',1)[0]}")
def v(sub, fn): return ("V", sub + "/" + fn, "Acoustic " + fn.rsplit('.',1)[0].replace('_Mid','').replace('_Sum','').replace('_',' '))
M = lambda m: m
SETS = {
 "afrobeats": {
  "kick":   [t("RolandTR808","bd","BD5025.WAV"), t("BossDR660","bd","TR808K.wav"), t("YamahaRY30","bd","Bassdrum-09.wav"), t("EmuSP12","bd","Bassdrum-01.wav"), t("AkaiMPC60","bd","0 Bassdrum.wav")],
  "snare":  [t("EmuSP12","sd","Snaredrum-05.wav"), t("RolandR8","sd","Snaredrum-08.wav"), t("AkaiMPC60","sd","Snare 2.wav"), t("YamahaRY30","sd","Snare13.wav"), t("AkaiXR10","sd","Snaredrum-06.wav")],
  "clap":   [t("LinnDrum","cp","Clap.wav"), t("RolandTR808","cp","cp2.wav"), t("EmuSP12","cp","Clap.wav"), t("AkaiMPC60","cp","Clap.wav"), v(I+"Claps","SoloClap_vl2.wav")],
  "rim":    [t("LinnDrum","rim","Sidestick-01.wav"), t("RolandTR808","rim","RS.WAV"), t("AlesisHR16","rim","Rim.wav"), t("OberheimDMX","rim","Rim Shot.wav"), t("RolandR8","rim","Rimshot2.wav")],
  "hat":    [t("LinnDrum","hh","Hat Closed-03.wav"), t("EmuSP12","hh","Hat Closed-01.wav"), t("AkaiMPC60","hh","Closed Hat.wav"), t("RolandTR808","hh","CH.WAV"), t("RolandR8","hh","Hat Closed.wav")],
  "openhat":[t("LinnDrum","oh","Hat Open.wav"), t("AkaiMPC60","oh","Open Hat.wav"), t("RolandTR808","oh","OH25.WAV"), t("EmuSP12","oh","Hhopen1.wav"), t("RolandTR626","oh","Hat Open.wav")],
  "shaker": [v(I+"Shaker, Small","Mid_ShakerLowFaster_Down_rr1.wav"), v(I+"Shaker, Large","LShaker_Hit_rr1_Mid.wav"), t("AlesisHR16","sh","Shaker.wav"), t("RolandTR727","sh","Maracas.wav"), v(I+"Cabasa","Cabasa1_Hit_rr1_Mid.wav")],
  "perc":   [v(V+"Conga","Conga_HitN_v2_rr1_Sum.wav"), v(V+"Bongos","BongoH_Hit1_v2_rr1_Mid.wav"), v(V+"Conga","Quinto_HitN_v2_rr1_Sum.wav"), v(V+"Conga","Tumba_HitN_v2_rr1_Sum.wav"), v(V+"Bongos","BongoL_Hit1_v2_rr1_Mid.wav")],
  "bell":   [v(I+"Cowbells","Cowbell1_Hit_v3_rr1_Mid.wav"), v(I+"Agogo Bells","Agogo_High_v2_rr1_Mid.wav"), v(I+"Agogo Bells","Agogo_Low_v2_rr1_Mid.wav"), v(I+"Claves","Claves1_Hit_v2_rr1_Mid.wav"), v(I+"Cowbells","Cowbell2_Muted_v2_rr1_Mid.wav")],
 },
 "amapiano": {
  "kick":   [t("BossDR660","bd","Rap K.wav"), t("BossDR660","bd","Dull K.wav"), t("YamahaRY30","bd","Bassdrum-13.wav"), t("RolandR8","bd","Bassdrum-07.wav"), t("RolandTR808","bd","BD2525.WAV")],
  "snare":  [t("RolandTR909","sd","sd12.wav"), t("RolandR8","sd","Snaredrum-05.wav"), t("EmuSP12","sd","Snaredrum-17.wav"), t("YamahaRY30","sd","Snare4.wav"), t("YamahaRY30","sd","Snare3.wav")],
  "clap":   [t("RolandTR909","cp","cp01.wav"), t("RolandTR909","cp","cp03.wav"), t("RolandTR707","cp","Clap.wav"), v(I+"Claps","Clap_rr2.wav"), v(I+"Claps","Clap_rr5.wav")],
  "rim":    [t("RolandTR909","rim","rs01.wav"), t("RolandTR707","rim","Rimshot.wav"), t("BossDR550","rim","Rim Shot.wav"), t("AkaiXR10","rim","Rim Shot-01.wav"), t("YamahaRY30","rim","Rimshot1.wav")],
  "hat":    [t("RolandTR909","hh","hh02.wav"), t("RolandTR909","hh","hh04.wav"), t("MPC1000","hh","MPC1000_909CHH_TL.wav"), t("RolandTR707","hh","Hat Closed.wav"), t("RolandTR626","hh","Hat Closed.wav")],
  "openhat":[t("RolandTR909","oh","oh02.wav"), t("RolandTR909","oh","Hat Open.wav"), t("MPC1000","oh","MPC1000_909OHH_TL.wav"), t("RolandTR707","oh","Hat Open.wav"), t("RolandTR909","oh","oh04.wav")],
  "shaker": [v(I+"Shaker, Small","Mid_ShakerLowFaster_Up_rr1.wav"), v(I+"Shaker, Small","Mid_ShakerHighFaster_Down_rr1.wav"), v(I+"Shaker, Large","LShaker_Shake1D_rr2_Mid.wav"), t("RolandTR626","sh","Shaker.wav"), v(I+"Cabasa","Cabasa1_Rub_v1_rr2_Mid.wav")],
  "perc":   [v(V+"Bongos","BongoH_HitMuted1_v2_rr1_Mid.wav"), v(V+"Bongos","BongoL_HitMuted2_v2_rr1_Mid.wav"), v(V+"Conga","Conga_HitN_v1_rr1_Sum.wav"), t("AkaiMPC60","perc","Bongo.wav"), v(V+"Conga","Quinto_HitN_v1_rr1_Sum.wav")],
  "bell":   [v(I+"Claves","Claves2_Hit_v2_rr1_Mid.wav"), v(I+"Claves","Claves1_Hit_v3_rr1_Mid.wav"), v(I+"Woodblock","wood_click_mp.wav"), v(I+"Agogo Bells","Agogo_High_v1_rr1_Mid.wav"), v(I+"Triangles","Triangle3_HitFM_v2_rr1_Mid.wav")],
 },
 "afrohouse": {
  "kick":   [t("RolandTR909","bd","Bassdrum-02.wav"), t("RolandTR909","bd","Bassdrum-03.wav"), t("RolandTR909","bd","Bassdrum-04.wav"), t("RolandTR909","bd","Bassdrum-01.wav"), t("BossDR660","bd","909HdK.wav")],
  "snare":  [t("RolandTR909","sd","sd04.wav"), t("RolandTR909","sd","sd13.wav"), t("RolandTR909","sd","sd09.wav"), t("RolandTR909","sd","sd01.wav"), t("RolandTR909","sd","sd15.wav")],
  "clap":   [t("RolandTR909","cp","Clap.wav"), t("RolandTR909","cp","cp02.wav"), t("RolandTR909","cp","cp04.wav"), t("BossDR550","cp","Clap.wav"), t("RolandR8","cp","Clap.wav")],
  "rim":    [t("RolandTR909","rim","Rimhot.wav"), t("RolandTR909","rim","rs02.wav"), t("RolandTR626","rim","Rimshot.wav"), t("EmuSP12","rim","zRim Shot-01.wav"), t("RolandR8","rim","Rimshot1.wav")],
  "hat":    [t("RolandTR909","hh","hh01.wav"), t("RolandTR909","hh","hh03.wav"), t("RolandTR808","hh","CH.WAV"), t("AkaiXR10","hh","Hat Closed.wav"), t("BossDR550","hh","Hat Closed-02.wav")],
  "openhat":[t("RolandTR909","oh","oh01.wav"), t("RolandTR909","oh","oh03.wav"), t("BossDR550","oh","Hat Open-02.wav"), t("RolandCompurhythm78","oh","Hat Open-01.wav"), t("AkaiXR10","oh","Hat Open.wav")],
  "shaker": [v(I+"Tambourine 1","Tamb1_Shake_rr1_Mid.wav"), v(I+"Tambourine 2","Tamb2_Shake_rr3_Mid.wav"), v(I+"Cabasa","Cabasa1_Hit_rr2_Mid.wav"), t("RolandTR727","sh","Cabasa.wav"), t("AlesisHR16","sh","Maracas.wav")],
  "perc":   [v(V+"Conga","Conga_HitN_v3_rr1_Sum.wav"), v(V+"Conga","Tumba_HitN_v3_rr1_Sum.wav"), v(V+"Conga","Quinto_HitN_v3_rr2_Sum.wav"), v(V+"Bongos","BongoH_Hit1_v3_rr1_Mid.wav"), t("LinnDrum","perc","Conga M-01.wav")],
  "bell":   [v(I+"Cowbells","Cowbell1_Hit_v4_rr1_Mid.wav"), v(I+"Cowbells","Cowbell2_Normal_v2_rr1_Mid.wav"), v(I+"Agogo Bells","Agogo_Low_v1_rr1_Mid.wav"), v(I+"Brake Drum","BrakeDrum1_Hammer_v2_rr1_Mid.wav"), v(I+"Cowbells","Cowbell1_Muted_v2_rr1_Mid.wav")],
 },
 "rnb": {
  "kick":   [t("LinnDrum","bd","Bassdrum.wav"), t("OberheimDMX","bd","Bassdrum-02.wav"), t("RolandTR808","bd","BD0025.WAV"), t("EmuSP12","bd","Bassdrum-03.wav"), t("AlesisHR16","bd","Bassdrum.wav")],
  "snare":  [t("OberheimDMX","sd","Snaredrum-02.wav"), t("OberheimDMX","sd","Snaredrum-01.wav"), t("EmuSP12","sd","Snaredrum-09.wav"), t("RolandTR707","sd","Snaredrum-01.wav"), t("AkaiMPC60","sd","Snare 3.wav")],
  "clap":   [t("OberheimDMX","cp","Clap.wav"), t("RolandTR808","cp","cp4.WAV"), t("RolandTR626","cp","Clap.wav"), t("AlesisHR16","cp","Clap.wav"), v(I+"Claps","SoloClap_vl1.wav")],
  "rim":    [t("LinnDrum","rim","Sidestick-03.wav"), t("RolandR8","rim","Rimshot1.wav"), t("RolandTR707","rim","Rimshot.wav"), t("EmuSP12","rim","zRim Shot-02.wav"), t("AkaiMPC60","rim","Rim Gated.wav")],
  "hat":    [t("OberheimDMX","hh","Hat Closed.wav"), t("RolandTR707","hh","Hat Closed.wav"), t("LinnDrum","hh","Hat Closed-01.wav"), t("EmuSP12","hh","Hat Closed-02.wav"), t("YamahaRY30","hh","Hat Closed-01.wav")],
  "openhat":[t("OberheimDMX","oh","Hat Open.wav"), t("RolandTR707","oh","Hat Open.wav"), t("AlesisHR16","oh","Open Hat.wav"), t("RolandR8","oh","Hat Open.wav"), t("RolandCompurhythm78","oh","Hat Open-02.wav")],
  "shaker": [t("LinnDrum","sh","Cabasa.wav"), t("OberheimDMX","sh","Cabasa.wav"), v(I+"Shaker, Small","Mid_ShakerDouble_Up_rr1.wav"), v(I+"Tambourine 1","Tamb1_Shake_rr2_Mid.wav"), t("YamahaRY30","sh","Cabasa-01.wav")],
  "perc":   [v(V+"Conga","Conga_HitN_v2_rr2_Sum.wav"), v(V+"Bongos","BongoH_Hit1_v1_rr1_Mid.wav"), t("LinnDrum","perc","Conga M-01.wav"), v(I+"Cajon","Cajon_hit1_mp_rr1.wav"), v(V+"Conga","Tumba_HitN_v1_rr2_Sum.wav")],
  "bell":   [v(I+"Triangles","Triangle6_HitM_v2_rr2_Mid.wav"), v(I+"Hand Chimes","sus_C6_r01_main.wav"), v(I+"Triangles","Triangle3_HitM_v2_rr1_Mid.wav"), v(I+"Agogo Bells","Agogo_High_v3_rr1_Mid.wav"), v(I+"Claves","Claves2_Hit_v1_rr1_Mid.wav")],
 },
 "trap": {
  "kick":   [t("RolandTR808","bd","BD7525.WAV"), t("RolandTR808","bd","BD5010.WAV"), t("RolandTR808","bd","BD2575.WAV"), t("RolandTR808","bd","BD7510.WAV"), t("BossDR660","bd","Hard K.wav")],
  "snare":  [t("RolandTR808","sd","SD2525.WAV"), t("RolandTR808","sd","SD5050.WAV"), t("RolandTR808","sd","SD1050.WAV"), t("BossDR660","sd","TR808S.wav"), t("BossDR660","sd","Hard S.wav")],
  "clap":   [t("RolandTR808","cp","cp0.wav"), t("RolandTR808","cp","cp1.wav"), t("RolandTR808","cp","cp2.wav"), t("RolandTR808","cp","cp3.wav"), t("RolandTR808","cp","cp4.WAV")],
  "rim":    [t("RolandTR808","rim","RS.WAV"), t("BossDR660","rim","808Stk.wav"), t("RolandTR909","rim","rs01.wav"), t("RolandTR909","rim","Rimhot.wav"), t("BossDR660","rim","MtlStk.wav")],
  "hat":    [t("RolandTR808","hh","CH.WAV"), t("BossDR660","hh","808CHH.wav"), t("RolandTR909","hh","hh01.wav"), t("RolandTR909","hh","hh03.wav"), t("BossDR660","hh","BrsCHH.wav")],
  "openhat":[t("RolandTR808","oh","OH00.WAV"), t("RolandTR808","oh","OH25.WAV"), t("RolandTR808","oh","OH50.WAV"), t("RolandTR808","oh","OH75.WAV"), t("RolandTR808","oh","OH10.WAV")],
  "shaker": [t("RolandTR808","sh","MA.WAV"), t("RolandTR808","sh","Cabasa.wav"), t("RolandTR727","sh","Maracas.wav"), t("BossDR660","sh","0Shaker.wav"), t("BossDR660","sh","CabaDn.wav")],
  "perc":   [t("RolandTR808","perc","HC25.WAV"), t("RolandTR808","perc","LC25.WAV"), t("RolandTR808","perc","MC25.WAV"), t("RolandTR808","perc","CL.WAV"), t("RolandTR808","ht","HT25.WAV")],
  "bell":   [t("RolandTR808","cb","CB.WAV"), t("RolandTR808","cb","Cowbell.wav"), t("BossDR660","cb","808Cow.wav"), t("BossDR660","cb","78Cow.wav"), t("BossDR660","cb","Cowbell.wav")],
 },
}
# per type: max seconds kept, RMS target (dBFS over the first 120 ms), peak ceiling dBFS
SPEC = {"kick": (0.80, -14, -1.5), "snare": (0.40, -15, -1.5), "clap": (0.38, -16, -1.5), "rim": (0.18, -17, -1.5),
        "hat": (0.14, -21, -1.5), "openhat": (0.55, -21, -1.5), "shaker": (0.22, -21, -1.5), "perc": (0.50, -17, -1.5), "bell": (0.70, -19, -1.5)}
def load(path):
    p = subprocess.run(["ffmpeg","-v","error","-i",path,"-ac","1","-ar",str(SR),"-f","f32le","-"],capture_output=True)
    return np.frombuffer(p.stdout, dtype=np.float32).copy()
def process(x, typ):
    maxs, rms_t, pk_c = SPEC[typ]
    from scipy.signal import butter, sosfilt
    x = x - np.median(x)
    if typ not in ("kick",):                       # remove sub-bass rumble / DC drift in everything but kicks
        x = sosfilt(butter(2, 30, "highpass", fs=SR, output="sos"), x).astype(np.float32)
    else:
        x = sosfilt(butter(1, 15, "highpass", fs=SR, output="sos"), x).astype(np.float32)
    pk = np.max(np.abs(x)); thr = pk * 10**(-48/20)
    idx = np.where(np.abs(x) > thr)[0]; s = max(0, idx[0] - int(0.001*SR))
    x = x[s:]
    n = min(len(x), int(maxs*SR)); x = x[:n].copy()
    f = min(int(0.04*SR), n//3); x[-f:] *= np.linspace(1, 0, f)**2          # tail fade
    a = int(0.0008*SR); x[:a] *= np.linspace(0, 1, a)                       # tiny fade-in against clicks
    seg = x[:int(0.12*SR)]; rms = np.sqrt(np.mean(seg**2)) + 1e-9
    g = min(10**(rms_t/20)/rms, 10**(pk_c/20)/np.max(np.abs(x)))
    x = x*g
    # trim silent tail
    e = np.where(np.abs(x) > 10**(-70/20))[0]
    if len(e): x = x[:e[-1]+1]
    return x
def write(path, x):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((np.clip(x, -1, 1)*32767).astype("<i2").tobytes())
info = {}; total = 0
for genre, types in SETS.items():
    info[genre] = {}
    for typ, items in types.items():
        assert len(items) == 5, (genre, typ)
        info[genre][typ] = []
        for i, (src, rel, label) in enumerate(items, 1):
            path = os.path.join(T_DIR if src == "T" else V_DIR, rel)
            if not os.path.exists(path): raise SystemExit("MISSING " + path)
            x = process(load(path), typ)
            out = os.path.join(OUT, genre, typ, f"{i}.wav"); write(out, x); total += os.path.getsize(out)
            info[genre][typ].append(label)
with open(MAPJS, "w") as f:
    f.write("// Generated by the sample build script. The display name of every file in samples/<genre>/<type>/<n>.wav\n")
    f.write("const SAMPLE_LABELS = " + json.dumps(info, indent=1) + ";\n")
print("ok", total/1e6, "MB")
