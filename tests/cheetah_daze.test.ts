import { describe, expect, it } from 'vitest';
import { isRootedOrChilled } from '../src/sim/combat/cc';
import { dealDamage } from '../src/sim/combat/damage';
import { applyCourserDaze, COURSER_DAZE_AURA_ID } from '../src/sim/combat/hunter_shared';
import { ABILITIES } from '../src/sim/content/classes';
import { moveSpeedMult } from '../src/sim/player_motion';
import { Sim } from '../src/sim/sim';
import type { Aura } from '../src/sim/types';

// Aspect of the Cheetah / Courser's Guise: +30% move speed, but taking damage
// while it is active dazes the hunter to half of their CURRENT total speed for
// 4s, refreshed (never stacked) by each hit. The classic anti-kite counterplay.
const CHEETAH = 'aspect_of_the_cheetah';

function hunterWithCheetah(seed = 7): Sim {
  const sim = new Sim({ seed, playerClass: 'hunter', autoEquip: true });
  sim.setPlayerLevel(20);
  sim.castAbility(CHEETAH);
  sim.tick();
  return sim;
}

// Environmental / sourceless damage (the shape fall damage, drowning, and fatigue
// all take): magic school so player armor cannot mitigate the test hit to zero.
function hit(sim: Sim, amount = 50): void {
  dealDamage(sim.ctx, null, sim.player, amount, false, 'shadow', 'Test Hit', 'hit');
}

function pushAura(sim: Sim, partial: Partial<Aura> & Pick<Aura, 'id' | 'kind'>): void {
  sim.player.auras.push({
    name: partial.id,
    remaining: 60,
    duration: 60,
    value: 0,
    sourceId: sim.player.id,
    school: 'physical',
    ...partial,
  });
}

