# GPU hitch capture protocol

`node scripts/gpu_hitch_capture.mjs` records a versioned, raw WebGL timeline for
the shader-linking hitch investigation. The command installs the probe with
`evaluateOnNewDocument` before the application navigates, stores the exact
`linkProgram` and `getProgramParameter` calls, and validates the artifact before
accepting it.

## Capture

The default is a headed Chrome run on the configured real GPU. A headless run is
only a serialization/smoke check and must not be used as performance evidence,
even when `GL_RENDERER` confirms that Chrome used the discrete GPU rather than
SwiftShader. Headless changes the window/compositor path and must never be mixed
with headed legs in one A/B campaign.

The analyzer refuses any software rasterizer as performance evidence, not just
SwiftShader: it reads the adapter string through `SOFTWARE_RENDERER_PATTERN`
(`src/render/software_renderer.ts`), which also names llvmpipe and the D3D11
WARP fallback that Windows now uses in place of SwiftShader.

What a capture CLAIMS decides whether that is an error or a warning, and the
claim is written into the artifact as `capture.performanceEvidence`, so
re-reading a capture through the analyzer alone reproduces the verdict it
embedded. A headed run claims the real GPU: finding llvmpipe or WARP on one
fails validation and the command exits 1, because the machine did not do what
the run said it was doing. A `--headless` run claims smoke only, so the same
adapter is a warning on a valid `smoke` artifact. To keep a software-rasterizer
capture as smoke evidence, run it with `--headless`.

For headed evidence, inhibit automatic sleep/DPMS for the complete command and
keep the browser foregrounded. A physical HDMI switch can remove the display's
EDID and reconfigure the desktop/GPU without producing a browser
`visibilitychange`; discard any leg captured across such a switch. An HDMI
dummy plug or switch with EDID emulation is acceptable only if every campaign
leg uses the same stable display configuration.

```sh
node scripts/gpu_hitch_capture.mjs \
  --url 'http://localhost:5173/?perf&gfx=ultra' \
  --profile shader \
  --viewport 1920x1080 \
  --duration-ms 180000 \
  --out tmp/gpu-hitch/example.json
```

`--mode offline` enters the local game fixture automatically. `--mode manual`
opens the page and waits for the operator to enter the world; it needs an
interactive terminal and refuses to start without one, rather than waiting
forever on a stdin nobody can type into.
`--mode online-geared` is the controlled local-online boot scenario: it creates
up to 40 disposable bots, gives every bot a deterministic complete authored
appearance (including face/body morphs, hair, eyes, skin and outfit), varied
class equipment and weapon cosmetics, and places the crowd inside the
observer's interest area before the observer enters. It requires a loopback
game server with `ALLOW_DEV_COMMANDS=1` and a loopback `DATABASE_URL`; the
fixture count and SHA-256 are written into the capture.

A dirty worktree is refused unless `--allow-dirty` is supplied; its content
hash is recorded. The tool uses a temporary browser profile and disables the
shader disk cache. Chrome's sub-second initial target-focus handoff is
normalized only while no application or GPU event exists. Any later hidden
transition invalidates the capture.

The default viewport is 1600 x 900 at DPR 1. Use `--viewport WIDTHxHEIGHT` to
qualify another render resolution. The requested viewport is applied both to
Puppeteer's page and to Chrome's outer-window flag, and the effective renderer
size remains the comparability source of truth in the artifact.

Profiles are intentionally not interchangeable:

- `shader` (default): links, completion status, active uniforms, active
  attributes, the value each of those queries returned, per-program Three
  identity, the draw context of each link and reflection query, phases, and
  renderer compile-unit lifecycle;
- `upload`: sparse 100 ms texture-upload buckets;
- `full`: both sets of wrappers.

`--observer X,Z` moves the observer AND the geared crowd to another world spot.
It changes WHAT is measured, not how: a different town streams different
content, so a leg there is only ever a control for another leg at the same spot.
The spot is recorded in `capture.observer` and is a comparability key, so the
comparator refuses a pair that drifted.

