import { describe, expect, it } from 'vitest';
import { PRIEST_CHOICE_ROWS, SHAMAN_CHOICE_ROWS } from '../src/sim/content/choice_rows_classic';
import type { ClassChoiceRows } from '../src/sim/content/talents';

// The final healer identity pass replaced two flat/utility choice options with
// heal-weave procs (reusing the existing proc engine, no new kinds):
//  - Priest "Last Blessing": letting Renew run its full duration banks an instant
//    direct heal, a proactive-vs-reactive HoT decision for Doctrine and Benison.
//  - Shaman "Tideflow": every 3rd Mending Waters primes an instant Chain Heal,
//    a single-target-into-burst-AoE weave gated to Spiritmend (restoration).
function findOption(tree: ClassChoiceRows, id: string) {
  for (const row of tree.rows) {
    const opt = row.options.find((o) => o.id === id);
    if (opt) return opt as unknown as { name: string; effect: any };
  }
  return undefined;
}

describe('healer identity pass', () => {
  it('priest Last Blessing turns a fully-run Renew into an instant heal window', () => {
    const opt = findOption(PRIEST_CHOICE_ROWS, 'pri_r17_improved_fortitude');
    expect(opt?.name).toBe('Last Blessing');
    const proc = opt?.effect?.proc;
    expect(proc).toBeTruthy();
    expect(proc.requiresKnownAbility).toBe('renew');
    expect(proc.trigger).toEqual({ on: 'hotExpired', ability: 'renew' });
    const resp = proc.responses[0];
    expect(resp.kind).toBe('empowerNext');
    expect(resp.aura).toBe('next_cast_instant');
    expect(resp.abilities).toEqual(['heal', 'flash_heal']);
    // no longer the flat Stamina buff it replaced
    expect(opt?.effect?.ability).toBeUndefined();
  });

  it('shaman Tideflow weaves Mending Waters into an instant Chain Heal for Spiritmend', () => {
    const opt = findOption(SHAMAN_CHOICE_ROWS, 'sha_r17_improved_ghost_wolf');
    expect(opt?.name).toBe('Tideflow');
    const proc = opt?.effect?.proc;
    expect(proc).toBeTruthy();
    expect(proc.spec).toBe('restoration'); // only Spiritmend draws it
    expect(proc.requiresKnownAbility).toBe('chain_heal');
    expect(proc.trigger).toEqual({ on: 'castNth', n: 3, abilities: ['healing_wave'] });
    const resp = proc.responses[0];
    expect(resp.kind).toBe('empowerNext');
    expect(resp.aura).toBe('next_cast_instant');
    expect(resp.abilities).toEqual(['chain_heal']);
    // no longer the flat instant-Ghost-Wolf utility it replaced
    expect(opt?.effect?.ability).toBeUndefined();
  });
});
