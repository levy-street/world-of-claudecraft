import { describe, expect, it } from 'vitest';
import { abilityIconWarmKeys } from '../src/ui/icon_prewarm';

describe('abilityIconWarmKeys', () => {
  it('warms an ability + aura icon per id, in order', () => {
    const keys = abilityIconWarmKeys(['heroic_strike', 'rend']);
    expect(keys).toEqual([
      { kind: 'ability', id: 'heroic_strike' },
      { kind: 'aura', id: 'heroic_strike' },
      { kind: 'ability', id: 'rend' },
      { kind: 'aura', id: 'rend' },
    ]);
  });

  it('dedupes repeated ability ids', () => {
    const keys = abilityIconWarmKeys(['fireball', 'fireball', 'frostbolt']);
    expect(keys.filter((k) => k.kind === 'ability').map((k) => k.id)).toEqual([
      'fireball',
      'frostbolt',
    ]);
    expect(keys).toHaveLength(4);
  });

  it('skips empty ids and handles an empty list', () => {
    expect(abilityIconWarmKeys([])).toEqual([]);
    expect(abilityIconWarmKeys(['', 'shield_bash'])).toEqual([
      { kind: 'ability', id: 'shield_bash' },
      { kind: 'aura', id: 'shield_bash' },
    ]);
  });
});
