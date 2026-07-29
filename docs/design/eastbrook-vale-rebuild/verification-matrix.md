# Eastbrook Vale rebuild: verification matrix

This is the evidence ledger for the current polish-v2 worktree. Exact narrative and shipping
tables are in `final-report.md`. Rebuild-v1 captures and measurements are historical references;
they do not satisfy a current polish-v2 row.

Status vocabulary:

- `PASS`: the named source, focused test, or inspected artifact proves the requirement.
- `VERIFY`: evidence is incomplete or the final integration outcome is not yet recorded.
- `N/A`: the check does not apply for the recorded reason.
- `FAIL`: measured evidence violates the contract.
- `BLOCKED`: the check could not run because of a named external blocker.

No blank status is accepted. SwiftShader screenshots are visual evidence, never native-GPU
performance evidence. Bare `polish/` evidence paths below are relative to
`docs/screenshots/eastbrook-vale-rebuild/`.

## Reference, provenance, and source contracts

| ID     | Requirement                                                    | Evidence                                                                                   | Current result                                                                                                                                                  | Status |
| ------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| REF-01 | Original rebuild concept and nine turnarounds remain preserved | `concepts/`, `turnarounds/`, `imagegen-provenance.md`                                      | Existing accepted inputs remain present                                                                                                                         | PASS   |
| REF-02 | Polish concept is an original World of ClaudeCraft composition | `polish/concepts/master-concept.png`, prompts, provenance, `CREDITS.md`                    | No proprietary image input; prompt and rights lineage recorded                                                                                                  | PASS   |
| REF-03 | Mailbox and noticeboard have reconstruction-grade turnarounds  | `polish/turnarounds/ravenpost-mailbox.png`, `polish/turnarounds/noticeboard.png`           | Matched isolated views are retained                                                                                                                             | PASS   |
| REF-04 | Complete img2threejs intake exists for both new assets         | `docs/design/eastbrook-vale-rebuild/polish-img2threejs/`                                   | Admission, assessment, detail inventory, sculpt spec, stages, comparisons, and validation retained                                                              | PASS   |
| SRC-01 | Rebuild-v1 town source remains deterministic                   | `tests/eastbrook_town_assets.test.ts`                                                      | Historical town source fingerprint remains `9262e650d1f9b1ece4fad225477a327f047b2aa4ac00a0f94250986fb8b3015e`                                                   | PASS   |
| SRC-02 | Shared atlas remains deterministic                             | `build_surface_atlas.mjs --check` contract                                                 | Fingerprint `6427821b76f9f45878dd6c1616be49264d5cd66a7c4ed61606c23b31df21d224`; shipping SHA `d66f2fab603aa83e6c73c6fc4bdde2d545a6d8c1a0d4a58d42a3fb227e5a3f9b` | PASS   |
| SRC-03 | New mailbox source is fingerprinted                            | `tests/eastbrook_mailbox_asset.test.ts`                                                    | `2b7c4ccadf47206173d6dd0106fe9cd59fe5dd4987a71f6d860df5b68335c3a0`                                                                                              | PASS   |
| SRC-04 | New noticeboard source is fingerprinted                        | `tests/eastbrook_noticeboard_asset.test.ts`                                                | `710d294fe63696e041a2465a5ce01a730f4060220be01d6beb309dff8998b72f`                                                                                              | PASS   |
| SRC-05 | Final re-export and generated-file freshness are clean         | Deterministic exporters, optimizer specs, media-manifest regeneration, zero generated diff | Settled mailbox/noticeboard exports, optimizer outputs, and generated manifest match the staged shipping files with no residual binary or manifest diff          | PASS   |

## Authored layout geometry

Primary evidence is `tests/eastbrook_layout.test.ts`, with literal polish anchors also pinned in
`tests/eastbrook_polish_capture_contract.test.ts`.

