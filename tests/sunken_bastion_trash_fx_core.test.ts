// The Sunken Bastion trash mechanics' visual plan (src/render/sunken_bastion/
// bastion_trash_fx_core.ts) and its wiring: the boathook's lane is the lane the
// sim tests and its chain holds the victim for the whole drag, the Halberd
// Wall links exactly the partners within the sim's reach, a fed crawler swells
// and keeps the swell, the fog's edge is the sim's radius, the column rises,
// collapses on its cue and bursts when it broke, and the rigs carry the clips
// the cues play (the watchman's thrust on the hook's bar, the warhound's Howl,
// the prisoner's Kneel held while its fetters' aura lasts).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VISUALS, visualKeyFor } from '../src/render/characters/manifest';
import { auraHeldClip, stunIdleClip } from '../src/render/characters/stun_idle_core';
import {
  burstDelayForRadius,
  DEATH_BURST_RING_LOOK,
  deathBurstRingLook,
} from '../src/render/death_burst_fx_core';
import { TELEGRAPH_ACCENTS } from '../src/render/floor_telegraph/telegraph_look_core';
import * as fxCore from '../src/render/sunken_bastion/bastion_fx_core';
import { bastionTelegraphSpecs } from '../src/render/sunken_bastion/bastion_fx_core';
import {
  BASTION_FETTERS_KNEEL_GESTURE,
  BASTION_PACK_HOWL_GESTURE,
  CHAIN_MAX_LINKS,
  COLUMN_BURST,
  COLUMN_COLLAPSE,
  COLUMN_RISE,
  chainDrop,
  chainLinkCount,
  chainSag,
  columnPhase,
  columnShape,
  FOG_LIFT,
  FOG_ROLL_IN,
  fallBackSeconds,
  fogAlpha,
  fogBankRadius,
  frenzyGlow,
  GLUT_GULP_SEC,
  GLUT_MAX_STACKS,
  GLUT_SWELL_PER_STACK,
  glutGlow,
  glutStacks,
  glutSwell,
  HOOK_REEL_CAUGHT,
  HOOK_REEL_MISS,
  hookFlightSeconds,
  hookPhase,
  hookSpec,
  inBastionClaim,
  PACK_FRENZY_AURA,
  RELEASE_SEC,
  releaseEnvelope,
  stableSlots,
  streamPoint,
  TRASH_FX_SLOTS,
  wallPairs,
  wallRadius,
} from '../src/render/sunken_bastion/bastion_trash_fx_core';
import { dungeonByIndex, instanceOriginX, MOBS } from '../src/sim/data';
import {
  BASTION_BOATHOOK,
  BASTION_BRINE_COLUMN,
  BASTION_CARRION_GLUT,
  BASTION_FOG_BANK,
  BASTION_SNAPPED_FETTERS,
} from '../src/sim/mob/trash_kit/bastion_cast_ids';
import type { Entity } from '../src/sim/types';

const def = (templateId: string) => VISUALS[visualKeyFor({ kind: 'mob', templateId } as Entity)];

