// The Sanctum's static kit dressing: every placement of the pure plan
// (sanctum_kit_plan_core.ts) instanced from the kit (sanctum_kit.ts), and the
// procedural stand-ins every placed piece draws if the kit is missing:
// faceted ice for the glacier pieces, cleaved rock lumps for the slate,
// wind-carved drifts for the snow, lofted solids for the camp's things (never
// a plain box or cylinder), all painted in the Sanctum's palette.

import type * as THREE from 'three';
import {
  instanceSanctumPlacements,
  registerSanctumFallback,
  type SanctumPart,
  upgradeWhenSanctumKitLands,
} from './sanctum_kit';
import { planSanctumKitPlacements, SANCTUM_KIT_SIZES } from './sanctum_kit_plan_core';
import { iceCrystal, ringLoft, rockLump, snowDrift } from './sanctum_shapes';

const ICE_FOOT: readonly [number, number, number] = [0.1, 0.27, 0.45];
const ICE_TOP: readonly [number, number, number] = [0.5, 0.74, 0.9];
const SLATE: readonly [number, number, number] = [0.07, 0.075, 0.09];
const IRON: readonly [number, number, number] = [0.05, 0.052, 0.058];
const SOOT: readonly [number, number, number] = [0.05, 0.045, 0.045];
const HIDE: readonly [number, number, number] = [0.3, 0.24, 0.18];
const EMBER: readonly [number, number, number] = [1.0, 0.45, 0.12];
const SOUL: readonly [number, number, number] = [0.5, 0.9, 0.62];
const RUNE: readonly [number, number, number] = [0.3, 0.62, 1.0];

function seedOf(name: string): number {
  let h = 7;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 9973;
  return h;
}

function size(name: string): readonly [number, number, number] {
  return SANCTUM_KIT_SIZES[name] ?? [3, 3, 3];
}

