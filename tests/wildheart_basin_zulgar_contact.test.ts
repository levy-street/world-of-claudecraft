import { describe, expect, it } from 'vitest';
import {
  ZULGAR_ID,
  ZULGAR_MAULED,
  ZULGAR_PREY,
  ZULGAR_SUNSTRUCK,
} from '../src/sim/encounters/wildheart_basin';
import { lightGlyph } from '../src/sim/encounters/wildheart_basin/zulgar_glyphs';
import { mobCombatProfile } from '../src/sim/mob/combat_profile';
import { combatProfileForMob } from '../src/sim/mob_combat';
import { dist2d, type Entity, type ZulgarFightState } from '../src/sim/types';
import {
  aura,
  boss,
  engage,
  fight,
  hitsOn,
  local,
  put,
  run,
  tick,
  until,
} from './helpers/wildheart_fight';

function hunt(difficulty: 'normal' | 'heroic' = 'normal') {
  const f = fight(difficulty);
  const z = boss(f, ZULGAR_ID);
  put(f, z, 0, 218);
  put(f, f.tank, 0, 214);
  f.others.forEach((p, i) => {
    put(f, p, -20 + i * 20, 234);
  });
  engage(f, z);
  tick(f);
  f.sim.chat('/dev wildheart trigger prey', f.tank.id);
  const st = z.wildheartFight as ZulgarFightState;
  const prey = f.sim.ctx.entities.get(st.preyIds[st.chase]) as Entity;
  return { f, z, st, prey };
}

describe('Zulgar avatar contact', () => {
  it.each(['normal', 'heroic'] as const)(
    '%s: no maul eight yards away, but contact still mauls',
    (difficulty) => {
      const { f, z, prey } = hunt(difficulty);
      z.moveSpeed = 0;
      put(f, prey, local(f, z).x + 8, local(f, z).z);
      tick(f);
      expect(aura(prey, ZULGAR_MAULED)).toBeUndefined();
      expect(hitsOn(f, prey, 'Mauled')).toHaveLength(0);
      put(f, prey, local(f, z).x + 3, local(f, z).z);
      tick(f);
      expect(aura(prey, ZULGAR_MAULED)?.kind).toBe('stun');
      expect(hitsOn(f, prey, 'Mauled')).toHaveLength(1);
    },
  );

  it('walks into a lit glyph before catching the player beyond it', () => {
    const { f, z, st, prey } = hunt();
    const glyph = f.sim.ctx.entities.get(st.glyphs[0].objectId) as Entity;
    const at = local(f, glyph);
    // An actual chase through the glyph, no teleporting the avatar onto it.
    put(f, z, at.x, at.z - 10);
    put(f, prey, at.x, at.z + 4);
    lightGlyph(f.sim.ctx, st, 0, f.tank);
    expect(until(f, () => !!aura(z, ZULGAR_SUNSTRUCK) || !!aura(prey, ZULGAR_MAULED), 4)).toBe(
      true,
    );
    expect(aura(z, ZULGAR_SUNSTRUCK)).toBeDefined();
    expect(aura(prey, ZULGAR_MAULED)).toBeUndefined();
    expect(st.glyphs[0].cold).toBeGreaterThan(0);
    expect(until(f, () => !!aura(prey, ZULGAR_MAULED), 4)).toBe(true);
    expect(dist2d(z.pos, prey.pos)).toBeLessThanOrEqual(5);
  });

  it('uses close pursuit only while hunting, including the final phase', () => {
    const { f, z, st } = hunt();
    const normal = combatProfileForMob(z.templateId, z.scale);
    expect(mobCombatProfile(z)).toMatchObject({
      meleeRange: 5,
      desiredRange: 4,
      movingRangeBonus: 0,
    });
    st.phase = 'final';
    expect(mobCombatProfile(z).desiredRange).toBe(4);
    st.phase = 'hunt';
    f.sim.chat('/dev wildheart trigger endhunt', f.tank.id);
    expect(mobCombatProfile(z)).toEqual(normal);
    z.wildheartFight = undefined;
    expect(mobCombatProfile(z)).toEqual(normal);
  });

  it('heroic Twin Prey gives the new chased player time to react even at his feet', () => {
    const { f, z, st, prey } = hunt('heroic');
    z.moveSpeed = 0;
    put(f, prey, 20, 234);
    const next = f.sim.ctx.entities.get(st.preyIds[1]) as Entity;
    put(f, next, local(f, z).x + 1, local(f, z).z);
    st.switchTimer = 0.05;
    tick(f);
    expect(aura(next, ZULGAR_PREY)?.value2).toBe(1);
    expect(z.aggroTargetId).toBe(next.id);
    expect(aura(next, ZULGAR_MAULED)).toBeUndefined();
    run(f, 1.4);
    expect(aura(next, ZULGAR_MAULED)).toBeUndefined();
    run(f, 0.15);
    expect(aura(next, ZULGAR_MAULED)).toBeDefined();
  });

  it('a taunt cannot restart the turn window while the same Prey is chased', () => {
    const { f, z, st, prey } = hunt();
    z.moveSpeed = 0;
    put(f, prey, local(f, z).x + 8, local(f, z).z);
    f.sim.ctx.applyTaunt(f.tank, z);
    tick(f);
    expect(z.forcedTargetId).toBe(prey.id);
    expect(st.feedTimer).toBe(0);
    put(f, prey, local(f, z).x + 3, local(f, z).z);
    tick(f);
    expect(aura(prey, ZULGAR_MAULED)).toBeDefined();
  });

  it('the heroic turn window stays inside the six second Twin Prey cadence', () => {
    const { f, z, st, prey } = hunt('heroic');
    z.moveSpeed = 0;
    for (const id of st.preyIds) {
      const p = f.sim.ctx.entities.get(id) as Entity;
      put(f, p, 20, 234);
    }
    st.switchTimer = 0.05;
    tick(f);
    expect(z.aggroTargetId).not.toBe(prey.id);
    run(f, 5.85);
    expect(z.aggroTargetId).not.toBe(prey.id);
    run(f, 0.2);
    expect(z.aggroTargetId).toBe(prey.id);
  });
});
