// The Hammer Council's deaths, "The quarry falls silent"
// (src/render/smith_heart_fx/council_death_core.ts, painted by
// council_death_fx.ts and its parts council_death_stone.ts and
// council_death_crystal.ts):
//   - each member's timeline in order, inside the 6 to 10 seconds asked for,
//     a second death's end beat included, and a dev replay of both too;
//   - the Guardian's slabs: a fixed plan that lands on the floor and lies
//     there; the Singer's shards: flung, held a beat, raining, gone; her
//     shafts of light shut at the shatter;
//   - the end beat: the columns power down in the reverse of their waking,
//     dark by its end; it starts only once both have fallen, after the
//     second one's climax;
//   - every sound a shipped sample; the clock: a death, a replay, neither;
//   - the rig: the husk's shade held while re-sent, a replay's fall plays
//     the Death clip;
//   - CouncilDeathFx over a fake world: a death seen live plays the scene
//     and leaves its rubble and husk; a corpse first seen long dead shows
//     none of the scene; a member out of view mid-scene resumes, never
//     restarts; a replay cue is claimed, falls the living body and stands it
//     up; the low tier sheds only its named double; reduced motion takes the
//     thuds;
//   - `/dev heart council death` over a real Sim emits the cues and kills
//     nothing; the cue makes no sound of its own.

import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { SFX_FIXED_CATALOG_KEYS } from '../src/game/sfx_manifest.generated';
import { councilSoundClaims } from '../src/game/smith_heart_council_audio_core';
import { GlowPulse } from '../src/render/characters/glow_pulse';
import { SMITH_HEART_BOSS_LOOKS } from '../src/render/characters/smith_heart_boss_looks';
import { gfxInternalsForTest, sharedUniforms } from '../src/render/gfx';
import { CouncilDeathFx } from '../src/render/smith_heart_fx';
import {
  COLUMN_DOWN_ORDER,
  COUNCIL_DEATH_END,
  COUNCIL_DEATH_GESTURES,
  COUNCIL_END_LEAD,
  COUNCIL_END_SECONDS,
  COUNCIL_END_SOUNDS,
  COUNCIL_HUSK_SHADE,
  COUNCIL_REPLAY_STAGGER,
  columnDownAt,
  councilDeathCrossed,
  councilDeathKept,
  councilDeathLight,
  councilDeathShake,
  councilDeathTime,
  councilEndLook,
  councilEndTime,
  councilLeakLevel,
  councilReplaySeconds,
  councilSecondDeathSeconds,
  GUARDIAN_DEATH,
  GUARDIAN_DEATH_SOUNDS,
  GUARDIAN_SLABS,
  guardianDeathLook,
  guardianSlabAt,
  SINGER_DEATH,
  SINGER_DEATH_SOUNDS,
  SINGER_LEAKS,
  SINGER_SHARDS,
  singerDeathLook,
  singerShardAt,
} from '../src/render/smith_heart_fx/council_death_core';
import { COLUMN_ORDER } from '../src/render/smith_heart_fx/council_entrance_core';
import { COUNCIL_DEATH_SECONDARY_LAYERS } from '../src/render/smith_heart_fx/entrance_budget_core';
import { SMITH_HEART_DUNGEON } from '../src/sim/content/smith_heart';
import { HAMMER_PIT, QUARRY_PILLAR_SPOTS } from '../src/sim/content/smith_heart_layout';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import { handleSmithHeartDevChat } from '../src/sim/dev/smith_heart_dev';
import { councilBodies } from '../src/sim/encounters/smith_heart';
import { COUNCIL_DEV_CUES, COUNCIL_TEMPLATES } from '../src/sim/encounters/smith_heart/council_ids';
import type { InstanceSlot } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