## Artifact contract

The JSON has schema version `4` and retains the raw `timeline` before deriving
the summary. Query windows are anchored on `query.startMs`; links after the
blocking call returns cannot be attributed to it. Upload attribution reports
`certain` and `possible` bounds because edge buckets are partial.

Upload bytes are read from the overload that was actually called, never from
fixed argument positions. The DOM-source overloads three r165 uses for image
uploads carry no dimensions at all: in
`texImage2D(target, level, internalformat, format, type, source)` the two
arguments the pixel overload spends on width and height hold GL enums, and the
source states its own size (read as a PAIR from one source kind, so a
half-decoded image cannot contribute an intrinsic width with a layout height).
The bytes per texel come from the format and type pair, including the packed
types that size a whole texel at once. An upload whose overload states neither
dimensions nor a source size is counted in the bucket's `unsized` rather than
guessed at, and `uploadBucketsBeforeQuery` carries `unsizedCertain` /
`unsizedPossible` beside the byte totals: a byte total is only readable next to
how many uploads it leaves out.

The wrapped surface is the four 2D entry points (`texImage2D`,
`texSubImage2D`, and their compressed forms). The 3D forms are NOT wrapped, so
`DataArrayTexture` / `Data3DTexture` uploads appear in neither `count` nor
`unsized`; the `unsized` honesty claim covers the 2D calls the estimator saw,
not every upload the GPU received.

An artifact from an earlier schema is rejected by name rather than read on a
best-effort basis: schema `1` carries no completion-status return value, so the
reflection families below cannot be derived from it at all, schema `2` has
no `variantDiff`, where a missing field is not the same claim as "this program
had no variant", and schema `3` sized every DOM-source upload from two GL enums
read as width and height (about 131 MB per image upload), so its byte totals
are not a smaller version of the same claim. A mixed pair must never look
comparable. The meaning of the earlier fields is unchanged.

## Program variants

A material that was already compiled can link a SECOND program: three keys its
program cache on the material PLUS the render conditions baked into it, and the
condition list is in `THREE_CACHE_KEY_PARAMETERS`. Change one and every warm
program carrying the old value is invalid, so the next draw links a fresh one
and blocks on it. This applies to EVERY material, including unlit
`MeshBasicMaterial` and the shadow pass's `MeshDepthMaterial`: three pushes the
light counts into the key whether or not the shader reads them.

`timeline.programs[].variantDiff` records what changed, and the comparison
happens in the page so no key is serialized: `getProgramCacheKey` ends with
`array.join()`, and its last element is `customProgramCacheKey`, which for a
patched material IS the `onBeforeCompile` source. Only the differing segment
leaves, and a segment that is not a short plain token is replaced by a
`#<hash>:<length>` stand-in.

`cacheKeyVariance(capture)` groups those diffs. One before/after pair shared by
many unrelated materials is a GLOBAL condition flip; one pair per material is
content arriving. `variantDiffParameter` names the position by counting back
from the fixed trailers (two boolean masks, then the output colour space, then
the custom key), because the `defines` block in front is variable length.

Variant identity has a limit of its own. The link happens inside the
`WebGLProgram` constructor, which three reaches from `compileAsync` with no
draw context, so the material INSTANCE is unreachable and the retention key is
the material class plus name: two unnamed `MeshStandardMaterial`s share it. A
difference is therefore only claimed as a variant when it is ONE
comma-separated segment wide on the shorter side and at most one segment wider
on the other, which is what a single render condition produces: a value
replaced in place, or the one `defines` entry appearing or disappearing that
makes the key a segment longer. A wider difference is two materials that shared
a family key and is recorded as `variantAmbiguous`, counted by
`cacheKeyVariance` as `ambiguousPrograms`. Two materials differing in exactly
one segment still collide, so a group holding a single program is weak evidence
and a before/after pair shared by many materials is the strong signal.

