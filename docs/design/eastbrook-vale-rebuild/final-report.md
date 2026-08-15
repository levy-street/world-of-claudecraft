# Eastbrook Vale rebuild: final implementation report

Status: the settled polish-v2 layout and current bank assets, interaction, parity, and rendering
match the implementation. The matched visual captures and CPU/requestAnimationFrame measurements
below are historical polish-v2 evidence from before the bank rebuild, not current bank
performance evidence. Current deterministic geometry budgets, focused tests, web/native builds,
deterministic rebuilds, and specialist review results are recorded below. Authenticated
physical-device play and representative native-GPU performance remain explicit `VERIFY` items;
browser and simulator evidence is not misrepresented as a physical-device pass.

This report sits on top of the PR 2356 banker-chest and Grand Armoury stages, which both
remain preserved in the shipped tree.
Polish v2 pushes four service buildings farther toward the wall, distributes two merchant stalls
through distinct civic pockets, turns their vendors toward the public side, keeps Apothecary Lin
as a separate northeast-gate service anchor, replaces the Ravenpost mailbox, adds an interactable
noticeboard, and gives the civic crystal a zero-draw shader animation with a reduced-motion mode.

`EASTBROOK_LAYOUT.id` deliberately remains `eastbrook_civic_layout_v2`; `polish-v2` is the capture
contract. The incompatible online compatibility epoch is separately advanced to
`ONLINE_WORLD_LAYOUT_VERSION = 3` and `auth-world-3`.

## Authoritative master plan

World units are yards. Rotation is Three.js yaw in radians. Dimensions are width by height by
depth. Player-relative scale is height divided by the `2.6` yard humanoid reference.

| Order | Building                | Position `(x,z)` |              Rotation |             Dimensions `W x H x D` |     Player-height scale | Contract                                                                                |
| ----: | ----------------------- | ---------------: | --------------------: | ---------------------------------: | ----------------------: | --------------------------------------------------------------------------------------- |
|     1 | Eastbrook Grand Armoury |    `(17.5,-5.5)` | `-1.5707963267948966` | `13 x 16.35 x 9`, `15` above grade | `5.77` rigs above grade | Preserved GLB, pipeline, landmark, foundation, and lot; remains the sole major landmark |
|     2 | Bank                    |      `(18,10.5)` | `-2.0119758072098772` |                    `7 x 7.8 x 5.5` |             `3.00` rigs | Bursar and decorative banker-chest apron                                                |
|     3 | Smithy                  |     `(4.8,19.7)` |           `-2.876775` |                    `7 x 7.5 x 5.5` |             `2.88` rigs | Moved outward; forge-facing front and fenced workyard                                   |
|     4 | Inn                     |   `(-12.5,16.5)` |  `2.4301335278502854` |                    `7.5 x 8.5 x 6` |             `3.27` rigs | Sole Eastbrook rest building and kitchens apron                                         |
|     5 | Chapel                  |     `(-21,-2.3)` |            `1.368826` |                      `5.5 x 7 x 6` |             `2.69` rigs | Moved outward; Brother Aldric and quest approach                                        |
|     6 | Weaving workshop        |     `(-7.2,-21)` |             `0.30338` |                  `5.5 x 5.8 x 4.5` |             `2.23` rigs | Moved outward; loom and weaver apron                                                    |
|     7 | Toolworks               |      `(6.2,-18)` | `-0.3006056700423954` |                  `5.5 x 5.8 x 4.5` |             `2.23` rigs | Final seam-safe lot; toolworks and tinker apron                                         |

The Bank and Inn retain their rebuild-v1 lots. The Smithy, Chapel, Weaving workshop, and Toolworks
move outward while retaining wall padding, non-overlapping OBBs, clear entrances, and the six road
corridors. The final Toolworks lot also preserves the deterministic `(2,-21)` combat/open-field
seam and the southeast gate road. Current tests pin every literal above and prove that all building
and noticeboard corners remain inside the wall inner face.

### Civic center and distributed market

The civic axis remains `(0,2)`, with a `4.75` yard clear circulation ring and `1.5` yard path
half-width. The `3.2 x 3.1 x 3.2` yard well and blue-crystal beacon remains at `(-0.75,2)` with its
radius-`1.5` collider. Three `1.8 x 0.6` yard benches remain north `(0,4.9,pi)`, south
`(0,-0.9,0)`, and west `(-2.9,2,pi/2)`; the east arrival quadrant stays open.

The market no longer has a shared axis or a stall row. `market.arrangement` is `distributed` and
`axisYaw` is `null`:

| Stall        | Canopy | Position `(x,z)` |   Rotation |        Civic radius |                      Front standing point |
| ------------ | ------ | ---------------: | ---------: | ------------------: | ----------------------------------------: |
| World Market | Gold   |     `(-5.5,9.5)` | `2.508844` | `9.300537618869136` |    `(-4.55381837226296,8.20975183498178)` |
| Provisions   | Green  |       `(-9,0.5)` | `1.405648` | `9.124143795447328` | `(-7.421769629642221,0.7630378263298812)` |

Both live placements use the same `2.8 x 2.7 x 2.2` yard asset, remain more than eight yards apart,
turn their public side toward civic circulation, and retain clear interaction standing space.
Their vendors stand `1.9` yards from the stall center on that public side and use the same
customer-facing yaw.

