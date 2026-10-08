# Crowd cost: folding a WOC body's pieces into few draws

A full-kit WOC character drew 21 meshes a pass (17 materials) piece by piece. In the world view
a body now folds its head into one mesh, its worn armor into one skinned mesh per material and
its far head into one group: 6 meshes a pass, the same triangles. Design and seams:
`src/render/characters/CLAUDE.md`, "WOC crowd draws".

What this page measures is that fold: one build, with the merge on and with it off. It is NOT
a comparison with the bodies the release draws. That comparison is its own section, "Against
the release", below.

## Same look

Every image is a SAME-FRAME comparison in the real client: the merged draw is rendered, the
merge is dropped, and the pieces are rendered again inside one task, so pose, lights and time
are identical. Left is piece by piece, middle is merged, right is the difference times 16
(black means identical).

| What | Image |
|---|---|
| Heads, four looks (two body types, hair, beards, piercings, custom colours) | [merged-head-same-frame.png](merged-head-same-frame.png) |
| Head and full armor kit with every bone bent (skinning of the merged armor) | [merged-armor-bent-pose.png](merged-armor-bent-pose.png) |
| A fire hit response on merged heads | [hit-response-same-frame.png](hit-response-same-frame.png) |
| The one-atlas head core against the separate textures it replaced, at 3, 6, 10 and 16 m | [mid-distance-atlas.png](mid-distance-atlas.png) |

Across nine looks, six angles and both material tiers the merged head differs from its pieces
by a few dozen edge pixels of 1.26 million.

## Numbers: the same build, merge on against merge off

Apple M4 Pro (ANGLE Metal), 1600x900, device pixel ratio 1, frame rate uncapped
(`--disable-frame-rate-limit --disable-gpu-vsync`), governor off, HUD on, 40 new characters
standing idle, draw calls from `renderer.perfStats()`. Before and after are the SAME build in
one session: `?wocmerge=off` keeps every piece its own draw.

Read every row as an ATTRIBUTION inside this branch: how many draw calls and how much frame
time the fold removes from a WOC crowd. It is one GPU, with vsync and the frame-rate limit
off, and it carries no release arm, so it says nothing about the release, about another GPU or
driver, or about a frame-rate-capped session. The build id, the browser version and the state
of the shader cache were not recorded.

| Scene | Pieces (`?wocmerge=off`) | Merged |
|---|---|---|
| High, 40 close | 2,099 draws, 17.4 ms | 874 draws, 11.5 ms |
| High, 20 close | 1,256 draws, 12.5 ms | 639 draws, 9.6 ms |
| Low, 40 close | 1,044 draws, 9.5 ms | 432 draws, 6.6 ms |
| Low, 20 close | 623 draws, 6.6 ms | 311 draws, 5.3 ms |

The far LOD folds either way, so its before is an earlier session of this branch: 40 far on
high went from 1,025 draws to 540, on low from 811 to 358.

One character: 21 meshes and 17 materials a pass become 6 and 6; 21,625 triangles either way.
On this GPU, then, the frame time fell with the draw calls at an unchanged triangle count.
That is an observation about one Apple GPU, not a rule: where skinned vertex work weighs more
(an integrated GPU, a phone) the same fold may buy less, and the far crowd in the reviewer's
run below costs MORE GPU time than the release's with fewer draws and fewer triangles.

Arrival (40 appearing at once, 8 s window, high): the merges ride the renderer's work queue,
all forty stand folded about one second after the spawn, no `live-program` and no
`gate-timeout` event in either arm, and the mean frame over the window is 12 to 14 ms merged
against 17 to 19 ms in pieces. Both arms ran in one session, so the missing `live-program`
events may only mean the second arm met a warm program cache: this run does not show that a
first session links nothing live.

## Against the release

### What a release player draws

Not the 2 meshes a pass an earlier version of this page quoted. That figure is the fixed class
rig (for the warrior `knight.glb`: its skinned parts share one material, so
`mergeSkinnedParts` folds them into one mesh, 5,800 triangles in the file, plus the held
weapons), and on the release only a character with NO stored look draws it: `inWorldLookFor`
(`src/render/characters/player_look_core.ts`) answers null for a non-player or a player with
no authored appearance, and composes a look for everyone else.

