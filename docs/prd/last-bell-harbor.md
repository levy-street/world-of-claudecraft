# The Last Bell harbor program (H1 to H3)

The boat/dock experience for the Farshore crossing, specced after the owner's
2026-07-27 review of the first pass ("a plank kit and a dinghy"). Target: a
grand dock with a big walkable boardwalk, a real ship moored beside it, a
ferryman you talk to on the dock, a purchased fare, and a departure cutscene
with bell sound as the ship casts off. Three phases, each independently
playable and reviewed by the owner before the next starts.

Decisions (owner may reverse; each is localized):
- **Cutscene crossing, not a walkable moving ship.** The fare dialog boards
  you; the cinematic sells the voyage (the campaign doc's Final Fantasy
  model). A walkable moving vessel is a vehicle/moving-platform engine
  feature and is explicitly out of scope for this program.
- **Ship asset: the owned CC0 fleet** (`public/models/biome/sea_boat_sail_a.glb`
  first candidate, `sea_boat_sail_b` / `beach_ship` as alternates; Quaternius
  Pirate Kit and Kenney Pirate Kit both credited in CREDITS.md). No new
  dependencies, no procedural hull.
- The existing 3-section dock kit (`src/sim/dock_layout.ts`) stays for
  village fishing jetties but is NOT the harbor: it is hard-capped at a
  ~6 yd deck and each dock seats on its own anchor terrain (a chained
  anchor in deep water drowns its planks; learned the hard way).

## H1: The harbor (structure + ship + ferryman placement)

The two landings (the vale's east point and Gullhaven's bay) get real
harbors. No flow changes: F-boarding keeps working exactly as today.

What it is:
- A new HARBOR layout contract: a pure sim leaf declaring, per harbor, the
  boardwalk footprint (piecewise rects with deck heights, so a long pier can
  step down toward the water), railing/prop colliders, lamp/crate/mooring
  dressing points, the SHIP BERTH (position, heading, waterline), and the
  gangplank point (where the ferryman stands and boarding happens).
- Sim: the boardwalk is raised WALKABLE ground (the dockSurfaceHeight
  pattern, generalized to the larger multi-rect footprint) plus colliders
  for railings and dressed props. Deck heights are authored per rect, NOT
  seated on terrain, so a pier can run level from shore out over deep water.
- Render: one harbor builder assembling the kit pieces (planks/pilings from
  the pirate-kit dock assets, lamps, crates, rope bollards) over the same
  layout, plus the moored ship GLB at the berth with its waterline on the
  sea surface.
- The lb_ferry fixture moves to the gangplank point and loses its procedural
  dinghy visual (the ship IS the visual; the fixture keeps only the sparkle
  and nameplate). Ferryman Ewald stands at the gangplank. Demi's small
  Landing jetty (fishing flavor) is untouched.

Files, H1 (CREATE):
- `src/sim/harbor_layout.ts`: the layout contract + the two harbor defs
  (HARBORS table; exports consumed by world/colliders/render/campaign).
- `src/render/harbor.ts`: the harbor builder (boardwalk + dressing + ship).
- `tests/last_bell_harbor.test.ts`: deck walkability (groundHeight above
  terrain across the whole boardwalk on multiple seeds), level pier over
  deep water, berth in genuinely deep water, gangplank on deck, colliders
  present, both harbors.

Files, H1 (MODIFY):
- `src/sim/world.ts`: harbor surface arm in groundHeight beside
  dockSurfaceHeight.
- `src/sim/colliders.ts`: harbor railing/prop colliders from the layout.
- `src/render/renderer.ts`: build harbors at world build; slim the lb_ferry
  branch (no boat; sparkle + label only).
- `src/render/last_bell_fixtures.ts`: retire buildFerryLanding's boat body
  (keep the mooring/marker minimal form), door/breach builders unchanged.
- `src/sim/content/zone1.ts` and `src/sim/content/farshore.ts`: remove the
  interim landing docks (the harbor replaces them); keep the Landing jetty.
- `src/sim/last_bell/campaign.ts`: fixture + arrival anchors read from
  harbor_layout (single source for the gangplank/arrival points).
- `tests/last_bell_fixtures.test.ts`: re-pin to the gangplank anchors.

Acceptance (owner walk): both harbors read as harbors from 40 yd; the
boardwalk is walkable end to end with railings that collide; the ship sits
in the water at the pier, not on grass; Ewald stands at the gangplank; the
old plank-and-dinghy is gone.