The naming has one honest limit, and reading around it matters. The join
separator is a comma and the `onBeforeCompile` source contains commas of its
own, so for a HOOKED material the position is shifted by an unknown amount and
the reported name is wrong. The before/after VALUES are unaffected. Read the
exact name off materials with no hook (a small `cacheKeyLength`), then match the
value pair across the hooked ones.

`capture.durationMs` is the requested measurement window after world entry and
is therefore part of A/B comparability. `capture.totalElapsedMs` preserves the
complete probe span, including variable boot and entry time, for timeline
reconstruction without making equivalent measurement windows incomparable.

`effective` comes from the running application, not from parsing the URL. The
renderer uses the lifecycle controller by default: it admits whole compile
units against a window measured in observed program links, grows that window
after fast settlements, halves it after slow settlements or failures, and
stops new entry work after a bounded no-progress interval. Its receipt reports
`compile-unit-lifecycle`, the effective window and congestion counters without
inventing a fixed links-per-second value. The `?perf` capture seam retains
explicit controls: `linkrate=0` selects unlimited submission, a positive value
selects a static candidate, and `linkmode=adaptive` explicitly selects the
shipping controller for A/B attribution. The static receipt reports
`compile-unit-sync-prologue`; continuations that link later in async tails are
observed but are not completely governed by that static budget.
Modular self/peer
flags remain unavailable, so requesting them fails closed instead of silently
measuring a no-op.

`timeline.compileUnits` is the renderer's application-level lifecycle view on
the same probe-relative monotonic timeline as the WebGL events. Each
record includes submission, synchronous-prologue end, settlement/failure, lane,
and `statusAtReveal` (`settled`, `pending`, `deferred`, or `failed`) sampled
immediately before the loading curtain starts to fade. This is not
an internal driver-pending counter; it is the strongest pending-at-initial-frame
evidence available from the renderer.

## Reflection attribution

Three r165 links asynchronously under `KHR_parallel_shader_compile`, so
`linkProgram` itself always measures near zero. The wait surfaces on the first
call that needs the link result, which is the `ACTIVE_UNIFORMS` query inside
`WebGLProgram.onFirstUse`. Reading that query as a reflection cost is a
misattribution: `reflectionAttribution` therefore classifies every reflection
query by what the program's link had actually done when the query was issued.

The discriminator is the completion-status RETURN VALUE, not a timestamp
ordering. A program can be polled again after it is ready, so "the query came
before the last poll" would misclassify a settled program as racing.

- `never-compiled`: the program has NO completion poll anywhere in the capture,
  so it was never submitted to `compileAsync`. The link and the first use happen
  in one instruction stream and the query absorbs the whole link.
  `WebGLProgram.isReady` is the only `COMPLETION_STATUS_KHR` caller in three
  r165 and only the `compileAsync` poll pass calls it, so the presence of a
  poll, even one that starts after the query, is proof of submission.
- `raced-pending-link`: the program was submitted, and no poll had returned true
  before the query started. A draw reached a material whose compile was still in
  flight and paid whatever link time remained. This includes a program drawn in
  the same frame it was submitted, before its first poll.
- `settled-first`: a poll observed true strictly before the query started. This
  is the only family that measures reflection itself.

Two limits of that split, worth reading before quoting a family count. Without
`KHR_parallel_shader_compile` three flags a program ready on construction and
never polls at all, so every program lands in `never-compiled`:
`polledPrograms` travels with the families, and a capture reporting zero of
them is evidence about the extension, not about compilation. And a program
first linked synchronously at a draw, then swept up by a LATER `compileAsync`
pass over the same cached program, reads as `raced-pending-link`. The families
are a population readout, not a per-program verdict.