describe('the timelines', () => {
  it('runs each scene in order, inside the 6 to 10 seconds asked for', () => {
    const G = GUARDIAN_DEATH;
    expect(G.seamsTo).toBeLessThan(G.splitAt);
    expect(G.blazeFull).toBeLessThan(G.splitAt);
    expect(G.splitAt).toBeLessThan(G.kneelAt);
    expect(G.gutterFrom).toBeLessThan(G.gutters[0]);
    expect(G.gutters[G.gutters.length - 1]).toBeLessThan(G.coreOut);
    expect(G.coreOut).toBeLessThan(G.end);
    const S = SINGER_DEATH;
    expect(S.noteFrom).toBeLessThan(S.leakFrom);
    expect(S.leakTo).toBeLessThan(S.shatterAt);
    for (const role of ['guardian', 'singer'] as const) {
      expect(COUNCIL_DEATH_END[role]).toBeGreaterThanOrEqual(5);
      // A second death with its end beat: 6 to 10 seconds.
      expect(councilSecondDeathSeconds(role)).toBeGreaterThanOrEqual(6);
      expect(councilSecondDeathSeconds(role)).toBeLessThanOrEqual(10);
    }
    // Both replayed: the Singer follows, the whole within 10 seconds.
    expect(COUNCIL_REPLAY_STAGGER + councilSecondDeathSeconds('singer')).toBeLessThanOrEqual(10);
  });

  it('blazes, splits and lets the core gutter out; holds the husk from the split', () => {
    const before = guardianDeathLook(GUARDIAN_DEATH.blazeFull, false);
    expect(before.blaze).toBeGreaterThan(0.9);
    expect(before.seams).toBe(1);
    expect(before.husk).toBe(false);
    const split = guardianDeathLook(GUARDIAN_DEATH.splitAt + 0.05, false);
    expect(split.husk).toBe(true);
    expect(split.slabHeat).toBeGreaterThan(1);
    const out = guardianDeathLook(GUARDIAN_DEATH.coreOut + 0.2, false);
    expect(out.core).toBeLessThan(0.05);
    const long = guardianDeathLook(500, false);
    expect(long.husk).toBe(true);
    expect(long.slabHeat).toBe(0);
    expect(long.slabEmber).toBe(0);
    // A replay gives the colour back at its end.
    expect(guardianDeathLook(councilReplaySeconds('guardian') + 0.1, true).husk).toBe(false);
  });

  it("opens the Singer's shafts through her fracture and shuts every one at the shatter", () => {
    let opened = 0;
    for (const l of SINGER_LEAKS) {
      expect(l.at).toBeGreaterThanOrEqual(SINGER_DEATH.leakFrom);
      expect(l.at).toBeLessThan(SINGER_DEATH.shatterAt);
      if (councilLeakLevel(l, SINGER_DEATH.shatterAt - 0.01, 1.5, SINGER_DEATH.shatterAt) > 0)
        opened++;
      expect(councilLeakLevel(l, SINGER_DEATH.shatterAt, 1.5, SINGER_DEATH.shatterAt)).toBe(0);
    }
    expect(opened).toBe(SINGER_LEAKS.length);
    const look = singerDeathLook(SINGER_DEATH.shatterAt + 0.05, false);
    expect(look.flash).toBeGreaterThan(0.3);
    expect(look.husk).toBe(true);
  });
});

describe('the stone and the shards', () => {
  it('drops every slab to the floor, where it lies settled', () => {
    for (const s of GUARDIAN_SLABS) {
      const drop = 6;
      const mid = guardianSlabAt(s, 0.05 + s.delay, drop);
      expect(mid.landed).toBe(false);
      const late = guardianSlabAt(s, 30, drop);
      expect(late.landed).toBe(true);
      expect(late.y).toBeCloseTo(-drop, 5);
      expect(late.settle).toBe(1);
      expect(late.scale).toBe(1);
      expect(late.out).toBeGreaterThan(0);
    }
  });

  it('flings each shard, holds it a beat, rains it down and melts it away', () => {
    for (const s of SINGER_SHARDS) {
      const held = singerShardAt(s, s.hang * 0.9, 4);
      expect(held.hanging).toBe(true);
      expect(held.scale).toBeGreaterThan(0);
      // Held aloft: hardly moving through its last tenth of the hang.
      const a = singerShardAt(s, s.hang * 0.8, 4);
      expect(Math.abs(held.out - a.out)).toBeLessThan(0.6);
      const down = singerShardAt(s, s.hang + 6, 4);
      expect(down.landed).toBe(true);
      expect(down.y).toBeCloseTo(-4, 5);
      expect(down.scale).toBe(0);
    }
  });

  it('keeps every piece on a detail tier and a share on the low tier', () => {
    expect(SINGER_SHARDS.every((_, i) => councilDeathKept(i, 1))).toBe(true);
    const low = SINGER_SHARDS.filter((_, i) => councilDeathKept(i, 0.4)).length;
    expect(low).toBeGreaterThan(0);
    expect(low).toBeLessThan(SINGER_SHARDS.length);
  });
});