The former polish-v2 Artisans placement is deliberately retired: `(3.5,11.5)`, yaw `-2.788602`,
footprint `2.8 x 2.2`. This is a removal from the finishing-pass layout, not a rewrite of the
historical rebuild-v1 three-stall inventory recorded below.

Only four low fence runs remain:

| Fence                  |                            Start `(x,z)` |                                End `(x,z)` |  Width | Height |
| ---------------------- | ---------------------------------------: | -----------------------------------------: | -----: | -----: |
| Smithy west            |  `(10.42562417868173,23.25138741905632)` |    `(9.98067759818833,21.610649005869373)` | `0.28` |  `0.9` |
| Smithy outer           | `(10.214602090559337,23.61944947676462)` |    `(2.107424048929704,25.81800905096731)` | `0.28` |  `0.9` |
| Smithy east            | `(1.739361991221407,25.606986962844914)` |  `(1.2944154107280057,23.966248549657966)` | `0.28` |  `0.9` |
| Provisions-market edge | `(-12.222218917656093,4.01813945810839)` | `(-11.729022993287566,1.0589575136875549)` | `0.28` | `0.75` |

The radius-`28.4` wall, 26 terrain-pitched chord placements, six exact five-yard openings, and six
outgoing road tails remain as accepted in rebuild v1. Its inner and outer radii are `28.075` and
`28.725`; the outer face remains `1.275` yards inside the existing radius-`30` tree exclusion.
Each five-yard chord opening spans `0.176284510114` radians.

| Road             |                   Projected gate crossing | Preserved outside-wall road point |
| ---------------- | ----------------------------------------: | --------------------------------: |
| Wolf/north       | `(-7.190451611555966,27.474668435158083)` |                 `(-7.469,28.539)` |
| Boar/east        |  `(27.443132443127425,7.309889308940804)` |                  `(28.506,7.593)` |
| Bandit           |  `(20.08183258569795,-20.08183258569795)` |                  `(20.86,-20.86)` |
| Mirror/northwest | `(-23.056701749697417,16.58157122909346)` |                 `(-23.95,17.224)` |
| Copper/southwest | `(-20.69365035767656,-19.45077980118619)` |               `(-21.495,-20.204)` |
| Fallen/northeast |  `(19.58928369573657,20.562586517458097)` |                 `(20.348,21.359)` |

Exterior Vale content, fixed camps, road tails, graveyards, Sowfield content, and points of
interest remain preserved. The established seed-`4242` entity-54 wander target remains
`0.8805028274180917` yard clear of wall chord 25, preserving its arrival-timer RNG draw.

## Removed and replaced Eastbrook placements

Removal remains literal and scoped through `REMOVED_EASTBROOK_PLACEMENTS`; reusable assets and
generic render code remain available elsewhere.

| Category                  | Old authored placement removed or replaced                                                                                                                                                                                                                                                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Buildings                 | House `(10,12)`, `7 x 6`, yaw `-0.4`; house `(-10,10)`, `6 x 5`, yaw `0.5`; chapel `(-16,-8)`, `5 x 7`, yaw `0.9`                                                                                                                                                                                                                              |
| Civic                     | Old well `(0,2)`, radius `1.5`, replaced by the civic well and beacon at `(-0.75,2)` with the same collider radius                                                                                                                                                                                                                             |
| Stalls                    | `(-8.5,3)`, yaw `pi/2`, radius `1.7`; `(9.5,17.5)`, yaw `-2.7`, radius `1.7`; `(0,11.5)`, yaw `pi`, radius `1.8`                                                                                                                                                                                                                               |
| Fire                      | Town campfire `(3,-4)`; the kitchens station remains the live cooking-fire owner                                                                                                                                                                                                                                                               |
| Fences                    | `(16,16)` to `(22,4)` and `(-16,14)` to `(-20,2)`                                                                                                                                                                                                                                                                                              |
| Renderer-only Artisan Row | Engineering workbench `(2,20,0.4)`; alchemy cauldron `(5,23,-0.6)`; cooking spit `(9,25,0)`; leatherworking rack `(13,24,0.9)`; tailoring loom `(13.5,20.5,1.6)`; inscription lectern `(19.5,14.5,2.4)`; enchanting altar `(16,13,-2.6)`; jewelcrafting bench `(15,9,-1.8)`; mining ore cart `(3,12,-0.9)`; herbalism drying rack `(1,16,0.3)` |
| Residual wiring           | Old visual dispatch, foundations, roofs, colliders, grass exclusions, minimap shapes, station duplication, and Eastbrook-only audio anchors with no surviving visible owner                                                                                                                                                                    |

The old NPC coordinates replaced by the authoritative layout were:

| NPC                   | Old position `(x,z)` | Old facing |
| --------------------- | -------------------: | ---------: |
| `the_merchant`        |            `(0,9.5)` |       `pi` |
| `marshal_redbrook`    |              `(4,6)` |       `pi` |
| `trader_wilkes`       |             `(-7,3)` |     `pi/2` |
| `apothecary_lin`      |            `(11,-3)` |    `-pi/2` |
| `brother_aldric`      |          `(-14,-10)` |      `0.8` |
| `smith_haldren`       |           `(7,16.5)` |     `-2.7` |
| `fisherman_brandt`    |            `(-16,6)` |    `-0.75` |
| `foreman_odell`       |           `(-4,-14)` |    `-2.14` |
| `bursar_fernando`     |             `(13,8)` |    `-pi/2` |
| `card_master`         |             `(13,2)` |    `-pi/2` |
| `chronicler_saul`     |           `(15,-16)` |      `2.4` |
| `forgemistress_darva` |             `(5,15)` |     `-2.4` |
| `cook_marlow`         |          `(-12.5,3)` |     `pi/2` |
| `weaver_ottilie`      |            `(-4,-9)` |      `0.8` |
| `tinker_gizzel`       |          `(9.5,-14)` |     `-0.8` |

