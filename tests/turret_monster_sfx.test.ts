import { describe, expect, it } from 'vitest';
import { SFX_CLIPS } from '../src/game/sfx_manifest.generated';
import type { TurretSfxCue } from '../src/game/turret_defense_sfx';
import {
  TURRET_KNOCK_SFX,
  TURRET_THUMP_HEAVY_SFX,
  TURRET_THUMP_LIGHT_SFX,
  TurretMonsterSfx,
  turretKnockGain,
  turretThumpGain,
  turretThumpSound,
  turretVoiceKeys,
} from '../src/game/turret_monster_sfx';
import { TURRET_BOWLING, TURRET_PHYSICS, TURRET_WEAPON } from '../src/sim/content/turret_defense';
import type { TurretEvent } from '../src/sim/minigames/turret_defense';
import type { TurretKind, TurretPlan } from '../src/sim/minigames/turret_defense_plan';
import type { TurretSizeClass } from '../src/sim/types';
import type { TurretSessionView } from '../src/world_api/vehicles';

function kind(templateId: string, sizeClass: TurretSizeClass): TurretKind {
  return {
    templateId,
    level: 1,
    sizeClass,
    maxHp: 100,
    marchSpeed: 4,
    mass: 1,
    radius: 0.5,
    breachValue: 2,
    height: 2,
  };
}

const PLAN = {
  scenarioId: 'test',
  integrity: 100,
  medals: { gold: { minIntegrityShare: 0.9 }, silver: { minIntegrityShare: 0.6 } },
  arsenal: { shockwave: 0, fragmentation: 0 },
  resupplyWaves: [],
  chargeBonus: false,
  kinds: [
    kind('forest_wolf', 'small'),
    kind('vale_bandit', 'medium'),
    kind('fen_troll', 'large'),
    kind('thornpeak_ogre', 'huge'),
  ],
  waves: [],
  bowling: TURRET_BOWLING,
} as TurretPlan;

/** Monster id n is of kind n - 1 (1 wolf, 2 bandit, 3 troll, 4 ogre), plus two more wolves. */
function view(ids: number[] = [1, 2, 3, 4, 5, 6]): TurretSessionView {
  return {
    origin: { x: 0, y: 0, z: 0 },
    defense: {
      startTick: 0,
      plan: PLAN,
      monsters: ids.map((id) => ({ id, kind: id <= 4 ? id - 1 : 0 })),
    } as unknown as TurretSessionView['defense'],
    waveCount: 6,
    monstersLeft: 0,
    feedback: [],
  };
}

const voices = (templateId: string, action: string) => `${templateId}_${action}`;
const at = { x: 3, y: 1, z: 7 };
const launched = (id: number): TurretEvent => ({
  type: 'launched',
  id,
  ...at,
  vx: 1,
  vy: 5,
  vz: 0,
});
const killed = (id: number): TurretEvent => ({ type: 'killed', id, ...at });
const landed = (id: number): TurretEvent => ({ type: 'landed', id, ...at });
const bounce = (id: number, speed: number): TurretEvent => ({
  type: 'bounce',
  id,
  surface: 'ground',
  ...at,
  speed,
});
const bowled = (struckId: number, speed: number): TurretEvent => ({
  type: 'bowled',
  flyerId: 5,
  struckId,
  ...at,
  speed,
  damage: 9,
});

function rig() {
  const sounds = new TurretMonsterSfx(voices);
  const played: TurretSfxCue[] = [];
  const play = (cue: TurretSfxCue) => played.push({ ...cue });
  const session = view();
  /** Offers `events` at `now` and flushes them, as one frame. */
  const frame = (now: number, ...events: TurretEvent[]) => {
    for (const event of events) sounds.offer(event, session, now);
    sounds.flush(now, play);
  };
  const keys = () => played.map((cue) => cue.key);
  return { sounds, played, play, frame, keys, session };
}