describe('the end beat', () => {
  it('powers the columns down in the reverse of their waking, and leaves them dark', () => {
    expect(COLUMN_DOWN_ORDER).toEqual([...COLUMN_ORDER].reverse());
    for (let k = 1; k < COLUMN_DOWN_ORDER.length; k++)
      expect(columnDownAt(COLUMN_DOWN_ORDER[k])).toBeGreaterThan(
        columnDownAt(COLUMN_DOWN_ORDER[k - 1]),
      );
    const lit = councilEndLook(0.6);
    expect(lit.active).toBe(true);
    for (let i = 0; i < QUARRY_PILLAR_SPOTS.length; i++) expect(lit.climb[i]).toBeGreaterThan(0.9);
    const first = COLUMN_DOWN_ORDER[0];
    const last = COLUMN_DOWN_ORDER[COLUMN_DOWN_ORDER.length - 1];
    const mid = councilEndLook(columnDownAt(first) + 0.9);
    expect(mid.climb[first]).toBe(0);
    expect(mid.climb[last]).toBeGreaterThan(0.9);
    const done = councilEndLook(COUNCIL_END_SECONDS + 0.1);
    expect(done.active).toBe(false);
    expect(done.glow.every((g) => g === 0)).toBe(true);
  });

  it('starts only once both have fallen, after the second one climax', () => {
    expect(councilEndTime(-1, 3)).toBe(-1);
    expect(councilEndTime(3, -1)).toBe(-1);
    // The Singer fell second (her clock is the younger).
    expect(councilEndTime(9, 2)).toBeCloseTo(2 - COUNCIL_END_LEAD.singer, 6);
    expect(councilEndTime(1, 9)).toBeCloseTo(1 - COUNCIL_END_LEAD.guardian, 6);
    // A pair long dead is long past it.
    expect(councilEndLook(councilEndTime(500, 400)).active).toBe(false);
  });
});

describe('the beats, the sounds and the clock', () => {
  it('fires a beat once, only for a scene seen crossing it', () => {
    expect(councilDeathCrossed(1.2, 1.35, 1.3)).toBe(true);
    expect(councilDeathCrossed(1.35, 1.4, 1.3)).toBe(false);
    expect(councilDeathCrossed(-1, 40, 1.3)).toBe(false);
    expect(councilDeathCrossed(30, 40, 1.3)).toBe(false);
  });

  it('every sound is a shipped sample on a beat inside its scene', () => {
    for (const [list, end] of [
      [GUARDIAN_DEATH_SOUNDS, GUARDIAN_DEATH.end],
      [SINGER_DEATH_SOUNDS, SINGER_DEATH.end],
      [COUNCIL_END_SOUNDS, COUNCIL_END_SECONDS],
    ] as const) {
      for (const s of list) {
        expect(SFX_FIXED_CATALOG_KEYS, s.key).toContain(s.key);
        expect(s.at).toBeGreaterThanOrEqual(0);
        expect(s.at).toBeLessThan(end);
      }
    }
  });

  it('runs off a death, off a replay on a living body, or not at all', () => {
    expect(councilDeathTime('guardian', 10, 7, -1, true)).toBe(3);
    expect(councilDeathTime('guardian', 10, 0, 8, false)).toBe(2);
    expect(councilDeathTime('guardian', 10, 0, 11, false)).toBe(-1);
    expect(councilDeathTime('guardian', 30, 0, 8, false)).toBe(-1);
    expect(councilDeathTime('singer', 10, 0, -1, false)).toBe(-1);
  });

  it('calms the light and takes the thuds under reduced motion', () => {
    expect(councilDeathLight(2, true)).toBeLessThan(2);
    expect(councilDeathLight(2, false)).toBe(2);
    expect(councilDeathShake(0.8, 100, 10, true)).toBe(0);
    expect(councilDeathShake(0.8, 100, 10, false)).toBeGreaterThan(0);
    expect(councilDeathShake(0.8, 100, 120, false)).toBe(0);
  });
});

