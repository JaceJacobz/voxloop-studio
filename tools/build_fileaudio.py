#!/usr/bin/env python3
"""Makes fileaudio/<path>.js for every file in samples/ so the app also works when index.html is opened straight from
a folder (file://), where browsers refuse to fetch audio. Each file sets window.__VLA["<path>"] = "<base64>".
Run from the project root: python3 tools/build_fileaudio.py"""
import base64, os, shutil
OUT = "fileaudio"
shutil.rmtree(OUT, ignore_errors=True)
n = 0
for root, _, files in os.walk("samples"):
    for f in files:
        if not f.lower().endswith((".mp3", ".wav")):
            continue
        src = os.path.join(root, f)
        key = src.replace(os.sep, "/")
        dst = os.path.join(OUT, key + ".js")
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        with open(src, "rb") as fh:
            b64 = base64.b64encode(fh.read()).decode("ascii")
        with open(dst, "w") as out:
            out.write('(window.__VLA=window.__VLA||{})["%s"]="%s";' % (key, b64))
        n += 1
print(n, "files in", OUT)
