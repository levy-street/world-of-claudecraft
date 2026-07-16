# SFX Studio tutorial

SFX Studio is the local authoring and production export tool for World of
ClaudeCraft sound effects. Use it to edit published SFX masters, audition them
against representative game context, tune reversible runtime gain and playback
rate, and export a complete production bundle.

The Studio is loopback-only. Drafts and uploads remain under
`tmp/sfx_studio/`, which is ignored by Git and excluded from production builds.
Music and NPC voice lines use separate pipelines and are not included in an SFX
Studio export.

## 1. Start the Studio

Install dependencies (this also downloads the bundled FFmpeg and FFprobe static
binaries the Studio spawns; no system install is needed) and start the Studio:

```bash
npm ci
npm run sfx:studio
```

The command prints the local URL, normally `http://127.0.0.1:5181`. Open that
URL in a browser. To choose another port, run:

```bash
npm run sfx:studio -- --port 5182
```

Only one Studio process can use a repository at a time. Stop it with `Ctrl-C`
when finished.

## 2. Understand the workspace

The left side lists every fixed catalog cue. Search by key or filter by
category, routing state, modified state, or unsafe peak. The summary reports
both cue count and published track count because one cue can have multiple
round-robin takes.

Selecting a cue loads:

- its published audio and content hash;
- the saved non-destructive edit project;
- loudness, true-peak, duration, sample-rate, and channel inspection;
- its category baseline, per-key gain trim, and playback rate;
- representative animation, environment, or interface context;
- its published versions and ordered runtime tracks.

The `clean` label means the current Studio values are saved to the local draft.
It does not mean the audio has been published or the playback mix has been
applied.

## 3. Replace or edit a source

Drop an audio file on the Studio or use the file picker. WAV, MP3, FLAC, OGG,
M4A, AAC, WebM, AIF, and AIFF inputs are accepted. An upload must be no larger
than 64 MiB, no longer than 120 seconds, mono or stereo, between 8 and 96 kHz,
and within the decoded-sample budget shown by any rejection message. Lossy MP3,
OGG, M4A, AAC, and WebM sources must report at least 112 kbps. Studio checks the
original upload before creating any lossless authoring intermediate, so a
low-quality lossy source cannot be hidden by transcoding it. WAV, FLAC, AIF, and
AIFF are treated as lossless sources and bypass only the bitrate floor; all
other duration, channel, sample-rate, and decoded-sample limits still apply.

For a one-shot, select the useful waveform region and keep or remove slices.
Use zero-crossing snap and a short slice crossfade to avoid clicks. For a loop,
select the intended loop body and tune the seam crossfade. Whether a cue loops
is a catalog contract and cannot be changed in Studio.

The timing controls have distinct meanings:

- `Event delay` inserts silence into the rendered audio and is published.
- `Context sync` moves only the Studio context preview. It is not game timing.
- `Playback speed` changes runtime playback duration and pitch together. It is
  never rendered into the file.

Use context sync to line up the preview, then make small playback-speed changes
when the sound itself needs to follow animation timing. Check large changes by
ear because Web Audio `playbackRate` intentionally couples speed and pitch.

## 4. Shape tone and dynamics

Trim, slicing, slice joins, fades, loop seam construction, event delay,
reverse, EQ, compression, limiter behavior, and channel layout are authoring
decisions. They are baked into the published master.

The optional pre-conform loudness controls are part of that authoring graph,
but they do not define the final production level. Every exact preview and
publish ends with the fixed repository conform pass:

- clips shorter than 1 second target -6 dBFS true peak;
- clips at least 1 second long target -14 LUFS integrated loudness;
- output is a 44.1 kHz, 192 kbps MP3.

This two-branch standard is intentional. Peak normalization suits short
transients, while integrated LUFS suits sustained material. Do not try to make
relative mix decisions by changing the rendered level. Use runtime gain instead.

## 5. Compare auditions A, B, and C

The three audition modes answer different questions:

- `A: source bypass` plays the untouched working source without authoring or
  runtime processing.
- `B: live authoring + playback mix` is a fast Web Audio approximation of the
  edit graph plus the current runtime gain and speed.
