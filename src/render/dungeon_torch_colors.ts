// Per-variant interior torch palettes (flame mesh, emissive, point light),
// extracted verbatim from dungeon.ts under the monolith ratchet. The shape is
// dungeon_torch_rig's TorchFireColors, the one every fire consumer takes;
// InteriorStyle.torch overrides the table per generated rift floor.
import type { DungeonInteriorVariant } from './dungeon';
import type { TorchFireColors } from './dungeon_torch_rig';

export const TORCH_COLORS: Record<DungeonInteriorVariant, TorchFireColors> = {
  crypt: { flame: 0x7fd4ff, emissive: 0x2288cc, light: 0x66bbff },
  bastion: { flame: 0x7ffbe0, emissive: 0x18b89a, light: 0x4fe3c0 },
  sanctum: { flame: 0xa6ffb8, emissive: 0x22cc55, light: 0x55e08a },
  // the Drowned Temple burns with cold moonfire, pale lilac over still water
  temple: { flame: 0xd9c9ff, emissive: 0x6a4fd0, light: 0xb79cff },
  // the Ashen Coliseum burns warm, amber braziers ringing the fighting sands
  arena: { flame: 0xffb24a, emissive: 0xcc5a14, light: 0xff9a3c },
  // the Drowned Court fights under the temple's cold moonfire (same palette)
  arena_drowned: { flame: 0xd9c9ff, emissive: 0x6a4fd0, light: 0xb79cff },
  // The Last Keep is a LIVED-IN castle: soft candle-orange hearth light, warmer
  // and paler than the arena's hard ember (its undercroft alone burns the
  // crypt's cold blue, split per story in the authored build path).
  lastkeep: { flame: 0xffc27a, emissive: 0xcc6a1e, light: 0xffa14e },
  // Dawnhold Castle is a garden palace in DAYLIGHT: paler, golder candle
  // flames than the keep's torchlit halls, closer to sun through blossom.
  dawnhold: { flame: 0xffd98f, emissive: 0xd08428, light: 0xffc061 },
  nythraxis: { flame: 0x8f5cff, emissive: 0x4b1c9a, light: 0x7b4dff },
  ignivar: { flame: 0xffd06a, emissive: 0xe05a16, light: 0xff7a2e },
  // delve reliquaries burn with grave-ember red: warm coals over cold stone
  delve_ossuary: { flame: 0xff7a3c, emissive: 0xcc3a14, light: 0xff6a3c },
  delve_bell: { flame: 0xff7a3c, emissive: 0xcc3a14, light: 0xff6a3c },
  delve_hall: { flame: 0xff7a3c, emissive: 0xcc3a14, light: 0xff6a3c },
  // the bell-buried boss chamber burns hotter: brighter ember over the arena
  delve_finale: { flame: 0xffa24a, emissive: 0xe04a18, light: 0xff7a3c },
  // the Drowned Litany burns with sickly bog-light: cold green marsh-gas flames
  // over wet stone, clearly distinct from the reliquary ember-orange.
  delve_marsh: { flame: 0x6abf6a, emissive: 0x2f6f2f, light: 0x6aff8c },
  // the drowned apse burns brighter and colder: a cyan corpse-glow over the stage
  delve_marsh_apse: { flame: 0x7fe6c0, emissive: 0x2f8f6f, light: 0x6affb0 },
};
