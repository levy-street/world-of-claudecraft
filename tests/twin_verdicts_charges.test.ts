import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

// G7 (fix/talents2-balance-pass): the charge/seal audit found the engine
// SOUND (each Verdict required and consumed its own Seal; a no-Seal Verdict
// was refused at the cast gate before billing). The maintainer's sheet still
// called banked double Verdicts broken as a balance matter, so the row option
// became Swift Verdicts (the classic Improved Judgement cooldown cut). These
// tests pin the replacement and the seal cast gate that made the audit pass.

type Ev = { type?: string; ability?: string | null; amount?: number; text?: string };

function setup(): { sim: Sim; p: Entity; events: Ev[] } {
  const sim = new Sim({ seed: 7, playerClass: 'paladin', autoEquip: true });
  sim.setPlayerLevel(14);
  expect(sim.applyTalents({ spec: null, rows: { 14: 'pal_r14_swift_verdicts' } })).toBe(true);
  const p = sim.player;
  const mob = createMob(20_000, MOBS.forest_wolf, 5, {
    x: p.pos.x + 3,
    y: p.pos.y,
    z: p.pos.z,
  });
  mob.hostile = true;
  mob.aiState = 'idle';
  mob.maxHp = 100_000;
  mob.hp = mob.maxHp;
  (sim as unknown as { addEntity(entity: Entity): void }).addEntity(mob);
  sim.targetEntity(mob.id);
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  p.resource = p.maxResource;
  const events: Ev[] = [];
  const anySim = sim as unknown as { emit(e: Ev): void };
  const orig = anySim.emit.bind(sim);
  anySim.emit = (e: Ev) => {
    events.push(e);
    orig(e);
  };
  return { sim, p, events };
}

describe('Swift Verdicts (G7 outcome)', () => {
  it('resolves as a 20% Verdict cooldown cut with no banked charges', () => {
    const { sim } = setup();
    const verdict = sim.resolvedAbility('judgement');
    expect(verdict?.cooldown).toBeCloseTo(8);
    expect(verdict?.bonusCharges ?? 0).toBe(0);
  });

  it('a no-Seal Verdict is refused at the cast gate before billing', () => {
    const { sim, p, events } = setup();
    const manaBefore = p.resource;
    sim.castAbility('judgement'); // no seal active: refused
    sim.tick();
    expect(events.some((e) => e.type === 'error' && /no active seal/i.test(e.text ?? ''))).toBe(
      true,
    );
    expect(p.resource).toBe(manaBefore);
    expect(p.cooldowns.has('judgement')).toBe(false);
  });
});