- `C: exact + playback mix` plays the exact FFmpeg render after production
  conform, then applies the same runtime gain and speed the game will use.

Click `Render exact preview` before making a final judgment. Mode B is useful
while moving controls, but mode C is authoritative for reverse, normalization,
limiting, codec output, and loop-seam QA.

## 6. Tune runtime gain and speed

The `Master and game` tab contains the reversible playback controls. These
values never enter FFmpeg and never change an MP3:

- `Shared category baseline` corrects a whole family, such as movement or
  combat, for broad perceptual balance.
- `Per-key fine tune` adjusts one cue after the category baseline.
- `Playback speed` writes a per-key Web Audio playback-rate multiplier.

Category baseline and key trim add in dB. The resolved value must stay between
-60 dB and 0 dB. At runtime, the game multiplies caller gain by this resolved
gain and multiplies caller rate or pitch jitter by the authored playback rate.

Gain and speed apply to every take of a key. Accepted one-shots advance through
the ordered takes. A loop chooses one take when it starts and stays pinned to
that take until stopped.

## 7. Save, render, publish, and apply

The actions deliberately have separate effects:

1. `Save draft` stores the edit project and playback workspace only under
   `tmp/sfx_studio/`. Autosave has the same local-only scope.
2. `Reset audio draft` discards only the selected cue's unpublished audio edits
   and returns it to the current published master. Runtime gain and speed edits
   are kept.
3. `Render exact preview` creates a conformed preview under the temporary
   workspace. It changes no game file.
4. `Publish audio to game` replaces the selected primary published master,
   records its bounded render recipe, and regenerates the manifests. It does not
   change gain or speed maps.
5. `Apply playback mix` publishes the entire saved gain and speed workspace to
   the checked-in maps and regenerates the manifests. It does not change audio.

A reliable sequence is:

1. Edit and save.
2. Audition B while iterating.
3. Render and audition C.
4. Publish the audio master.
5. Apply the playback mix.
6. Recheck the cue in C and in the game when its real event combination matters.

Optimistic content hashes independently protect the per-cue audio draft, the
published audio-plus-recipe pair, and the playback-map workspace. Reload the cue
if Studio reports that any of them changed in another tab or branch.

## 8. Work with versions and round-robin takes

Publishing snapshots the previous audio and its render recipe. A version restore
first snapshots the current published state, then restores the chosen audio and
tracked recipe metadata. The working draft is reset to a limiter-free project
with a zero-millisecond loop seam whose source is that restored master, so the
old recipe is not applied to already processed audio a second time. Version
restore does not change the category baseline, per-key gain, or speed maps.

Numbered take files use the release convention:

```text
foot_grass_1.mp3
foot_grass_2.mp3
foot_grass_3.mp3
```

When numbered takes exist, their numeric order is the runtime order and they
take precedence over a bare `foot_grass.mp3`. A key can have at most eight
tracks. The current Studio displays the complete take list but edits and
auditions the primary track only. Add or replace additional numbered takes in
`public/audio/sfx/`, run the conform and manifest commands, then reopen Studio:

```bash
npm run sfx:conform
npm run sfx:manifest
```

Numbered fixed-catalog takes must start at `_1` and stay contiguous. Export
fails instead of silently dropping `_2`, `_3`, or any later orphan after a gap.

The same discovery path supports constrained mob subfamily files such as
`mob_beast_wolf_attack_1.mp3`. Their action must be `aggro`, `attack`, `death`,
`hurt`, or `idle`.

## 9. Export everything for production

Before export:

1. Publish every finished audio edit.
2. Apply all saved playback changes.
3. Confirm representative cues in exact audition C.
4. Click `Export all`.

Export refuses an unapplied playback workspace or a saved audio draft that is
newer than its published master. It also decodes and checks every published
track before creating the ZIP. Each track must be a mono or stereo MP3 at 44.1
kHz and 192 kbps, and it must pass the correct fixed loudness branch for its
decoded duration. A malformed file, a low-quality source, or an unconformed
published master blocks the whole export. The resulting content-addressed ZIP
includes:

- every published fixed-catalog and accepted mob-extension SFX track;
- exact ordered round-robin take lists;
- resolved runtime gain and playback rate;
- the stable runtime pack manifest;
- the checked-in gain, speed, and authoring recipe maps;
- immutable audio blobs, integrity metadata, checksums, and an installer.

