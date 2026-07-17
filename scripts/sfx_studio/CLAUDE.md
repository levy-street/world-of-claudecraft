# scripts/sfx_studio/

Local-only sound authoring studio. It is a plain Node ESM tool and is never
bundled into the game client or server. Root `CLAUDE.md` and
`scripts/CLAUDE.md` also apply.

## Invariants

- Bind the authoring server to loopback only. Every mutation requires the
  per-launch token, a same-origin request, an exact loopback Host header, and an
  allowlisted key.
- Allow only one Studio server per repository. The server lock prevents separate
  processes from interleaving playback-map, manifest, audio, or version
  transactions.
- Bind every per-cue mutation to the current audio-draft hash, and bind publish
  and restore to the combined published audio-plus-recipe identity. Stale tabs
  must fail without changing either half of a transaction.
- Export All is a read-only snapshot of every published SFX master and the
  applied playback maps. Refuse export when the workspace playback profile is
  unapplied or a saved audio draft differs from its publication baseline. Keep
  exports deterministic, content-address audio, include integrity metadata, and
  activate the stable runtime manifest only after every blob is in place.
- Treat every filename, upload, project value, and URL as hostile. Resolve paths
  through containment checks and pass ffmpeg arguments as an array, never a shell.
- Keep editing non-destructive in `tmp/sfx_studio/`. Audio Publish may
  transactionally replace `public/audio/sfx/<key>.mp3` and the bounded render
  recipe, then regenerate the runtime manifest for the new content hash. It must
  not change the playback maps. Apply Playback Mix may transactionally replace
  the checked-in gain and speed maps plus the generated runtime manifest, but it
  must not change the MP3 or render recipe. Caught errors must roll the files
  back.
- `WOC_SFX_STUDIO_ROOT` may redirect the workspace for hermetic tooling. The
  browser smoke must use an isolated temporary root and remove it on exit; it
  must never read or overwrite an engineer's normal drafts.
- Apply the fixed production conform pass after slicing, fades, loop seam
  construction, tone, dynamics, limiter, and output channel layout. Every exact
  preview and publish must be a decoded-QA-verified 44.1 kHz, 192 kbps MP3 using
  true-peak normalization below one second and, at or above one second, LUFS
  normalization bounded by the post-encode true-peak ceiling: a peak-constrained
  clip may publish under the LUFS target and is marked `peakLimited`
  (`conformSfxAudio` in `scripts/sfx/conform_audio.mjs`, pinned by
  `tests/sfx_conform.test.ts`).
- The catalog loop flag is a runtime contract. Loop cues must publish through
  seam processing and one-shots must not. Runtime playback rate changes the
  wall-clock loop duration without changing the rendered seam samples.
- Keep exact renders within the per-cue duration and byte budgets. Uploads must
  stay within the decoded-sample budget so browser preview cannot exhaust memory.
  Recheck the original source codec and bitrate at render time so legacy drafts
  cannot bypass the lossy floor. Require a conformed public MP3 before publish.
- Cross-clip mix gain has two additive dB layers: the category baseline and the
  per-key fine tune. Their resolved sum must stay at or below the key's ceiling
  (0 dB for every key by default; a `custom: true` key may have its own higher
  computed ceiling, see `scripts/sfx/sfx_gain_ceiling.mjs` and `SFX_GAIN_LIMITS`
  in the generated manifest) so runtime playback cannot defeat peak QA.
- Keep studio-only waveform, prompt, analysis, and history data out of the game
  bundle. Trim, slices, fades, seam construction, reverse, EQ, dynamics,
  loudness, and encoding stay baked in the published asset. Category baseline
  gain, per-key gain, and per-key speed never enter the render graph or audio
  bytes.
- Store runtime mix data only in `scripts/sfx/sfx_gain_map.json` and
  `scripts/sfx/sfx_speed_map.json`. Resolve those maps into the generated
  manifest, then apply them through `GainNode` and
  `AudioBufferSourceNode.playbackRate` at playback. `playbackRate` couples speed
  and pitch by design.
- Ordered catalog variants are separate published tracks. The generated runtime
  pack and production artifact must retain their order. Reject gaps in fixed-key
  `_N` takes instead of dropping orphan files. One-shots cycle accepted plays,
  while each loop pins one selected track until it stops.
- Audition A is the untouched source bypass. Auditions B and C include the
  runtime gain and playback rate so the live graph and exact rendered asset are
  judged as the game will play them.
- Never hand-edit `src/game/sfx_manifest.generated.ts` or
  `public/audio/sfx/runtime-pack.json`. Run
  `node scripts/build_sfx_manifest.mjs` or publish from the studio.
- The tracked render recipe and playback maps contain bounded declarative values
  only. Do not store local absolute paths, upload names, secrets, or timestamps
  in them.

## Verification

Run the pure project/catalog tests, the SFX runtime tests, changed-file Biome,
TypeScript, and the real browser studio smoke flow after authoring changes.
