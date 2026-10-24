// Live pools of a dungeon's spawn-list mobs, read from a real claim: a Sim, a
// level 20 player, the difficulty set, the door taken. What the heroic health
// band suites pin (hp, melee, mechanic factor and armor of each named boss).

import { DUNGEONS } from '../../src/sim/data';
import { claimedInstanceAt, enterDungeon } from '../../src/sim/instances/dungeons';
import { Sim } from '../../src/sim/sim';

export interface LivePool {
  hp: number;
  weapon: [number, number];
  mech: number | undefined;
  armor: number;
}

/** The owner's heroic bands (2026-10-12): non-final bosses about 25,000,
 *  minibosses 15,000 to 20,000, clearly under the bosses. */
export const HEROIC_BOSS_BAND = { min: 24_000, max: 30_000 } as const;
export const HEROIC_MINIBOSS_BAND = { min: 15_000, max: 20_000 } as const;
/** The owner's normal rule (2026-10-12): a miniboss carries clearly less than
 *  every boss of its dungeon, at most this share of the weakest one's pool. */
export const NORMAL_MINIBOSS_SHARE = 0.75;

/** Every spawn-list template of a claimed dungeon, by id (the first spawn of
 *  each template: bosses stand once). */
export function livePools(
  dungeonId: string,
  difficulty: 'normal' | 'heroic',
): Record<string, LivePool> {
  const sim = new Sim({ seed: 23, playerClass: 'warrior', autoEquip: false, devCommands: true });
  const tank = sim.player;
  sim.chat('/dev level 20', tank.id);
  sim.ctx.setDungeonDifficulty(difficulty, tank.id);
  enterDungeon(sim.ctx, dungeonId, tank.id, true);
  const inst = claimedInstanceAt(sim.ctx, tank.pos);
  if (!inst) throw new Error(`no ${dungeonId} claim`);
  const out: Record<string, LivePool> = {};
  DUNGEONS[dungeonId].spawns.forEach((spawn, i) => {
    if (out[spawn.mobId]) return;
    const e = sim.ctx.entities.get(inst.mobIds[i]);
    if (!e) return;
    out[spawn.mobId] = {
      hp: e.maxHp,
      weapon: [e.weapon?.min ?? 0, e.weapon?.max ?? 0],
      mech: e.mechanicDamageMult,
      armor: e.stats.armor,
    };
  });
  return out;
}
