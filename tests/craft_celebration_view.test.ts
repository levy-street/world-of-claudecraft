// Pure-core pins for the crafting celebration plan (Professions 2.0 Phase 6):
// tier-crossing detection over craft-skill snapshots and the coalesced
// banner / one-sound-per-drain / reduced-motion batching rules the HUD arm
// consumes thinly (the buildDeedUnlockPlan contract shape).

import { describe, expect, it } from 'vitest';
import { TIER_SKILL_STEP } from '../src/sim/professions/wheel';
import {
  buildCraftCelebrationPlan,
  CRAFT_TIER_UP_DRAIN_WINDOW,
  computeCraftTierUps,
  observeCraftSkillsForTierUps,
} from '../src/ui/craft_celebration_view';

describe('computeCraftTierUps', () => {
  it('reports no tier-ups on first observation (null prev), the silent init', () => {
    expect(computeCraftTierUps(null, { armorcrafting: 4 * TIER_SKILL_STEP })).toEqual([]);
  });

  it('reports nothing when no craft crossed a tier boundary', () => {
    expect(
      computeCraftTierUps(
        { armorcrafting: TIER_SKILL_STEP, cooking: 3 },
        { armorcrafting: 2 * TIER_SKILL_STEP - 1, cooking: 4 },
      ),
    ).toEqual([]);
  });

  it('reports one entry with the reached tier on a single crossing', () => {
    expect(
      computeCraftTierUps(
        { armorcrafting: 2 * TIER_SKILL_STEP - 1 },
        { armorcrafting: 2 * TIER_SKILL_STEP },
      ),
    ).toEqual([{ craftId: 'armorcrafting', toTier: 2 }]);
  });

  it('reports one entry per craft when several crafts cross in one drain', () => {
    expect(
      computeCraftTierUps(
        { armorcrafting: TIER_SKILL_STEP - 1, cooking: 2 * TIER_SKILL_STEP - 1 },
        { armorcrafting: TIER_SKILL_STEP, cooking: 2 * TIER_SKILL_STEP },
      ),
    ).toEqual([
      { craftId: 'armorcrafting', toTier: 1 },
      { craftId: 'cooking', toTier: 2 },
    ]);
  });

  it('collapses a multi-tier jump to a single entry carrying the final tier', () => {
    expect(
      computeCraftTierUps({ armorcrafting: 1 }, { armorcrafting: 3 * TIER_SKILL_STEP }),
    ).toEqual([{ craftId: 'armorcrafting', toTier: 3 }]);
  });

  it('treats a craft key absent from prev as skill 0, so a fresh tier-0 craft is silent', () => {
    expect(computeCraftTierUps({}, { cooking: TIER_SKILL_STEP - 1 })).toEqual([]);
    // ...while a fresh craft that lands straight in tier 1+ still celebrates.
    expect(computeCraftTierUps({}, { cooking: TIER_SKILL_STEP })).toEqual([
      { craftId: 'cooking', toTier: 1 },
    ]);
  });

  it('never reports a downward move (a defensive no-op, skills are monotonic)', () => {
    expect(
      computeCraftTierUps({ armorcrafting: 2 * TIER_SKILL_STEP }, { armorcrafting: 1 }),
    ).toEqual([]);
  });
});

describe('buildCraftCelebrationPlan', () => {
  it('plans nothing for an empty drain: no logs, no banner, no sound, no motion', () => {
    const plan = buildCraftCelebrationPlan({ masterwork: null, tierUps: [], reducedMotion: false });
    expect(plan).toEqual({
      masterworkLogItemId: null,
      tierUpLogs: [],
      banner: null,
      playSound: false,
      motion: false,
    });
  });

  it('plans a masterwork-only drain: log line, masterwork banner, one sound', () => {
    const plan = buildCraftCelebrationPlan({
      masterwork: { itemId: 'iron_sword' },
      tierUps: [],
      reducedMotion: false,
    });
    expect(plan.masterworkLogItemId).toBe('iron_sword');
    expect(plan.banner).toEqual({ kind: 'masterwork', itemId: 'iron_sword' });
    expect(plan.playSound).toBe(true);
    expect(plan.motion).toBe(true);
  });

  it('plans a tier-up-only drain: one log per crossing, banner coalesces to the LAST', () => {
    const plan = buildCraftCelebrationPlan({
      masterwork: null,
      tierUps: [
        { craftId: 'armorcrafting', toTier: 1 },
        { craftId: 'cooking', toTier: 2 },
      ],
      reducedMotion: false,
    });
    expect(plan.tierUpLogs).toEqual([
      { craftId: 'armorcrafting', toTier: 1 },
      { craftId: 'cooking', toTier: 2 },
    ]);
    expect(plan.banner).toEqual({ kind: 'tierUp', craftId: 'cooking', toTier: 2 });
    expect(plan.playSound).toBe(true);
  });

  it('lets masterwork outrank tier-ups for the single banner slot, still ONE sound', () => {
    const plan = buildCraftCelebrationPlan({
      masterwork: { itemId: 'iron_sword' },
      tierUps: [{ craftId: 'cooking', toTier: 2 }],
      reducedMotion: false,
    });
    // Both moments keep their durable log copy; only the banner coalesces.
    expect(plan.masterworkLogItemId).toBe('iron_sword');
    expect(plan.tierUpLogs).toEqual([{ craftId: 'cooking', toTier: 2 }]);
    expect(plan.banner).toEqual({ kind: 'masterwork', itemId: 'iron_sword' });
    expect(plan.playSound).toBe(true);
  });

  it('reducedMotion trims MOTION only: logs, banner, and sound survive untouched', () => {
    const plan = buildCraftCelebrationPlan({
      masterwork: { itemId: 'iron_sword' },
      tierUps: [{ craftId: 'cooking', toTier: 2 }],
      reducedMotion: true,
    });
    expect(plan.motion).toBe(false);
    expect(plan.masterworkLogItemId).toBe('iron_sword');
    expect(plan.tierUpLogs).toHaveLength(1);
    expect(plan.banner).not.toBeNull();
    expect(plan.playSound).toBe(true);
  });

  it('does not mutate or alias the caller tierUps array', () => {
    const tierUps = [{ craftId: 'cooking', toTier: 2 }];
    const plan = buildCraftCelebrationPlan({ masterwork: null, tierUps, reducedMotion: false });
    expect(plan.tierUpLogs).not.toBe(tierUps);
    expect(plan.tierUpLogs).toEqual(tierUps);
  });
});