describe('the boathook', () => {
  it('reads its lane and drag off the watchman template', () => {
    const h = MOBS.drowned_watchman.trashKit?.hook;
    expect(h).toBeDefined();
    expect(hookSpec()).toEqual({
      length: h?.length,
      halfWidth: h?.halfWidth,
      pullSeconds: h?.pullSeconds,
    });
    // The floor lane is the same lane, in the danger colour.
    const lane = bastionTelegraphSpecs()[BASTION_BOATHOOK];
    expect(lane.shape).toBe('lane');
    expect(lane.range).toBe(h?.length);
    expect(lane.halfWidth).toBe(h?.halfWidth);
    expect(lane.color).toBe(fxCore.BASTION_TELEGRAPH_COLORS.physical);
  });

  it('flies fast enough to be on the victim before the drag moves them', () => {
    expect(hookFlightSeconds(22)).toBeLessThanOrEqual(0.24);
    expect(hookFlightSeconds(0)).toBeGreaterThan(0);
    expect(hookFlightSeconds(5)).toBeLessThan(hookFlightSeconds(22));
  });

  it('holds a caught victim through the whole drag, then reels in', () => {
    const pull = hookSpec().pullSeconds;
    const flight = 0.2;
    expect(hookPhase(0.1, flight, true, pull)).toEqual({ stage: 'fly', k: 0.5 });
    expect(hookPhase(0.3, flight, true, pull).stage).toBe('drag');
    // The drag lasts to the sim's pull (fly + drag = pull).
    expect(hookPhase(pull - 0.01, flight, true, pull).stage).toBe('drag');
    expect(hookPhase(pull + 0.01, flight, true, pull).stage).toBe('reel');
    expect(hookPhase(pull + HOOK_REEL_CAUGHT + 0.01, flight, true, pull).stage).toBe('done');
  });

  it('a miss never drags: it reels back in slack', () => {
    const pull = hookSpec().pullSeconds;
    expect(hookPhase(0.25, 0.2, false, pull).stage).toBe('reel');
    expect(hookPhase(0.2 + HOOK_REEL_MISS + 0.01, 0.2, false, pull).stage).toBe('done');
    // Taut while it drags, sagging when slack.
    expect(chainSag(20, 'drag', 0.5)).toBeLessThan(0.05);
    expect(chainSag(20, 'reel', 0.2)).toBeGreaterThan(0.5);
    expect(chainDrop(0, 1)).toBe(0);
    expect(chainDrop(1, 1)).toBe(0);
    expect(chainDrop(0.5, 1)).toBeCloseTo(1);
  });

  it('lays a chunky chain, capped at its pool', () => {
    expect(chainLinkCount(0.1)).toBe(2);
    expect(chainLinkCount(10)).toBeGreaterThan(20);
    expect(chainLinkCount(1000)).toBe(CHAIN_MAX_LINKS);
    // The whole lane plus the reach to the fist fits the pool.
    expect(chainLinkCount(hookSpec().length + 3)).toBeLessThanOrEqual(CHAIN_MAX_LINKS);
  });

  it('plays the thrust on the hook bar, bar-locked, the lunge landing before it ends', () => {
    const clips = def('drowned_watchman').clips;
    expect(clips.castByAbility?.[BASTION_BOATHOOK]).toBe('Attack');
    const rate = clips.castTimeScaleByAbility?.[BASTION_BOATHOOK] ?? 1;
    const bar = MOBS.drowned_watchman.trashKit?.hook?.castTime ?? 0;
    // The thrust's contact (0.5 s clip time) lands inside the bar, and the
    // held reach (to 0.78 s) still holds as the bar ends and the hook flies.
    expect(0.5 / rate).toBeLessThan(bar);
    expect(0.78 / rate).toBeGreaterThan(bar);
    expect(clips.castPlayOut).toContain('Attack');
    expect(def('drowned_watchman').castClipSync).toEqual([BASTION_BOATHOOK]);
  });
});

describe('the Halberd Wall link', () => {
  it('links only partners within the sim reach, each pair once', () => {
    const r = wallRadius();
    expect(r).toBe(MOBS.drowned_watchman.trashKit?.wall?.radius);
    const bodies = [
      { id: 1, x: 0, z: 0 },
      { id: 2, x: r * 0.8, z: 0 },
      { id: 3, x: 40, z: 0 },
      { id: 4, x: 0, z: r * 0.9 },
    ];
    const out: number[] = [];
    const n = wallPairs(bodies, bodies.length, r, out, 4);
    // 1 and 2 stand side by side, 1 and 4 too; 2 and 4 are 1.2 reaches apart.
    expect(n).toBe(2);
    expect(out.slice(0, n * 2)).toEqual([0, 1, 0, 3]);
    // The far one is never linked; the cap holds.
    expect(wallPairs(bodies, bodies.length, r, out, 1)).toBe(1);
    expect(wallPairs(bodies, 1, r, out, 4)).toBe(0);
  });
});