The replaced station-cluster anchors were forge `(7,16.5)`, kitchens `(-11,4.5)`, loom
`(-2,-8)`, and toolworks `(11,-12)`. Current station positions are derived from the new buildings
below instead of duplicating unrelated coordinate literals.

## NPC and service placement

All stable IDs, names, titles, greetings, colors, vendor stock, quest links, flags, source order,
and dynamic semantics remain preserved. The non-placement NPC payload SHA remains
`92c37779f6a29982ec3541169d995fc4365c9696a9b7a0e2fd32713094073db1`.

| NPC                   |                           Position `(x,z)` |                Facing | Current association                                       |
| --------------------- | -----------------------------------------: | --------------------: | --------------------------------------------------------- |
| `the_merchant`        |   `(-4.376409317062264,7.967830304040863)` |            `2.508844` | Public side of World Market stall; `market:true` retained |
| `marshal_redbrook`    |                                `(4.5,5.5)` | `-2.2318394956455836` | Civic-center quest anchor                                 |
| `trader_wilkes`       |   `(-7.125851435200138,0.812357418766734)` |            `1.405648` | Public side of Provisions stall                           |
| `apothecary_lin`      |   `(2.8431593444121797,9.717148252611294)` |           `-2.788602` | Northeast-gate service anchor; no stall                   |
| `brother_aldric`      | `(-16.59147045515334,-1.3973000209293893)` |            `1.368826` | Chapel approach                                           |
| `smith_haldren`       |   `(5.617914034868791,15.074687401746273)` |           `-2.876775` | Smithy forge apron                                        |
| `fisherman_brandt`    |                                  `(-22,4)` |   `1.661456213995642` | Northwest gate/fishing approach                           |
| `foreman_odell`       |                                `(-8,-9.5)` |            `0.607802` | Southwest mine/professions route                          |
| `bursar_fernando`     |   `(14.156943251329539,8.685223202016726)` | `-2.0119758072098772` | Bank apron; `banker:true` retained                        |
| `card_master`         |                                 `(10.5,1)` | `-1.4758446204521403` | Civic/Armoury Card Duel anchor                            |
| `chronicler_saul`     |                                  `(0,-14.5)` | `-0.3006056700423954` | Ravenpost service anchor                                  |
| `forgemistress_darva` |  `(1.7573530626642033,16.121620532318982)` |           `-2.876775` | Forge master                                              |
| `cook_marlow`         | `(-12.780764037489869,10.316661779002187)` |  `2.4301335278502854` | Kitchens master                                           |
| `weaver_ottilie`      |  `(-4.171032337012701,-18.01874944082567)` |             `0.30338` | Loom master                                               |
| `tinker_gizzel`       |  `(6.999944260671105,-13.825962484617639)` | `-0.3006056700423954` | Toolworks master                                          |
| `FURY`                |                               `(-22.5,-7.5)` |   `1.171280832795522` | West-wall Honor Quartermaster; reserved/dynamic semantics |

`FURY` retains the Honor Quartermaster's reserved-ID and conditional/dynamic spawn behavior; the
new row records placement only and does not convert that NPC into an ordinary sequential spawn.
`groundskeeper_bram` remains the unchanged dynamic exterior NPC at `(-6,-82)`, facing `pi`.

### Derived station and master pairs

`STATION_RADIUS` remains `20`. IDs, types, recipes, work orders, training, and decorative-cluster
offsets remain unchanged.

| Station                       |                  Derived position `(x,z)` | Master              |                    Master position `(x,z)` | Separation |
| ----------------------------- | ----------------------------------------: | ------------------- | -----------------------------------------: | ---------: |
| `station_eastbrook_forge`     |  `(3.687633548766497,15.598153967032626)` | Forgemistress Darva |  `(1.7573530626642033,16.121620532318982)` |      `2.0` |
| `station_eastbrook_kitchens`  | `(-11.45529660468886,11.459306117623747)` | Cook Marlow         | `(-12.780764037489869,10.316661779002187)` |     `1.75` |
| `station_eastbrook_loom`      | `(-6.07969668833487,-17.421254341270934)` | Weaver Ottilie      |  `(-4.171032337012701,-18.01874944082567)` |      `2.0` |
| `station_eastbrook_toolworks` |   `(5.089629608322198,-14.4181600268458)` | Tinker Gizzel       |  `(6.999944260671105,-13.825962484617639)` |      `2.0` |

Forge, loom, and toolworks use their building `frontStandingPoint`; kitchens uses a stable local
Inn transform. Masters and decorative props are then derived from those authoritative anchors.

## Ravenpost mailbox and noticeboard

The Eastbrook mailbox service remains at `(0,-7.5)`, with body radius `0.8` and interaction radius
`7`. Its `mailbox_eastbrook` identity and service behavior are unchanged; only the shipping model
is replaced with the new Ravenpost pillar.

The new noticeboard is a real, future-extensible world service:

- Layout ID `eastbrook_noticeboard`; stable reserved entity ID `2_000_000_001`.
- Template `noticeboard_eastbrook`; position `(10,-8)`; yaw `-0.7853981633974483`.
- Dimensions `2.4 x 2.6 x 0.6`; front standing point
  `(9.010050506338834,-7.010050506338834)`; authored interaction radius `4`.
- Spawned as a non-consumed lootable object with an OBB collider and a visual/sight top derived
  from terrain plus height.
- Direct click/tap, proximity `F`/Use, and the programmatic targeted-interaction command emit the
  same personal structured event
  `{ type:'noticeboard', noticeboardId:'noticeboard_eastbrook', state:'empty', pid }`.
- Server routing sends the event only to that player. The HUD localizes it as
  “Nothing seems posted.” Normal range and dead-player gates remain active.
- The high static ID neither increments the sequential entity allocator nor draws RNG. Custom
  worlds receive the board only when their active `WorldContent` supplies it.

## Gameplay, parity, and persistence

- Player start remains `(2,-2)` and the start-to-square route remains clear.
- The graveyard remains `(-14,-14)`, legacy release remains `(-12,-14)`, Spirit Healer facing
  remains `pi`, and all six headstones remain authored and visible.
- The banker chest remains one cosmetic, non-clickable, collision-aware sibling resolved from
  `banker:true`; it is not baked into the Bank GLB.
- Bank, market, mail, noticeboard, vendors, Card Duel, quests, rest, and four crafting stations
  retain their established contracts. The Inn remains Eastbrook's sole rest building; the Armoury
  remains a `house` for rested-XP purposes.
- Bidirectional player/pet pathfinding now covers 36 destinations:
  `6 gates + 16 NPCs + 4 stations + mailbox + noticeboard + graveyard + 7 entrances`.
- The authored service-route inventory has five routes: start-to-square, mailbox, noticeboard,
  graveyard, and Armoury approach. The noticeboard route is
  `(2.85,-1.8) -> (6,-6) -> (9.010050506338834,-7.010050506338834)`.
- Current polish overlay inventory is exactly `43` OBBs, `1` circle, `32` points, and `6` gates.
- The pre-bank polish-v2 capture contract's `23` matched views remain complete and visually
  accepted as historical evidence on Desktop Ultra and Mobile Low. Current bank-specific visual
  evidence is recorded separately.
- Fixed-seed camps, object/mob ordering, mailbox IDs, persisted-position escape, graveyard flows,
  and the established entity-54 arrival-timer RNG seam remain protected by decisive tests.
- Browser/native proximity and click helpers, authoritative simulation interaction, and the
  headless/RL interactable observation share the noticeboard's inclusive four-yard range. At the
  exact board-4.5/Tinker-4.8 seam, both observation and action select Tinker.
- `ONLINE_WORLD_LAYOUT_VERSION` is `3`; `ONLINE_WORLD_AUTH_TYPE` is `auth-world-3`. Both
  mixed-release mismatch directions reject before world admission.
- Renderer, collision, rest, stations, noticeboards, mailbox, grass, minimap, audio, server,
  offline, editor, and custom-world consumers continue to use active `WorldContent`.
- No database, schema, stored-data, or migration change is present.

Exactly three parity goldens were deliberately refreshed for the moved vendors:

| Golden                      |   Seed | Ticks | Frames | Reviewed change                                         |
| --------------------------- | -----: | ----: | -----: | ------------------------------------------------------- |
| `inventory_vendor.json`     | `5150` |   `0` |   `14` | Trader-gated player position and resulting state digest |
| `market_round_trip.json`    | `1019` |  `20` |   `11` | World Market player position and resulting state digest |
| `quest_collect_turnin.json` | `1015` |   `2` |    `7` | Trader/quest position and resulting state digest        |

The reviewed diff is `103` insertions and `103` deletions. All three retain
`drawDigest = 811c9dc5` and `draws = 0`; `nextId`, event behavior, and RNG behavior are not
intentionally changed.

## Shipping assets

### Historical rebuild-v1 town bundle

This table records the rebuild-v1 snapshot. It remains historical evidence and is not relabeled
with the current bank rebuild's hashes or measurements.

