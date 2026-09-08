# Masterwork signature audio

Original offline sound design for all eight VFX signatures. This pack has three
separate cues per ability: held charge, release at the actual launch, and contact
with its material aftermath. No borrowed samples, API jobs, voices, or music.

## Delivery

- `runtime/`: 24 canonical mono 44.1 kHz, 192 kbps MP3 files.
- `masters/`: lossless 24-bit mono WAV mixes.
- `stems/`: independently editable material layers, with names describing their role.
- `asset_manifest.json`: key-to-ability mapping, durations, loop regions, seeds,
  envelopes, provenance, hashes and suggested runtime gain.
- `validation.json`: measurements of the actual encoded MP3 files and full decode.
- `generate_masters.py`: deterministic original sound-design source (NumPy only).
- `package_and_validate.mjs`: repository conformance adapter and encoded-audio QA.

## Rebuild

Run `python generate_masters.py`, then
`node package_and_validate.mjs /absolute/path/to/woc-vfx-studio`.
The second command reads the repository's conformance measurement/classification helpers and bundled FFmpeg;
it writes only inside this asset directory. No existing game sounds are replaced.

The design uses band-shaped periodic noise, inharmonic physical resonators,
short granular crystal/liquid events, independently timed material layers, FM
organic formants and sparse diffuse reflections. The impact attack is dry and
front-loaded; the decay supplies depth without a musical chord or a speech cue.

## Runtime hookup

Copy each runtime MP3 to `public/audio/sfx/<key>.mp3` and register the keys through
the existing source sound catalogue, then run the owning manifest generator.
`cast_masterwork_<identity>`, `proj_masterwork_<identity>` and
`impact_masterwork_<identity>` are new keys, separate from the old `signature_*`
accent tails. Suppress that old accent on these upgraded signature events, plus
the overlapping generic cast/release/impact cue where the authored cue replaces it.

Charge clips contain two repeats of an original two-second periodic signal, in a
four-second encoded file. Set AudioBufferSourceNode `loop = true`,
`loopStart = 1`, `loopEnd = 3`, and start playback at offset 1 second.
Those interior bounds avoid MP3 boundary/padding artefacts. Fade the initial gain
over 55 ms and stop over 100 ms. Fade the charge when the cast stops, dies, resets,
or releases. Do not loop the whole MP3 or concatenate another attack on every cycle.

Release and impact cues start at offset zero. Their only onset smoothing is a
sub-millisecond anti-click edge; there is no baked anticipation delay. Schedule
release at visual launch and impact at the real hit/contact cue. Do not launch the
impact from a cast timer for traveling spells. Disable random pitch jitter on
these designed phase cues. Their fixed sound identities supply the variation;
ordinary catalogue accents can continue using the existing variation policy.

Suggested voice gains are charge 0.28, release 0.60, impact 0.72, below the existing
master gain. These are initial integration values; concurrent VFX signatures should
use the existing distance and voice limits. Keep charge/release at the caster and
impact at its target or actual ground position. Healing contacts should share a
short per-cast cooldown to avoid stacking a full impact sound on every chain hop.

## Verification limits

The pack is checked against the repository's actual format/loudness rules, then
fully decoded for sample count, finite values, literal -6 dBFS true-peak ceiling,
and the interior loop transitions. Linear normalization from the pristine masters
targets -14 LUFS only while the literal -6 dBFS true-peak ceiling allows it.
Long transients remain below -14 LUFS where peak safety is binding, as the standard
and its classifier explicitly permit. This avoids flattening an authored impact
and long aftermath through repeated limiter passes just to chase integrated level.

No enabled tool provided auditory listening, so the report does not claim an
ear-based review. Final scene-level playback review and mix balance remain part
of the parent integration QA. `audition.html` provides direct phase/sequence playback
when this folder is served by a local HTTP server.