describe('Fall Back', () => {
  it('times the trail and landing to the sim leap', () => {
    expect(fallBackSeconds()).toBe(MOBS.fogbound_arbalest.trashKit?.fallBack?.seconds);
  });
});

describe('Carrion Glut', () => {
  it('reads the stacks off the aura (the wire leaves one stack out)', () => {
    expect(glutStacks(undefined, BASTION_CARRION_GLUT)).toBe(0);
    expect(glutStacks([{ id: 'x' }], BASTION_CARRION_GLUT)).toBe(0);
    expect(glutStacks([{ id: BASTION_CARRION_GLUT }], BASTION_CARRION_GLUT)).toBe(1);
    expect(glutStacks([{ id: BASTION_CARRION_GLUT, stacks: 3 }], BASTION_CARRION_GLUT)).toBe(3);
    expect(glutStacks([{ id: BASTION_CARRION_GLUT, stacks: 9 }], BASTION_CARRION_GLUT)).toBe(
      GLUT_MAX_STACKS,
    );
    expect(GLUT_MAX_STACKS).toBe(MOBS.barnacle_crawler.trashKit?.gorge?.maxStacks);
  });

  it('swells with every stack, gulps on a new one, and settles', () => {
    expect(glutSwell(0, 99)).toBe(1);
    expect(glutSwell(1, 99)).toBeCloseTo(1 + GLUT_SWELL_PER_STACK);
    expect(glutSwell(3, 99)).toBeGreaterThan(glutSwell(2, 99));
    expect(glutSwell(3, 99)).toBeLessThan(1.3);
    expect(glutSwell(2, GLUT_GULP_SEC * 0.3)).toBeGreaterThan(glutSwell(2, 99));
    expect(glutSwell(2, GLUT_GULP_SEC)).toBe(glutSwell(2, 99));
    expect(glutGlow(0)).toBe(0);
    expect(glutGlow(GLUT_MAX_STACKS)).toBe(1);
  });

  it('keeps the swell on the painter instance, never in the pure core', () => {
    // A second renderer (the editor) must never share one map of swells: the
    // core holds no module-scope state and exports no swell setter.
    const core = readFileSync('src/render/sunken_bastion/bastion_trash_fx_core.ts', 'utf8');
    expect(core).not.toMatch(/^(const|let) \w+ = new (Map|Set)\b/m);
    expect(core).not.toMatch(/export function (set|clear)BastionSwell/);
    const painter = readFileSync('src/render/sunken_bastion/bastion_trash_fx.ts', 'utf8');
    expect(painter).toMatch(/private readonly swell = new Map<number, number>\(\)/);
    // The renderer reads it through the dungeon visuals, O(1) per body.
    const renderer = readFileSync('src/render/renderer.ts', 'utf8');
    expect(renderer).toContain('e.scale * (this.riftDeathZoneVisuals?.bodySwell(e.id) ?? 1)');
  });

  it('keeps the brine look on the crawler ring and drops the old second ring', () => {
    const name = MOBS.barnacle_crawler.name;
    expect(deathBurstRingLook(name).accent).toBe(TELEGRAPH_ACCENTS.brine);
    expect(deathBurstRingLook('Rime Whelp')).toBe(DEATH_BURST_RING_LOOK);
    expect(deathBurstRingLook(undefined)).toBe(DEATH_BURST_RING_LOOK);
    // The grown ring's fuse is still the crawler's own (the name wins).
    const burst = MOBS.barnacle_crawler.trashKit?.deathBurst;
    expect(burst).toBeDefined();
    const grown = (burst?.radius ?? 0) + 3 * (burst?.perStack?.radius ?? 0);
    expect(burstDelayForRadius(grown, name)).toBe(burst?.delay);
    // bastion_fx no longer paints a crawler ring of its own.
    expect('brineBurstSpec' in fxCore).toBe(false);
    expect(MOBS.barnacle_crawler.deathThroes).toBeUndefined();
  });
});

