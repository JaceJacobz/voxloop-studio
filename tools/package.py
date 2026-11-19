#!/usr/bin/env python3
"""Builds the two downloads from the project (run from the project root):
   python3 tools/package.py 2.6.0 <out_dir>
 - folder edition: for double-clicking index.html. Audio only as fileaudio/*.js (no samples/*.mp3|wav).
 - web edition:    for hosting online.       Audio only as samples/ (no fileaudio/).
Both skip the dev scripts in tools/*.js and the tests."""
import os, subprocess, sys, zipfile
version, out = sys.argv[1], sys.argv[2]
subprocess.check_call([sys.executable, "tools/build_fileaudio.py"])
subprocess.check_call([sys.executable, "tools/build-sw.py"])
def build(name, skip):
    path = os.path.join(out, "voxloop-studio-%s-%s.zip" % (version, name))
    if os.path.exists(path): os.remove(path)
    n = 0
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for root, dirs, files in os.walk("."):
            dirs[:] = [d for d in dirs if d not in (".git", "node_modules", "tests")]
            for f in files:
                p = os.path.join(root, f)[2:]
                if skip(p): continue
                z.write(p, "voxloop-studio/" + p); n += 1
    print(name, n, "files", round(os.path.getsize(path) / 1e6, 1), "MB")
audio = (".mp3", ".wav")
build("folder", lambda p: (p.startswith("samples/") and p.endswith(audio)) or (p.startswith("tools/") and p.endswith(".js")))
build("web", lambda p: p.startswith("fileaudio/") or (p.startswith("tools/") and p.endswith(".js")))