| ID     | Requirement                                            | Current measured result                                                                                                                 | Status |
| ------ | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| LAY-01 | Layout identifiers remain unambiguous                  | Content ID `eastbrook_civic_layout_v2`; capture contract `polish-v2`; neither is renamed to v3                                          | PASS   |
| LAY-02 | Armoury anchor is preserved                            | `(17.5,-5.5)`, yaw `-pi/2`, `13 x 16.35 x 9`, `15` above grade                                                                          | PASS   |
| LAY-03 | Final Bank lot is exact                                | `(18,10.5)`, yaw `-2.0119758072098772`, `7 x 7.8 x 5.5`                                                                                 | PASS   |
| LAY-04 | Final Smithy lot is pushed outward                     | `(4.8,19.7)`, yaw `-2.876775`, `7 x 7.5 x 5.5`                                                                                          | PASS   |
| LAY-05 | Final Inn lot is exact                                 | `(-12.5,16.5)`, yaw `2.4301335278502854`, `7.5 x 8.5 x 6`                                                                               | PASS   |
| LAY-06 | Final Chapel lot is pushed outward                     | `(-21,-2.3)`, yaw `1.368826`, `5.5 x 7 x 6`                                                                                             | PASS   |
| LAY-07 | Final Weaving lot is pushed outward                    | `(-7.2,-21)`, yaw `0.30338`, `5.5 x 5.8 x 4.5`                                                                                          | PASS   |
| LAY-08 | Final Toolworks lot preserves the combat/gate seam     | `(6.2,-18)`, yaw `-0.3006056700423954`, `5.5 x 5.8 x 4.5`                                                                               | PASS   |
| LAY-09 | Buildings, board, and civic feature do not overlap     | All current OBB pairs are disjoint; all building and board corners remain inside the wall inner face                                    | PASS   |
| LAY-10 | Entrances and authored routes are clear                | Every building front, stall front, board standing point, service-route sample, and banker-chest sample clears its required mover radius | PASS   |
| LAY-11 | Civic composition remains stable                       | Center `(0,2)`; feature `(-0.75,2)`; radius `1.5`; three benches; east arrival quadrant open                                            | PASS   |
| LAY-12 | Market is distributed, not a row                       | `arrangement:'distributed'`, `axisYaw:null`; the two live stalls are more than 8 yards apart                                             | PASS   |
| LAY-13 | World Market stall is exact                            | `(-5.5,9.5)`, yaw `2.508844`, gold canopy, civic radius `9.300537618869136`                                                             | PASS   |
| LAY-14 | Provisions stall is exact                              | `(-9,0.5)`, yaw `1.405648`, green canopy, civic radius `9.124143795447328`                                                              | PASS   |
| LAY-15 | Retired Artisans stall remains absent                  | Removed finishing-pass placement: `(3.5,11.5)`, yaw `-2.788602`, footprint `2.8 x 2.2`; rebuild-v1 history remains unchanged             | PASS   |
| LAY-16 | Live vendors face the public/customer side             | Merchant and Trader stand `1.9` yards along their stall's public `+Z`; Lin remains at the northeast gate with no stall                  | PASS   |
| LAY-17 | Selective low fences remain exact                      | Three Smithy-yard runs at height `0.9`; one Provisions-market edge at `0.75`; all are at most 1 yard high                               | PASS   |
| LAY-18 | Wall and roads remain the accepted rebuild-v1 geometry | Radius `28.4`, 26 chords, six five-yard gates, six road tails, no exterior deletion                                                     | PASS   |
| LAY-19 | Noticeboard placement is exact                         | `(10,-8)`, yaw `-pi/4`, `2.4 x 2.6 x 0.6`, standing point `(9.010050506338834,-7.010050506338834)`                                      | PASS   |
| LAY-20 | Polish overlay inventory matches authoritative layout  | `43` OBBs, `1` circle, `32` points, `6` gates                                                                                           | PASS   |

## Removal inventory and preserved identity