describe('Pack Frenzy', () => {
  it('howls on the gesture and burns until the frenzy gutters', () => {
    const clips = def('bastion_warhound').clips;
    expect(clips.attackByAbility?.[BASTION_PACK_HOWL_GESTURE]).toBe('Howl');
    expect(clips.flourish).toBe('Howl');
    expect(PACK_FRENZY_AURA).toBe('pack_frenzy');
    expect(frenzyGlow(8, 8)).toBe(1);
    expect(frenzyGlow(0.75, 8)).toBeCloseTo(0.5);
    expect(frenzyGlow(0, 8)).toBe(0);
  });
});

describe('Fog Bank', () => {
  it('draws its edge at the sim radius, rolls in and lifts', () => {
    expect(fogBankRadius()).toBe(MOBS.mistweaver.trashKit?.fogBank?.radius);
    expect(fogAlpha(0, -1)).toBe(0);
    expect(fogAlpha(FOG_ROLL_IN, -1)).toBe(1);
    expect(fogAlpha(99, FOG_LIFT / 2)).toBeCloseTo(0.5);
    expect(fogAlpha(99, FOG_LIFT)).toBe(0);
    // Its bar marks the chanter with a kick glyph.
    const spec = bastionTelegraphSpecs()[BASTION_FOG_BANK];
    expect(spec.shape).toBe('sigil');
    expect(spec.color).toBe(fxCore.BASTION_TELEGRAPH_COLORS.ward);
  });
});

describe('Brine Column', () => {
  it('rises, holds, collapses on its cue and bursts when the channel broke', () => {
    expect(columnPhase(COLUMN_RISE / 2, -1, false)).toEqual({ stage: 'rise', k: 0.5 });
    expect(columnPhase(3, -1, false).stage).toBe('hold');
    expect(columnPhase(3, COLUMN_COLLAPSE / 2, false)).toEqual({ stage: 'collapse', k: 0.5 });
    expect(columnPhase(3, COLUMN_BURST / 2, true)).toEqual({ stage: 'burst', k: 0.5 });
    expect(columnPhase(3, COLUMN_COLLAPSE, false).stage).toBe('done');
    expect(columnShape('hold', 1)).toEqual({ height: 1, width: 1 });
    expect(columnShape('rise', 0).height).toBe(0);
    expect(columnShape('collapse', 1).height).toBe(0);
    expect(columnShape('burst', 1).width).toBeGreaterThan(2);
    const spec = bastionTelegraphSpecs()[BASTION_BRINE_COLUMN];
    expect(spec.shape).toBe('sigil');
    expect(spec.color).toBe(fxCore.BASTION_TELEGRAPH_COLORS.heal);
  });

  it('pours the stream in an arc from the conch to the crown', () => {
    const o = { x: 0, y: 0, z: 0 };
    expect(streamPoint(0, 0, 5, 0, 10, 3, 0, o)).toEqual({ x: 0, y: 5, z: 0 });
    expect(streamPoint(1, 0, 5, 0, 10, 3, 0, o)).toEqual({ x: 10, y: 3, z: 0 });
    // It arcs over the straight line between them.
    expect(streamPoint(0.5, 0, 5, 0, 10, 3, 0, o).y).toBeGreaterThan(4);
  });
});