## H2: The fare (talk to the ferryman, pay, cross)

What it is:
- Talking to Ferryman Ewald (and the Gullhaven return keeper) opens the
  existing dialogue-choice window: "Passage to the Farshore: {price}" /
  "Not today." Paying charges copper and runs the crossing; boarding via
  the fare replaces free F-on-fixture (the fixture stays as a walk-up
  alternative that opens the same dialog).
- The choice engine today is story-claim-bound: it gains the same
  personal shared-world audience arm the scene engine already has
  (audiencePid, keyed -pid), so a dock dialog can prompt one player in the
  open world. Party rule for the ferry: each rider pays their own fare
  (the leader-answers rule stays for story claims only).
- Q0 hooks the FIRST PAID crossing (auto-accept + arrival scene unchanged).
  Fare price is a named const (initial: 10 copper, owner decision 2026-07-28,
  down from the spec's 50; not enough to gate a
  broke level-3 player out of the campaign forever: first crossing is free
  if the purse cannot cover it, with a line from Ewald).

Files, H2 (MODIFY):
- `src/sim/scenes/choices.ts`: personal shared-world choice arm
  (audiencePid; resolve writes flags/charges through a callback instead of
  claim-participant iteration for that arm).
- `src/sim/last_bell/campaign.ts`: fare flow (talk hook, charge, cross,
  free-first-crossing arm), FERRY_FARE_COPPER const.
- `src/sim/content/last_bell_campaign.ts`: fare choice def + Ewald/return
  keeper dialogue keys.
- `src/ui/i18n.catalog/last_bell.ts` + the five non-Latin overlays: fare
  strings (M16).
- `src/sim/interaction.ts`: route ferryman NPC talk into the fare dialog
  (one arm beside the lb_ fixture arm).
- `tests/last_bell_q0.test.ts`, `tests/last_bell_fixtures.test.ts`: flow
  re-pins; NEW fare cases in a `tests/last_bell_fare.test.ts` (pays and
  crosses, declines and stays, broke first-timer rides free once, party
  members pay individually, return leg).

Acceptance: talk, see the fare, pay, cross; declining leaves you on the
dock; the purse visibly drops; Q0 still auto-starts on the first crossing.

## H3: The voyage (departure cinematic + sound)

What it is:
- Paying the fare letterboxes into a departure scene at the dock: bell
  strikes, gulls and water, the moored ship casts off and pulls away from
  the pier (client-side ship animation driven by a scene cue: the ship is
  a render prop; the scene director gets a `prop` cue op targeting the
  harbor ship with a small authored path), fade to black, teleport, fade
  up inside the EXISTING arrival scene at Gullhaven's own pier (its shots
  re-framed to the harbor: this closes deliverable D4's arrival half).
- Sound through the repo's sampled-SFX pipeline (`scripts/sfx/`, manifest
  regenerated by `npm run sfx:manifest`): a real bell toll (this is the
  campaign's signature sound: owner approves the sample), harbor ambience
  (gulls, lapping water), cast-off creak. The scene 'music' directive
  `lb_bell_toll_one` stops being a no-op.

Files, H3 (MODIFY):
- `src/sim/types.ts` + `src/sim/scenes/scenes.ts`: one new SceneWireOp
  `prop` (target key + motion cue id), emitted like anim ops.
- `src/sim/content/last_bell_campaign.ts`: the departure scene def; arrival
  scene re-framed to the Gullhaven harbor; the fare flow cues departure.
- `src/game/scene_director.ts` (+ core): route prop cues.
- `src/render/harbor.ts`: the ship's cast-off/berthed animation states.
- `src/game/music.ts`: map lb_bell/harbor directives to the new samples.
- `public/sfx/*` + `scripts/sfx/sfx_gain_map.json` (+ manifest regen):
  bell toll, harbor ambience, cast-off (CC0-sourced, credited in
  CREDITS.md).
- `tests/last_bell_scenes.test.ts` (+ scene-director core tests): prop op
  emission + teardown pins.

Acceptance: pay the fare and watch the ship leave the dock under a bell
toll, fade, and arrive at Gullhaven in one continuous cinematic; Esc skips
cleanly at any point; the bell sample has the owner's sign-off.

## Sequencing with the map program

H1 to H3 sit between D1 (shipped) and D2 (Gullhaven town pass): the harbor
IS the town's front face, so H1's Gullhaven end doubles as the first piece
of D2. D4 (arrival cinematic) is absorbed by H3.