Every other release player draws the COMPOSED body: the parts `modularPartNames`
(`src/render/characters/modular.ts`) picks for its look over the class's full kit (the kit
is always whole there, whatever is equipped; only the helm toggles), pruned from
`models/chars/modular/warrior_modular.glb` and folded by `mergeSkinnedParts` per material and
merge partition (`modularMergePartition`: the head and the mouth never fold into the rest).
Checked on `release/v0.45.0`: for the default look over each class kit that rule leaves 7 to 9
skinned meshes (counted from the file's JSON; the most the fold can do, so a floor), before
the scalp or beard decal a cropped style adds and before the held weapons, and 7,670 triangles
for the male warrior's body. The reviewer's count, from running the release's merge on the
real rigs, is 9 to 11 meshes near (female 11 to 13, paladin 21 to 23) and 7 to 10 groups far.

So a merged WOC body (6 meshes near, 3 to 6 groups far in the reviewer's census) draws FEWER
meshes than the body a release player draws, and an unmerged one (21) about twice as many.

An earlier note in `src/render/characters/woc_head_merge_core.ts` set 2,098 draw calls for 40
close WOC characters "against 677 for the bodies they replace". It never said which bodies the
677 counted, and it is not used here.

### Measured against the release

`scripts/woc_crowd_ab.mjs` measures one arm per run and the same file measures every arm: it
drives the offline client of whatever checkout a dev server is serving, and reads only what the
release and this branch both expose on the dev hook (`scripts/lib/woc_crowd_ab_page.mjs` lists
each one). `--table` puts result files side by side. Every result carries its provenance: the
served checkout (read off the process listening on the port), its commit and dirty flag, the
page's build id, the browser, the WebGL renderer, the flags, the CPU throttle, the host load
and the date.

The scene is the review's. A level 1 warrior stands at the Proving Shore landing. 40 bot
players are added through the sim: the nine classes in turn, body type alternating, default
faces, the same six worn slots on every bot in every arm. They stand 6 to 20 yd ahead (CLOSE,
articulated), then 62 to 75 yd ahead (FAR, every body on its far mesh). SOLO, CLOSE and FAR
are 15 s windows after a settle; ARRIVAL is the 15 s that start at the spawn.
`?gfx=<low|medium>&governor=0&gputimer=1&fpscap=60`, 1920x953 at device pixel ratio 1, normal
vsync, a fresh browser profile per run.

The arms do not draw the same picture: the release's composed body ignores worn armor and
wears its class kit, a WOC body draws its own class's piece for each worn slot.

Three things are held still in every arm: the time of day (the world's day turns every 45
minutes on a UTC clock, so it is frozen at noon), the network (no host but this machine
resolves, so no run waits on the web fonts and the HUD renders in the fallback font), and the
minute after entry (the preview prewarm and the shader corpus record are waited out before the
first window).

Each window records GPU ms per frame (the timer probe's bracket sum), draw calls and triangles
(median of 1 s samples), the game's own frame dt (mean, p95, frames over 50 ms, time in frames
over 33.4 ms), raw animation-frame gaps, long tasks, linked programs, `live-program` and
`gate-timeout` events, the build ledger's `view:*` rows and the background queue units per
kind. ARRIVAL adds when every body had a view and when every body was drawn.

It cannot show another GPU, driver or OS (one Apple M4 Pro on ANGLE Metal, far from the
review's Intel HD 530 on Direct3D 11), a weak CPU (`AB_CPU_THROTTLE` slows the page's main
thread only and is labelled a proxy on every row), a cold driver cache, a network, a
production build (offline mode exists only in dev builds), a real town (default faces, one
worn set) or memory. A headless run has no display and is paced by a timer: a smoke run. Every
output says whether it counts as evidence and why not.

#### The run of 2026-10-05

Three arms, each served by its own dev server from its own checkout, each page reporting the
build id of its commit:

- **release**: `release/v0.45.0` at 55de7ffe92.
- **PR head**: this branch at 03802a2e08, the head the review response started from.
- **response**: the review response at 61bc4f62e2 (its code and its rebuilt texture files; this
  page and the rig were committed on top of it).

Apple M4 Pro (14 cores), ANGLE Metal, Chrome 154.0.8037.95 with a window on a display, a fresh
profile per run. All twelve runs are ONE session of 40 minutes, the three arms back to back
for each preset, because figures taken hours apart on this machine do not compare (see the end
of this section). One run per cell. The host's load average sat between 3.8 and 5.4 (this
machine idles around 4). The rig disqualified four runs on its own rules (the host swapping,
then busy with other work); those were repeated in the same session, and the release's Medium
run with them. The rig's text summary of every run counted here is in [ab/](ab/), one file per
run (`fixed` is the response, `x4` the slowed-CPU proxy, `far-*` the layer pricing below).

Steady state, release / PR head / response:

| Preset | Scene | Draw calls | Triangles | GPU ms per frame |
|---|---|---|---|---|
| Low | SOLO | 218 / 212 / 212 | 0.93M / 0.93M / 0.93M | 0.92 / 1.05 / 1.03 |
| Low | CLOSE (40) | 740 / 455 / 455 | 1.52M / 1.45M / 1.45M | 1.33 / 1.27 / 1.40 |
| Low | FAR (40) | 572 / 385 / 385 | 1.25M / 1.16M / 1.16M | 1.19 / 1.00 / 1.10 |
| Medium | SOLO | 389 / 378 / 378 | 1.32M / 1.34M / 1.34M | 4.06 / 3.96 / 4.02 |
| Medium | CLOSE (40) | 1,196 / 780 / 781 | 2.25M / 2.38M / 2.24M | 5.01 / 4.99 / 5.18 |
| Medium | FAR (40) | 742 / 548 / 548 | 1.66M / 1.59M / 1.59M | 4.43 / 4.43 / 4.55 |

Against the release the branch draws 39 % fewer draw calls close and 33 % fewer far at Low,
35 % and 26 % fewer at Medium. GPU time shows no difference this GPU can resolve: the EMPTY
scene alone read 0.92, 1.05 and 1.03 ms in the three Low runs above, and from 3.94 to 4.26 ms
at Medium across the day, which is as much as any two arms differ in a crowd scene. So the
review's far-crowd finding (3 to 10 % more GPU time than the release on an HD 530) is neither
confirmed nor cleared here. What can be said: at Medium the far crowd cost 0.37 ms over the
empty scene of its own run on the release and 0.47 and 0.53 ms on the two branch arms, and in
earlier sessions the same day 0.20 against 0.41 to 0.51. The direction agrees with the review;
the size is at the edge of what this machine measures.

Arrival, the 15 s from the spawn:

| Preset | Arm | All 40 have a view | All 40 drawn | Frames over 50 ms | Time in frames over 33.4 ms | Long tasks (count, max) | Worst frame gap | View build, mean | Character files first requested |
|---|---|---|---|---|---|---|---|---|---|
| Low | release | 0.36 s | 0.36 s | 0 | 0.00 s | none | 25 ms | 0.53 ms | 0 |
| Low | PR head | 0.44 s | 0.85 s | 0 | 0.00 s | none | 33 ms | 2.63 ms | 37 (8.33 MB) |
| Low | response | 0.36 s | 0.54 s | 0 | 0.00 s | none | 26 ms | 0.92 ms | 0 |
| Medium | release | 0.64 s | 0.64 s | 1 | 0.05 s | 1, 51 ms | 50 ms | 0.63 ms | 0 |
| Medium | PR head | 0.71 s | 1.48 s | 1 | 0.31 s | 1, 85 ms | 83 ms | 2.71 ms | 37 (15.17 MB) |
| Medium | response | 0.14 s | 0.82 s | 1 | 0.11 s | 1, 64 ms | 67 ms | 0.85 ms | 0 |

"Has a view" is the nameplate and the click target; "drawn" is the body on screen. The view
build is the ledger's `view:composed` row on the release and `view:rig` on the branch: the
work a new body costs inside a live frame.

The same arrival with the page's main thread slowed four times (`AB_CPU_THROTTLE=4`). This is
a PROXY for a weak CPU, never a measurement of one: workers, the GPU process and the driver
are not slowed.

| Preset | Arm | Frame mean / p95 | Longest task | Worst frame gap | All 40 have a view | All 40 drawn | View build, mean |
|---|---|---|---|---|---|---|---|
| Low | release | 43.6 / 66.3 ms | 89 ms | 141 ms | 2.68 s | 2.78 s | 2.98 ms |
| Low | PR head | 62.5 / 108.0 ms | 119 ms | 142 ms | 3.92 s | 6.21 s | 11.83 ms |
| Low | response | 51.8 / 72.9 ms | 83 ms | 116 ms | 2.58 s | 4.60 s | 4.28 ms |
| Medium | release | 72.8 / 101.8 ms | 117 ms | 150 ms | 3.96 s | 4.04 s | 2.95 ms |
| Medium | PR head | 114.3 / 181.3 ms | 188 ms | 242 ms | 5.61 s | 9.67 s | 12.33 ms |
| Medium | response | 78.2 / 119.7 ms | 132 ms | 134 ms | 3.59 s | 7.05 s | 4.71 ms |

What the arrival tables say, plainly:

- With the response every body has its nameplate and click target as soon as on the release or
  sooner in all four cases (0.36 s against 0.36 s and 0.14 s against 0.64 s; under the proxy
  2.58 s against 2.68 s and 3.59 s against 3.96 s), and no body waits on a download: the files
  a new body needs are resident (entry) or prefetched after first paint, where the PR head
  first asked for 37 of them inside the window.
- Drawing every body still takes longer than on the release: 0.54 s against 0.36 s at Low and
  0.82 s against 0.64 s at Medium, and under the proxy 4.60 s against 2.78 s and 7.05 s
  against 4.04 s. The PR head took 0.85 s, 1.48 s, 6.21 s and 9.67 s. A WOC body is revealed
  only when the compile gate has proven its programs, and the branch links more of them inside
  the window: 7 at Low and 19 at Medium against the release's 1.
- Under the proxy the mean frame of the arrival is 19 % (Low) and 8 % (Medium) above the
  release's. On the PR head it was 43 % and 57 % above.
- No run of any arm recorded a `live-program` or a `gate-timeout` event.

The gap to the release is narrower, not closed.

How far such figures move between sessions on this machine: earlier the same day the release
and the PR head were measured three hours before the response, which was still uncommitted.
That mix read 50 / 79 / 57 ms (Low) and 82 / 150 / 99 ms (Medium) for the proxy's mean frame,
and 0.51 / 1.07 / 0.69 s and 0.67 / 1.59 / 0.93 s for the unthrottled time to draw everyone.
The order of the arms held; the sizes did not, which is why the tables above are one session.

#### Pricing the far crowd's layers (review finding S11)

Three dev arms switch one layer of the far crowd off each, so a reviewer with the hardware
that showed the cost can price them: `?wocfarheadtint=off` (the far head's tint layer),
`?wocfarbodytint=off` (the far body's skin tint), `?wocfarshare=off` (the shared under-armor
material). The response, Medium, the far crowd's GPU ms per frame over the empty scene of the
same run, in two sessions (the first on the tree before it was committed, the second at
61bc4f62e2):

| Arm | First session | Second session |
|---|---|---|
| response | 0.41 | 0.46 |
| far head tint off | 0.35 | 0.24 |
| far body tint off | 0.36 | 0.27 |
| sharing off | 0.37 | 0.37 |
| release | 0.20 | 0.37 |

Each tint layer lowers the far crowd's cost in both sessions, by 0.05 to 0.22 ms, and the
sharing arm by less. That is as far as this machine goes: the empty scene alone moved by up to
0.24 ms between the runs of one session, so the table ranks nothing firmly and the finding is
NOT attributed here. It needs the review's GPU. (The second session's summaries are in
[ab/](ab/); the release's second figure is the main run's.)

#### What the crowd prefetch costs

The loading model prefetches the rest of the crowd set right after first paint on an
unconstrained profile. `?woccrowdprefetch=off` switches that off, so one build prices it.
Medium, the 20 s that start when the world has its first views, a window on a display, normal
vsync; then, 35 s in and after a forced collection, what the page keeps. Measured on the
response's tree just before it was committed (its only later change on this path is that a
browser sending the Save-Data hint prefetches nothing):

