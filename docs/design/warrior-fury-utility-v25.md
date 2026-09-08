# Warrior: blood-forged states, Bladed Gyre and Goad

This development milestone gives Bloodrush three different lasting signatures:
ragged crimson fire along the real weapons for Mayhem, fitted blood-red stitching
for Furious Mending, and two small split-blade marks for Gyre's remaining echoes.
Armor keeps its original colors. These effects follow actual live state, including
refreshes, spent charges, removal and characters returning to view.

Bladed Gyre now plants the feet and sweeps both weapons through two large, open,
textured crimson cutting wakes. Their outer reach is the real eight-yard area.
Bright beveled steel edges lead dark blood-grained faces; ground dust and short
metal fragments support the sweep. Actual receiving damage separately owns each
enemy imprint. Additional enemies do not trigger another caster sweep.

Goad now has an authored challenge gesture, serrated forward bark pressure and
three animated dust plumes. The existing swearing bubble is restored in the Studio
through its missing speech-bubble styling. A separate notched attention sprite
appears on an eligible enemy for its actual forced-attention time. A training
dummy still receives the bark and threat, but never pretends to be controlled.
The three hand-drawn attention cels occupy previously unused cells in the shared
sprite atlas; they require no additional atlas texture.

Furious Mending is an inward defensive clench, with drawn blood seams and reverse
animated plumes. Casting it does not restore health. Subsequent Bloodletting
recovery gets its own inward sprite and thread pull only when effective health
actually returns. That recovery is independent of whether the separate weapon
strike hits. Zero effective healing does not flash or play a success sound.

These are authored replacements under review, not final AAA acceptance. Mending's
worn detail, unusual equipment, movement and crowded composition remain subject
to further inspection. Whole-kit and whole-game review cycles remain open.

## Gameplay and priority

The saved usage evidence contains two Bloodrush raid samples, 7.7233 participant
minutes and 133,035 damage. Bloodletting accounts for 49 damage events and 5,840
damage (4.3898%). Damage events are not cast counts. Instant utility frequency is
not exposed by that evidence and is unmeasured, not zero. Twinstrike and Red
Harvest remain the kit's principal impact priorities in the earlier milestones.

Mayhem is the actual fury_enrage/enrage aura: normally four seconds of +7% damage,
25% haste and 10% movement speed. Red Harvest guarantees it; Bloodletting normally
has a 30% chance, with equipment changing that rule and duration. The renderer
reads the resulting aura instead of rolling its own chance or assuming a cast.

Mending lasts ten seconds with 20% damage reduction, a 120-second cooldown and
the global cooldown.
Its activation has no heal. It raises Bloodletting's separate self-heal to at
least 20% maximum health; effective healing still depends on missing health and
absorption. The cue reads the actual heal event's effective amount.

Gyre deals one physical area attack, has a ten-second cooldown and uses the
global cooldown. Its two echo charges last twelve seconds. Each eligible single-target
cast spends one charge, regardless of weapon components or number of extra
recipients; the echoes copy 40% damage to up to four additional nearby enemies.
The two marks immediately become one and then disappear with the real state.

Goad deals no damage and applies no aura. Eligible mobs are forced toward the
Warrior for three seconds. Snapshot forcedTargetId/forcedTargetTimer already
carry that state online. Other Warrior taunts share this state, so the receiving
mark means Warrior-forced attention, not a guessed Goad-only attribution.

## Authoring and limits

Three new native animation clips join the twenty preserved clips. The delivered
23-clip library has SHA256
084400bfa620b0880a90d5a0e0e6a059a5cecca0fe850f0b66b776452d13087b.
A decoded comparison preserves the other twenty clips exactly. Gyre's rejected
preparation crossed the helmet; its final preparation was checked at one
millisecond intervals. Goad's rejected buckler guard crossed the torso and leg;
the final raised left guard was likewise checked at one millisecond intervals.
The reported samples found no outer blade/body intersections or buckler/body
intersections outside its own forearm. This is sampled evidence for the tested
rig and equipment, not every cosmetic, transition or continuous surface.

Mending's initial back stitches crossed the cape and its first brace crossed the
front ribs. The revised brace preserves torso compression and all front ribs,
with the wrists raised and moved outward. Back stitches now sit outside the cape
with their ridges facing outward. Across 145 samples at five-millisecond steps,
the paired geometry and pose have no detected stitch/body/weapon intersections.
Minimum sampled front/back surface gaps are .02207/.04516 native units. A further
722 poses at one-millisecond steps find no outer-blade crossings or floor contact.
All 1,728 delivered stitch vertices and all 23 decoded clips match the audited
proposal exactly; the other 22 clips and the Mayhem/Echo geometry are unchanged.

Six folded inward clamps extend the defensive silhouette beyond the armor. Their
half-unit depth retains a visible face from side cameras. The complete geometry
has 594 triangles; all original fitted ribs remain exact. A further 145 samples
at five-millisecond intervals find no clamp/body/weapon surface crossings. The
closest sampled clamp-vertex/surface gap is .01112 to the alternative buckler
during transition. These are unsigned sampled surface distances, not a guarantee
for every equipment skin or continuous motion.

