// The Pack's departure cue (src/game/turret_monster_sfx.ts): the crying member's own aggro
// cry, resolved through the same per-template voice lookup as the seat's hurt and death
// cries, on the member's look; silent when that look has no such clip, never another
// creature's voice. The table pins, wave by wave, which leader cries and the exact clip.
import { describe, expect, it } from 'vitest';
import { SFX_CLIPS } from '../src/game/sfx_manifest.generated';
import type { TurretSfxCue } from '../src/game/turret_defense_sfx';
import {
  TurretMonsterSfx,
  type TurretVoiceCue,
  turretRallyCueKey,
  turretVoiceKeys,
} from '../src/game/turret_monster_sfx';
import { fireAndFlyLookTemplate } from '../src/sim/content/fire_and_fly_looks';
import { TURRET_MISSION_PACK } from '../src/sim/content/fire_and_fly_missions';
import type { TurretEvent } from '../src/sim/minigames/turret_defense';
import { resolveTurretPlan } from '../src/sim/minigames/turret_defense_plan';
import { turretPackLeaderKind } from '../src/sim/minigames/turret_group_plan';
import type { TurretSessionView } from '../src/sim/turret_defense_session';
import { mobVoiceCue } from '../src/ui/combat_sfx';

/** The game's own lookup, against the clips the manifest ships (as `sfx.hasVariants` reads). */
const shipped: TurretVoiceCue = (templateId, action) =>
  mobVoiceCue(templateId, action, (key) => Object.hasOwn(SFX_CLIPS, key));

const plan = resolveTurretPlan(TURRET_MISSION_PACK);

/** Per wave, per pack: the leader's template, the look it wears, and the clip its cue plays. */
const LEADERS: readonly (readonly [string, string, string | null])[][] = [
  [['forest_wolf', 'forest_wolf', 'mob_beast_wolf_aggro']],
  [['forest_wolf', 'forest_wolf', 'mob_beast_wolf_aggro']],
  [
    ['webwood_spider', 'webwood_spider', 'mob_spider_aggro'],
    ['webwood_spider', 'webwood_spider', 'mob_spider_aggro'],
  ],
  [
    ['fen_troll', 'rift_dread_stalker', 'mob_demon_aggro'],
    ['fen_troll', 'rift_dread_stalker', 'mob_demon_aggro'],
  ],
  [
    ['thornpeak_ogre', 'rift_thornback', 'mob_beast_aggro'],
    ['thornpeak_ogre', 'rift_thornback', 'mob_beast_aggro'],
  ],
  [
    ['frostmane_yeti', 'old_greyjaw', 'mob_beast_wolf_aggro'],
    ['frostmane_yeti', 'old_greyjaw', 'mob_beast_wolf_aggro'],
    ['frostmane_yeti', 'old_greyjaw', 'mob_beast_wolf_aggro'],
  ],
  [
    ['thornpeak_ogre', 'rift_thornback', 'mob_beast_aggro'],
    ['thornpeak_ogre', 'rift_thornback', 'mob_beast_aggro'],
    ['thornpeak_ogre', 'rift_thornback', 'mob_beast_aggro'],
    ['thornpeak_ogre', 'rift_thornback', 'mob_beast_aggro'],
  ],
  [
    ['frostmane_yeti', 'old_greyjaw', 'mob_beast_wolf_aggro'],
    ['frostmane_yeti', 'old_greyjaw', 'mob_beast_wolf_aggro'],
    ['frostmane_yeti', 'old_greyjaw', 'mob_beast_wolf_aggro'],
    ['frostmane_yeti', 'old_greyjaw', 'mob_beast_wolf_aggro'],
  ],
];