| Arm | Runs | Long tasks | Time in long tasks | Longest task | Frame gaps over 50 ms | Worst gap |
|---|---|---|---|---|---|---|
| prefetch on | 3 | 2, 2, 2 | 119, 118, 118 ms | 60, 59, 61 ms | 2, 2, 2 | 58, 67, 67 ms |
| prefetch off | 3 | 1, 2, 2 | 63, 128, 120 ms | 63, 64, 61 ms | 1, 2, 2 | 67, 75, 67 ms |
| on, main thread slowed 4x | 2 | 32, 44 | 2.60, 3.29 s | 202, 206 ms | 162, 187 | 215, 233 ms |
| off, main thread slowed 4x | 2 | 32, 27 | 2.55, 2.35 s | 194, 202 ms | 131, 138 | 202, 216 ms |

| Arm | Character files fetched | JS heap | Array-buffer backing store | Textures, geometries, programs on the GPU |
|---|---|---|---|---|
| prefetch on | 64 files, 19.90 MB | 395.0 MB | 1,065.8 MB | 535, 511, 349 |
| prefetch off | 9 files, 5.59 MB | 381.7 MB | 1,009.7 MB | 535, 511, 349 |

Unthrottled, the prefetch does not show in the frames. Under the slowed-CPU proxy (never a
measurement of a weak CPU) the entry is still warming for the whole window in both arms, and
the prefetch adds about 30 % more frames over 50 ms on top (162 and 187 against 131 and 138)
without lengthening the longest stall. It keeps about 69 MB more on the CPU side at Medium:
13 MB of JS heap and 56 MB of buffers (the files' compressed texture levels, their parsed
geometry and a prepared copy of each armor pack). Nothing reaches the GPU until a body wears a
file: the counts are the same in both arms (one run with the prefetch on read 537 textures).
The memory totals are a dev build's and only the difference between the arms means anything.
One Apple machine, two or three runs an arm; not measured on Low, on a phone (which prefetches
nothing) or on the review's hardware.

