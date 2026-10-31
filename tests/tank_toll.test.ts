// Tank Toll (src/sim/pvp/tank_toll.ts): the visible debuff of the PvP tank
// restraint. Worn by a committed tank wherever players can fight them (/pvp
// flag, battleground or arena seat, active duel, or a live PvP exchange);
// inert itself (the cuts are gated by the 5 second exchange window), never
// dispellable, never on a party frame, and re-localized on the client.

import { describe, expect, it } from 'vitest';
import {
  isDebuffAura,
  isDispellableAura,
  isPartyFrameRelevantAura,
  isPlayerRemovableAura,
} from '../src/sim/aura_classify';
import {
  TANK_TOLL_AURA_ID,
  TANK_TOLL_AURA_NAME,
  tankTollApplies,
  tankTollAura,
  updateTankToll,
} from '../src/sim/pvp';
import { Sim } from '../src/sim/sim';
import type { Entity, PlayerClass } from '../src/sim/types';
import { auraEffectDescriptor } from '../src/ui/aura_effect';
import { localizeSimAuraName } from '../src/ui/sim_i18n';
import { EMPTY_TEST_WORLD } from './sim_shared';

function setup(cls: PlayerClass, spec: string): { sim: Sim; pid: number; e: Entity; ctx: any } {
  const sim = new Sim({
    seed: 77,
    playerClass: 'warrior',
    noPlayer: true,
    world: EMPTY_TEST_WORLD,
  });
  const pid = sim.addPlayer(cls, 'Bulwark');
  sim.setPlayerLevel(20, pid);
  sim.applyTalents({ spec, rows: {} }, pid);
  return { sim, pid, e: sim.entities.get(pid)!, ctx: (sim as any).ctx };
}

const wearsToll = (e: Entity): boolean => e.auras.some((a) => a.id === TANK_TOLL_AURA_ID);

function startDuel(sim: Sim, a: number, b: number): void {
  const duel = { a, b, state: 'active', timer: 0, controlled: new Map() };
  (sim.duels as Map<number, unknown>).set(a, duel);
  (sim.duels as Map<number, unknown>).set(b, duel);
}

describe('Tank Toll: who wears it', () => {
  it('appears on a flagged Protection warrior on the next zone pass, and leaves with the flag', () => {
    const { sim, pid, e } = setup('warrior', 'prot');
    for (let i = 0; i < 20; i++) sim.tick();
    expect(wearsToll(e)).toBe(false);
    sim.chat('/pvp', pid);
    expect(e.pvpFlag).toBe(true);
    for (let i = 0; i < 20; i++) sim.tick();
    expect(wearsToll(e)).toBe(true);
    const toll = e.auras.find((a) => a.id === TANK_TOLL_AURA_ID)!;
    expect(toll.name).toBe(TANK_TOLL_AURA_NAME);
    // The flag drops: the debuff goes with it on the next pass.
    e.pvpFlag = false;
    const ctx = (sim as any).ctx;
    (sim.players.get(pid) as any).worldPvp = undefined;
    updateTankToll(ctx);
    expect(wearsToll(e)).toBe(false);
  });

  it('shows in a duel, a battleground and an arena seat with no /pvp flag', () => {
    const { sim, pid, e, ctx } = setup('paladin', 'protection');
    const foe = sim.addPlayer('mage', 'Foe');
    startDuel(sim, pid, foe);
    expect(tankTollApplies(ctx, e)).toBe(true);
    sim.duels.clear();
    expect(tankTollApplies(ctx, e)).toBe(false);
    (sim.bgMatches as Map<number, unknown>).set(pid, {});
    expect(tankTollApplies(ctx, e)).toBe(true);
    sim.bgMatches.clear();
    (sim.arenaMatches as Map<number, unknown>).set(pid, {});
    expect(tankTollApplies(ctx, e)).toBe(true);
  });

  it('shows during a live PvP exchange (free-for-all ground needs no flag)', () => {
    const { sim, e, ctx } = setup('warrior', 'prot');
    e.pvpExchangeAt = sim.time;
    expect(tankTollApplies(ctx, e)).toBe(true);
    sim.time += 5;
    expect(tankTollApplies(ctx, e)).toBe(false);
  });

  it('never shows on a non-tank, or on a Feral druid outside Bruin Form', () => {
    const arms = setup('warrior', 'arms');
    startDuel(arms.sim, arms.pid, arms.sim.addPlayer('mage', 'Foe'));
    expect(tankTollApplies(arms.ctx, arms.e)).toBe(false);

    const druid = setup('druid', 'feral');
    startDuel(druid.sim, druid.pid, druid.sim.addPlayer('mage', 'Foe'));
    expect(tankTollApplies(druid.ctx, druid.e)).toBe(false);
    druid.sim.castAbility('bear_form', druid.pid);
    druid.sim.tick();
    expect(druid.e.auras.some((a) => a.kind === 'form_bear')).toBe(true);
    expect(tankTollApplies(druid.ctx, druid.e)).toBe(true);
    updateTankToll(druid.ctx);
    expect(wearsToll(druid.e)).toBe(true);
  });

  it('is put back after a wipe strips it, and never sits on a dead player', () => {
    const { sim, pid, e, ctx } = setup('warrior', 'prot');
    startDuel(sim, pid, sim.addPlayer('mage', 'Foe'));
    updateTankToll(ctx);
    expect(wearsToll(e)).toBe(true);
    e.auras = [];
    updateTankToll(ctx);
    expect(wearsToll(e)).toBe(true);
    expect(e.auras.filter((a) => a.id === TANK_TOLL_AURA_ID)).toHaveLength(1);
    e.dead = true;
    updateTankToll(ctx);
    expect(wearsToll(e)).toBe(false);
  });
});

describe('Tank Toll: the aura itself', () => {
  const aura = tankTollAura(1);

  it('is an inert, permanent, undispellable debuff kept off party frames', () => {
    expect(aura.kind).toBe('tank_toll');
    expect(aura.value).toBe(0);
    expect(aura.permanent).toBe(true);
    expect(aura.school).toBe('physical');
    expect(isDebuffAura(aura.kind, aura.value)).toBe(true);
    expect(isDispellableAura(aura, true)).toBe(false);
    expect(isDispellableAura(aura, false)).toBe(false);
    expect(isPlayerRemovableAura(aura)).toBe(false);
    expect(isPartyFrameRelevantAura(aura)).toBe(false);
  });

  it('explains the rule with the live 30% figure', () => {
    expect(auraEffectDescriptor(aura)).toEqual({
      key: 'hudChrome.auraEffect.tankToll',
      nums: { pct: 30 },
    });
  });

  it('re-localizes its English name on the client', () => {
    expect(localizeSimAuraName(TANK_TOLL_AURA_NAME)).not.toBeNull();
  });
});