| ID     | Requirement                                                             | Evidence or result                                                   | Status                                                                                                                 |
| ------ | ----------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| INV-01 | Old buildings, stalls, well, campfire, and fences are literally removed | `REMOVED_EASTBROOK_PLACEMENTS` and exact literal tests               | Three old buildings, three stalls, old well, one town campfire, and two old fences remain absent                       | PASS |
| INV-02 | Renderer-only Artisan Row is absent                                     | `tests/artisan_row_props.test.ts`                                    | Ten old Eastbrook placements absent; generic assets retained                                                           | PASS |
| INV-03 | No residual old wiring survives                                         | Layout, renderer, collision, foliage, minimap, rest, and audio tests | Old Eastbrook visuals, foundations, roofs, colliders, exclusions, map shapes, station copies, and stale anchors absent | PASS |
| INV-04 | Exterior Vale content remains ordered                                   | Full prop/camp/road preservation snapshots                           | Camps, mines, docks, graves, roads, POIs, and dynamic Bram preserved                                                   | PASS |
| INV-05 | NPC identity payload is unchanged                                       | Deep comparison in gameplay integration                              | SHA `92c37779f6a29982ec3541169d995fc4365c9696a9b7a0e2fd32713094073db1`                                                 | PASS |
| INV-06 | All 16 town NPC/service coordinates and facings are authoritative        | Literal layout/runtime tables                                        | Lin `(2.8431593444121797,9.717148252611294,-2.788602)`, northeast gate/no stall; Saul `(0,-14.5,-0.3006056700423954)`, Ravenpost; FURY `(-22.5,-7.5,1.171280832795522)`, west-wall Honor Quartermaster with reserved/dynamic semantics; remaining anchors match `final-report.md` | PASS |
| INV-07 | Groundskeeper Bram is unchanged                                         | Zone content snapshot                                                | Dynamic at `(-6,-82)`, facing `pi`                                                                                     | PASS |
| INV-08 | Station identities remain stable                                        | Layout/world-content/station tests                                   | IDs, types, recipes, order, work orders, training, and `STATION_RADIUS=20` retained                                    | PASS |
| INV-09 | Forge and Darva are derived as a pair                                   | Smithy front point and local transform                               | `(3.687633548766497,15.598153967032626)` / `(1.7573530626642033,16.121620532318982)`, separation `2.0`                 | PASS |
| INV-10 | Kitchens and Marlow are derived as a pair                               | Inn local transforms                                                 | `(-11.45529660468886,11.459306117623747)` / `(-12.780764037489869,10.316661779002187)`, separation `1.75`              | PASS |
| INV-11 | Loom and Ottilie are derived as a pair                                  | Weaving front point and local transform                              | `(-6.07969668833487,-17.421254341270934)` / `(-4.171032337012701,-18.01874944082567)`, separation `2.0`                | PASS |
| INV-12 | Toolworks and Gizzel are derived as a pair                              | Toolworks front point and local transform                            | `(5.089629608322198,-14.4181600268458)` / `(6.999944260671105,-13.825962484617639)`, separation `2.0`                  | PASS |
| INV-13 | Mailbox identity and service remain stable                              | Mail and gameplay tests                                              | `mailbox_eastbrook` remains at `(0,-7.5)`; exterior mailbox order unchanged                                            | PASS |
| INV-14 | Banker chest remains decorative                                         | Banker-chest tests and layout samples                                | One non-clickable, non-baked sibling attached to `bursar_fernando`; all samples clear                                  | PASS |
| INV-15 | Rest ownership remains correct                                          | Rest integration                                                     | Inn grants Eastbrook rest; Armoury remains a `house`                                                                   | PASS |
| INV-16 | Custom worlds do not inherit canonical Eastbrook                        | World-content, renderer, foliage, audio, and interaction tests       | Layout, collision, rest, mailbox/noticeboard, and ambience remain content-owned                                        | PASS |

## Noticeboard, gameplay, parity, and online compatibility

