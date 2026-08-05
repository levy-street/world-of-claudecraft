// Craft Cast System Phase 5: tool-effect recharge is a fixed 1.5 s non-spell
// cast. Start admits without consume; complete applies the resolve body;
// cancel is safe. No action_throttle.

import { describe, expect, it } from 'vitest';
import { cancelCast } from '../src/sim/combat/casting_lifecycle';
import { TOOL_RECHARGE_CAST_DURATION_SEC } from '../src/sim/content/professions';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import { type Entity, type SimEvent, TOOL_RECHARGE_CAST_ID } from '../src/sim/types';
import { completeRechargeCast, runRecharge } from './helpers/enchant_family_cast';

function makeSim(seed = 11): Sim {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: false });
}

function metaOf(sim: Sim): PlayerMeta {
  const meta = sim.players.get(sim.playerId);
  if (!meta) throw new Error('player meta missing');
  return meta;
}

function playerOf(sim: Sim): { p: Entity; meta: PlayerMeta; pid: number } {
  const pid = sim.playerId;
  const meta = metaOf(sim);
  const p = (sim as unknown as { entities: Map<number, Entity> }).entities.get(pid);
  if (!p) throw new Error('player entity missing');
  return { p, meta, pid };
}

function simWithDepletedSlot(): Sim {
  const sim = makeSim();
  sim.addItem('copper_mining_pick', 1);
  sim.addItemInstance('gatherers_cache', { signer: metaOf(sim).name }, sim.playerId, 1);
  sim.slotToolEffect('mining', 'gatherers_cache');
  const slot = metaOf(sim).toolEffectSlots?.mining;
  if (!slot) throw new Error('slot minted');
  slot.durability = 0;
  sim.addItem('arcane_dust', 10);
  return sim;
}

describe('tool recharge cast duration', () => {
  it('pins the fixed 1.5 s content constant', () => {
    expect(TOOL_RECHARGE_CAST_DURATION_SEC).toBe(1.5);
  });
});

describe('tool recharge cast', () => {
  it('starts TOOL_RECHARGE_CAST_ID without consuming materials', () => {
    const sim = simWithDepletedSlot();
    const { p } = playerOf(sim);
    const slot = metaOf(sim).toolEffectSlots?.mining;
    if (!slot) throw new Error('slot');
    sim.rechargeToolEffect('mining');
    expect(p.castingAbility).toBe(TOOL_RECHARGE_CAST_ID);
    expect(p.castTotal).toBe(TOOL_RECHARGE_CAST_DURATION_SEC);
    expect(p.castRemaining).toBe(TOOL_RECHARGE_CAST_DURATION_SEC);
    expect(p.toolRechargeCastProfessionId).toBe('mining');
    expect(sim.countItem('arcane_dust')).toBe(10);
    expect(slot.durability).toBe(0);
  });

  it('complete consumes materials and refills the slot', () => {
    const sim = simWithDepletedSlot();
    const slot = metaOf(sim).toolEffectSlots?.mining;
    if (!slot) throw new Error('slot');
    runRecharge(sim, 'mining');
    expect(slot.durability).toBe(20);
    expect(sim.countItem('arcane_dust')).toBe(9);
    expect(playerOf(sim).p.toolRechargeCastProfessionId).toBe('');
    expect(playerOf(sim).p.castingAbility).toBeNull();
  });

  it('cancel mid-cast leaves materials and session fields inert', () => {
    const sim = simWithDepletedSlot();
    const { p } = playerOf(sim);
    const slot = metaOf(sim).toolEffectSlots?.mining;
    if (!slot) throw new Error('slot');
    sim.rechargeToolEffect('mining');
    cancelCast(sim.ctx, p);
    expect(p.castingAbility).toBeNull();
    expect(p.toolRechargeCastProfessionId).toBe('');
    expect(sim.countItem('arcane_dust')).toBe(10);
    expect(slot.durability).toBe(0);
  });

  it('denies busy when already casting', () => {
    const sim = simWithDepletedSlot();
    sim.rechargeToolEffect('mining');
    const events: { type: string; reason?: string; ok?: boolean }[] = [];
    const orig = sim.ctx.emit.bind(sim.ctx);
    sim.ctx.emit = (ev) => {
      events.push(ev as { type: string; reason?: string; ok?: boolean });
      orig(ev);
    };
    sim.rechargeToolEffect('mining');
    const deny = events.find((e) => e.type === 'toolEffectResult');
    expect(deny).toMatchObject({ ok: false, reason: 'busy' });
    expect(sim.countItem('arcane_dust')).toBe(10);
  });

  it('more than 10 sequential completes succeed; craftThrottle stays inert', () => {
    const sim = makeSim();
    sim.addItem('copper_mining_pick', 1);
    sim.addItemInstance('gatherers_cache', { signer: metaOf(sim).name }, sim.playerId, 1);
    sim.slotToolEffect('mining', 'gatherers_cache');
    const slot = metaOf(sim).toolEffectSlots?.mining;
    if (!slot) throw new Error('slot');
    sim.addItem('arcane_dust', 50);
    metaOf(sim).craftThrottle = { windowStart: 0, count: 999 };
    for (let i = 0; i < 12; i++) {
      slot.durability = 0;
      runRecharge(sim, 'mining');
      expect(slot.durability).toBe(20);
    }
    expect(metaOf(sim).craftThrottle.count).toBe(999);
    // 12 recharges at 1 dust each (self-crafted common).
    expect(sim.countItem('arcane_dust')).toBe(38);
  });

  it('complete denies insufficient_materials when the materials leave mid-cast', () => {
    const sim = simWithDepletedSlot();
    const { p } = playerOf(sim);
    const slot = metaOf(sim).toolEffectSlots?.mining;
    if (!slot) throw new Error('slot');
    sim.rechargeToolEffect('mining');
    expect(p.castingAbility).toBe(TOOL_RECHARGE_CAST_ID);
    // The dust is spent elsewhere (a trade, an enchant) while the cast runs.
    sim.removeItem('arcane_dust', 10);
    sim.drainEvents();

    completeRechargeCast(sim);

    const results = sim
      .drainEvents()
      .filter(
        (e): e is Extract<SimEvent, { type: 'toolEffectResult' }> => e.type === 'toolEffectResult',
      );
    expect(results).toHaveLength(1);
    expect(results[0].action).toBe('recharge');
    expect(results[0].ok).toBe(false);
    expect(results[0].reason).toBe('insufficient_materials');
    expect(slot.durability).toBe(0);
    expect(p.castingAbility).toBeNull();
    expect(p.toolRechargeCastProfessionId).toBe('');
    expect(sim.countItem('arcane_dust')).toBe(0);
  });

  it('completeRechargeCast after cancel is a no-op (session already cleared)', () => {
    const sim = simWithDepletedSlot();
    const { p } = playerOf(sim);
    const slot = metaOf(sim).toolEffectSlots?.mining;
    if (!slot) throw new Error('slot');
    sim.rechargeToolEffect('mining');
    cancelCast(sim.ctx, p);
    completeRechargeCast(sim);
    expect(slot.durability).toBe(0);
    expect(sim.countItem('arcane_dust')).toBe(10);
  });
});
