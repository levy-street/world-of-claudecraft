// The Sunken Bastion's Blender-built creatures (scripts/assets/
// sunken_bastion_creatures/): every roster mob wears its own sea-themed body
// (no KayKit skeleton or stock crab or wolf), every clip its VISUALS row names
// ships in its GLB, and each creature carries the unique clips of its job
// (the crawler's swell-and-burst death, the hound's airborne Lunge, the
// watchman's halberd sweep, the arbalest's aim and crossbow drill, the
// sergeant's rally, the sea hag's ward, the Turnkey's keys and lantern), and
// every drowned sailor stands clearly over the player.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VISUALS, visualKeyFor } from '../src/render/characters/manifest';
import {
  BASTION_OPEN_CELLS_GESTURE,
  LANTERN_FLARE_DELAY,
} from '../src/render/sunken_bastion/bastion_creature_fx_core';
import { MOBS } from '../src/sim/data';
import { GHOST_CAPTAIN_TUNING } from '../src/sim/encounters/sunken_bastion/ghost_captain_ids';
import { BASTION_PIERCING_BOLT } from '../src/sim/mob/trash_kit/bastion_cast_ids';
import type { Entity } from '../src/sim/types';

function glbJson(url: string): { animations?: { name: string }[]; nodes?: { name?: string }[] } {
  const buf = readFileSync(join('public', url));
  expect(buf.readUInt32LE(0)).toBe(0x46546c67); // 'glTF'
  const jsonLength = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + jsonLength).toString('utf8'));
}

function glbNodeNames(url: string): Set<string> {
  return new Set((glbJson(url).nodes ?? []).map((n) => n.name ?? ''));
}

function glbClips(url: string): Set<string> {
  return new Set((glbJson(url).animations ?? []).map((a) => a.name));
}

/** The VISUALS key a mob template draws with. */
function keyOf(mobId: string): string {
  return visualKeyFor({ kind: 'mob', templateId: mobId } as Entity);
}

/** Every clip name a VISUALS row's ClipMap references. */
function referencedClips(key: string): string[] {
  const clips = VISUALS[key].clips as unknown as Record<string, unknown>;
  const out: string[] = [];
  for (const value of Object.values(clips)) {
    if (typeof value === 'string') out.push(value);
    else if (Array.isArray(value))
      out.push(...value.filter((v): v is string => typeof v === 'string'));
    else if (value && typeof value === 'object') {
      for (const v of Object.values(value)) if (typeof v === 'string') out.push(v);
    }
  }
  return out;
}

const ROSTER: Record<string, { glb: string; unique: string[] }> = {
  barnacle_crawler: { glb: 'bastion_ghost_sailor.glb', unique: ['Attack2', 'Death', 'Cast'] },
  turretback_hermit: {
    glb: 'woc_bastion_captain.glb',
    unique: ['Broadside', 'Anchor', 'Boarding', 'Death'],
  },
  bastion_warhound: {
    glb: 'bastion_warhound.glb',
    unique: ['Leap', 'Land', 'Attack2', 'Howl', 'Stunned'],
  },
  bastion_revenant: { glb: 'drowned_revenant.glb', unique: ['Attack', 'Attack2'] },
  drowned_watchman: { glb: 'drowned_watchman.glb', unique: ['HalberdSweep', 'CombatIdle'] },
  fogbound_arbalest: { glb: 'drowned_arbalest.glb', unique: ['Aim', 'Shoot'] },
  drowned_sergeant: { glb: 'drowned_sergeant.glb', unique: ['Rally', 'CombatIdle'] },
  shackled_prisoner: { glb: 'drowned_prisoner.glb', unique: ['Attack', 'Attack2'] },
  gaol_turnkey: {
    glb: 'woc_bastion_turnkey.glb',
    unique: ['KeySwing', 'ChainLash', 'LanternRaise', 'Cast'],
  },
  mistweaver: { glb: 'mist_chanter.glb', unique: ['Ward', 'Cast'] },
  tidebound_acolyte: { glb: 'tidebound_acolyte.glb', unique: ['Mend'] },
};