| ID      | Requirement                                                       | Evidence                                          | Current result                                                                                                              | Status |
| ------- | ----------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------ |
| GAME-01 | Noticeboard ID never perturbs sequential allocation               | Layout and spawn tests                            | Reserved entity ID `2_000_000_001`; no `nextId` increment or RNG draw                                                       | PASS   |
| GAME-02 | Noticeboard interaction is structured and non-consuming           | Noticeboard and client-helper interaction tests   | Direct click/tap, proximity Use/F, and programmatic target paths emit the same personal structured event                   | PASS   |
| GAME-03 | Noticeboard response is private                                   | Event serialization and server routing tests      | Event is routed only to its `pid`                                                                                           | PASS   |
| GAME-04 | Empty-board response is player-readable                           | HUD/i18n tests                                    | “Nothing seems posted.” through `hudChrome.noticeboard.empty`                                                               | PASS   |
| GAME-05 | Navigation covers every current destination                       | `tests/eastbrook_gameplay_integration.test.ts`    | 36 bidirectional destinations: 6 gates, 16 NPCs, 4 stations, mailbox, board, graveyard, 7 entrances                         | PASS   |
| GAME-06 | Authored service routes include the board                         | Layout route test                                 | Five routes; board route `(2.85,-1.8) -> (6,-6) -> (9.010050506338834,-7.010050506338834)`                                  | PASS   |
| GAME-07 | Existing service interactions remain live                         | Gameplay integration                              | Bank, market, mail, noticeboard, vendor, Card Duel, quest, rest, and four station gates represented                         | PASS   |
| GAME-08 | Spawn, graveyard, corpse, healer, and persisted saves remain safe | Layout, persistence, spirit, and fixed-seed tests | Anchors unchanged; blocked legacy saves escape without RNG                                                                  | PASS   |
| GAME-09 | Pet travel remains represented                                    | Player/pet route and passive-pet tests            | Radius-`0.5` paths through all gates and service destinations                                                               | PASS   |
| PAR-01  | Golden refresh scope is bounded and reviewed                      | Three parity golden diffs                         | Exactly `103/103` lines; moved positions and resulting state digests only                                                   | PASS   |
| PAR-02  | Golden RNG stream is unchanged                                    | Golden diff review                                | All three retain `drawDigest=811c9dc5`, `draws=0`; no intentional event/RNG change                                          | PASS   |
| PAR-03  | Final parity suite passes byte-for-byte                           | `tests/parity/parity.test.ts` in settled gate     | Final parity suite passed inside the 18,919-test canonical gate                                                              | PASS   |
| PAR-04  | Headless observation matches interact-action selection            | `tests/obs_interaction.test.ts`                   | Exact board-4.5/Tinker-4.8 seam advertises and acts on Tinker; authored 4/5-yard boundaries pinned                          | PASS   |
| AUTH-01 | Compatibility epoch is advanced                                   | `src/world_api.ts`, auth scripts                  | `ONLINE_WORLD_LAYOUT_VERSION=3`, discriminator `auth-world-3`                                                               | PASS   |
| AUTH-02 | Both mixed-release directions fail closed                         | Client/server/auth-script tests                   | Version-2/3 mismatches reject before world admission                                                                        | PASS   |
| GAME-10 | Authenticated physical/native interactions                        | Signed physical/native session                    | Not yet exercised                                                                                                           | VERIFY |

## Parsed shipping GLB contracts

Every listed GLB is centered on X/Z, floor-seated at `Y=0`, uses `COLOR_0`, meshopt compression and
quantization, and has zero embedded textures, animations, skins, cameras, and lights.

### Retained rebuild-v1 bundle: historical origin, unchanged in polish v2

