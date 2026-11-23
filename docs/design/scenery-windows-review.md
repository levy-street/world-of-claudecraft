# RTX 3060 Windows scenery review

Completed follow-up: [Windows RTX 4070 Laptop results](scenery-windows-4070-results.md)
measure the pre-integration commit `c33418ac348`, not the later merged head.

Use this with [the rollout report](scenery-distance-rollout.md). The earlier Mac
tests ran two simultaneous browsers; they do not predict normal Windows play FPS.
The Windows result is required before a desktop recommendation is final.

## Prepare the branch

Use a clean checkout of `feature/cel-shading-rnd` after the report commit is pushed.
Record its exact commit. Use the repository's Node and pinned pnpm setup, with
Chrome or Edge installed and hardware acceleration enabled. In PowerShell, from
the checkout root:

```powershell
pnpm install --frozen-lockfile
pnpm run i18n:gen
pnpm run wiki:content
npx vitest run tests/scenery_review_checks.test.mjs
node scripts/scenery_review/build.mjs
node scripts/scenery_review/bench.mjs
```

The builder makes a separate minified research bundle under
`tmp/scenery-review/build`, enables offline entry only in that bundle and verifies
all media against the checked-in content hashes. It does not edit application
source. Media files are hardlinked within the checkout to avoid another large
copy; keep this checkout's assets unchanged during the test. An existing build is
never overwritten. Use another checkout for a different candidate.

The research bundle is for local testing only. Do not deploy it. The preview binds
to `127.0.0.1:5250`. No game server, account, production credential or remote
deployment is needed. Set `$env:BROWSER_PATH` to the full Chrome/Edge executable
path if automatic discovery fails.

## Run conditions and outputs

Keep the machine plugged in and the test browser visible. Avoid concurrent games
or GPU-intensive applications. The harness records CPU, GPU/driver information,
power scheme, browser version, uptime and the actual WebGL renderer. Full runs
require Windows and an RTX 3060 renderer; they fail rather than silently accepting
an integrated GPU or software rendering.

One visible browser runs at a measured 1920 by 1080 drawing buffer, using normal
browser display pacing. At each preset, it measures existing then updated scenery,
followed by updated then existing. Both fixed views are measured in each setting:
Thornpeak `(30, 700)` and Palmreach `(-352, 806)`. Cameras and noon lighting match
the earlier study. All arms use three-band cel, governor off and shader-cache
warmup off. Low keeps the selected FXAA-off and coconut-cell controls; higher tiers
retain their native settings.

Preparation and changing shader counts are excluded. Each accepted view contains
two 20-second submitted-frame windows, stable buffer/quality checks, material
identity checks for higher tiers and a screenshot. Results and rejected windows
are retained under a new timestamped `tmp/scenery-review/windows-*` directory.
`results.json` contains individual submitted-frame intervals, frame counts,
durations, CPU phase samples, draw counts and triangle counts. These intervals
describe observed submitted-frame cadence, not measured display scan-out or
isolated GPU execution time. It also records
console and page errors. A page error fails the run.

Compare settings within each order. Require a gain larger than roughly 10% in
both orders before claiming improvement. If both arms reach the display cap,
report parity at that cap; capped FPS alone cannot establish spare GPU capacity.
Retain the original JSON and images, including failures. Do not combine absolute
FPS from this single-window test with the dual-browser Mac benchmark.

`node scripts/scenery_review/bench.mjs --smoke` runs a short Medium-only harness
check on supported desktop GPUs. Its one-second windows are not performance
evidence and must not enter the comparison table. The Mac smoke check passed for both settings at 1080p, and the five validation
tests passed. Its console retained local API 502 responses and character preload
warnings; no page errors occurred. This is not a clean-console claim. Windows
execution itself still requires validation on the actual machine.

## Decision to make

Check Low first for preservation of the selected aggressive policy, then compare
Medium through Insane for real gains or regressions without changed textures or
lighting. Judge nearby readability, distant giant-tree silhouettes, Palmreach
canopies and transitions while moving. The fixed-view harness does not establish
sustained movement performance or exhaustive loading correctness.

If the RTX 3060 result resembles the Mac regression, take separate CPU profiles
and supported GPU-timing captures before changing desktop quality. Profiles and
GPU diagnostics belong outside the paired FPS windows. Keep the desktop decision
provisional until these results and screenshots are reviewed.