describe("Courser's Guise daze", () => {
  it('tooltip documents the daze drawback', () => {
    const def = ABILITIES[CHEETAH];
    expect(def.description).toMatch(/daze/i);
    expect(def.description).toMatch(/4 sec/);
  });

  it('grants +30% move speed with no daze until struck', () => {
    const sim = hunterWithCheetah();
    expect(sim.player.auras.some((a) => a.id === CHEETAH)).toBe(true);
    expect(moveSpeedMult(sim.player)).toBeCloseTo(1.3, 5);
    expect(sim.player.auras.some((a) => a.id === COURSER_DAZE_AURA_ID)).toBe(false);
  });

  it('dazes to half of total speed on taking damage while active', () => {
    const sim = hunterWithCheetah();
    hit(sim);
    const daze = sim.player.auras.find((a) => a.id === COURSER_DAZE_AURA_ID);
    expect(daze).toBeTruthy();
    expect(daze!.kind).toBe('slow');
    expect(daze!.value).toBeCloseTo(0.5, 5);
    expect(daze!.duration).toBe(4);
    // 0.5 * the aspect's 1.3 = 0.65: half of the CURRENT total, not base run.
    expect(moveSpeedMult(sim.player)).toBeCloseTo(0.65, 5);
  });

  it('environmental damage (fall/drown/fatigue shape, no source) dazes while active', () => {
    const sim = hunterWithCheetah();
    hit(sim); // null-source damage, the same path fall/drown/fatigue take
    expect(sim.player.auras.some((a) => a.id === COURSER_DAZE_AURA_ID)).toBe(true);
  });

  it('refreshes the 4s timer on each hit rather than stacking', () => {
    const sim = hunterWithCheetah();
    hit(sim);
    for (let i = 0; i < 20; i++) sim.tick(); // one second of decay
    const mid = sim.player.auras.find((a) => a.id === COURSER_DAZE_AURA_ID);
    expect(mid!.remaining).toBeLessThan(4);
    hit(sim);
    const dazes = sim.player.auras.filter((a) => a.id === COURSER_DAZE_AURA_ID);
    expect(dazes).toHaveLength(1);
    expect(dazes[0].remaining).toBe(4); // reset exactly, in place
  });

  it('refreshes IN PLACE (same aura record) to stay cheap under DoTs and swim pulses', () => {
    const sim = hunterWithCheetah();
    hit(sim);
    const first = sim.player.auras.find((a) => a.id === COURSER_DAZE_AURA_ID)!;
    for (let i = 0; i < 10; i++) sim.tick();
    hit(sim);
    const second = sim.player.auras.find((a) => a.id === COURSER_DAZE_AURA_ID)!;
    expect(second).toBe(first); // same object: refreshed, not spliced + re-pushed
    expect(second.remaining).toBe(4);
  });

  it('a dazed hunter reads as snared to enemy offense predicates (classic daze = snare)', () => {
    // DECISION: the daze is intentionally kind 'slow'. That keeps slow_immunity
    // clearing it, and it means a dazed hunter counts as rooted/chilled, so
    // critVsRooted and crippling-pursuit follow-ups land, exactly as against any
    // classic snare. The cost of choosing to keep the aspect up in combat.
    const sim = hunterWithCheetah();
    expect(isRootedOrChilled(sim.player)).toBe(false);
    hit(sim);
    expect(isRootedOrChilled(sim.player)).toBe(true);
  });

  it('the Pack Rally build still pays the daze (in-combat aspect becomes pack_rally)', () => {
    const sim = new Sim({ seed: 7, playerClass: 'hunter', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.applyTalents({ spec: 'marksmanship', rows: { 17: 'hun_r17_pack_rally' } })).toBe(
      true,
    );
    sim.player.inCombat = true; // the aspect -> pack_rally rewrite is in-combat only
    sim.castAbility(CHEETAH); // resolves to pack_rally for this build
    sim.tick();
    expect(sim.player.auras.some((a) => a.id === 'pack_rally')).toBe(true);
    expect(sim.player.auras.some((a) => a.id === CHEETAH)).toBe(false); // the pack_rally form
    hit(sim);
    expect(sim.player.auras.some((a) => a.id === COURSER_DAZE_AURA_ID)).toBe(true);
  });

  it('a fully absorbed hit does not daze (no HP actually lost)', () => {
    const sim = hunterWithCheetah();
    pushAura(sim, { id: 'test_shield', kind: 'absorb', value: 1000 });
    const hpBefore = sim.player.hp;
    hit(sim, 50);
    expect(sim.player.hp).toBe(hpBefore); // fully soaked
    expect(sim.player.auras.some((a) => a.id === COURSER_DAZE_AURA_ID)).toBe(false);
  });

  it('slow_immunity suppresses the daze (applyAura refuses the slow)', () => {
    const sim = hunterWithCheetah();
    pushAura(sim, { id: 'test_immune', kind: 'slow_immunity' });
    hit(sim);
    expect(sim.player.auras.some((a) => a.id === COURSER_DAZE_AURA_ID)).toBe(false);
  });

  it('does not daze on non-damage HP loss (a max-HP buff expiring)', () => {
    // The daze must fire on DAMAGE TAKEN only, never on incidental health loss.
    // A max-HP buff dropping recomputes stats and clamps current HP downward
    // (recalcPlayerStats), a real HP loss that never routes through dealDamage.
    const sim = hunterWithCheetah();
    const p = sim.player;
    pushAura(sim, { id: 'test_maxhp', kind: 'buff_maxhp_pct', value: 0.5 });
    sim.ctx.recalcPlayer(p); // buff applies: max HP and current HP scale up
    const hpBuffed = p.hp;
    p.auras = p.auras.filter((a) => a.id !== 'test_maxhp');
    sim.ctx.recalcPlayer(p); // buff drops: max HP falls, current HP clamps down
    expect(p.hp).toBeLessThan(hpBuffed); // HP genuinely dropped,
    expect(p.auras.some((a) => a.id === COURSER_DAZE_AURA_ID)).toBe(false); // but no daze
  });

  it("does not daze when Courser's Guise is inactive", () => {
    const sim = new Sim({ seed: 7, playerClass: 'hunter', autoEquip: true });
    sim.setPlayerLevel(20);
    hit(sim);
    expect(sim.player.auras.some((a) => a.id === COURSER_DAZE_AURA_ID)).toBe(false);
  });

  it('expires after 4 seconds, restoring full aspect speed', () => {
    const sim = hunterWithCheetah();
    hit(sim);
    for (let i = 0; i < 20 * 4 + 2; i++) sim.tick();
    expect(sim.player.auras.some((a) => a.id === COURSER_DAZE_AURA_ID)).toBe(false);
    expect(moveSpeedMult(sim.player)).toBeCloseTo(1.3, 5);
  });

  it('applyCourserDaze applies the daze directly', () => {
    const sim = new Sim({ seed: 7, playerClass: 'hunter', autoEquip: true });
    sim.setPlayerLevel(20);
    applyCourserDaze(sim.ctx, sim.player);
    const daze = sim.player.auras.find((a) => a.id === COURSER_DAZE_AURA_ID);
    expect(daze).toBeTruthy();
    expect(moveSpeedMult(sim.player)).toBeCloseTo(0.5, 5);
  });

  it('/dev daze applies the daze through the chat router', () => {
    const sim = new Sim({ seed: 7, playerClass: 'hunter', autoEquip: true, devCommands: true });
    sim.setPlayerLevel(20);
    sim.chat('/dev daze');
    expect(sim.player.auras.some((a) => a.id === COURSER_DAZE_AURA_ID)).toBe(true);
  });
});