describe('Fire and Fly thumps', () => {
  it('picks the light landing for small and medium bodies, the boulder for large and huge', () => {
    expect(TURRET_THUMP_LIGHT_SFX).toBe('move_land');
    expect(TURRET_THUMP_HEAVY_SFX).toBe('rift_boulder_impact');
    expect(TURRET_KNOCK_SFX).toBe('impact_warrior_quake');
    expect(turretThumpSound('small').key).toBe(TURRET_THUMP_LIGHT_SFX);
    expect(turretThumpSound('medium').key).toBe(TURRET_THUMP_LIGHT_SFX);
    expect(turretThumpSound('large').key).toBe(TURRET_THUMP_HEAVY_SFX);
    expect(turretThumpSound('huge').key).toBe(TURRET_THUMP_HEAVY_SFX);
    expect(turretThumpSound('medium').rate).toBeLessThan(turretThumpSound('small').rate);
    expect(turretThumpSound('huge').rate).toBeLessThan(turretThumpSound('large').rate);
    const clips: Record<string, unknown> = SFX_CLIPS;
    for (const key of [TURRET_THUMP_LIGHT_SFX, TURRET_THUMP_HEAVY_SFX, TURRET_KNOCK_SFX])
      expect(clips[key], key).toBeDefined();
  });

  it('plays each body with its own size, at the contact', () => {
    const { frame, played } = rig();
    frame(0, landed(1));
    frame(100, bounce(3, 10));
    expect(played).toMatchObject([
      { key: TURRET_THUMP_LIGHT_SFX, rate: turretThumpSound('small').rate, ...at },
      { key: TURRET_THUMP_HEAVY_SFX, rate: turretThumpSound('large').rate, ...at },
    ]);
  });

  it('grows louder with the contact speed, a landing softest, and stays bounded', () => {
    const soft = turretThumpGain(TURRET_PHYSICS.bounceMinSpeed);
    expect(turretThumpGain(0)).toBe(soft);
    expect(turretThumpGain(Number.NaN)).toBe(soft);
    expect(turretThumpGain(8)).toBeGreaterThan(soft);
    expect(turretThumpGain(16)).toBeGreaterThan(turretThumpGain(8));
    expect(turretThumpGain(60)).toBe(turretThumpGain(20));
    expect(turretThumpGain(60)).toBeLessThan(1);
    const { frame, played } = rig();
    frame(0, landed(1));
    frame(100, bounce(1, 18));
    expect(played[0].gain).toBe(soft);
    expect(played[1].gain).toBe(turretThumpGain(18));
  });

  it('plays one thump per 90 ms: the loudest of a frame, and nothing inside the gap', () => {
    const { frame, played } = rig();
    frame(0, landed(1), bounce(2, 12), bounce(6, 6));
    expect(played).toHaveLength(1);
    expect(played[0].gain).toBe(turretThumpGain(12));
    frame(89, bounce(1, 20));
    expect(played).toHaveLength(1);
    frame(90, landed(2));
    expect(played).toHaveLength(2);
    expect(played[1].gain).toBe(turretThumpGain(0));
    frame(90, bounce(3, 20));
    expect(played).toHaveLength(2);
  });

  it('knocks a bowled body with a short heavy impact at the contact, on its own channel', () => {
    expect(turretKnockGain(TURRET_BOWLING.minSpeed)).toBeLessThan(
      turretKnockGain(TURRET_WEAPON.maxLaunchSpeed),
    );
    const { frame, played, keys } = rig();
    frame(0, bowled(2, 12), bowled(3, 25), bounce(1, 10));
    expect(keys().sort()).toEqual([TURRET_KNOCK_SFX, TURRET_THUMP_LIGHT_SFX].sort());
    expect(played.find((c) => c.key === TURRET_KNOCK_SFX)).toMatchObject({
      gain: turretKnockGain(25),
      ...at,
    });
    frame(50, bowled(4, 30));
    expect(keys().filter((k) => k === TURRET_KNOCK_SFX)).toHaveLength(1);
    frame(90, bowled(4, 30));
    expect(keys().filter((k) => k === TURRET_KNOCK_SFX)).toHaveLength(2);
  });
});