| Shipping GLB                      |     Bytes | Triangles | Primitives/materials | Textures/animations/skins | SHA-256                                                            |
| --------------------------------- | --------: | --------: | -------------------: | ------------------------: | ------------------------------------------------------------------ |
| `eastbrook_bank.glb`              |  `40,000` |   `2,324` |              `2 / 2` |               `0 / 0 / 0` | `d8de1129edf7bdf7789b1cf0a1088eb492c7617948c4c05d34c95b43876f97cf` |
| `eastbrook_smithy.glb`            |  `40,352` |   `2,410` |              `2 / 2` |               `0 / 0 / 0` | `f07fb30a58733982216e51e99abcb29d9323df8035820a74ab6919d865824c21` |
| `eastbrook_inn.glb`               |  `67,768` |   `4,348` |              `2 / 2` |               `0 / 0 / 0` | `16213ff1526914d7448d87ac12667fe4702ae76edee9acfc50f26478242af902` |
| `eastbrook_chapel.glb`            |  `66,132` |   `4,120` |              `2 / 2` |               `0 / 0 / 0` | `efe504a2d46e3eadaba772e35c893647e867ee2ee9fde252890d971a98c75af0` |
| `eastbrook_weaving_workshop.glb`  |  `40,392` |   `2,412` |              `2 / 2` |               `0 / 0 / 0` | `bd3e8486102bcab9a8e8385631b4bf09e2d9b9c4d41eec8e0d6a150def93514d` |
| `eastbrook_toolworks.glb`         |  `39,920` |   `2,320` |              `2 / 2` |               `0 / 0 / 0` | `a87b4b647b07555209448c4a34642c230b457648d9aff4d99c50605c405626d1` |
| `eastbrook_civic_well_beacon.glb` |  `13,216` |     `464` |              `2 / 2` |               `0 / 0 / 0` | `b999fde017b1c67cf54dd45bc1648b0f11c7208b6e8e8cf24c0cafb818b2e76e` |
| `eastbrook_market_stall.glb`      |  `27,072` |   `1,314` |              `2 / 2` |               `0 / 0 / 0` | `c6a3fbca05b6dcd27669be04ae163e7727d9914a9c8f9ce3d3fb9f1c776915ff` |
| `eastbrook_wall_wing.glb`         |   `8,352` |     `206` |              `2 / 2` |               `0 / 0 / 0` | `63c6f1a7009d8981355c6f63449e0baf9afa23be137231b4446ce59618b4a3b5` |
| Historical v1 subtotal            | `343,204` |  `19,918` |            `18 / 18` |               `0 / 0 / 0` | n/a                                                                |

### Current bank rebuild and town bundle

The bank was rebuilt from its Eastbrook turnaround while retaining its exact
`7 x 7.8 x 5.5` runtime envelope, two materials, two primitives, and two named sockets. The
shipping bank is `52,508` bytes and `3,104` triangles (`2,928` opaque and `176` emissive), with
SHA-256 `59ee6025292eaeb616708be569d55d50d4f2de2077d0ab9418b6265054102c34`.
Its source fingerprint is
`4430923952c20d7a5883b54aea8b09fe305b392090aec5968b73bd8cf5b7a02a`.

The rebuilt facade keeps the arched entrance visible, aligns the teller counter with its awning,
posts, and socket, and leaves the secure alcove empty so the separate runtime banker chest is not
duplicated. The full nine-GLB town bundle is now `355,708` bytes and `20,698` unique triangles.
Repeated town placement plus the six optional foundation skirts is `29,110` triangles, leaving
`890` triangles below the `30,000` target.

The retained shared `512 x 512` lossless WebP atlas is `141,666` bytes, SHA-256
`d66f2fab603aa83e6c73c6fc4bdde2d545a6d8c1a0d4a58d42a3fb227e5a3f9b`.

### Polish-v2 rebuilt and new service assets

| Shipping GLB                |  Bounds `W x H x D` |    Bytes | Triangles | Primitives/materials | Textures/animations/skins | SHA-256                                                            | Source fingerprint                                                 |
| --------------------------- | ------------------: | -------: | --------: | -------------------: | ------------------------: | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `mailbox_pillar.glb`        | `1.65 x 2.9 x 1.05` | `32,884` |   `1,640` |              `2 / 2` |               `0 / 0 / 0` | `24678a6bbc8e8b25926b3c17298b959f0cbd149c7641e1a3331a02a3c19c4207` | `3c6803552368b495ac05758cf7dbe8dd393f8c6cfd4625c587362898e6db687b` |
| `eastbrook_noticeboard.glb` |   `2.4 x 2.6 x 0.6` | `24,684` |   `1,184` |              `2 / 2` |               `0 / 0 / 0` | `a53a3f9818ca57f593ccc448cb1b60862a28bf9cf0d1b17baf43eb6942a0516f` | `12435757b245583bb91a26450f5bfcf76c3532399b5d8f024af8dae30078265e` |
| Polish-v2 service subtotal  |                 n/a | `57,568` |   `2,824` |              `4 / 4` |               `0 / 0 / 0` | n/a                                                                | n/a                                                                |

Both are centered on X/Z, floor-seated at `Y=0`, use `COLOR_0`, meshopt compression and
quantization, contain two semantic sockets, and contain no embedded texture, animation, skin,
camera, or light. Standard and Lambert-compatible Low materials reuse the existing Eastbrook
surface atlas at runtime.

The replaced mailbox was `115,088` bytes, `9,294` triangles, one primitive/material, and three
embedded textures. Mailbox replacement plus noticeboard therefore changes the static service-asset
inventory by `-57,520` bytes, `-6,470` triangles, `+3` primitives/materials, and `-3` embedded
textures.

The current 11-GLB town/service set totals `413,276` GLB bytes, `23,522` unique triangles, and
`22` primitives/materials. Including the shared atlas, it is `554,942` bytes across 12 files.
Including the preserved Grand Armoury (`137,012` bytes, `8,226` triangles, `6/6`) and banker chest
(`43,956` bytes, `2,048` triangles, `4/4`), the complete listed media is `735,910` bytes and
`33,796` unique GLB triangles.

## Civic animation and runtime rendering

The civic crystal is animated in the existing merged micro-emissive draw rather than by a GLB
animation or mixer:

- A normalized Uint8 `eastbrookCivicMask` selects exactly the shipping
  `TownEmissive` primitive's 24 crystal vertices; every other emissive vertex remains zero.
- Shared `uTime` drives `0.28` radians/second rotation, a `0.04` yard sine bob, and emissive pulse
  from `0.92` to `1.08`.
