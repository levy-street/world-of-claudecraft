# src/sim/encounters/wildheart_basin: the Wildheart Basin encounters

The reworked level-20 jungle caldera (`docs/design/dungeon-rework/wildheart_basin.md`
on the `design/dungeon-rework` branch), ticked once per claim by
`tickWildheartEncounters` (`index.ts`), called from `instances/dungeons.ts`
`updateInstances` right after the Drowned Temple's.

Built in phases. PHASE A: the field record (`sim/content/wildheart_basin_layout.ts`,
interior key `wildheart` on the shared authored-field engine), every pack and patrol with
its trash kit (`mob/trash_kit/wildheart_kit.ts`), the seven gates and the Great Saurian.
PHASE B (this state): the three boss cores, one module each, with their loot, trinkets,
deeds, Reliquary pages, the HUD alert and placeholder telegraphs. The art phase replaces
the looks, never the ids.

| Module | Role |
|---|---|
| `ids.ts` | Leaf: every dungeon, boss, showpiece and trash id, every cast, aura and object template id, the tuning of all four encounters (`SAURIAN_TUNING`, `BEAST_TUNING`, `BLOOM_TUNING`, `ZULGAR_TUNING`), the deed ids and lines, and the pure helpers `controlGroupOf`, `bondReachFor`, `bondStrength`. The content, the renderer, the HUD alert, the dev helpers and the tests key on it. |
| `claim.ts` | The live Basin claims, the Basin's ephemeral objects (`spawnBasinObject`: never loot, so the generic ground-object pass never draws one as loot), `arenaPlayers`, `holdPlanted`, `placeAt`, `farthestPlayer`, `nearestPlayerTo`; the claim-generic reads are the Bastion's, re-exported. |
| `great_saurian.ts` | The Great Saurian (4.3, reworked 2026-10-14): Tail Swipe, Earthshaking Stomp, the rider's Sap Totems, Howdah Rider, the heroic drum, Enrage. Its state outlives it until the Toppled Titan deed settles (it and its rider within 20 s of each other). |
| `saurian_totems.ts` | The Howdah Hexcaller fighting from his seat: a Sunbone Sap Totem (`SAP_TOTEM_ID`, a body raised by the encounter) thrown onto the ford every 10 s while the howdah is whole, on a hashed spot 14 yd round the Saurian, three at most. A totem arms for 4 s (its cast bar is its clock), then mends the Saurian 0.8 percent every 2 s until broken; a totem the group breaks deals the Saurian its own health back (`SAP_BACKLASH_NAME`), credited to whoever led its threat. They crumble with the Saurian and go with a wipe. |
| `saurian_drum.ts` | Heroic: the second rider's drum. While it beats (`SAURIAN_WAR_DRUM` on the Saurian, a `spellfx` a beat) the Stomp's clock runs twice as fast; a broken totem silences it for 6 s (`SAURIAN_DRUM_SILENCED`); it goes down with the howdah. The drummer is never a body. A heroic Stomp lands at 0.7 of its roll while the drum is aboard (beating or silenced): the arithmetic stands beside `SAURIAN_TUNING`. A paused pull (a lost target, `tickSaurianPaused`) holds the drum's beat and its silence where they are, as it holds the Stomp's clock, while the totems keep mending and a broken one still silences it. |
| `beastmaster.ts` | The Fanglord Beastmaster and his Great Jaguar (5.1, G15): ONE health pool (`syncPool`: every body's loss comes off both, both fall together), Pack Bond (auras `buff_dr` 0.5 and `buff_dmg_done` 0.2 within 15 yd, heroic 20), Stalk (the jaguar ignores taunts, fixates a hashed non-tank for 10 s and bites with a bleed; its control windows show as Wary auras), Beast Pit Quake (1.5 s bar), Call of the Hunt, Thickhide Ward, heroic Heel! (2 s bar; a stun stops it). Deed: Kept at Bay. |
| `control_gate.ts` | Pure aura gate asked by `combat/trinket_seams.ts` `auraGuarded` (Sim.applyAura): the jaguar's once-per-20-s window per control kind, and Zulgar's hunt and final phase (only true stuns land, halved). |
| `gorgebloom.ts` | The Gorgebloom (5.2): Seed Rain (pods on the loam beds; a clean touch stomps, a pollinated touch sprouts, a pod left alone sprouts at 12 s; heroic Burrowing Seeds at 6 s), Pollinate (heroic Pollen Cloud), Vine Lash (a locked 30 yd lane and a root), Gorge and Digesting, the Bloom Spit at a target it cannot reach. Its sprouts wither with it. Deed: Weed Control. |
| `zulgar.ts` | Zulgar (5.3, reworked 2026-10-13): the phase machine. The telegraphed Wildheart Pulse, Spirit of the Hunt at 70 and 40 (the Jaguar Avatar aura, Prey marks, Mauled, the respite that keeps knockdowns from chaining), The Idol Wakes at 30 (the avatar until he dies, a new Prey every 8 s that he turns on for 1.5 s before he runs, the tank hunted too; it replaced the template enrage), heroic Twin Prey and Ambush. Owns his control immunity (entity flags, immune outside the hunt). Deed: Never Caught. |
| `zulgar_terrace.ts` | What his modules share: `shrinePlayers` (the terrace's living players) and the encounter objects' own clocks (`setObjectClock`: a replicated cast bar on an object, as the Ghost Captain's lanes carry theirs). |
| `zulgar_glyphs.ts` | The six sun glyphs: dark at the pull; while he hunts a player who is NOT the Prey lights one by standing on it 2 s (the Prey only when nobody else stands free, in 1 s); a lit glyph the avatar crosses leaves him Sunstruck (60 percent slower and 25 percent more damage taken for 3 s) and goes dark and cold for 8 s; he is Wary of the Sun for 5 s from a strike; a hunt's end puts them all out. Heroic: `snuffGlyphsInHalf`. |
| `zulgar_spear.ts` | The Hunting Spear of the plain phases: a 1.5 s bar at a hashed non-tank, the spear's usable body (the trash engine's G3 use, effect `free`), the Pinned root and its bleed, the pull (a teammate's 1.5 s use; the victim's own 3 s, claimed from `sim.interact` by `trySpearWrench`, only while nobody else stands free), its 10 s, and what clears it. |
| `zulgar_idol.ts` | The Idol's Breath of the final phase: the warned half of the terrace (an object on the centre line, its facing the side, its bar the 5 s warning), the landing (300 to 360 to everyone in that half; the centre line is safe), the alternating sides, the heroic snuff. |
| `index.ts` | The tick (the Saurian, the idle-rider sweep, the pair, the bloom, Zulgar) and `/dev wildheart trigger` for every mechanic (`WILDHEART_DEV_TRIGGERS`; the Saurian's: tail, stomp, totem, sap, drum, silence, howdah, enrage; Zulgar's: pulse, spirit, prey, endhunt, ambush, glyphs, sunstrike, spear, pin, idol, breath). |

Rules:
- Deterministic: every pick is hashed (`kitHash`, `pickMarkTargets`) or distance or id ordered; the only rng draws are damage rolls in claim-player order.
- Every visible state rides existing entity fields (cast bars and `castTargetId`, facing, auras, encounter object template ids and `scale`, `spellfx` with the cast ids), so the online client mirrors it with no wire or IWorld change. The renderer (`render/wildheart_basin/`) and the HUD alert (`ui/hud/dungeon/wildheart_alert_view.ts`) read the same ids.
- An evade or a wipe drops every bar, mark, bond, pod, glyph, spear, breath and window; a momentary target loss (`paused`) never replays a threshold. Once the Saurian's pull is over, a Howdah Hexcaller that is not fighting is dropped, so it never idles in the ford.
- The Saurian's totem rework moves no pool: a totem broken inside its arming bar heals nothing and its backlash returns what the group spent on it; the heroic drum is paid for out of the Stomp it quickens (`ids.ts` `SAURIAN_TUNING`).
- Zulgar's balance is redistributed, never added to: the arithmetic stands beside each number in `ids.ts` `ZULGAR_TUNING` (the spear off the Pulse, the Idol's Breath off the enrage it replaced, the Sunstruck window at the size of every other boss's).
- Tests: `tests/wildheart_basin_beastmaster.test.ts`, `..._gorgebloom.test.ts`, `..._zulgar.test.ts` (with `..._zulgar_glyphs`, `..._zulgar_spear` and `..._zulgar_idol` for the rework's three additions), `..._saurian.test.ts` (with `..._saurian_totems.test.ts` for the totem rework and the heroic drum), `..._alert.test.ts` (on `tests/helpers/wildheart_fight.ts`), `..._route.test.ts`, `..._trash.test.ts`, `..._dungeon.test.ts` (record, gates, seals, every dev jump and trigger), `tests/wildheart_normal_tuning.test.ts`, `tests/wildheart.test.ts`, `tests/wildheart_boss_chain_pull.test.ts`.

Naming originality (`src/sim/content/CLAUDE.md`, checked 2026-10-02 against the
design doc's section 10): "Vine Lasher" is an exact Pathfinder 2e monster name
(and a League of Legends minion), so it ships as **Snarlvine Lasher** (the id
`vine_lasher` stays); "Snarlvine" returned no game use. Gorgebloom was clear at
design time. Great Saurian, Howdah Hexcaller, Basin Raptor, Spore Toad, Sunbone
Totem-Binder, Sunbone Totem, Plant Totem, Sunbone Mending, Pounce, Spore Burst,
Entangling Lash, Tail Swipe, Earthshaking Stomp, Knocked Down and Enrage are
generic English (Tail Swipe, Spore Burst, Entangling Lash and Earthshaking Stomp
appear as generic ability labels elsewhere, never as a distinctive coined
term); the gate names (West and East Vine Bridge, the thorn walls, the
Convergence Stair Ward, the Shrine Ward) are generic place compounds.

Phase B names (checked 2026-10-02): the design's deed "Divide and Conquer" is an exact
World of Warcraft achievement, so it ships as **Kept at Bay** (the id
`dgn_beastmaster_apart` stays); Weed Control, Never Caught and Toppled Titan returned no
game use. Thorn Sprout, Jaguar Bite, Rending Bite, Bloom Spit, Vine Lashed, Digesting,
Jaguar Avatar, Prey, Mauled, Sunstruck, Vanished, Wary of Stuns, Roots and Slows, Seedpod
and Sun Glyph are generic English (Rending Bite also labels a generic NPC bite elsewhere,
never a coined term).

The Saurian rework's names (checked 2026-10-14): Sunbone Sap Totem joins this dungeon's own
Sunbone Totem and Ancestral Sap; Sap Backlash, Howdah Drum and Drum Silenced are plain
descriptive English. Exact-phrase searches for "Sap Totem", "Sunbone Sap Totem", "Sap Backlash"
and "Howdah Drum" returned no game use ("Hex Totem", the first name considered, is a Dead by
Daylight term and was not used).

The hunt rework's names (checked 2026-10-14): Hunting Spear, Pinned, Pull the Spear, The Idol
Wakes, Idol's Breath and Wary of the Sun are plain descriptive English; exact-phrase searches
for "Idol's Breath", "The Idol Wakes" and "Wary of the Sun" returned no game use (the last
follows this dungeon's own Wary of Stuns, Roots and Slows).