#### The same picture as the PR head

The response is meant to change WHEN work happens, not what is drawn. Checked in the world:
the local player as every class in both body types, wearing a chest piece and then a full
kit, the default face, the idle clip held on its first frame, the time of day held at noon, a
fixed camera; the response and the PR head (03802a2e08) served the same texture files. Per
close-up, the mean absolute difference per colour channel (0 to 255) inside a box on the
torso and a box on the head, median and worst of the 36 shots:

| Preset | Pair | Torso box, median / worst | Head box, median / worst |
|---|---|---|---|
| Low | PR head against the response | 0.000 / 0.002 | 0.03 / 0.08 |
| High | PR head against the response | 1.71 / 2.99 | 1.78 / 6.20 |
| High | the response against a second run of itself | 1.63 / 2.98 | 1.77 / 6.19 |

On Low the bodies and their armor match to the pixel, and the head box differs only where
trees sway behind it. That is also the on-screen check of the three colour conversions the
response moved from the merged head shader to the CPU (review finding S6), for the default
look: the faces match. On High two runs of ONE build differ as much as the pair does (moving
clouds and water, and whatever else the preset varies from frame to frame, are not held still
by this rig), so High shows no difference that belongs to the response and cannot show
identity. One Apple GPU, the response's tree just before it was committed; the capture
scripts were scratch and are not in the repo.

