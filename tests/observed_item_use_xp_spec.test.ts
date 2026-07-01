import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const spec = readFileSync('docs/design/observed-item-use-xp.md', 'utf8');

type Tier = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
type EventType = 'potionDrunk' | 'killingBlow' | 'armorWornAtKill';

const tierMultiplier: Record<Tier, number> = {
  common: 0,
  uncommon: 0,
  rare: 1,
  epic: 1.5,
  legendary: 2,
};

const eventBaseXp: Record<EventType, number> = {
  potionDrunk: 4,
  killingBlow: 6,
  armorWornAtKill: 2,
};

function prototypeObservedUseGrant({
  eventType,
  tier,
  hasAttribution,
  observerWeight,
  cooldownReduction,
}: {
  eventType: EventType;
  tier: Tier;
  hasAttribution: boolean;
  observerWeight: number;
  cooldownReduction: number;
}) {
  if (!hasAttribution) return 0;

  const raw = eventBaseXp[eventType] * tierMultiplier[tier] * observerWeight - cooldownReduction;
  return Math.max(0, Math.floor(raw));
}

describe('observed item-use XP design spec', () => {
  it('documents the issue 1149 acceptance topics', () => {
    expect(spec).toContain('Issue: #1149');
    expect(spec).toContain('## Observation Scope');
    expect(spec).toContain('## Per-Item Attribution');
    expect(spec).toContain('## Rare-Tier Gate');
    expect(spec).toContain('## Additive-Only Invariant');
  });

  it('keeps the prototype rare-tier gated', () => {
    for (const eventType of ['potionDrunk', 'killingBlow', 'armorWornAtKill'] as const) {
      expect(
        prototypeObservedUseGrant({
          eventType,
          tier: 'common',
          hasAttribution: true,
          observerWeight: 1,
          cooldownReduction: 0,
        }),
      ).toBe(0);
      expect(
        prototypeObservedUseGrant({
          eventType,
          tier: 'uncommon',
          hasAttribution: true,
          observerWeight: 1,
          cooldownReduction: 0,
        }),
      ).toBe(0);
      expect(
        prototypeObservedUseGrant({
          eventType,
          tier: 'rare',
          hasAttribution: true,
          observerWeight: 1,
          cooldownReduction: 0,
        }),
      ).toBeGreaterThan(0);
    }
  });

  it('never returns negative progress from cooldowns, weights, or missing attribution', () => {
    const weights = [0, 0.1, 0.5, 1];
    const reductions = [0, 1, 5, 999];

    for (const eventType of ['potionDrunk', 'killingBlow', 'armorWornAtKill'] as const) {
      for (const tier of ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const) {
        for (const observerWeight of weights) {
          for (const cooldownReduction of reductions) {
            expect(
              prototypeObservedUseGrant({
                eventType,
                tier,
                hasAttribution: true,
                observerWeight,
                cooldownReduction,
              }),
            ).toBeGreaterThanOrEqual(0);
            expect(
              prototypeObservedUseGrant({
                eventType,
                tier,
                hasAttribution: false,
                observerWeight,
                cooldownReduction,
              }),
            ).toBe(0);
          }
        }
      }
    }
  });
});
