// The rogue energy fix (the Thronebane runaway): two knobs that only bite the
// off-spec spam and leave intended dagger play + Combat untouched.
//   Knob 1: Venom Ritual's energy refund rewards the THRUST (Craven Thrust),
//           not the Wicked Slash fallback (rogue_engines.ts).
//   Knob 2: Ceaseless Cuts (+50 energy every 3rd Wicked Slash) is Combat-only;
//           it is inert for the dagger specs (choice_rows_classic + talent_procs).

import { describe, expect, it } from 'vitest';
import { rogueEngineOnCast } from '../src/sim/combat/rogue_engines';
import { onCastCompleted } from '../src/sim/combat/talent_procs';
import { Sim } from '../src/sim/sim';

function rogue(spec: string, rows: Record<number, string> = {}) {
  const sim = new Sim({ seed: 7, playerClass: 'rogue', autoEquip: true });
  sim.setPlayerLevel(20);
  sim.setSpec(spec);
  for (const [lvl, row] of Object.entries(rows)) {
    sim.selectTalentRow(Number(lvl) as Parameters<typeof sim.selectTalentRow>[0], row);
  }
  // biome-ignore lint/suspicious/noExplicitAny: reach the ctx seam for a direct hook call
  return { sim, p: sim.player, ctx: (sim as unknown as { ctx: any }).ctx };
}

describe('Venom Ritual refund rewards the thrust, not the Wicked Slash fallback', () => {
  it('Craven Thrust (backstab) refunds 15 energy; the Wicked Slash fallback refunds 0', () => {
    const { p, ctx } = rogue('assassination');
    p.resource = 40;
    rogueEngineOnCast(ctx, p, 'sinister_strike');
    expect(p.resource).toBe(40); // fallback: no self-funding refund
    // ...but it still BUILDS the ritual, so Venomrend keeps working off-dagger.
    expect(p.auras.some((a) => a.id === 'venom_ritual')).toBe(true);

    p.resource = 40;
    rogueEngineOnCast(ctx, p, 'backstab');
    expect(p.resource).toBe(55); // the thrust earns the +15
  });
});

describe('Ceaseless Cuts is Combat-only (inert for the dagger specs)', () => {
  it('does not refund for Assassination even at the 3rd Wicked Slash', () => {
    const { p, ctx } = rogue('assassination', { 14: 'rog_r14_ceaseless_cuts' });
    p.resource = 10;
    for (let i = 0; i < 3; i++) onCastCompleted(ctx, p, 'sinister_strike');
    // No +50 (Ceaseless Cuts inert) and no +15 (knob 1): energy is unchanged.
    expect(p.resource).toBe(10);
  });

  it('DOES refund for Combat on the 3rd Wicked Slash (its intended home)', () => {
    const { p, ctx } = rogue('combat', { 14: 'rog_r14_ceaseless_cuts' });
    p.resource = 10;
    onCastCompleted(ctx, p, 'sinister_strike');
    onCastCompleted(ctx, p, 'sinister_strike');
    const before = p.resource;
    onCastCompleted(ctx, p, 'sinister_strike'); // 3rd -> +50 energy
    expect(p.resource).toBeGreaterThan(before);
  });
});
