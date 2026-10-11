// What the Sunken Bastion's boss marks DO, for their buff/debuff hover tooltip.
// A pure descriptor like the rest of aura_effect.ts (which calls this before the
// generic kind line): it returns a hudChrome.auraEffect.bastion.* key plus the
// raw numbers, and the HUD formats the numbers and renders t(key, values).
// The Drowned Anchor's hook is a tether (an authoritative displacement state,
// with no generic kind line of its own), so it says its rule: the two ways out
// and what the pit costs. Every number is the encounter tuning
// (src/sim/encounters/sunken_bastion/ids.ts), the same constants combat reads.
// Pinned by tests/sunken_bastion_chain_alert.test.ts.
// The trash marks of the mechanics pass (src/sim/mob/trash_kit/bastion_kit.ts)
// say their rule too: the Brine Column's root drowns, the Halberd Wall and the
// Fog Bank's shroud say what grants them, the Carrion Glut is a marker whose
// burst it grows, and the Snapped Fetters is a prisoner out of the fight. Their
// numbers are the templates' own (src/sim/content/sunken_bastion.ts). Pinned by
// tests/sunken_bastion_trash_mechanics.test.ts.

import { MOBS } from '../sim/data';
import { anchorHits, OSSICK_ANCHORED, OSSICK_TUNING } from '../sim/encounters/sunken_bastion/ids';
import {
  BASTION_BRINE_COLUMN,
  BASTION_CARRION_GLUT,
  BASTION_FOG_SHROUD,
  BASTION_HALBERD_WALL,
  BASTION_SNAPPED_FETTERS,
} from '../sim/mob/trash_kit/bastion_cast_ids';
import type { AuraEffectDescriptor, AuraEffectInput } from './aura_effect';

const KEY = 'hudChrome.auraEffect.bastion';

const pct = (frac: number): number => Math.round(Math.abs(frac) * 100);

/** The Bastion mark's descriptor, or null when `a` is not one of them. */
export function bastionAuraEffectDescriptor(a: AuraEffectInput): AuraEffectDescriptor | null {
  if (a.id === OSSICK_ANCHORED) {
    const T = OSSICK_TUNING;
    return {
      key: `${KEY}.anchored`,
      nums: {
        reach: T.postReach,
        run: T.postRun,
        dark: T.postDarkSeconds,
        links: anchorHits(false),
        linksHeroic: anchorHits(true),
        pit: pct(T.pitShare),
        pitHeroic: pct(T.pitShareHeroic),
      },
    };
  }
  if (a.id === BASTION_BRINE_COLUMN && a.kind === 'root') {
    const col = MOBS.tidebound_acolyte?.trashKit?.column;
    return {
      key: `${KEY}.brineColumn`,
      nums: {
        min: a.value2 ?? col?.min ?? 0,
        max: a.value3 ?? col?.max ?? 0,
        tick: col?.tick ?? 1,
        seconds: col?.castTime ?? 4,
      },
    };
  }
  if (a.id === BASTION_HALBERD_WALL) {
    const wall = MOBS.drowned_watchman?.trashKit?.wall;
    return { key: `${KEY}.halberdWall`, nums: { pct: pct(a.value), radius: wall?.radius ?? 5 } };
  }
  if (a.id === BASTION_FOG_SHROUD) {
    return { key: `${KEY}.fogShroud`, nums: { pct: pct(a.value) } };
  }
  if (a.id === BASTION_CARRION_GLUT) {
    const kit = MOBS.barnacle_crawler?.trashKit;
    const burst = kit?.deathBurst?.perStack;
    return {
      key: `${KEY}.carrionGlut`,
      nums: {
        stacks: a.stacks ?? 1,
        max: kit?.gorge?.maxStacks ?? 3,
        radius: burst?.radius ?? 0,
        pct: pct(burst?.damage ?? 0),
      },
    };
  }
  if (a.id === BASTION_SNAPPED_FETTERS) {
    return { key: `${KEY}.snappedFetters`, nums: {} };
  }
  return null;
}