describe('the rigs', () => {
  for (const role of ['guardian', 'singer'] as const) {
    const look =
      SMITH_HEART_BOSS_LOOKS[
        role === 'guardian' ? 'smith_heart_hammer_guardian' : 'smith_heart_seam_singer'
      ];
    const husk =
      role === 'guardian' ? COUNCIL_DEATH_GESTURES.guardianHusk : COUNCIL_DEATH_GESTURES.singerHusk;
    const fall =
      role === 'guardian' ? COUNCIL_DEATH_GESTURES.guardianFall : COUNCIL_DEATH_GESTURES.singerFall;

    it(`${role}: darkens to a husk, held while the shade is re-sent`, () => {
      const set = look.glowPulses;
      if (!set) throw new Error('no glow pulses');
      const p = set.pulses.find((x) => x.gesture === husk);
      expect(p?.shade).toBe(COUNCIL_HUSK_SHADE[role]);
      // A rise would restart at every re-send and strobe the stone.
      expect(p?.rise).toBe(0);
      const pulse = new GlowPulse(set);
      pulse.handle(husk);
      for (let i = 0; i < 40; i++) {
        pulse.step(0.05, true);
        if (i % 7 === 0) pulse.handle(husk);
      }
      expect(pulse.active).toBe(true);
    });

    it(`${role}: a replay's fall plays its Death clip on the living body`, () => {
      expect(look.phaseClips?.[fall]?.enter).toBe('Death');
      expect(look.clips.death).toBe('Death');
    });
  }
});

