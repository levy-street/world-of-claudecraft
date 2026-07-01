import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const spec = readFileSync('docs/design/off-wheel-professions.md', 'utf8');

describe('off-wheel professions design spec', () => {
  it('documents the issue 1150 no-combat-wheel boundary', () => {
    expect(spec).toContain('Issue: #1150');
    expect(spec).toContain('outside the ten combat-craft wheel');
    expect(spec).toContain('Do not add these crafts to `src/sim/professions/wheel.ts`');
    expect(spec).toContain('off_wheel_professions.ts');
  });

  it('keeps every proposed craft cosmetic, housing, or flavor scoped', () => {
    for (const craft of [
      'Carpenter',
      'Mason',
      'Shepherd',
      'Beekeeping',
      'Stargazing',
      'Tattooing',
      'Taxidermy',
      'Heraldry',
      'Instrument-making',
      'Candlemaking',
    ]) {
      expect(spec).toContain(craft);
    }
    expect(spec).toContain('Do not grant stats, damage, mitigation, healing throughput');
  });
});
