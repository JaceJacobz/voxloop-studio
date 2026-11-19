# Drum & percussion samples used by Beat Lab

Each genre has 5 samples per type (kick, snare, clap, rim, hat, open hat, shaker, percussion, bell) in
`samples/<genre>/<type>/1.wav ... 5.wav`. A new beat picks one of the five for each type at random.
`js/samplemap.js` lists the original name of every file.

Sources (trimmed to one-shots, converted to mono 16-bit 44.1 kHz, loudness-matched per type):

- **Hand percussion, claps, shakers, bells, agogo, cowbell, claves, triangle, cajon, congas, bongos**:
  Versilian Community Sample Library (VCSL), https://github.com/sgossner/VCSL, released under CC0 1.0 (public domain).
- **Drum-machine hits** (Roland TR-808 / TR-909 / TR-707 / TR-626 / TR-727 / R-8, LinnDrum, Oberheim DMX, Akai MPC60 /
  MPC1000 / XR10, E-mu SP-12, Alesis HR-16, Boss DR-550 / DR-660, Yamaha RY30): from the community collection
  "tidal-drum-machines" (https://github.com/ritchse/tidal-drum-machines), which gathers one-shot recordings of these
  classic machines. The collection does not state a licence of its own. These are short hardware one-shots that are
  widely shared and used in music production, but if you plan to release the app publicly, check the terms
  yourself or swap those files for ones you own.

To change a sample, replace the WAV file with the same name (mono or stereo WAV, under 1 second works best).

## Recorded instruments (samples/instruments/)
- Piano, electric piano (FM), organ, harmonium, guitars, harp, vibraphone, violin, cello, trumpet, saxophone, flute, clarinet, french horn, trombone, tuba, kalimba, marimba, xylophone, glockenspiel, electric and upright bass: from **tonejs-instruments** (MIT licence) and the **Versilian Community Sample Library** (CC0), re-encoded to mp3 at the sampled notes only.
- mbira, balafon: VCSL (CC0).
- 808 bass (boom, punch, deep): from the Roland TR-808 bass drum recordings in **tidal-drum-machines** (no licence stated by the collection; see the note above about the drum machine samples). A TR-808 kick glides down in pitch for its first 0.4 s, so each 808 keeps the recording's own click and loudness shape but is carried on the steady, whole-cycle part of the same recording, which makes short bass notes in tune (see tools/build_instruments.py).

## Trap drum kit (samples/trap/)
Roland TR-808 / TR-909 / Boss DR-660 one-shots from tidal-drum-machines, the same source and licence note as the other drum kits.

## Transition effects (samples/fx/)
crash.wav is a Roland TR-909 crash; impact.wav is a Roland TR-808 bass drum played slowly (same source and licence note as the drum kits).