describe('CouncilDeathFx plays the deaths', () => {
  afterEach(() => {
    sharedUniforms.uTime.value = 0;
  });

  function setup(reduced = false) {
    const o = instanceOrigin(DUNGEONS.smith_heart.index, 0);
    const entities = new Map<number, Entity>();
    const mk = (id: number, kind: Entity['kind'], templateId: string, x: number, z: number) =>
      ({
        id,
        kind,
        templateId,
        name: templateId,
        pos: { x, y: 0, z },
        prevPos: { x, y: 0, z },
        facing: 0.4,
        scale: 1,
        hp: 100,
        maxHp: 100,
        dead: false,
        inCombat: false,
        auras: [],
        castingAbility: null,
        castRemaining: 0,
        castTotal: 0,
      }) as unknown as Entity;
    const me = mk(1, 'player', 'warrior', o.x + HAMMER_PIT.x - 20, o.z + HAMMER_PIT.z);
    const g = mk(2, 'mob', COUNCIL_TEMPLATES.guardian, o.x + HAMMER_PIT.x, o.z + HAMMER_PIT.z);
    const s = mk(
      3,
      'mob',
      COUNCIL_TEMPLATES.singer,
      o.x + HAMMER_PIT.x + 3,
      o.z + HAMMER_PIT.z + 9,
    );
    for (const e of [me, g, s]) entities.set(e.id, e);
    QUARRY_PILLAR_SPOTS.forEach((c, i) => {
      const p = mk(10 + i, 'object', 'sh_council_pillar_2', o.x + c.x, o.z + c.z);
      entities.set(p.id, p);
    });
    const world = {
      entities,
      player: me,
      playerId: me.id,
      entityRosterVersion: 1,
    } as unknown as IWorld;
    const scene = new THREE.Scene();
    const sent: string[] = [];
    let shakes = 0;
    const fx = new CouncilDeathFx(
      scene,
      () => 0,
      world,
      undefined,
      () => reduced,
      () => {
        shakes++;
      },
      (_id, gesture) => sent.push(gesture),
    );
    const step = (seconds: number) => {
      for (let i = 0; i < Math.round(seconds * 20); i++) {
        sharedUniforms.uTime.value += 0.05;
        fx.update(0.05);
      }
    };
    return { scene, fx, g, s, sent, step, entities, shakes: () => shakes };
  }

  const shown = (scene: THREE.Scene, name: string) => {
    const o = scene.getObjectByName(name);
    let v = !!o;
    for (let p: THREE.Object3D | null | undefined = o; p; p = p.parent) v = v && p.visible;
    return v;
  };

  it('a death seen live plays the scene and leaves its rubble and its husk', () => {
    const t = setup();
    t.step(1);
    expect(shown(t.scene, 'smithHeartCouncilDeathSlabs')).toBe(false);
    t.g.dead = true;
    t.step(GUARDIAN_DEATH.blazeFull);
    expect(shown(t.scene, 'smithHeartCouncilDeathLight')).toBe(true);
    expect(shown(t.scene, 'smithHeartCouncilDeathShafts')).toBe(true);
    t.step(GUARDIAN_DEATH.splitAt + 0.3 - GUARDIAN_DEATH.blazeFull);
    expect(shown(t.scene, 'smithHeartCouncilDeathSlabs')).toBe(true);
    expect(t.sent).toContain(COUNCIL_DEATH_GESTURES.guardianHusk);
    expect(t.shakes()).toBeGreaterThan(0);
    t.step(GUARDIAN_DEATH.end + 2);
    // The Singer still fights: the rubble has sunk (no slab over a floor
    // mark), the husk stays dark; the scene's light is gone.
    expect(shown(t.scene, 'smithHeartCouncilDeathSlabs')).toBe(false);
    expect(shown(t.scene, 'smithHeartCouncilDeathShafts')).toBe(false);
    const before = t.sent.filter((x) => x === COUNCIL_DEATH_GESTURES.guardianHusk).length;
    t.step(2);
    expect(t.sent.filter((x) => x === COUNCIL_DEATH_GESTURES.guardianHusk).length).toBeGreaterThan(
      before,
    );
    // One down: no end beat yet.
    expect(t.fx.endTime).toBe(-1);
    t.fx.dispose();
  });

  it('the second death powers the columns down, once', () => {
    const t = setup();
    t.step(1);
    t.g.dead = true;
    t.step(3);
    t.s.dead = true;
    t.step(COUNCIL_END_LEAD.singer + 0.6);
    expect(t.fx.endTime).toBeGreaterThan(0);
    expect(shown(t.scene, 'smithHeartCouncilDeathColumns')).toBe(true);
    t.step(COUNCIL_END_SECONDS);
    expect(shown(t.scene, 'smithHeartCouncilDeathColumns')).toBe(false);
    t.fx.dispose();
  });

  it('a pair first seen long dead shows none of the scene, only rubble and husks', () => {
    const t = setup();
    t.g.dead = true;
    t.s.dead = true;
    t.step(2);
    expect(t.sent).toContain(COUNCIL_DEATH_GESTURES.guardianHusk);
    expect(t.sent).toContain(COUNCIL_DEATH_GESTURES.singerHusk);
    expect(shown(t.scene, 'smithHeartCouncilDeathSlabs')).toBe(true);
    expect(shown(t.scene, 'smithHeartCouncilDeathShafts')).toBe(false);
    expect(shown(t.scene, 'smithHeartCouncilDeathShards')).toBe(false);
    expect(shown(t.scene, 'smithHeartCouncilDeathColumns')).toBe(false);
    expect(t.shakes()).toBe(0);
    t.fx.dispose();
  });

  it('a member seen alive, gone from view and back dead is a husk, never a late scene', () => {
    const t = setup();
    t.step(1);
    t.entities.delete(t.g.id);
    t.step(1);
    t.g.dead = true;
    t.entities.set(t.g.id, t.g);
    t.step(1);
    expect(t.fx.sceneTime('guardian')).toBeGreaterThan(GUARDIAN_DEATH.end);
    expect(t.shakes()).toBe(0);
    expect(t.sent).toContain(COUNCIL_DEATH_GESTURES.guardianHusk);
    t.fx.dispose();
  });

  it('a member out of view mid-scene and back still dead resumes, never restarts', () => {
    const t = setup();
    t.step(0.5);
    t.s.dead = true;
    t.step(0.6);
    const at = t.fx.sceneTime('singer');
    t.entities.delete(t.s.id);
    t.step(1);
    expect(shown(t.scene, 'smithHeartCouncilDeathCrystal')).toBe(false);
    t.entities.set(t.s.id, t.s);
    t.step(0.5);
    expect(t.fx.sceneTime('singer')).toBeCloseTo(at + 1.5, 1);
    t.fx.dispose();
  });

  it('a replay cue is claimed, falls the living bodies and stands them back up', () => {
    const t = setup();
    t.step(1);
    const cue = (id: number): SimEvent => ({
      type: 'spellfx',
      sourceId: id,
      targetId: id,
      school: 'arcane',
      fx: 'nova',
      ability: COUNCIL_DEV_CUES.deathReplay,
    });
    expect(t.fx.handleEvent(cue(t.g.id))).toBe(true);
    expect(t.fx.handleEvent(cue(t.s.id))).toBe(true);
    // A cue off anything else is claimed and plays nothing.
    expect(t.fx.handleEvent(cue(999))).toBe(true);
    t.step(GUARDIAN_DEATH.splitAt + 0.3);
    expect(t.sent).toContain(COUNCIL_DEATH_GESTURES.guardianFall);
    expect(t.sent).not.toContain(COUNCIL_DEATH_GESTURES.singerFall);
    expect(shown(t.scene, 'smithHeartCouncilDeathSlabs')).toBe(true);
    // The Singer follows the Guardian.
    t.step(COUNCIL_REPLAY_STAGGER);
    expect(t.sent).toContain(COUNCIL_DEATH_GESTURES.singerFall);
    t.step(COUNCIL_REPLAY_STAGGER + councilReplaySeconds('singer'));
    expect(t.sent).toContain('smith_heart_council_guardian_stand');
    expect(t.sent).toContain('smith_heart_council_singer_stand');
    expect(shown(t.scene, 'smithHeartCouncilDeathSlabs')).toBe(false);
    expect(t.g.dead).toBe(false);
    expect(t.s.dead).toBe(false);
    t.fx.dispose();
  });

  it('plays every beat on the low tier and sheds only its named double', () => {
    const restore = gfxInternalsForTest.overrideSettings({ tier: 'low' });
    try {
      const t = setup();
      t.step(0.5);
      t.g.dead = true;
      t.step(3);
      t.s.dead = true;
      t.step(SINGER_DEATH.shatterAt - 0.1);
      expect(shown(t.scene, 'smithHeartCouncilDeathShafts')).toBe(true);
      expect(shown(t.scene, 'smithHeartCouncilDeathRings')).toBe(true);
      expect(shown(t.scene, 'smithHeartCouncilDeathLight')).toBe(true);
      t.step(COUNCIL_END_LEAD.singer + 0.7 - (SINGER_DEATH.shatterAt - 0.1));
      expect(shown(t.scene, 'smithHeartCouncilDeathColumns')).toBe(true);
      for (const layer of COUNCIL_DEATH_SECONDARY_LAYERS)
        expect(shown(t.scene, layer), layer).toBe(false);
      t.fx.dispose();
    } finally {
      restore();
    }
  });

  it('the full tier draws its double in its window', () => {
    const t = setup();
    t.step(0.5);
    t.g.dead = true;
    t.step(3);
    t.s.dead = true;
    t.step(COUNCIL_END_LEAD.singer + 0.7);
    expect(shown(t.scene, COUNCIL_DEATH_SECONDARY_LAYERS[0])).toBe(true);
    t.fx.dispose();
  });

  it('throws its slabs and its shards on the low tier too', () => {
    const restore = gfxInternalsForTest.overrideSettings({ tier: 'low' });
    try {
      const t = setup();
      t.step(0.5);
      t.g.dead = true;
      t.step(GUARDIAN_DEATH.splitAt + 0.3);
      expect(shown(t.scene, 'smithHeartCouncilDeathSlabs')).toBe(true);
      t.s.dead = true;
      t.step(SINGER_DEATH.shatterAt + 0.3);
      expect(shown(t.scene, 'smithHeartCouncilDeathShards')).toBe(true);
      t.fx.dispose();
    } finally {
      restore();
    }
  });

  it('calms the blaze under reduced motion: the same beat, less light', () => {
    const peak = (reduced: boolean) => {
      const t = setup(reduced);
      t.step(0.5);
      t.g.dead = true;
      t.step(GUARDIAN_DEATH.blazeFull + 0.1);
      const mesh = t.scene.getObjectByName('smithHeartCouncilDeathLight') as THREE.InstancedMesh;
      const c = mesh.instanceColor?.array ?? [];
      let m = 0;
      for (let i = 0; i < c.length; i++) m = Math.max(m, c[i]);
      t.fx.dispose();
      return m;
    };
    const calm = peak(true);
    expect(calm).toBeGreaterThan(0);
    expect(calm).toBeLessThan(peak(false));
    // Capped (the hottest card carries 1.5 times its level in red).
    expect(calm).toBeLessThanOrEqual(1.5 * 0.7 + 1e-6);
  });

  it('takes every thud under reduced motion, the scene itself whole', () => {
    const t = setup(true);
    t.step(0.5);
    t.g.dead = true;
    t.step(GUARDIAN_DEATH.splitAt + 1);
    expect(t.shakes()).toBe(0);
    expect(shown(t.scene, 'smithHeartCouncilDeathSlabs')).toBe(true);
    t.fx.dispose();
  });
});