describe('Snapped Fetters', () => {
  it('kneels on the gesture and holds the kneel while the aura lasts', () => {
    const d = def('shackled_prisoner');
    expect(d.url).toBe('models/creatures/drowned_prisoner.glb');
    expect(d.clips.attackByAbility?.[BASTION_FETTERS_KNEEL_GESTURE]).toBe('Kneel');
    expect(d.clips.heldByAura?.[BASTION_SNAPPED_FETTERS]).toBe('KneelLoop');
    const freed = [{ id: BASTION_SNAPPED_FETTERS, kind: 'buff_dr', remaining: 3 }];
    expect(auraHeldClip(d.clips.heldByAura, freed)).toBe('KneelLoop');
    expect(auraHeldClip(d.clips.heldByAura, [{ id: 'x', kind: 'stun', remaining: 3 }])).toBeNull();
    expect(auraHeldClip(d.clips.heldByAura, [{ ...freed[0], remaining: 0 }])).toBeNull();
    expect(auraHeldClip(undefined, freed)).toBeNull();
    // The aura-held pose is no stun: the dazed loop never fires off it.
    expect(stunIdleClip('Stunned', freed)).toBeNull();
  });

  it('releases him in a soft swell that fades out', () => {
    expect(releaseEnvelope(-0.1)).toBe(0);
    expect(releaseEnvelope(0.45)).toBe(1);
    expect(releaseEnvelope(RELEASE_SEC * 0.9)).toBeLessThan(0.3);
    expect(releaseEnvelope(RELEASE_SEC + 0.1)).toBe(0);
  });
});

describe('the trash fx pools', () => {
  it('pins every pool size', () => {
    expect(TRASH_FX_SLOTS).toEqual({
      hooks: 4,
      fogs: 4,
      shrouds: 8,
      columns: 4,
      wards: 8,
      bands: 8,
      souls: 3,
      rings: 12,
    });
    // Four warded watchmen side by side link every pair (six bands).
    expect(TRASH_FX_SLOTS.bands).toBeGreaterThanOrEqual((4 * 3) / 2);
  });

  it('keeps every seated body on its slot and never evicts one for a newcomer', () => {
    const slots = [-1, -1, -1];
    expect(stableSlots(slots, [10, 11], 2)).toBe(2);
    expect(slots).toEqual([10, 11, -1]);
    // A new body takes the free slot; the seated ones stay put, in any order.
    expect(stableSlots(slots, [12, 11, 10], 3)).toBe(3);
    expect(slots).toEqual([10, 11, 12]);
    // Over-subscribed: the newcomer is dropped, no live read is evicted.
    expect(stableSlots(slots, [13, 10, 11, 12], 4)).toBe(3);
    expect(slots).toEqual([10, 11, 12]);
    // A body gone frees its slot for the waiting newcomer.
    expect(stableSlots(slots, [13, 10, 12], 3)).toBe(3);
    expect(slots).toEqual([10, 13, 12]);
    // Only the first `count` wanted bodies count.
    expect(stableSlots(slots, [10, 99, 99], 1)).toBe(1);
    expect(slots).toEqual([10, -1, -1]);
  });

  it('does not take a live slot in any painter (a full pool drops the newcomer)', () => {
    for (const file of [
      'bastion_boathook_fx.ts',
      'bastion_brine_column_fx.ts',
      'bastion_trash_fx.ts',
      'bastion_trash_fx_kit.ts',
    ]) {
      const src = readFileSync(`src/render/sunken_bastion/${file}`, 'utf8');
      expect(src, file).not.toMatch(/\?\? this\.\w+\[0\]/);
    }
  });
});

describe('the claim gate', () => {
  it('scans only inside a Sunken Bastion claim', () => {
    let index = -1;
    for (let i = 0; i < 64; i++) {
      if (dungeonByIndex(i)?.interior === 'sunken_bastion') {
        index = i;
        break;
      }
    }
    expect(index).toBeGreaterThanOrEqual(0);
    const x = instanceOriginX(index);
    expect(inBastionClaim(x)).toBe(true);
    expect(inBastionClaim(0)).toBe(false);
    expect(inBastionClaim(instanceOriginX(index === 0 ? 1 : 0))).toBe(false);
  });
});