| Asset                  | Bounds `W x H x D` |     Bytes | Triangles | Primitives/materials | Status |
| ---------------------- | -----------------: | --------: | --------: | -------------------: | ------ |
| Bank                   |    `7 x 7.8 x 5.5` |  `40,000` |   `2,324` |              `2 / 2` | PASS   |
| Smithy                 |    `7 x 7.5 x 5.5` |  `40,352` |   `2,410` |              `2 / 2` | PASS   |
| Inn                    |    `7.5 x 8.5 x 6` |  `67,768` |   `4,348` |              `2 / 2` | PASS   |
| Chapel                 |      `5.5 x 7 x 6` |  `66,132` |   `4,120` |              `2 / 2` | PASS   |
| Weaving                |  `5.5 x 5.8 x 4.5` |  `40,392` |   `2,412` |              `2 / 2` | PASS   |
| Toolworks              |  `5.5 x 5.8 x 4.5` |  `39,920` |   `2,320` |              `2 / 2` | PASS   |
| Civic well/beacon      |  `3.2 x 3.1 x 3.2` |  `13,216` |     `464` |              `2 / 2` | PASS   |
| Market stall           |  `2.8 x 2.7 x 2.2` |  `27,072` |   `1,314` |              `2 / 2` | PASS   |
| Wall wing              | `6.5 x 2.7 x 0.65` |   `8,352` |     `206` |              `2 / 2` | PASS   |
| Historical v1 subtotal |                n/a | `343,204` |  `19,918` |            `18 / 18` | PASS   |

### Polish-v2 service assets

| ID     | Asset requirement                                  | Exact result                                                                                                                   | Status                         |
| ------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| GLB-01 | Ravenpost mailbox bytes and hash                   | `32,884`; SHA `ae36075f9118d619e6e7239392bcb741e1f3e22d6ea485970498542c9acdfe2c`                                               | PASS                           |
| GLB-02 | Ravenpost mailbox topology                         | `1.65 x 2.9 x 1.05`; `1,640` triangles (`1,336` opaque, `304` metal); `2/2`; two sockets                                       | PASS                           |
| GLB-03 | Noticeboard bytes and hash                         | `24,684`; SHA `5577ec46e9127e8f01f9f7c20444d693e1dcac9c16adab81590326a84e46ef3f`                                               | PASS                           |
| GLB-04 | Noticeboard topology                               | `2.4 x 2.6 x 0.6`; `1,184` triangles (`604` surface, `580` hardware); `2/2`; two sockets                                       | PASS                           |
| GLB-05 | Polish service subtotal                            | `57,568` bytes, `2,824` triangles, `4/4`, zero embedded textures                                                               | PASS                           |
| GLB-06 | Current town/service static total                  | Eleven GLBs: `400,772` bytes, `22,742` triangles, `22/22`; plus atlas = `542,438` bytes across 12 files                        | PASS                           |
| GLB-07 | Replaced-mailbox comparison                        | New mailbox + board versus old mailbox: `-57,520` bytes, `-6,470` triangles, `+3` primitives/materials, `-3` embedded textures | PASS                           |
| GLB-08 | Final deterministic rebuild and manifest freshness | Re-export both assets, regenerate manifest, require no diff                                                                    | Optimized SHA and manifest diff are empty after settled rebuild | PASS |
| GLB-09 | Raw and optimized validation                       | `gltf-transform inspect` and `validate` for both assets                                                                        | Raw and shipping mailbox/noticeboard assets inspect and validate | PASS |

## Civic motion, rendering, and tier fairness