`timeline.programs` gives each program its Three identity: the material class
and name, three's own program id, and a HASH of the cache key with its length.
The raw cache key is never written, because three's default
`customProgramCacheKey` returns the `onBeforeCompile` source. Comparing a live
link's cache-key hash against the set linked under the curtain separates a
duplicate variant the prewarm dedupe missed (`liveLinkedKnownKey`) from a
variant prewarm never built at all (`liveLinkedNewKey`).

Both reflection queries and every link also carry a `draw` context, taken from
an instance-level hook on `WebGLRenderer.renderBufferDirect`: material and
object class, the skinned/instanced/morph/cast-shadow shape bits, the scene-root
index, and `shadowPass`. The last is exact rather than heuristic:
`WebGLShadowMap` draws with a null scene. `timeline.sceneRoots` (index, class,
name, child count, visibility) resolves a root index to a subsystem, and it is
the census of the container the index actually indexes, never of the last scene
drawn: the post chain draws its own quad scenes, so those are different objects.
Each draw carries `rootCount` alongside `rootIndex` so a mismatch between the
two is visible rather than silent. Completion polls deliberately carry no draw
context: a capture holds tens of thousands of them.

Two coverage limits are recorded rather than assumed. `timeline.programs` is
resolved through `window.__game`, which `main.ts` only assembles around the
reveal; programs linked under the curtain resolve retroactively from the first
reachable pass, and only a program disposed before then stays unattributed.
The draw context has no such retroactive path, so
`diagnostics.rendererHook.attachedAtMs` states when it became available: a link
before that timestamp could not be attributed to a draw, which is a different
claim from "that link happened outside any draw". `draws` and `scenedDraws`
report how much the hook actually saw.

`provenance` records the source HEAD, dirty-worktree content hash, served build
ID, probe hash, analyzer hash, worktree name, and dirty state. URLs are reduced
to the allowlisted measurement knobs; credentials, fragments, and arbitrary
query parameters are not written to the artifact.

## Comparison rules

Use `areComparable(left, right, { varying: ['linkrate'] })` for a static sweep,
or `areComparable(left, right, { varying: ['linkrate', 'linkmode'] })` for an
explicit `linkrate=0` unlimited control versus `linkmode=adaptive`. Omitting
both knobs now selects adaptive and is not an unlimited control. Dynamic
adaptive counters are observed results, not comparability keys. Every campaign
capture supplies `--group-id`, `--leg`,
`--repetition`, and `--order` together. The comparator rejects
changes to the source/served build, probe/analyzer/schema, profile, browser
flags/version, shader cache, GL vendor/renderer, viewport/DPR, graphics knob,
scenario, zone, group, or fixture evidence. A rejected leg remains useful as
raw evidence but must not enter an A/B verdict.

Example local-online qualification (load the main checkout's env directly; do
not copy it into the worktree):

```sh
ALLOW_DEV_COMMANDS=1 PORT=8788 \
  node --env-file=/path/to/main/.env dist-server/server.cjs
WOC_DEV_API_TARGET=http://127.0.0.1:8788 \
  pnpm exec vite --port 5199 --strictPort
node --env-file=/path/to/main/.env scripts/gpu_hitch_capture.mjs \
  --url 'http://127.0.0.1:5199/?perf&gfx=ultra&linkrate=0' \
  --server-url http://127.0.0.1:8788 \
  --mode online-geared --bots 20 --profile shader --duration-ms 180000 \
  --group-id linkrate-v38-a1 --leg control --repetition 1 --order 1 \
  --out tmp/gpu-hitch/linkrate-v38-a1-control-r1.json
```

For a decision campaign, alternate control/candidate order across repetitions
and restart the dedicated game server between legs. Keep population, fixture
hash, URL knobs other than the declared varying knob, browser, viewport and capture duration
identical. Production captures are observational only: production cannot
provide a strictly identical crowd and the tool must never create bots or use
dev commands against a non-loopback target.

The raw JSON is the audit record. Keep it, or publish its SHA-256 and a durable
copy alongside the compact summary; a derived summary without the raw timeline
cannot reproduce the attribution windows.