### The reviewer's measurement (PR 4360 review)

The only release comparison so far is the reviewer's own, copied here as reported. It was
taken on an OLDER head of this branch (9dd5110598) against `release/v0.44.4` (f9aa5fefeb),
not on this page's build.

Setup, as the review describes it: Windows 10, Intel HD Graphics 530, ANGLE Direct3D11 (adapter
asserted every run), Chrome 153, 1920x953 at DPR 1,
`?gfx=<low|medium>&governor=0&gputimer=1&fpscap=60`, dev-mode builds of both refs (served
bundles verified by branch-only markers). An offline level-1 warrior and 40 bot players (the
nine classes, alternating body type, default faces), added through the sim and dressed in the
same six-slot worn set in both arms (the release's composed body ignores it and wears its
look's kit; the WOC body shows each class's own pieces), on a grid 6 to 20 yd ahead (CLOSE,
articulated) then 62 to 75 yd (FAR, every body on its far mesh). Windows of 15 s after a
settle; ARRIVAL is the 15 s right after the spawn. Low: two runs per arm (plus a third release
sample); Medium: one run per arm.

| Preset | Scene | GPU ms per frame, release | GPU ms per frame, branch | Draw calls, release / branch | Triangles, release / branch |
|---|---|---|---|---|---|
| Low | SOLO | 12.10 | 12.12 | 222 to 224 / 216 | 1.06M / 1.06M |
| Low | CLOSE (40) | 18.18 | 15.62 (-14 %) | 745 / 459 | 1.65M / 1.58M |
| Low | FAR (40) | 12.96 | 14.31 (+10 %) | 577 / 392 | 1.39M / 1.30M |
| Medium | SOLO | 42.19 | 42.58 | 369 / 362 | 1.31M / 1.35M |
| Medium | CLOSE (40) | 55.46 | 53.82 (-3 %) | 1,201 / 775 | 2.28M / 2.40M |
| Medium | FAR (40) | 43.42 | 44.61 (+3 %) | 722 / 532 | 1.66M / 1.61M |

