# The Emberforge boss room kit

The Emberforge Tyrant's Buried Hoard room, dressed as an ancient black-iron forge
chamber. The room itself is still the seeded one (outline, cliffs, floor,
collision, all from the sim): this is a MODULAR KIT the runtime scatters over it
from the same seed, so every player in one hoard sees one room.

This was the first boss room. The engine it runs on is now shared by every hoard
boss: see `docs/design/boss-rooms/README.md` for the theme model, the rules every
room keeps, and the other seven rooms.

## Where everything lives

| What | Where |
|---|---|
| Where each piece stands, the floor marks, what a tier keeps (pure) | `src/render/hoard_room_kit_core.ts` |
| The forge's own theme record (`EMBERFORGE_THEME`) | `src/render/hoard_room_themes_core.ts` |
| Instances, floor meshes, the sway, the molten pulse, the sparks | `src/render/hoard_room_kit.ts` |
| Composed into the room by | `src/render/hoard_valley.ts` |
| Blender source, review renders | `docs/design/forge-room/` |
| Shipping build | `scripts/assets/forge_room/build.mjs` |
| Shipped asset | `public/models/props/hoard_forge_kit.glb` |
| Tests | `tests/hoard_room_kit.test.ts` |

## Rebuild

```
blender --background --python docs/design/forge-room/build_forge_kit.py
blender --background --python docs/design/forge-room/preview.py
node scripts/assets/forge_room/build.mjs
```

## The kit

One hero and seven props, each a `Kit_*` node with its origin on the floor (the
chain's is its hang point), front toward +Z, in game yards:

`Kit_GreatForge` (the hero, set into the end wall behind the boss), `Kit_Anvil`,
`Kit_Crucible`, `Kit_IngotStack`, `Kit_Vent`, `Kit_ForgePost`, `Kit_ChainHook`,
`Kit_IronBrace`.

The hoard rooms are UNLIT flat colour with hand-painted facets, so every face
carries its own baked shade in the vertex colours: a key light, a warm forge
light on the faces it catches, darker toward the floor. Two materials only:
`ForgeSolid` (painted) and `ForgeMolten` (what glows; the runtime pulses it).

## Composition

Not scatter. The Great Forge and its flanking braces, vents and chains take the
end wall; CLUSTERS (a smelter, a bellows bank, a braced wall, a stockpile) are
pressed against the side walls with bare wall left between them, never mirrored
across the room. Every prop stands within `ROOM_KIT_WALL_BAND` of a wall and off
the boss's ground; only flat floor marks (the hearth plates, an engraved ring,
molten channels at the foot of the walls, firelight) reach the
fight, and they are dark or dim so every telegraph out-reads them. Nothing here
collides: the walls already do.

The zone's generic spires and hero trees are NOT drawn in a kitted room: the kit is the room's
dressing, and the floor it keeps clear stays clear.

## Tiers

One plan, filtered, so nothing moves between tiers: high keeps everything plus
the sparks and the chains' sway, medium drops the filler, low keeps the forge, a
few large silhouettes and the floor's lines. It is all cosmetic, so it may be
shed freely; no mechanic reads any of it.

## Cost

One InstancedMesh per piece per material (sixteen draws at most), three floor
meshes and one spark cloud: about twenty draw calls and 6,300 triangles of source
geometry for the whole room, built under the room's own gated attach. No lights,
no textures, nothing allocated per frame.