| ID     | Requirement                                                           | Evidence                                  | Current result                                                                                 | Status |
| ------ | --------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------- | ------ |
| REN-01 | Civic motion selects only crystal geometry                            | `tests/eastbrook_civic_beacon.test.ts`    | Shipping GLB test selects exactly 24 `TownEmissive` crystal vertices and leaves every other mask byte zero | PASS   |
| REN-02 | Motion is subtle and deterministic                                    | Shader literals                           | `0.28` rad/s rotation, `0.04` yard bob, emissive range `0.92..1.08`, shared `uTime`            | PASS   |
| REN-03 | Reduced motion removes spatial and pulse animation                    | Standard/Lambert shader tests             | Rotation and bob stop; pulse resolves to `1.0`; steady emissive remains                        | PASS   |
| REN-04 | Motion adds no rendering inventory                                    | Town renderer tests                       | No mesh/draw/shadow/triangle/texture/light/mixer; town root is `18` color / `9` shadow draws and `28,330` / `26,754` triangles | PASS   |
| REN-05 | Frame update allocates nothing                                        | Source test                               | Existing scalar uniform changes only; no per-frame object construction                         | PASS   |
| REN-06 | Low uses the same identity geometry                                   | Lambert asset/material tests              | Mailbox, noticeboard, surface detail, and civic motion retain their gameplay cues              | PASS   |
| REN-07 | Preload and actionable-landmark readiness are tier-independent         | Mailbox/noticeboard/town preload and prewarm-policy tests | Required models load on every preset; Mobile Low enters with visible, compiled mailbox and the ordinary two-view cap intact | PASS   |
| REN-08 | Custom worlds instantiate no canonical town motion/board              | Renderer and content tests                | No canonical Eastbrook geometry or board without built-in content                              | PASS   |
| REN-09 | Grass, minimap, collision, and camera treatments follow polish layout | Focused foliage/map/collider/render tests | Board and moved buildings have authoritative exclusions/OBBs/roof treatment; gates remain open | PASS   |
| REN-10 | Combined static render inventory is exact                             | Capture-contract structural inventory     | Current color `22/31,154`, shadow `11/28,694`, shadows-on `33/59,848`; baseline `19/38,938`, `10/37,342`, `29/76,280`; deltas `+3/-7,784`, `+1/-8,648`, `+4/-16,432` | PASS   |
| REN-11 | Current whole-scene render totals are measured                        | Four matched performance JSON files       | Four views x two repeats, shadows on/off, visible/hidden; native ANGLE Metal on Apple M4 Max     | PASS   |

## Visual capture contract

The polish-v2 contract has 23 matched views: the historical 15 views plus eight finishing-pass views.
Motion evidence adds four paired frames at a `1,600 ms` interval across motion-on and reduced-motion
modes.

| ID     | Requirement                                                                         | Current result                                                                    | Status |
| ------ | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------ |
| VIS-01 | Baseline/before polish captures and metadata exist                                  | Desktop Ultra and Mobile Low before sets are present                              | PASS   |
| VIS-02 | Overlay schema matches current layout                                               | Contract expects `43` OBBs, `1` circle, `32` points, `6` gates                    | PASS   |
| VIS-03 | Complete Desktop Ultra after set is captured and visually accepted                  | All 23 matched `1600 x 900` views and final contact visually accepted              | PASS   |
| VIS-04 | Complete Mobile Low after set is captured and visually accepted                     | All 23 matched `844 x 390`, touch, DPR-3 views and final contact visually accepted | PASS   |
| VIS-05 | Mailbox/noticeboard procedural, raw, optimized, and comparison contacts are present | `polish/assets/ravenpost-mailbox/` and `polish/assets/noticeboard/`               | PASS   |
| VIS-06 | Civic motion and reduced-motion pairs are captured and inspected                    | Four paired frames at the contract's 1,600 ms interval                            | PASS   |
| VIS-07 | All 23 after records pass schema/hash/error/asset validation                        | Current fingerprint; zero page/console/asset failures in both profiles             | PASS   |

## Performance and asset budget

Historical rebuild-v1 performance tables in `final-report.md` are explicitly non-current. The
following rows use the final polish-v2 matched runs.