describe('the Sunken Bastion creature roster', () => {
  for (const [mobId, spec] of Object.entries(ROSTER)) {
    it(`${mobId} wears its own Blender body with every clip it plays`, () => {
      expect(MOBS[mobId], mobId).toBeDefined();
      const key = keyOf(mobId);
      const def = VISUALS[key];
      expect(def.url).toBe(`models/creatures/${spec.glb}`);
      // No stock skeleton rig and no borrowed clip donors.
      expect(def.url).not.toMatch(/skeleton|crabenemy|wolf/);
      expect(def.animUrls ?? []).toEqual([]);
      const shipped = glbClips(def.url);
      for (const clip of referencedClips(key))
        expect(shipped.has(clip), `${key} ${clip}`).toBe(true);
      for (const clip of ['Idle', 'Walk', 'Run', 'Hit', 'Death', ...spec.unique]) {
        expect(shipped.has(clip), `${spec.glb} ${clip}`).toBe(true);
      }
    });
  }

  it('stands every creature well past the player', () => {
    const player = VISUALS.player_warrior?.height ?? 2.6;
    for (const mobId of Object.keys(ROSTER)) {
      const def = VISUALS[keyOf(mobId)];
      expect(def.height * (MOBS[mobId].scale ?? 1), mobId).toBeGreaterThan(player * 1.1);
    }
  });

  it('stands the drowned sailors clearly over the player, the elites and sergeant most', () => {
    const player = VISUALS.player_warrior?.height ?? 2.6;
    const drawn = (mobId: string) => VISUALS[keyOf(mobId)].height * (MOBS[mobId].scale ?? 1);
    // The plain prisoner at half again the player's height, every elite
    // sailor twice it, the sergeant and the Turnkey bigger still.
    expect(drawn('shackled_prisoner') / player).toBeGreaterThanOrEqual(1.55);
    for (const mobId of ['bastion_revenant', 'drowned_watchman', 'fogbound_arbalest']) {
      expect(MOBS[mobId].elite, mobId).toBe(true);
      expect(drawn(mobId) / player, mobId).toBeGreaterThanOrEqual(1.95);
      expect(drawn(mobId), mobId).toBeGreaterThan(drawn('shackled_prisoner'));
    }
    for (const big of ['drowned_sergeant', 'gaol_turnkey']) {
      expect(drawn(big) / player, big).toBeGreaterThanOrEqual(2.3);
      for (const mobId of ['bastion_revenant', 'drowned_watchman', 'fogbound_arbalest'])
        expect(drawn(big), `${big} over ${mobId}`).toBeGreaterThan(drawn(mobId));
    }
  });

  it("keeps the sailors' gameplay: only the drawn height grew", () => {
    // The pinned template scales (collision, reach and the nameplate anchor
    // ride these), unchanged by the bigger bodies.
    expect(MOBS.bastion_revenant.scale).toBe(1.1);
    expect(MOBS.drowned_watchman.scale).toBe(1.1);
    expect(MOBS.fogbound_arbalest.scale).toBe(1);
    expect(MOBS.drowned_sergeant.scale).toBe(1.4);
    expect(MOBS.shackled_prisoner.scale).toBe(0.9);
    expect(MOBS.gaol_turnkey.scale).toBe(1.3);
  });

  it('gives the Turnkey its own jailer body, never a player model', () => {
    const def = VISUALS[keyOf('gaol_turnkey')];
    expect(def.url).toBe('models/creatures/woc_bastion_turnkey.glb');
    expect(def.url).not.toMatch(/chars\/players/);
    expect(def.attach ?? []).toEqual([]);
    expect(def.show ?? []).toEqual([]);
    expect(def.tint).toBeUndefined();
    expect(def.clips.attackByAbility?.[BASTION_OPEN_CELLS_GESTURE]).toBe('LanternRaise');
    // The organic-kit body (baked skin and leather, rusted iron) at a boss's
    // stature: over three players tall as drawn.
    expect(def.authoredAtlas).toBe(true);
    expect((def.height * MOBS.gaol_turnkey.scale) / 2.6).toBeGreaterThanOrEqual(3);
  });

  it('carries a real crossbow drill on the arbalest', () => {
    const def = VISUALS[keyOf('fogbound_arbalest')];
    expect(def.clips.attack).toEqual(['Shoot']);
    // The Piercing Bolt's loose lands as its 2 s bar ends, the reload plays out.
    expect(def.clips.castByAbility?.[BASTION_PIERCING_BOLT]).toBe('Aim');
    expect(def.clips.castTimeScaleByAbility?.[BASTION_PIERCING_BOLT]).toBe(1);
    expect(def.clips.castPlayOut).toContain('Aim');
    expect(def.attackTimeScale).toBe(1);
    // The crossbow's moving parts ship as their own bones and are animated:
    // the bolt vanishes and the string snaps forward at the loose.
    const nodes = glbNodeNames(def.url);
    for (const bone of ['Bolt', 'StringD', 'StringR', 'Crank'])
      expect(nodes.has(bone), bone).toBe(true);
  });

  it('leaves the Sanctum Thawcaller its own body when the Chanter changed', () => {
    // The Gravewyrm Sanctum's Thawcaller used to be a re-tint spread from the
    // Mist Chanter's row; it now wears its own Blender body
    // (characters/sanctum_trash_looks.ts), so the Bastion's sculpted Chanter
    // never changes another dungeon's look.
    const chanter = VISUALS[keyOf('mistweaver')];
    const thaw = VISUALS.sanctum_thawcaller;
    expect(chanter.url).toBe('models/creatures/mist_chanter.glb');
    expect(chanter.authoredAtlas).toBe(true);
    expect(thaw.url).toBe('models/creatures/sanctum_thawcaller.glb');
    expect(thaw.authoredAtlas).toBe(true);
    const clips = glbClips(thaw.url);
    for (const clip of ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death', 'WarmingRite'])
      expect(clips.has(clip), clip).toBe(true);
  });

  it('no Bastion trash mob wears a KayKit skeleton any more', () => {
    for (const mobId of [...Object.keys(ROSTER), 'bastion_revenant']) {
      expect(VISUALS[keyOf(mobId)].url).not.toContain('skeleton');
    }
  });
});

interface GlbDoc {
  nodes?: { name?: string; children?: number[] }[];
  animations?: { name: string; samplers: { input: number }[] }[];
  accessors?: { max?: number[] }[];
}

/** A clip's length in seconds (its samplers' last key time). */
function clipSeconds(url: string, clip: string): number {
  const doc = glbJson(url) as GlbDoc;
  const anim = (doc.animations ?? []).find((a) => a.name === clip);
  expect(anim, clip).toBeDefined();
  return Math.max(...(anim?.samplers ?? []).map((s) => doc.accessors?.[s.input]?.max?.[0] ?? 0));
}

/** The name of the node that parents `name` in the GLB. */
function parentOf(url: string, name: string): string | undefined {
  const nodes = (glbJson(url) as GlbDoc).nodes ?? [];
  const i = nodes.findIndex((n) => n.name === name);
  return nodes.find((n) => (n.children ?? []).includes(i))?.name;
}

describe("the Gaol Turnkey on the art guide's body", () => {
  const def = VISUALS[keyOf('gaol_turnkey')];

  it('carries the great key and the lantern on their own bones in his fists', () => {
    // Each prop rides a bone of its own under its hand, so it never turns in the
    // fist and the lantern swings on its chain.
    expect(parentOf(def.url, 'key')).toBe('hand.r');
    expect(parentOf(def.url, 'lantern')).toBe('hand.l');
  });

  it('lands both blows on frame 18 of a 1.5 s swing played at 1x', () => {
    // Weight before speed: a long coil and hang, the contact at 0.567 s (frame
    // 18 at 30 fps), then the follow-through and a slow recovery.
    expect(def.attackTimeScale).toBe(1);
    for (const clip of ['KeySwing', 'ChainLash']) {
      expect(def.clips.contacts?.[clip], clip).toEqual([0.567]);
      expect(clipSeconds(def.url, clip), clip).toBeCloseTo(1.5, 2);
    }
  });

  it('flares the lantern at the top of its raise, inside the clip', () => {
    const raise = clipSeconds(def.url, 'LanternRaise');
    // The top of the hoist is frame 12 (0.367 s), when the flare is lit.
    expect(Math.abs(LANTERN_FLARE_DELAY - 11 / 30)).toBeLessThan(0.02);
    expect(raise).toBeGreaterThan(LANTERN_FLARE_DELAY + 0.8);
  });
});

describe("the Shipwreck Captain on the art guide's body", () => {
  const def = VISUALS[keyOf('turretback_hermit')];

  it('carries the cutlass on its own bone in his right fist', () => {
    expect(parentOf(def.url, 'cutlass')).toBe('hand.r');
  });

  it('lands both blows on frame 18 of a 1.5 s swing played at 1x', () => {
    expect(def.attackTimeScale).toBe(1);
    for (const clip of ['Attack', 'Attack2']) {
      expect(def.clips.contacts?.[clip], clip).toEqual([0.567]);
      expect(clipSeconds(def.url, clip), clip).toBeCloseTo(1.5, 2);
    }
  });

  it('plays each bar over exactly its warning, the blow at its end', () => {
    // Played at 1x through castByAbility, so each clip spans its bar: the
    // guns fire, the anchor flies and the crew boards as the clip ends.
    const bars = {
      Broadside: GHOST_CAPTAIN_TUNING.broadsideWarning,
      Anchor: GHOST_CAPTAIN_TUNING.anchorWarning,
      Boarding: GHOST_CAPTAIN_TUNING.boardingWarning,
    };
    for (const [clip, seconds] of Object.entries(bars))
      expect(clipSeconds(def.url, clip), clip).toBeCloseTo(seconds, 3);
  });
});