- Standard and Lambert shader paths use the stable `eastbrook-civic-beacon-v1` program key.
- Reduced motion stops rotation and bob, resolves pulse to `1.0`, and retains a steady emissive
  crystal.
- No mesh, draw, shadow draw, triangle, texture, light, mixer, or per-frame object allocation is
  added. The town-root structural contract remains `18` color draws and `9` shadow draws, with
  `29,110` color triangles and `27,554` shadow triangles.

The deterministic static render inventories are:

| Inventory | Color draws / triangles | Shadow draws / triangles | Shadows-on draws / triangles |
| --------- | -----------------------: | ------------------------: | ---------------------------: |
| Baseline combined town set | `19 / 38,938` | `10 / 37,342` | `29 / 76,280` |
| Current town + Ravenpost mailbox + noticeboard | `22 / 31,934` | `11 / 29,494` | `33 / 61,428` |
| Current minus baseline | `+3 / -7,004` | `+1 / -7,848` | `+4 / -14,852` |

These current literal renderer-structure counts come from the shipping meshes and direct draw
inventory. Earlier native measurements remain clearly separated as historical evidence.

## Performance

### Historical rebuild-v1 measurements - not polish-v2 acceptance evidence

The prior completed report measured PR-2356-before against rebuild-v1-after on Apple M4 Max ANGLE
Metal. Those results are retained only as historical context:

| Profile       | Shadows | Calls before -> v1 |       Triangles before -> v1 | CPU submit before -> v1 | rAF p95 before -> v1 |
| ------------- | ------- | -----------------: | ---------------------------: | ----------------------: | -------------------: |
| Desktop Ultra | On      |    `807.75 -> 678` |   `3,484,888.5 -> 3,404,486` |     `2.575 -> 2.400 ms` |   `10.10 -> 9.50 ms` |
| Desktop Ultra | Off     | `491.25 -> 428.25` |     `2,647,351 -> 2,605,761` |     `2.025 -> 1.900 ms` |   `10.05 -> 9.25 ms` |
| Mobile Low    | On      | `562.25 -> 459.75` | `1,330,790.5 -> 1,271,875.5` |     `1.800 -> 1.700 ms` |    `9.55 -> 9.65 ms` |
| Mobile Low    | Off     |    `410 -> 363.25` |   `1,080,253 -> 1,055,781.5` |     `1.500 -> 1.450 ms` |    `9.75 -> 9.65 ms` |

These values predate the distributed layout, replacement mailbox, noticeboard, and civic shader.

### Historical polish-v2 matched measurements before the bank rebuild

These committed measurements retain the accepted pre-bank-rebuild town fingerprint. They are not
relabeled as evidence for the rebuilt bank. The final harness ran four identical views (main gate,
elevated, central, and Armoury-facing) with
two warmed repeats per shadow state. Values below are medians of the eight town-visible samples;
`max` and the second input-latency value are the worst corresponding samples. The baseline is the
exact `3ab740db453bd8b5858a52c304edc811c9d520ca` rebuild-v1 tree. Both profiles used native ANGLE
Metal on Apple M4 Max (`Google Inc. (Apple)`); all timing is CPU/requestAnimationFrame timing, not
GPU time.

| Profile | Shadows | Whole-scene calls before -> after | Shadow draws | Whole-scene triangles before -> after | CPU submit median | rAF p95 / p99 before -> after | Worst max before -> after | Input-visible p95 median/worst before -> after |
| ------- | ------- | --------------------------------: | -----------: | -------------------------------------: | ----------------: | ----------------------------: | ------------------------: | ---------------------------------------------: |
| Desktop Ultra `1600 x 900` | On | `683 -> 683.5` | `10 -> 11` | `3,413,022 -> 3,401,124.5` | `2.50 -> 2.50 ms` | `9.15/9.30 -> 9.00/9.30 ms` | `9.4 -> 9.4 ms` | `8.55/9.20 -> 8.80/10.20 ms` |
| Desktop Ultra `1600 x 900` | Off | `431 -> 432.5` | `0 -> 0` | `2,607,836 -> 2,604,586.5` | `2.00 -> 2.00 ms` | `9.10/9.40 -> 9.10/9.35 ms` | `9.4 -> 9.4 ms` | `8.50/8.90 -> 8.70/10.40 ms` |
| Mobile Low `844 x 390`, touch, DPR 3 | On | `457.5 -> 465.5` | `10 -> 11` | `1,270,003 -> 1,260,635` | `1.70 -> 1.80 ms` | `9.25/9.40 -> 8.95/9.30 ms` | `9.4 -> 9.4 ms` | `8.70/9.40 -> 8.60/9.20 ms` |
| Mobile Low `844 x 390`, touch, DPR 3 | Off | `362.5 -> 369` | `0 -> 0` | `1,058,539 -> 1,051,152` | `1.40 -> 1.50 ms` | `9.25/9.40 -> 8.90/9.25 ms` | `9.9 -> 9.5 ms` | `8.75/9.30 -> 8.90/9.20 ms` |

All four cases held a `120` FPS mean on this 120 Hz host, with zero frames above `50 ms`, zero
long tasks, zero context loss, and zero asset-load failures. Renderer world p95 stayed
`0.2 ms`. Shadows-on submit p95 median/worst measured `2.70/2.90 -> 2.80/2.90 ms` on Desktop and
`2.00/2.10 -> 2.05/2.20 ms` on Mobile. The isolated Desktop input worst moved from `9.2` to
`10.4 ms`, while its median moved at most `0.25 ms`, the frame maximum remained `9.4 ms`, and all four profiles
remained within the same 120 Hz rAF envelope. The larger structural signal is favorable: every
profile renders fewer triangles than the exact baseline.