/** A stand-in per piece family (the kit's own pieces replace them). */
function standIn(name: string): SanctumPart[] {
  const [w, d, h] = size(name);
  const seed = seedOf(name);
  if (/Serac|GlacierWall|IceFall|IceChunk|FaceChunk/.test(name)) {
    return [
      {
        slot: 'stone',
        g: iceCrystal(w, h, d, seed, { sides: 11, boxy: 0.3, foot: ICE_FOOT, top: ICE_TOP }),
      },
    ];
  }
  if (/CrevasseEdge|RockCliff|FrozenFall/.test(name)) {
    const rock = name === 'Kit_RockCliff';
    const g = iceCrystal(w, h, Math.max(3, d), seed, {
      sides: 8,
      boxy: 0.95,
      jitter: 0.3,
      foot: rock ? SLATE : [0.03, 0.08, 0.16],
      top: rock ? [0.12, 0.13, 0.15] : [0.35, 0.6, 0.8],
    });
    g.translate(0, -h, d / 2);
    return [{ slot: 'stone', g }];
  }
  if (/Thornpeak|Moraine|VigilCairn/.test(name)) {
    return [{ slot: 'stone', g: rockLump(w, h, d, seed, SLATE) }];
  }
  if (/SnowDrift|Sastrugi/.test(name)) {
    return [{ slot: 'stone', g: snowDrift(w, Math.max(0.3, h), d / 2, seed) }];
  }
  if (/SealPillar/.test(name)) {
    const cracked = name.includes('Cracked');
    return [
      {
        slot: 'stone',
        g: ringLoft(
          [
            [2.7, 0],
            [2.5, 1.2],
            [1.9, 1.6],
            [1.7, 12.5],
            [2.2, 13.2],
            [2.0, 15],
            [0.4, 15.4],
          ],
          8,
          seed,
          (_y, t) => (t > 0.86 ? [0.6, 0.66, 0.74] : SLATE),
          cracked ? 0.16 : 0.05,
        ),
      },
      {
        slot: 'glow',
        g: ringLoft(
          [
            [1.76, 6],
            [1.76, 8.5],
          ],
          8,
          seed,
          () => (cracked ? [0.12, 0.2, 0.3] : RUNE),
          0.02,
        ),
      },
    ];
  }
  if (/Brazier|Pyre/.test(name)) {
    const big = name === 'Kit_ThawPyre';
    const s = big ? 2.4 : 0.6;
    return [
      {
        slot: 'stone',
        g: ringLoft(
          [
            [0.5 * s, 0],
            [0.35 * s, 1.2 * s],
            [0.9 * s, 1.6 * s],
            [0.8 * s, 2 * s],
          ],
          9,
          seed,
          () => IRON,
        ),
      },
      {
        slot: 'glow',
        g: ringLoft(
          [
            [0.7 * s, 1.95 * s],
            [0.2 * s, 2.1 * s],
          ],
          9,
          seed,
          () => (name.includes('Soul') || big ? SOUL : EMBER),
        ),
      },
    ];
  }
  if (/CultTent/.test(name)) {
    return [
      {
        slot: 'stone',
        g: ringLoft(
          [
            [w / 2, 0],
            [w * 0.42, h * 0.5],
            [0.25, h],
          ],
          7,
          seed,
          () => HIDE,
          0.12,
        ),
      },
    ];
  }
  if (
    /Sledge|GoadRack|ChainHeap|ChainAnchor|SmithsHammer|RuneWall|KeystoneSocket|GateTunnel|VaultWall|HeldGiant|HeldDead|RitualCircle|HaulRoadKerb|MeltChannel/.test(
      name,
    )
  ) {
    // Low, broad heaps of slate and ice in the piece's footprint.
    const ice = /VaultWall|HeldGiant|HeldDead/.test(name);
    return [
      {
        slot: 'stone',
        g: ice
          ? iceCrystal(w, h, d, seed, { sides: 9, boxy: 0.8, foot: ICE_FOOT, top: ICE_TOP })
          : rockLump(w, Math.max(0.4, h), d, seed, /Sledge|Goad|Chain/.test(name) ? SOOT : SLATE),
      },
    ];
  }
  return [{ slot: 'stone', g: iceCrystal(w, h, d, seed, { foot: ICE_FOOT, top: ICE_TOP }) }];
}

/** Register a stand-in for every piece the Sanctum draws. */
export function registerSanctumStandIns(names: Iterable<string>): void {
  for (const n of names) registerSanctumFallback(n, () => standIn(n));
}

const EXTRA_STAND_INS = [
  'Kit_SealPillar_Hammer',
  'Kit_SealPillar_Tongs',
  'Kit_SealPillar_Anvil',
  'Kit_SealPillar_Bellows',
  'Kit_SealPillarCracked_Hammer',
  'Kit_SealPillarCracked_Tongs',
  'Kit_SealPillarCracked_Anvil',
  'Kit_SealPillarCracked_Bellows',
  'Kit_IceChunkA',
  'Kit_IceChunkB',
  'Kit_IceChunkC',
  'Kit_FaceChunkA',
  'Kit_FaceChunkB',
  'Kit_FaceChunkC',
];

function buildGroup(lowGfx: boolean, density: number): THREE.Group {
  const plan = planSanctumKitPlacements();
  registerSanctumStandIns([...new Set(plan.map((p) => p.piece)), ...EXTRA_STAND_INS]);
  return instanceSanctumPlacements(plan, lowGfx, 'gravewyrmSanctumKit', density);
}

/** Instance the whole static kit over the layout (instance-local frame).
 *  `density` is the effects tier's (the gulf's scenery thins with it). */
export function buildSanctumKitDressing(lowGfx: boolean, density = 1): THREE.Group {
  const group = buildGroup(lowGfx, density);
  upgradeWhenSanctumKitLands(group, () => buildGroup(lowGfx, density));
  return group;
}

// Every piece's stand-in is registered as soon as the module loads, so a
// painter that adopts a piece before the dressing builds still has one.
registerSanctumStandIns([...Object.keys(SANCTUM_KIT_SIZES), ...EXTRA_STAND_INS]);