| ID      | Requirement                                                                    | Current result                                                                               | Status |
| ------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ------ |
| PERF-01 | Desktop Ultra shadows-on matched runs                                          | `683 -> 683.5` calls; `3,413,022 -> 3,401,124.5` triangles; p95 `9.15 -> 9.00 ms`            | PASS   |
| PERF-02 | Desktop Ultra shadows-off matched runs                                         | `431 -> 432.5` calls; `2,607,836 -> 2,604,586.5` triangles; p95 `9.10 -> 9.10 ms`            | PASS   |
| PERF-03 | Mobile Low shadows-on matched runs                                             | `457.5 -> 465.5` calls; `1,270,003 -> 1,260,635` triangles; p95 `9.25 -> 8.95 ms`            | PASS   |
| PERF-04 | Mobile Low shadows-off matched runs                                            | `362.5 -> 369` calls; `1,058,539 -> 1,051,152` triangles; p95 `9.25 -> 8.90 ms`              | PASS   |
| PERF-05 | Town-visible/town-hidden attribution                                           | Direct deltas exactly `22/31,154` color and `11/28,694` shadow                               | PASS   |
| PERF-06 | Preload, heap, programs, textures, long tasks, input latency, and context loss | All recorded; no long tasks, >50 ms frames, context loss, or asset failure; Mobile Low prewarm is `522.0 ms`, two views, with `4,477.9 ms` budget remaining | PASS   |
| PERF-07 | Timing labels remain honest                                                    | CPU/rAF only; no GPU-duration or driver texture-memory claim                                 | PASS   |
| BUD-01  | Static public-asset delta is exact                                             | PR base `142,624,095/1,092`; current `143,051,704/1,103`; delta `+427,609/+11`               | PASS   |
| BUD-02  | Polish improves rebuild-v1 media contribution                                  | `143,108,965 -> 143,051,445`, exactly `-57,520` bytes                                        | PASS   |
| BUD-03  | Pre-existing aggregate failures are separated                                  | Current aggregate remains above global and props limits; this pass improves both             | PASS   |
| BUD-04  | Final settled asset-budget command is recorded                                 | `143,051,704` bytes / `1,103` files; only documented pre-existing aggregate overages         | PASS   |

## Build, native, security, gate, and reviews

No rebuild-v1 PASS count is carried forward as a polish-v2 outcome.

| ID     | Requirement                                            | Exact command or evidence                   | Current status |
| ------ | ------------------------------------------------------ | ------------------------------------------- | -------------- |
| QA-01  | Focused contribution suites                            | Final integrity/capture/observation invocation: 3 files / 36 tests; reviewer suites: 6 files / 84 tests | PASS |
| QA-02  | Existing Armoury and banker contracts                  | Preserved-anchor suites included in the final 18,919-test gate | PASS |
| QA-03  | Typecheck                                              | `npm run check:types`; TypeScript and Svelte checks, 0 errors / 0 warnings | PASS |
| QA-04  | Production web build                                   | `npm run build`; Vite production bundle and 1,093 hashed media assets | PASS |
| QA-05  | Native web build                                       | `npm run build:native`                      | PASS           |
| QA-06  | Full canonical gate                                    | `npm run gate`; 11/11 steps, 1,525 files / 18,919 tests plus 66 browser tests | PASS |
| QA-07  | Deterministic malware scanner                          | 4,426 files / 224 contextual flags / 0 high; all findings triaged | PASS |
| QA-08  | Native simulator build and both landscape orientations | iPhone 16 Pro / iOS 18.4 build, install, orientation, and same-PID resume | PASS |
| QA-09  | Authenticated native in-game town                      | Signed simulator/device session             | VERIFY         |
| QA-10  | Physical iOS GPU, memory, resume, and context recovery | Physical device                             | VERIFY         |
| REV-01 | Frontend specialist review                             | PASS; prior Mobile Low prewarm blocker resolved, no actionable finding | PASS |
| REV-02 | Simulation specialist review                           | PASS; no determinism, RNG, ordering, or authority finding | PASS |
| REV-03 | Cross-platform specialist review                       | PASS; epoch-document drift corrected, no runtime parity finding | PASS |
| REV-04 | Test-coverage specialist review                        | PASS; accepted performance bytes and zero-jank outcomes now literal-pinned | PASS |
| REV-05 | Release-malware specialist review                      | PASS; all 224 scanner findings reconciled, no malicious behavior | PASS |
| REL-01 | One scoped local commit                                | Single scoped amend containing this report; final immutable hash supplied in handoff | PASS |

## Completion rule

The factual polish-v2 layout and source contracts, accepted captures, matched performance,
deterministic settled rebuild, typecheck/build/native/gate results, specialist reviews, and scoped
commit are complete. Physical iOS and authenticated native in-game rows remain explicit `VERIFY`
items unless new device evidence is produced.
