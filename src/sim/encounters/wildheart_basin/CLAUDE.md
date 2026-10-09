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
| `claim.ts` | The live Basin claims, the Basin's ephemeral objects (`spawnBasinObject`), `arenaPlayers`, `holdPlanted`, `placeAt`, `farthestPlayer`, `nearestPlayerTo`; the claim-generic reads are the Bastion's, re-exported. |
| `great_saurian.ts` | The Great Saurian (4.3): Tail Swipe, Earthshaking Stomp, Howdah Rider, Enrage. Its state outlives it until the Toppled Titan deed settles (it and its rider within 20 s of each other). |
| `beastmaster.ts` | The Fanglord Beastmaster and his Great Jaguar (5.1, G15): ONE health pool (`syncPool`: every body's loss comes off both, both fall together), Pack Bond (auras `buff_dr` 0.5 and `buff_dmg_done` 0.2 within 15 yd, heroic 20), Stalk (the jaguar ignores taunts, fixates a hashed non-tank for 10 s and bites with a bleed; its control windows show as Wary auras), Beast Pit Quake (1.5 s bar), Call of the Hunt, Thickhide Ward, heroic Heel! (2 s bar; a stun stops it). Deed: Kept at Bay. |
| `control_gate.ts` | Pure aura gate asked by `combat/trinket_seams.ts` `auraGuarded` (Sim.applyAura): the jaguar's once-per-20-s window per control kind, and Zulgar's hunt (only true stuns land, halved). |
| `gorgebloom.ts` | The Gorgebloom (5.2): Seed Rain (pods on the loam beds; a clean touch stomps, a pollinated touch sprouts, a pod left alone sprouts at 12 s; heroic Burrowing Seeds at 6 s), Pollinate (heroic Pollen Cloud), Vine Lash (a locked 30 yd lane and a root), Gorge and Digesting, the Bloom Spit at a target it cannot reach. Its sprouts wither with it. Deed: Weed Control. |
| `zulgar.ts` | Zulgar (5.3): the telegraphed Wildheart Pulse, Spirit of the Hunt at 70 and 40 (the Jaguar Avatar aura, Prey marks, Mauled, Sunstruck on the six sun glyph objects), heroic Twin Prey and Ambush. Owns his control immunity (entity flags, immune outside the hunt). Deed: Never Caught. |
| `index.ts` | The tick (the Saurian, the idle-rider sweep, the pair, the bloom, Zulgar) and `/dev wildheart trigger` for every mechanic (`WILDHEART_DEV_TRIGGERS`). |

Rules:
- Deterministic: every pick is hashed (`kitHash`, `pickMarkTargets`) or distance or id ordered; the only rng draws are damage rolls in claim-player order.
- Every visible state rides existing entity fields (cast bars and `castTargetId`, facing, auras, encounter object template ids and `scale`, `spellfx` with the cast ids), so the online client mirrors it with no wire or IWorld change. The renderer (`render/wildheart_basin/`) and the HUD alert (`ui/hud/dungeon/wildheart_alert_view.ts`) read the same ids.
- An evade or a wipe drops every bar, mark, bond, pod, glyph and window; a momentary target loss (`paused`) never replays a threshold. Once the Saurian's pull is over, a Howdah Hexcaller that is not fighting is dropped, so it never idles in the ford.
- Tests: `tests/wildheart_basin_beastmaster.test.ts`, `..._gorgebloom.test.ts`, `..._zulgar.test.ts`, `..._saurian.test.ts`, `..._alert.test.ts` (on `tests/helpers/wildheart_fight.ts`), `..._route.test.ts`, `..._trash.test.ts`, `..._dungeon.test.ts` (record, gates, seals, every dev jump and trigger), `tests/wildheart_normal_tuning.test.ts`, `tests/wildheart.test.ts`, `tests/wildheart_boss_chain_pull.test.ts`.

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
