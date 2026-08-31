import { describe, expect, it } from 'vitest';
import {
  VARKHUL_ANVILS_DECREE_DAMAGE_MAX_HP,
  VARKHUL_ANVILS_DECREE_STRIKES,
  varkhulAnvilsDecreeDamageMaxHp,
} from '../src/sim/varkhul_anvils_decree';

describe("Varkhul's Anvil's Decree tuning", () => {
  it('defines three escalating Normal raid hits', () => {
    expect(VARKHUL_ANVILS_DECREE_DAMAGE_MAX_HP.normal).toEqual([0.1, 0.1, 0.2]);
    expect(VARKHUL_ANVILS_DECREE_STRIKES).toBe(3);
  });

  it('defines three harder Heroic raid hits', () => {
    expect(VARKHUL_ANVILS_DECREE_DAMAGE_MAX_HP.heroic).toEqual([0.14, 0.14, 0.25]);
  });

  it('does not invent damage outside the authored sequence', () => {
    expect(varkhulAnvilsDecreeDamageMaxHp('normal', -1)).toBe(0);
    expect(varkhulAnvilsDecreeDamageMaxHp('heroic', 3)).toBe(0);
  });
});