// The plan's motion flag has exactly ONE consumer contract: showBanner skips
// the fade (a CSS class), while the log lines, the banner TEXT, the sound, and
// the ARIA announcer stay motion-blind (information always survives reduced
// motion). The pure suites above pin the flag itself; these source pins hold
// the consumer wiring in hud.ts/hud.css to that contract, since no test
// instantiates the full Hud.
import { readFileSync } from 'node:fs';

describe('plan.motion consumer wiring (source pins)', () => {
  const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
  const hudCss = readFileSync(new URL('../src/styles/hud.css', import.meta.url), 'utf8');

  it('showBanner takes the motion flag and toggles exactly the no-motion class', () => {
    expect(hud).toContain('showBanner(text: string, motion = true)');
    expect(hud).toContain("this.bannerEl.classList.toggle('banner-no-motion', !motion)");
  });

  it('the celebration handler feeds plan.motion to the banner and never gates the announcer', () => {
    expect(hud).toContain('this.showBanner(text, plan.motion);');
    // The polite ARIA push sits beside the banner call, unconditioned on the
    // plan's motion flag (accessibility: reduced motion is never reduced info).
    expect(hud).toContain('this.combatAnnouncer.push(text, performance.now());');
    expect(hud).not.toContain('if (plan.motion) this.combatAnnouncer');
  });

  it('the no-motion class only drops the transition (same text, same duration)', () => {
    expect(hudCss).toMatch(/#banner\.banner-no-motion\s*\{\s*transition:\s*none;\s*\}/);
  });
});

describe('observeCraftSkillsForTierUps (the armed drain window)', () => {
  const T = TIER_SKILL_STEP;

  it('never baselines an unsynced mirror, even with values present', () => {
    const obs = observeCraftSkillsForTierUps(false, null, { cooking: 3 * T }, 0);
    expect(obs).toEqual({ tierUps: [], prev: null, drains: 0 });
  });

  it('initializes silently on the first synced observation, copying (not aliasing) next', () => {
    const next = { cooking: 3 * T };
    const obs = observeCraftSkillsForTierUps(true, null, next, 0);
    expect(obs.tierUps).toEqual([]);
    expect(obs.prev).toEqual(next);
    expect(obs.prev).not.toBe(next);
    // The init arm runs even while disarmed (the prev===null arm of the
    // gate), and leaves the window untouched.
    expect(obs.drains).toBe(0);
  });

  it('is a no-op while disarmed once initialized: a change outside the window waits', () => {
    const prev = { cooking: T - 1 };
    const obs = observeCraftSkillsForTierUps(true, prev, { cooking: T }, 0);
    expect(obs.tierUps).toEqual([]);
    expect(obs.prev).toBe(prev);
    // prev is NOT carried forward outside the window, so the next ARMED
    // window still sees the crossing (the delayed-toast contract).
    expect(prev.cooking).toBe(T - 1);
    const later = observeCraftSkillsForTierUps(true, prev, { cooking: T }, 5);
    expect(later.tierUps).toEqual([{ craftId: 'cooking', toTier: 1 }]);
    expect(later.drains).toBe(0);
  });

  it('decrements the window on an unchanged armed drain, down to disarmed', () => {
    const prev = { cooking: 5 };
    const first = observeCraftSkillsForTierUps(true, prev, { cooking: 5 }, 2);
    expect(first).toEqual({ tierUps: [], prev, drains: 1 });
    const second = observeCraftSkillsForTierUps(true, prev, { cooking: 5 }, 1);
    expect(second.drains).toBe(0);
  });

  it('disarms on ANY observed change, crossing or not, carrying values in place', () => {
    const prev = { cooking: 2 };
    const obs = observeCraftSkillsForTierUps(true, prev, { cooking: 3 }, 90);
    expect(obs.tierUps).toEqual([]);
    expect(obs.drains).toBe(0);
    expect(obs.prev).toBe(prev);
    expect(prev.cooking).toBe(3);
  });

  it('reports a crossing observed inside the window and disarms', () => {
    const prev = { cooking: T - 1, tailoring: 4 };
    const obs = observeCraftSkillsForTierUps(
      true,
      prev,
      { cooking: T, tailoring: 4 },
      CRAFT_TIER_UP_DRAIN_WINDOW,
    );
    expect(obs.tierUps).toEqual([{ craftId: 'cooking', toTier: 1 }]);
    expect(obs.drains).toBe(0);
    expect(prev.cooking).toBe(T);
  });

  it('reports one entry per craft when several crafts cross in one observation', () => {
    const prev = { cooking: T - 1, tailoring: 2 * T - 1 };
    const obs = observeCraftSkillsForTierUps(true, prev, { cooking: T, tailoring: 2 * T }, 10);
    expect(obs.tierUps).toEqual([
      { craftId: 'cooking', toTier: 1 },
      { craftId: 'tailoring', toTier: 2 },
    ]);
  });
});
