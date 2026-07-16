# Molten Abyss (id `infernal_abyss`)

## Intent

Molten Abyss is a level 20, five-player lore dungeon beneath Stormcrag. (The
internal id keeps the original `infernal_abyss` slug; the display name avoids
the de-IP denylisted word.) It is a
separate story and space from every existing infernal rift. The visual target is a
black-obsidian forge complex split by living lava, with readable red-orange lighting,
large silhouettes and side chambers that reward exploration.

The dungeon follows the narrative density of the Nythraxis chain: the player first
investigates a disturbance, then reconstructs a broken covenant from four interactable
records, and finally confronts the name revealed by those records.

## Authored route

The layout is a single deterministic room graph shared by rendering and collision.
Visible walls, doorway gaps, prop footprints and minimap rooms all derive from
`INFERNAL_ABYSS_LAYOUT`.

| Stage | Room | Purpose |
|---|---|---|
| 1 | Ashen Descent | Safe entrance, first view of the chained forge |
| 1 | Chainscar Descent | Compression corridor into the hostile complex |
| 2 | Lava Maze | Physical switchback maze with nine shared render and collision barriers |
| 2 | Lost Armory | Optional west branch packed with racks, wall displays, crates and chained trophies |
| 2 | Pyre Crucible | Lava-ringed western chamber with a shrine, crucibles and magma crystals for the Pyre Golem |
| 3 | Infernal Forge | Monumental furnace, cranes, reliefs, bellows, molten ingots and lava channels |
| 3 | Gladiator Pit | Optional east branch with five barrier segments, raised galleries, carnage and a chained gantry |
| 3 | Maw Approach | Narrow regroup threshold after both branches |
| 3 | Maw Bridge | Narrow broken bridge over a deep lava river, cliff faces and volcanic crags |
| 3 | Heart Cairn Vestibule | Final trash and the broken covenant |
| 1 | Heart Cairn | Stepped arena, continuous lava moat, cracked ritual island, skull throne wall and Azazel |

The primary route remains readable while the west branches, east pit and S-shaped
progression reproduce the hierarchy of the concept map. Lava pools and fissures deal a deterministic eight percent
of maximum health each second, matching the exact visual footprints on every graphics
tier.

## Lore chain

Loremaster Caddis offers three linked quests:

1. `Echoes Beneath Stormcrag` sends the player to read the Charred Legion Tablet and
   the Brands of the First Flame.
2. `The Broken Covenant` follows the Forgekeeper's Ledger and Azazel's Broken
   Covenant, revealing that the first flame was a seal, not an object of worship.
3. `Lord of the Molten Abyss` asks a full party to kill Azazel before the last clause
   of the covenant burns away.

Every lore object emits a short two-part vision. The prose is localized in the five
non-Latin M16 locales as well as English.

## Encounters

The Forgekeeper uses a telegraphed hard cast and summons cinderlings from the forge.
The Pyre Golem combines a close-range fire nova, a stunning quake and a low-health
enrage. These fights teach the movement and burst patterns used in the final room.

Azazel combines the existing deterministic encounter vocabulary into one fight:

- `Apocalypse Flame`, a three-second room cast with a visible cast bar.
- `Abyssal Firestorm`, a nine-second pressure pulse.
- `Hellbreaker Stomp`, a damaging stun that punishes stacking in melee.
- Cinderling waves at 70 and 40 percent health.
- `Gaze of the Abyss`, a periodic fear that disrupts positioning.
- A 20 percent enrage with a 60 percent damage increase and attack-speed increase.

The arena leaves a clean central fighting island around the altar. A broad elliptical
lava moat separates it from the outer floor while authored magma veins, guardian
statues, ossuaries, hanging cages, lavafalls and a giant skull gate frame Azazel and the
horned throne. The stepped four-room shell reads as a circular cairn on both maps while
preserving the existing flat-floor movement contract.

## Generated asset set

Thirty-five Tripo v3 assets were generated specifically for this dungeon:

- Rigged Azazel and Pyre Golem models, each with Idle, Walk, Run, Attack, Hit, Death,
  Cast and Jump clips.
- Abyssal heart altar, infernal forge anvil, chained demon obelisk, lost armory weapon
  rack and lava brazier props.
- Monumental furnace, horned basalt throne, modular maze wall, gladiator chain gantry,
  broken bridge span, magma spires, horned portcullis and forge chain crane.
- Giant skull gate, lavafall shrine, cracked floor plate, battlefield debris, crucibles,
  forge tools, bellows, armory crates, weapon displays, spectator stands, hanging cages
  and horned guardian statues.
- Basalt buttresses, furnace reliefs, chained war banners, ossuary piles, molten ingot
  molds, arena carnage, horned wall sconces and magma crystal clusters.

All models use 512 px embedded WebP textures and remain within the repository triangle
and per-file limits. The creature clips pass the in-place movement validation. Repeated
cavern, ember and floor-fracture families are consolidated into fixed draw-call meshes,
with reduced populations on the low graphics tier.