describe('Fire and Fly cries', () => {
  it('cries in pain when a live monster is thrown, from where it was struck', () => {
    const { frame, played } = rig();
    frame(0, launched(2));
    expect(played).toEqual([
      { key: 'vale_bandit_hurt', ...at, gain: expect.any(Number), rate: 1, jitter: true },
    ]);
  });

  it('lets one cry through per 150 ms across every monster', () => {
    const { frame, keys } = rig();
    frame(0, launched(1), launched(2), launched(3));
    expect(keys()).toEqual(['forest_wolf_hurt']);
    frame(149, launched(4));
    expect(keys()).toHaveLength(1);
    frame(150, launched(4));
    expect(keys()).toEqual(['forest_wolf_hurt', 'thornpeak_ogre_hurt']);
  });

  it('lets each monster cry at most once a second', () => {
    const { frame, keys } = rig();
    frame(0, launched(2));
    frame(500, launched(2));
    frame(999, launched(2));
    expect(keys()).toEqual(['vale_bandit_hurt']);
    frame(1000, launched(2));
    expect(keys()).toEqual(['vale_bandit_hurt', 'vale_bandit_hurt']);
  });

  it('does not charge a monster whose cry lost the frame to another', () => {
    const { frame, keys } = rig();
    frame(0, launched(1), launched(2));
    frame(200, launched(2));
    expect(keys()).toEqual(['forest_wolf_hurt', 'vale_bandit_hurt']);
  });

  it('gives a kill its death cry, over any pain cry of the same frame', () => {
    const { frame, played } = rig();
    frame(0, launched(1), launched(3), killed(3));
    expect(played).toHaveLength(1);
    expect(played[0].key).toBe('fen_troll_death');
  });

  it('plays a death cry louder than a pain cry, and a pain cry well above a whisper', () => {
    const { frame, played } = rig();
    frame(0, launched(1));
    frame(2000, killed(2));
    expect(played.map((c) => c.key)).toEqual(['forest_wolf_hurt', 'vale_bandit_death']);
    expect(played[0].gain).toBeGreaterThanOrEqual(0.5);
    expect(played[1].gain).toBeGreaterThan(played[0].gain);
  });

  it("lets a death cry through a monster's own repeat limit", () => {
    const { frame, keys } = rig();
    frame(0, launched(3));
    frame(300, killed(3));
    expect(keys()).toEqual(['fen_troll_hurt', 'fen_troll_death']);
  });

  it('never voices a corpse', () => {
    const { frame, keys } = rig();
    frame(0, killed(1));
    frame(2000, launched(1));
    frame(4000, launched(1));
    expect(keys()).toEqual(['forest_wolf_death']);
  });

  it("keeps a monster's voice after the engine dropped its body (a drowned one)", () => {
    const { sounds, played, play } = rig();
    sounds.offer(launched(3), view(), 0);
    sounds.flush(0, play);
    sounds.offer(killed(3), view([1, 2]), 2000);
    sounds.flush(2000, play);
    expect(played.map((c) => c.key)).toEqual(['fen_troll_hurt', 'fen_troll_death']);
  });

  it('stays silent for a monster it cannot name, or one with no clip', () => {
    const sounds = new TurretMonsterSfx((templateId) =>
      templateId === 'forest_wolf' ? null : 'x',
    );
    const played: TurretSfxCue[] = [];
    sounds.offer(launched(9), view(), 0);
    sounds.offer(launched(1), view(), 0);
    sounds.flush(0, (cue) => played.push(cue));
    expect(played).toEqual([]);
  });

  it('forgets the previous seat on reset', () => {
    const { sounds, frame, keys } = rig();
    frame(0, killed(1), bounce(2, 10));
    sounds.reset();
    frame(10, launched(1), bounce(2, 10));
    expect(keys()).toEqual([
      'forest_wolf_death',
      TURRET_THUMP_LIGHT_SFX,
      'forest_wolf_hurt',
      TURRET_THUMP_LIGHT_SFX,
    ]);
  });

  it('voices a monster in a borrowed body with that body, never its own', () => {
    const dressed = { ...PLAN, kinds: [kind('frostmane_yeti', 'huge')] } as TurretPlan;
    const sounds = new TurretMonsterSfx(voices);
    const session = { ...view([1]), defense: { ...view([1]).defense, plan: dressed } };
    (session.defense as { monsters: unknown }).monsters = [{ id: 1, kind: 0 }];
    const played: TurretSfxCue[] = [];
    sounds.offer(killed(1), session as TurretSessionView, 0);
    sounds.flush(0, (cue) => played.push({ ...cue }));
    expect(played.map((c) => c.key)).toEqual(['pyre_colossus_death']);
    expect(turretVoiceKeys(dressed, voices).sort()).toEqual([
      'pyre_colossus_death',
      'pyre_colossus_hurt',
    ]);
  });

  it("voices the Deluge's diggers as tunnelers, and a digger elsewhere as a digger", () => {
    const cries = (scenarioId: string) => {
      const plan = { ...PLAN, scenarioId, kinds: [kind('tunnel_rat', 'small')] } as TurretPlan;
      const sounds = new TurretMonsterSfx(voices);
      const session = { ...view([1]), defense: { ...view([1]).defense, plan } };
      (session.defense as { monsters: unknown }).monsters = [{ id: 1, kind: 0 }];
      const played: TurretSfxCue[] = [];
      sounds.offer(launched(1), session as TurretSessionView, 0);
      sounds.flush(0, (cue) => played.push({ ...cue }));
      return [...played.map((c) => c.key), ...turretVoiceKeys(plan, voices)];
    };
    expect(cries('fire_and_fly_deluge')).toEqual([
      'deeprock_kobold_hurt',
      'deeprock_kobold_hurt',
      'deeprock_kobold_death',
    ]);
    expect(cries('fire_and_fly_standard')).toEqual([
      'tunnel_rat_hurt',
      'tunnel_rat_hurt',
      'tunnel_rat_death',
    ]);
  });

  it('lists every cry the plan can make, once each', () => {
    const plan = { ...PLAN, kinds: [...PLAN.kinds, kind('forest_wolf', 'small')] } as TurretPlan;
    expect(turretVoiceKeys(plan, voices).sort()).toEqual(
      ['forest_wolf', 'vale_bandit', 'fen_troll', 'thornpeak_ogre']
        .flatMap((id) => [`${id}_hurt`, `${id}_death`])
        .sort(),
    );
    expect(turretVoiceKeys(PLAN, (id, action) => (action === 'death' ? id : null))).toHaveLength(4);
  });
});