GPU time per frame from `EXT_disjoint_timer_query_webgl2`, mean over the window (the Low
values are means of the runs); draw calls and triangles per frame, median of 1 s samples.

| Preset | Arm | Rendered frames over 50 ms | Time in frames over 33.4 ms | Long tasks (count, max) | All 40 bodies drawn after |
|---|---|---|---|---|---|
| Low | release | 3 and 6 | 1.1 s and 1.1 s | 2 and 4, max 65 ms | 1.55 s and 1.64 s |
| Low | branch | 37 and 36 | 4.3 s and 4.6 s | 24 and 23, max 86 ms | 2.47 s and 2.41 s |
| Medium | release | 198 | 14.8 s | 175, max 181 ms | 2.70 s |
| Medium | branch | 153 | 14.7 s | 141, max 524 ms | 4.52 s |

The ARRIVAL window; "and" separates the two Low runs. Rendered frames are the game's own
frame time, long tasks the browser's `longtask` entries.

The limits the review states: Medium is GPU-saturated on that machine even SOLO (about 42 ms
against a 16.7 ms cap), so its differences are direction only, and in its arrival the
comparable signals are the longest stall and the time to draw everyone. Offline bots with
default faces (the per-face caches are under-exercised), one worn set for everyone, dev-mode
builds, a monitorless box with a 60 fps timer cap, LAN delivery. The browser kept its GPU
shader disk cache between runs, so the arrival figures are warm-cache figures, and a first
session can be rougher. No link time was measured.

## Not measured

No phone number exists for the merged head's program, and no shader link time on any backend
(the D3D11 run above is the reviewer's, with a warm cache). A Type A head compiles a back-face
`discard` for its one sided slots.

Memory: no device memory was measured, on any machine. This page has two figures: what the
crowd prefetch keeps on the CPU side of one desktop ("What the crowd prefetch costs", above),
and a geometry size. Each distinct face keeps about 0.35 MB of merged vertex and index buffers
while it is on screen (some ten thousand vertices at 27 bytes and their indices), and the cache
keeps the last 12 idle ones, 4 on a constrained profile
(`src/render/characters/woc_idle_cache_core.ts`, `wocIdleCacheCaps`). That is one copy, and
the buffers are held twice: as typed arrays in the JS heap and as their uploaded
copy on the GPU. (The PR 4360 review carries a memory comparison with the release on an
emulated iPhone profile, a headless software rasterizer reporting page totals. It is the
reviewer's, and it is not copied here.)