It does not include uploads, draft files, previews, version history, music, or
NPC voice lines. Identical published audio and maps produce an identical bundle.
Do not commit downloaded ZIP files or `tmp/sfx_studio/`.

## 10. Install and activate the artifact

The runtime loader and production overlay server must first be deployed through
a normal code release. After that, compatible audio and mix updates can ship as
artifacts without rebuilding the game JavaScript.

Extract the ZIP on the production host and run its installer against the
persistent SFX overlay root:

```bash
sudo mkdir -p /opt/eastbrook/sfx-runtime
sudo chown "$USER":"$(id -gn)" /opt/eastbrook/sfx-runtime
sh install.sh /opt/eastbrook/sfx-runtime
```

The primary installer needs only a POSIX shell and `sha256sum` or `shasum`; a
Node-based `install.mjs` alternative is included. It verifies and copies
immutable blobs first, then atomically
replaces `audio/sfx/runtime-pack.json` last. It keeps old blobs so active clients
and rollback can continue to use them.

For Docker Compose, set `EASTBROOK_SFX_DIR=/opt/eastbrook/sfx-runtime`; the game
container reads `/app/sfx-runtime/audio/sfx`. Without Compose, set
`SFX_PACK_DIR` directly to the installed `audio/sfx` directory.

Reload or reconnect the game client after activation because a running session
loads its runtime pack once. Verify the manifest endpoint and then test a short
one-shot, a sustained loop, a UI cue, and a key with multiple takes:

```text
/audio/sfx/runtime-pack.json
```

To roll back, rerun the installer from a retained older artifact. New event
routing or a new fixed catalog key still requires a normal code deployment. A
compatible constrained mob subfamily can be delivered by an artifact.

## 11. Commit the authored result

For a source-controlled Studio change, review and include the relevant files:

- published MP3 masters and numbered takes;
- `scripts/sfx/sfx_mix.json`;
- `scripts/sfx/sfx_gain_map.json`;
- `scripts/sfx/sfx_speed_map.json`;
- catalog changes when applicable;
- regenerated `src/game/sfx_manifest.generated.ts` and
  `public/audio/sfx/runtime-pack.json`.

Run the focused checks before the full repository gate:

```bash
npm run sfx:check
npm run sfx:manifest
npm run sfx:studio:smoke
npm run gate
```

## Troubleshooting

`FFmpeg is unavailable`
: The bundled `ffmpeg-static`/`ffprobe-static` binaries are missing (an install
  that skipped package scripts leaves them undownloaded). Rerun `npm ci`. A `PATH`
  FFmpeg install only restores playback and encoding (which fall back via
  `scripts/sfx/ffmpeg_paths.mjs`); the production bundle export validates with the
  static binaries directly and stays broken until they are reinstalled.

`another SFX Studio server is already using this repository`
: Stop the earlier process. If it crashed, rerun after confirming no Studio
  process remains; stale locks are cleaned automatically.

`export blocked: apply the saved playback mix`
: Save the current cue, then click `Apply playback mix` before exporting.

`export blocked` for an audio draft
: Render and publish that cue, or select it and click `Reset audio draft` to
  discard its unpublished audio edits.

`lossy audio source must be at least 112 kbps`
: Return to the original recording or lossless master and export a higher-quality
  source. Converting the rejected file to WAV does not restore lost quality.

`published SFX is not production-conforming`
: Reopen and publish the named cue through Studio, or run `npm run sfx:conform`
  for manually installed numbered takes, then retry Export All.

`published source must be conformed to MP3 before Studio publish`
: Run `npm run sfx:conform` and reopen the cue. Studio will not write MP3 bytes
  over a custom WAV, FLAC, or OGG filename.

`runtime pack rejected`
: The artifact is incomplete, malformed, outside resource limits, or built for
  a different compiled catalog. Keep using the bundled fallback and deploy a
  matching game build before retrying the artifact.

Players still hear the previous pack
: Reconnect or reload the client. Also confirm that the production server points
  at the persistent overlay and that `runtime-pack.json` is reachable with
  `Cache-Control: no-store`.
