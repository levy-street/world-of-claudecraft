import { describe, expect, it, vi } from 'vitest';
import { updatePlayerAutoAttack } from '../src/sim/combat/auto_attack';
import {
  applyRageSpendCooldownRefund,
  COLOSSAL_MIGHT_CAP_SECONDS,
  COLOSSAL_MIGHT_CAP_WINDOW,
} from '../src/sim/combat/casting_lifecycle';
import { Sim } from '../src/sim/sim';
import { dist2d, MAX_LEVEL } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

function warrior(spec: 'arms' | 'prot' | null): Sim {
  const sim = new Sim({ seed: 2614, playerClass: 'warrior', autoEquip: true });
  sim.setPlayerLevel(MAX_LEVEL);
  if (spec !== null) expect(sim.setSpec(spec)).toBe(true);
  expect(sim.selectTalentRow(17, 'war_row_recklessness')).toBe(true);
  expect(sim.selectTalentRow(20, 'war_row_colossal_might')).toBe(true);
  return sim;
}

function nearestMob(sim: Sim) {
  return [...sim.entities.values()]
    .filter((entity) => entity.kind === 'mob' && !entity.dead)
    .sort((a, b) => dist2d(a.pos, sim.player.pos) - dist2d(b.pos, sim.player.pos))[0]!;
}

function standInMelee(sim: Sim): ReturnType<typeof nearestMob> {
  const mob = nearestMob(sim);
  sim.player.pos.x = mob.pos.x - 2;
  sim.player.pos.z = mob.pos.z;
  sim.player.pos.y = terrainHeight(sim.player.pos.x, sim.player.pos.z, sim.cfg.seed);
  sim.player.prevPos = { ...sim.player.pos };
  sim.player.facing = Math.atan2(mob.pos.x - sim.player.pos.x, mob.pos.z - sim.player.pos.z);
  sim.targetEntity(mob.id);
  return mob;
}

describe('v0.26 Colossal Might', () => {
  it('refunds major cooldowns from the actual Rage billed by a normal cast', () => {
    const sim = warrior('prot');
    const player = sim.player;
    player.resource = 100;
    sim.castAbility('recklessness');
    expect(player.cooldowns.get('recklessness')).toBe(180);

    const cost = sim.resolvedAbility('demoralizing_shout')!.cost;
    sim.castAbility('demoralizing_shout');

    expect(player.cooldowns.get('recklessness')).toBeCloseTo(180 - cost * 0.1);
  });

  it('includes Shieldcrack in the winning cooldown roster', () => {
    const sim = warrior('prot');
    const player = sim.player;
    const mob = standInMelee(sim);
    mob.hp = mob.maxHp = 1_000_000;
    player.resource = 100;
    vi.spyOn(sim.rng, 'next').mockReturnValue(0.99);
    sim.castAbility('shield_slam');
    expect(player.cooldowns.get('shield_slam')).toBe(6);
    player.gcdRemaining = 0;

    const cost = sim.resolvedAbility('demoralizing_shout')!.cost;
    sim.castAbility('demoralizing_shout');

    expect(player.cooldowns.get('shield_slam')).toBeCloseTo(6 - cost * 0.1);
  });

  it('uses the actual queued on-next-swing Rage spend and gives no refund when free', () => {
    const sim = warrior(null);
    const player = sim.player;
    const mob = standInMelee(sim);
    mob.hp = mob.maxHp = 1_000_000;
    player.resource = 100;
    sim.castAbility('recklessness');
    const cost = sim.resolvedAbility('heroic_strike')!.cost;
    sim.castAbility('heroic_strike');
    player.autoAttack = true;
    player.swingTimer = 0;
    player.offhandSwingTimer = 100;
    vi.spyOn(sim.rng, 'next').mockReturnValue(0.99);

    updatePlayerAutoAttack(sim.ctx, player, sim.meta(player.id)!);

    expect(player.cooldowns.get('recklessness')).toBeCloseTo(180 - cost * 0.1);

    player.cooldowns.set('recklessness', 180);
    player.resource = 100;
    player.gcdRemaining = 0;
    player.swingTimer = 0;
    player.auras.push({
      id: 'battle_trance',
      name: 'Battle Trance',
      kind: 'battle_trance',
      remaining: 10,
      duration: 10,
      value: 0,
      sourceId: player.id,
      school: 'physical',
    });
    sim.castAbility('heroic_strike');
    updatePlayerAutoAttack(sim.ctx, player, sim.meta(player.id)!);
    expect(player.cooldowns.get('recklessness')).toBe(180);
  });
});

// v0.27.1: the rolling CDR cap. Uncapped, a fury spamming 80-rage Red Harvests
// banked ~78s of CDR per minute and collapsed the 180s cooldowns to ~78s
// effective; the cap bounds the shave to 10s per 30s rolling window, the same
// mechanism the mage's Overflowing Power always had.
describe('v0.27.1 Colossal Might CDR cap', () => {
  it('pins the cap constants', () => {
    expect(COLOSSAL_MIGHT_CAP_SECONDS).toBe(10);
    expect(COLOSSAL_MIGHT_CAP_WINDOW).toBe(30);
  });

  it('caps the shave at 10s per rolling window, then resumes when it expires', () => {
    const sim = warrior('prot');
    const player = sim.player;
    const meta = sim.meta(player.id)!;
    player.resource = 100;
    sim.castAbility('recklessness');
    expect(player.cooldowns.get('recklessness')).toBe(180);

    // An 80-rage spend (a Red Harvest bar) shaves its full 8s...
    applyRageSpendCooldownRefund(sim.ctx, player, meta, 80);
    expect(player.cooldowns.get('recklessness')).toBeCloseTo(172);

    // ...the next 80-rage spend inside the window only reaches the 10s cap...
    applyRageSpendCooldownRefund(sim.ctx, player, meta, 80);
    expect(player.cooldowns.get('recklessness')).toBeCloseTo(170);

    // ...and further spends in the window shave nothing.
    applyRageSpendCooldownRefund(sim.ctx, player, meta, 80);
    expect(player.cooldowns.get('recklessness')).toBeCloseTo(170);

    // The accumulator rides a visible aura with the window as its duration.
    const capAura = player.auras.find((aura) => aura.id === 'colossal_might_cap');
    expect(capAura).toMatchObject({
      kind: 'internal_cd',
      value: COLOSSAL_MIGHT_CAP_SECONDS,
      duration: COLOSSAL_MIGHT_CAP_WINDOW,
    });

    // When the window aura expires, refunds flow again.
    player.auras = player.auras.filter((aura) => aura.id !== 'colossal_might_cap');
    applyRageSpendCooldownRefund(sim.ctx, player, meta, 80);
    expect(player.cooldowns.get('recklessness')).toBeCloseTo(162);
  });
});
