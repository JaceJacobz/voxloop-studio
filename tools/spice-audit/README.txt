Spice audit tools (not part of the app). They stand in for listening: they draw beats and measure them.
Serve the app (python3 -m http.server 8768 from the app folder), then from this folder:
  node dump.js 8768 out.json '[{"genre":"afrobeats","style":"afroswing","seed":11}]'   writes every bar of those beats
  python3 roll.py out.json pngdir                                                      draws each beat as a note grid (one PNG each)
  node audit.js 8768 8 > audit.json                                                    8 beats per style, all 28 styles: checks the bars are valid,
                                                                                       the spice is audible, the backbeat survives, the next beat differs
Needs node with playwright, and python3 with numpy + matplotlib.