describe('/dev heart council death', () => {
  it('emits the replay cues on the living members and kills nothing', () => {
    const sim = new Sim({ seed: 23, playerClass: 'warrior', autoEquip: false, devCommands: true });
    const dev = (line: string) => handleSmithHeartDevChat(sim.ctx, line, sim.player.id);
    sim.setPlayerLevel(20);
    expect(dev('/dev heart tp hammer')).toBe(true);
    sim.tick();
    const DUNGEON = DUNGEONS[SMITH_HEART_DUNGEON];
    const inst: InstanceSlot | undefined = sim.ctx.instances.find((i) => {
      if (i.dungeonId !== SMITH_HEART_DUNGEON || i.partyKey === null || i.exitId === null)
        return false;
      const o = instanceOrigin(DUNGEON.index, i.slot);
      return Math.abs(sim.player.pos.x - o.x) < 300 && Math.abs(sim.player.pos.z - o.z) < 250;
    });
    if (!inst) throw new Error('no claim');
    const bodies = councilBodies(sim.ctx, inst);
    if (!bodies?.guardian || !bodies.singer) throw new Error('no council');
    const hp = [bodies.guardian.hp, bodies.singer.hp];
    expect(dev('/dev heart council death')).toBe(true);
    const events = sim.tick();
    for (const b of [bodies.guardian, bodies.singer])
      expect(
        events.some(
          (e) =>
            e.type === 'spellfx' &&
            e.ability === COUNCIL_DEV_CUES.deathReplay &&
            e.sourceId === b.id,
        ),
      ).toBe(true);
    expect(bodies.guardian.dead).toBe(false);
    expect(bodies.singer.dead).toBe(false);
    expect([bodies.guardian.hp, bodies.singer.hp]).toEqual(hp);
    expect(bodies.guardian.inCombat).toBe(false);
    // One member alone.
    expect(dev('/dev heart council death singer')).toBe(true);
    const one = sim
      .tick()
      .filter((e) => e.type === 'spellfx' && e.ability === COUNCIL_DEV_CUES.deathReplay);
    expect(one.map((e) => (e as { sourceId: number }).sourceId)).toEqual([bodies.singer.id]);
  });

  it('the cue makes no sound of its own (the scenes play their own)', () => {
    expect(councilSoundClaims(COUNCIL_DEV_CUES.deathReplay)).toBe(true);
  });
});