Three instanced held-state meshes have capacities 64, 32 and 64, serving at most
32 wearers. Local priority never grows those bounds. They borrow existing steel
and blood textures and have twelve explicit preparation units. A separate
instance of the existing ribbon family retains cold or missing-attachment
silhouettes without consuming attack ribbons. No existing pool capacity grows.
All 160 possible fallback pieces fit its existing buffer. Reduced motion freezes
its texture time; charge separation follows camera right even in fallback.

Attention shares the existing overlay pool and respects its protected control
prefix. It caps at 32 actual controlled recipients and prioritizes the local
Warrior's targets. No cast receipt, threat change or damage inference creates
successful control. Missing/dead source or recipient state removes the mark. A living source outside
the camera does not hide a visible controlled recipient.

Fourteen new ElevenLabs takes provide two variants for each of seven identities:
Gyre preparation and sweep, Goad preparation and bark, Mending preparation and
clench, and actual Bloodletting recovery. Existing takes are retained. The two
cast sounds follow the native .15-second moment. Both HUD and Studio use the
same recovery identity; Mending's generic buff chime is suppressed. The original
raw generations and conform decisions are retained in the private working
asset ledger. Auditory artistic approval remains open until listening review.

## Verification ledger

The focused integration run passes 215 tests in twenty suites. It covers native
tracks, actual state removal, charges, contact ownership, audio ownership,
preparation, lifetime, crowd bounds and unchanged attack ribbon capacity.
An additional architecture/geometry/native run passes 142 tests in five suites;
these totals overlap and must not be added. Canonical type checking passes.
The scoped formatter/checker exits zero; existing-style non-null warnings are
reported and are not represented as a warning-free result.

The final folded geometry passes 21 focused tests in three suites. The canonical
client build passes, including generated media and backdrop checks; the existing
large-chunk advisory remains. Sound conformance passes with eight advisory
loudness notices. Three recorded sound scenarios cover four real casts and seven
accepted authored cues, including actual Bloodletting recovery. This proves cue
routing and timing, not listening approval. An independent wall-clock trace
confirms the ordinary Goad bubble appears and expires after its existing 1.8s.

The matching baseline uses twenty original runtime files and the original
20-clip library from f191d8ddbc, served in memory without changing a checkout.
It has five real casts and 43 stills. A six-setting review has 30 casts and 258
stills. Subsequent Goad/Mending readability review has 18 casts and 150 stills;
its flat Mending clamps were rejected and replaced. The final folded Mending
review has six casts and 54 stills. All cited completed runs record unchanged
source and no game errors. A capture interrupted by a build-triggered preview
refresh is retained as failed evidence and excluded from accepted counts.

Matching Studio combos contain two scenarios, five real casts and 26 stills,
including recovery, movement, opposite camera and actual two-to-one-to-zero echo
charges. Combo staging retains actual auras but resets cooldowns and resources;
it is isolated sequence evidence, not a legal combat rotation. The separate
30-second pressure run performs 17 cooldown/resource-limited real commands:
one Mending, three Gyres, six Twinstrikes, five Bloodlettings and two Red Harvests.
It records 86 damage events across five actual recipients and 16 stills, without
cooldown or resource resets during the rotation. Final outdoor motion review repeats the two scenarios and five real casts in
26 stills with the folded brace, without game errors or source changes. It
includes bright shoreline, wooden bridge, movement and the opposite camera;
it does not establish every terrain or background.

The art review accepts this as development progress: the blood brace now reads
from side cameras; Goad has directional pressure and real receiving attention;
Gyre reaches the intended area with crimson cutting faces. Gyre's fine tearing
and contact composition still need whole-kit motion polish. Crowded allies can
occlude Mayhem's real weapons. No through-body rendering is added to hide that
composition problem. Unusual equipment, all backgrounds, full project gates,
publication and both complete visual review cycles remain open.

## Matching views

These pairs use Ultra, the same Bloodrush loadout, 1400 by 900 viewport, camera
and canonical instant. They are original full frames, without painted additions.
Their source records and image hashes are in the adjacent provenance file.

| View | Before | Development result |
| --- | --- | --- |
| Gyre, .30 seconds | [Before](../screenshots/v25-warrior-fury-utility/gyre-before.png) | [After](../screenshots/v25-warrior-fury-utility/gyre-after.png) |
| Goad, .15 seconds | [Before](../screenshots/v25-warrior-fury-utility/goad-before.png) | [After](../screenshots/v25-warrior-fury-utility/goad-after.png) |
| Mending, .15 seconds | [Before](../screenshots/v25-warrior-fury-utility/mending-cast-before.png) | [After](../screenshots/v25-warrior-fury-utility/mending-cast-after.png) |
| Mending held, 1.5 seconds | [Before](../screenshots/v25-warrior-fury-utility/mending-held-before.png) | [After](../screenshots/v25-warrior-fury-utility/mending-held-after.png) |
| Mayhem, 1.5 seconds after Harvest | [Before](../screenshots/v25-warrior-fury-utility/mayhem-before.png) | [After](../screenshots/v25-warrior-fury-utility/mayhem-after.png) |