| Profile | Cold navigation/boot | Preload wait | Renderer prewarm | Geometries | Textures | Programs | Heap median/worst |
| ------- | -------------------: | -----------: | -----------------: | ---------: | -------: | -------: | ----------------: |
| Desktop Ultra | `10,192 -> 10,160 ms` | `0.6 -> 0.6 ms` | `1,621 -> 1,672.2 ms` | `535 -> 539` | `547 -> 544` | `259 -> 262` | `457.35/474.02 -> 458.22/473.86 MiB` |
| Mobile Low | `6,098 -> 6,150 ms` | `0.5 -> 0.5 ms` | `496.5 -> 522.0 ms` | `306 -> 310` | `121 -> 115` | `139 -> 142` | `341.17/356.24 -> 342.44/356.66 MiB` |

The Mobile Low prewarm increase is intentional and bounded: the actionable spawn-mailbox landmark
readiness phase completes in `16.0 ms`, while the full async compiler phase is `57.2 ms`. It still
creates exactly two entry views (`player:warrior`, `object:mailbox`), leaves the out-of-range
noticeboard lazy, finishes with `4,477.9 ms` of its 5-second budget unused, and reports no failed or
timed-out entry. Lazily streamed object views now remain hidden while `compilePending` is true and
become visible only after shader readiness.

The four JSON files under `polish/performance/` contain every repeat, visible/hidden attribution,
resource sample, renderer phase, and input probe. WebGL does not expose reliable driver texture
memory or GPU duration here, so the evidence reports texture counts and labels that limitation.

## Asset budget

The final static public-asset accounting is:

| Snapshot              |  Public bytes | Public files | Delta from PR 2356 |
| --------------------- | ------------: | -----------: | -----------------: |
| PR 2356 base          | `142,624,095` |      `1,092` |                n/a |
| Historical rebuild v1 | `143,108,965` |      `1,102` |   `+484,870 / +10` |
| Current bank rebuild  | `143,085,136` |      `1,104` |   `+461,041 / +12` |

The shipping service binaries are exactly `57,520` bytes smaller than rebuild v1 while adding the
noticeboard. Against the current release branch, the bank rebuild adds exactly `12,504` bytes.
The current tree remains `23,829` bytes below rebuild v1. `node scripts/asset_budget.mjs --json`
settled at `143,085,136` bytes / `1,104` files and reports the repository's pre-existing aggregate
failures (`136.457 MiB` total and the
existing character, creature, props, dungeon, and weapon group overages). This finishing pass
does not cause those inherited failures.

## Native iOS

Historical rebuild-v1 simulator build and landing-shell evidence remains under
`docs/screenshots/eastbrook-vale-rebuild/native-ios/`; it is not current polish-v2 in-game proof.

| Check                                                       | Current polish-v2 status |
| ----------------------------------------------------------- | ------------------------ |
| `npm run build:native`                                      | PASS                     |
| Capacitor sync and iPhone 16 Pro / iOS 18.4 simulator build | PASS                     |
| Both simulator landscape orientations and background/resume | PASS for the native landing shell; same app PID resumed |
| Authenticated native in-game Eastbrook                      | VERIFY                   |
| Physical-device GPU, memory, context recovery, and input    | VERIFY                   |

`npm run native:sync` completed, the Debug simulator target built with `xcodebuild`, and bundle
`com.worldofclaudecraft` installed and launched. Both supported landscape orientations were
visually inspected in the iOS 18.4 simulator; sending the app to Settings and foregrounding it
resumed the same PID. This proves current shell packaging, orientation, safe-area, and basic resume
behavior. Browser Mobile Low evidence and simulator-shell evidence do not substitute for an
authenticated in-game physical-device pass or physical GPU/context-recovery evidence.

## Current bank rebuild QA and review state

The bank rebuild is checked in its isolated release-v0.31.0 worktree:

| Check | Current outcome |
| ----- | --------------- |
| Deterministic town export, GLB validation, manifest regeneration, and literal asset contracts | PASS |
| Focused changed-asset, renderer, capture-contract, and historical-evidence suites | PASS: 5 files / 61 tests |
| Asset budget versus exact release base | PASS for scoped delta: `+12,504` bytes, entirely in props; the same six aggregate failure categories exist on the clean base |
| `npm run gate` | PASS: all 11 steps; 1,604 test files / 20,471 tests plus 8 browser files / 68 browser tests |

## Historical polish-v2 QA and review state

Historical v1 pass counts did not satisfy polish-v2 acceptance. These are the recorded polish-v2
commands and outcomes from before the bank rebuild, not current bank-rebuild QA:

