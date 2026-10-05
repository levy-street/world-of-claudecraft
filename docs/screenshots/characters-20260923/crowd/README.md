# Crowd cost: folding a WOC body's pieces into few draws

A full-kit WOC character drew 21 meshes a pass (17 materials) against 2 for the bodies it
replaces, and draw calls, not triangles, were what a crowd cost. In the world view a body now
folds its head into one mesh, its worn armor into one skinned mesh per material and its far
head into one group: 6 meshes a pass, the same triangles. Design and seams:
`src/render/characters/CLAUDE.md`, "WOC crowd draws".

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

## Numbers

Apple M4 Pro (ANGLE Metal), 1600x900, device pixel ratio 1, frame rate uncapped
(`--disable-frame-rate-limit --disable-gpu-vsync`), governor off, HUD on, 40 new characters
standing idle, draw calls from `renderer.perfStats()`. Before and after are the SAME build in
one session: `?wocmerge=off` keeps every piece its own draw.

| Scene | Pieces (`?wocmerge=off`) | Merged |
|---|---|---|
| High, 40 close | 2,099 draws, 17.4 ms | 874 draws, 11.5 ms |
| High, 20 close | 1,256 draws, 12.5 ms | 639 draws, 9.6 ms |
| Low, 40 close | 1,044 draws, 9.5 ms | 432 draws, 6.6 ms |
| Low, 20 close | 623 draws, 6.6 ms | 311 draws, 5.3 ms |

The far LOD folds either way, so its before is an earlier session of this branch: 40 far on
high went from 1,025 draws to 540, on low from 811 to 358.

One character: 21 meshes and 17 materials a pass become 6 and 6; 21,625 triangles either way.

Arrival (40 appearing at once, 8 s window, high): the merges ride the renderer's work queue,
all forty stand folded about one second after the spawn, no `live-program` and no
`gate-timeout` event in either arm, and the mean frame over the window is 12 to 14 ms merged
against 17 to 19 ms in pieces.

## Not measured

No phone or D3D11 number exists for the merged head's program. A Type A head compiles a
back-face `discard` for its one sided slots. Each distinct face keeps about 0.35 MB of merged
geometry while it is on screen.
