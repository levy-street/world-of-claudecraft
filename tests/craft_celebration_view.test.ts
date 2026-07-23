// @vitest-environment jsdom

// Pure-core pins for the crafting celebration plan (Professions 2.0):
// tier-crossing detection over craft-skill snapshots and the coalesced
// banner / one-sound-per-drain / reduced-motion batching rules the HUD arm
// consumes thinly (the buildDeedUnlockPlan contract shape).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audio } from '../src/game/audio';
import { TIER_SKILL_STEP } from '../src/sim/professions/wheel';
import {
  buildCraftCelebrationPlan,
  CRAFT_TIER_UP_DRAIN_WINDOW,
  computeCraftTierUps,
  observeCraftSkillsForTierUps,
} from '../src/ui/craft_celebration_view';
import { Hud } from '../src/ui/hud';
import { MASTERWORK_SEAL_IMAGE_URL } from '../src/ui/profession_art';

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

interface CraftCelebrationHudHarness {
  bannerEl: HTMLElement;
  bannerTimer: number | undefined;
  log: ReturnType<typeof vi.fn>;
  combatAnnouncer: { push: ReturnType<typeof vi.fn> };
  handleCraftCelebrations(
    masterworkItemId: string | null,
    tierUps: { craftId: string; toTier: number }[],
  ): void;
  showBanner(text: string, motion?: boolean, decorativeIconUrl?: string): void;
}

function celebrationHud(): CraftCelebrationHudHarness {
  const hud = Object.create(Hud.prototype) as unknown as CraftCelebrationHudHarness;
  hud.bannerEl = document.createElement('div');
  hud.bannerTimer = undefined;
  hud.log = vi.fn();
  hud.combatAnnouncer = { push: vi.fn() };
  return hud;
}

describe('craft celebration HUD behavior', () => {
  const hudCss = readFileSync(join(process.cwd(), 'src/styles/hud.css'), 'utf8');
  const hudMobileCss = readFileSync(join(process.cwd(), 'src/styles/hud.mobile.css'), 'utf8');

  beforeEach(() => {
    vi.useFakeTimers();
    window.matchMedia = vi.fn(
      (query: string) => ({ matches: true, media: query }) as MediaQueryList,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('renders the masterwork seal, keeps copy announced under reduced motion, then clears stale art', () => {
    const achievement = vi.spyOn(audio, 'achievement').mockImplementation(() => {});
    const hud = celebrationHud();

    hud.handleCraftCelebrations('iron_sword', []);

    const icon = hud.bannerEl.querySelector<HTMLImageElement>('img.banner-art');
    const copy = hud.bannerEl.querySelector<HTMLElement>('.banner-copy');
    expect(icon?.getAttribute('src')).toBe(MASTERWORK_SEAL_IMAGE_URL);
    expect(icon?.alt).toBe('');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    expect(copy?.textContent).toBeTruthy();
    expect(hud.bannerEl.classList.contains('banner-with-art')).toBe(true);
    expect(hud.bannerEl.classList.contains('banner-no-motion')).toBe(true);
    expect(hud.combatAnnouncer.push).toHaveBeenCalledTimes(1);
    expect(hud.combatAnnouncer.push.mock.calls[0][0]).toBe(copy?.textContent);
    expect(hud.log.mock.calls[0][0]).toBe(copy?.textContent);
    expect(achievement).toHaveBeenCalledTimes(1);

    hud.showBanner('Ordinary banner');

    expect(hud.bannerEl.querySelector('img')).toBeNull();
    expect(hud.bannerEl.children).toHaveLength(1);
    expect(hud.bannerEl.querySelector('.banner-copy')?.textContent).toBe('Ordinary banner');
    expect(hud.bannerEl.classList.contains('banner-with-art')).toBe(false);
    expect(hud.bannerEl.classList.contains('banner-no-motion')).toBe(false);
  });

  it('keeps the banner art sizing and no-motion presentation contracts in CSS', () => {
    expect(hudCss).toMatch(/#banner\.banner-with-art[\s\S]*?display:\s*flex/);
    expect(hudCss).toMatch(/#banner \.banner-art[\s\S]*?width:\s*46px/);
    expect(hudMobileCss).toMatch(/body\.mobile-touch #banner \.banner-art[\s\S]*?width:\s*34px/);
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