| Check                                                                                                    | Recorded outcome |
| -------------------------------------------------------------------------------------------------------- | --------------- |
| Focused asset, layout, interaction, renderer, parity, auth, capture-contract, and preserved-anchor tests | PASS: final integrity/capture/observation command: 3 files / 36 tests; reviewer suites: 6 files / 84 tests |
| Deterministic re-export, optimizer freshness, manifest freshness, GLB inspect/validate                   | PASS: settled outputs validated; no residual shipping-binary or manifest diff |
| `npm run check:types`                                                                                    | PASS: TypeScript and Svelte, 0 errors / 0 warnings |
| `npm run build`                                                                                          | PASS: production bundle plus 1,093 hashed media assets |
| `npm run build:native`                                                                                   | PASS |
| `npm run gate`                                                                                           | PASS: 11/11 stages; 1,525 files / 18,919 tests, 5 files / 48 tests skipped; 66/66 browser tests |
| `node scripts/asset_budget.mjs --json` final settled run                                                 | RECORDED: 143,051,704 bytes / 1,103 files; nonzero only for documented pre-existing aggregate overages |
| Deterministic malware scan                                                                               | PASS: 4,426 files / 224 contextual flags / 0 high; all findings reconciled |
| Frontend specialist review                                                                               | PASS: prior Mobile Low blocker resolved; no actionable frontend/render/mobile finding |
| Simulation specialist review                                                                             | PASS: no determinism, RNG, ordering, persistence, or authority finding |
| Cross-platform specialist review                                                                         | PASS: no runtime parity finding; stale epoch-2 documentation corrected |
| Test-coverage specialist review                                                                          | PASS: no remaining coverage finding; performance evidence and zero-jank results literal-pinned |
| Release-malware specialist review                                                                        | PASS: no confirmed or unresolved malicious behavior |
| Scoped local commit and hash                                                                             | PASS: single scoped amend; immutable hash supplied in the handoff |

## Evidence index

Retention policy: every capture matrix below was recorded and visually accepted in full,
then deliberately pruned to matched hero views after acceptance to keep the repository
lean. The complete per-view record survives in the capture metadata JSONs and the contact
sheets; the deleted full-resolution frames are regenerable with the committed capture
helpers. The evidence integrity tests pin the retained inventories exactly.

- Original rebuild master concept: `docs/screenshots/eastbrook-vale-rebuild/concepts/`.
- Polish-v2 master concept: `docs/screenshots/eastbrook-vale-rebuild/polish/concepts/master-concept.png`.
- Polish-v2 turnarounds:
  `docs/screenshots/eastbrook-vale-rebuild/polish/turnarounds/ravenpost-mailbox.png` and
  `docs/screenshots/eastbrook-vale-rebuild/polish/turnarounds/noticeboard.png`.
- Polish-v2 img2threejs intake, admitted views, inventories, sculpt specifications, and staged
  reviews: `docs/design/eastbrook-vale-rebuild/polish-img2threejs/`.
- Mailbox and noticeboard procedural/raw/optimized/lookdev/comparison contacts:
  `docs/screenshots/eastbrook-vale-rebuild/polish/assets/`.
- Current bank procedural, raw, optimized, comparison, lighting, player-scale, and bounds contacts:
  `docs/screenshots/eastbrook-vale-rebuild/assets/bank-*.png`.
- Current bank matched in-game before and after views for Desktop Ultra and Mobile Low:
  `docs/screenshots/eastbrook-vale-rebuild/bank-rebuild/before/` and
  `docs/screenshots/eastbrook-vale-rebuild/bank-rebuild/after/`.
- Prompts, provenance, and rights: `imagegen-prompts.md`, `imagegen-provenance.md`, and
  `CREDITS.md`.
- Historical rebuild-v1 desktop/mobile evidence: `docs/screenshots/eastbrook-vale-rebuild/before/`,
  `after/`, `metadata/`, and `performance/`.
- Polish-v2 matched baseline: `docs/screenshots/eastbrook-vale-rebuild/polish/before/` and
  `polish/metadata/before-*.json`.
- Polish-v2 accepted after captures before the bank rebuild:
  `docs/screenshots/eastbrook-vale-rebuild/polish/after/`
  retains the matched hero views (ten Desktop Ultra views plus the four desktop civic
  motion/reduced-motion frames, and the two Mobile Low heroes). The accepted runs recorded
  all 23 matched views per profile with their accepted historical fingerprint and zero page,
  console, or asset-load failures; that complete per-view record survives in
  `polish/metadata/` and the after contact sheets.
- Visually accepted after contacts:
  `polish/contacts/after-desktop-ultra-contact.webp` and
  `polish/contacts/after-mobile-low-contact.webp`.
- Historical matched performance JSON:
  `docs/screenshots/eastbrook-vale-rebuild/polish/performance/`.

## Remaining risks and compromises

- The civic motion uses a focused shader deformation rather than GLB animation. This preserves the
  same draw/mesh inventory and avoids a mixer, while still providing visible movement and a proper
  reduced-motion mode.
- Actual driver texture memory and GPU time remain unavailable through the WebGL harness; the final
  evidence therefore reports texture counts and labels CPU/rAF timing honestly.
- Physical iOS and authenticated native in-game verification remain explicit `VERIFY` items unless
  new device evidence is produced. Simulator landing-shell orientation and resume passed, but no
  physical device was attached and the authenticated town was not entered inside the native shell.
- Real screen-reader/forced-colors announcement behavior and a contrived overlapping-landmark
  pre-input-unlock browser position remain explicit `VERIFY` items. The canonical Mobile Low spawn
  probe, interaction-radius tests, reduced-motion behavior, and ordinary prewarm cap all pass.
- The full repository asset budget remains over pre-existing aggregate limits. The current tree
  remains `23,829` bytes below rebuild v1 after the bank adjustment.