describe("The Pack's departure cue", () => {
  it("cries each wave's named leader's own aggro clip, every one shipped", () => {
    const table = plan.waves.map((wave) =>
      wave.groups.flatMap((_, g) => {
        const kind = turretPackLeaderKind(wave, g);
        if (kind < 0) return [];
        const templateId = plan.kinds[kind].templateId;
        return [
          [
            templateId,
            fireAndFlyLookTemplate(templateId, plan.scenarioId),
            turretRallyCueKey(plan, kind, shipped),
          ] as const,
        ];
      }),
    );
    expect(table).toEqual(LEADERS);
    // Every leader is named by its content (a leading entry), and every clip exists.
    for (const wave of TURRET_MISSION_PACK.waves)
      for (const group of wave.groups)
        if (group.brick === 'pack') expect(group.entries.filter((e) => e.leads)).toHaveLength(1);
    for (const [, , key] of LEADERS.flat()) expect(Object.hasOwn(SFX_CLIPS, key!)).toBe(true);
  });

  it('asks the same lookup as the hurt and death cries, on the look, for the aggro action only', () => {
    const asked: [string, string][] = [];
    const spy: TurretVoiceCue = (templateId, action) => {
      asked.push([templateId, action]);
      return shipped(templateId, action);
    };
    const yeti = plan.kinds.findIndex((k) => k.templateId === 'frostmane_yeti');
    expect(turretRallyCueKey(plan, yeti, spy)).toBe('mob_beast_wolf_aggro');
    expect(asked).toEqual([['old_greyjaw', 'aggro']]);
    // Every clip a leader can cry is preloaded with the seat's cries, and no other member's
    // aggro cry: only the leader's own kind may cry for it (the boar and the Wildheart looks
    // gather in The Pack but never lead it).
    const keys = turretVoiceKeys(plan, shipped);
    for (const [, , key] of LEADERS.flat()) expect(keys).toContain(key);
    expect(keys).not.toContain('mob_boar_aggro');
    expect(keys).not.toContain('mob_troll_aggro');
  });
});

describe('the cue on the seat', () => {
  const kinds = plan.kinds;
  const wolf = kinds.findIndex((k) => k.templateId === 'forest_wolf' && !k.role);
  const yeti = kinds.findIndex((k) => k.templateId === 'frostmane_yeti');
  const session = {
    origin: { x: 0, y: 0, z: 0 },
    defense: {
      startTick: 0,
      plan,
      monsters: [
        { id: 7, kind: wolf },
        { id: 8, kind: yeti },
      ],
    },
    waveCount: 8,
    monstersLeft: 0,
    feedback: [],
  } as unknown as TurretSessionView;
  const cue = (id: number, rally = 0, x = 3, z = 30): TurretEvent => ({
    type: 'rallyCue',
    rally,
    id,
    x,
    y: 1,
    z,
    departTick: 120,
  });

  function frame(voice: TurretVoiceCue, ...events: TurretEvent[]): TurretSfxCue[] {
    const sounds = new TurretMonsterSfx(voice);
    const played: TurretSfxCue[] = [];
    for (const event of events) sounds.offer(event, session, 0);
    sounds.flush(0, (c) => played.push({ ...c }));
    return played;
  }

  it('plays the crier its own aggro cry once, at the rally', () => {
    expect(frame(shipped, cue(7))).toMatchObject([
      { key: 'mob_beast_wolf_aggro', x: 3, y: 1, z: 30 },
    ]);
  });

  it('plays every departure a frame delivers, a hitch bunching two cues included', () => {
    expect(frame(shipped, cue(7), cue(8, 1, -20, 5))).toMatchObject([
      { key: 'mob_beast_wolf_aggro', x: 3, z: 30 },
      { key: 'mob_beast_wolf_aggro', x: -20, z: 5 },
    ]);
  });

  it('stays silent with no clip for that look, never another voice, and with no crier', () => {
    const none: TurretVoiceCue = () => null;
    expect(frame(none, cue(7))).toEqual([]);
    expect(frame(shipped, cue(-1))).toEqual([]);
    expect(frame(shipped, cue(99))).toEqual([]);
  });
});
