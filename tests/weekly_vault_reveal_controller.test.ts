// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { itemDisplayName } from '../src/ui/entity_i18n';
import type { PainterHostPresentation } from '../src/ui/painter_host';
import {
  VAULT_TIMELINE,
  vaultTimelineVars,
  weeklyVaultBurstLayout,
} from '../src/ui/weekly_vault_burst_core';
import {
  attachWeeklyVaultReveal,
  WEEKLY_REVEAL_DURATION_MS,
} from '../src/ui/weekly_vault_reveal_controller';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it('does not publish loot or animate while awaiting a host opening', () => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const stage = document.createElement('div');
  stage.innerHTML = '<img src="/ui/weekly-vault/normal.webp" alt="">';
  document.body.append(stage);
  const request = vi.fn();
  const reveal = vi.fn();
  const icon = vi.fn();
  const view = attachWeeklyVaultReveal(
    stage,
    undefined,
    'Reward 1',
    0,
    false,
    { itemIcon: icon, attachTooltip: vi.fn() } as unknown as PainterHostPresentation,
    () => true,
    reveal,
    undefined,
    request,
  );
  stage.querySelector<HTMLButtonElement>('.vault-reveal-trigger')!.click();
  stage.querySelector<HTMLButtonElement>('.vault-reveal-trigger')!.click();
  view.animate();
  vi.runAllTimers();
  expect(request).toHaveBeenCalledTimes(1);
  expect(reveal).not.toHaveBeenCalled();
  expect(icon).not.toHaveBeenCalled();
  expect(stage.querySelector('.vault-reveal-loot')!.hasAttribute('hidden')).toBe(true);
  expect(stage.classList.contains('vault-is-open')).toBe(false);
  view.dispose();
  stage.querySelector<HTMLButtonElement>('.vault-reveal-trigger')!.click();
  expect(request).toHaveBeenCalledTimes(1);
  stage.remove();
});
it('opens once, reveals the provided item and cancels safely on teardown', () => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const stage = document.createElement('div');
  document.body.append(stage);
  stage.innerHTML = '<img src="/ui/weekly-vault/normal.webp" alt="">';
  const reveal = vi.fn();
  let allowed = false;
  const view = attachWeeklyVaultReveal(
    stage,
    ITEMS.orb_of_the_last_spring,
    'Reward 1',
    0,
    false,
    { itemIcon: () => '', attachTooltip: vi.fn() } as unknown as PainterHostPresentation,
    () => allowed,
    reveal,
  );
  const trigger = stage.querySelector<HTMLButtonElement>('.vault-reveal-trigger')!;
  trigger.click();
  expect(stage.classList.contains('vault-is-open')).toBe(false);
  allowed = true;
  view.syncAvailability();
  trigger.focus();
  trigger.click();
  trigger.click();
  vi.advanceTimersByTime(WEEKLY_REVEAL_DURATION_MS);
  expect(reveal).toHaveBeenCalledTimes(1);
  expect(stage.querySelector<HTMLButtonElement>('.vault-reveal-loot')?.disabled).toBe(false);
  expect(trigger.disabled).toBe(true);
  expect(stage.querySelector('.vault-reveal-loot strong')?.textContent).toBe(
    itemDisplayName(ITEMS.orb_of_the_last_spring),
  );
  expect(document.activeElement).toBe(stage.querySelector('.vault-reveal-loot'));
  view.dispose();
  vi.runAllTimers();
  expect(reveal).toHaveBeenCalledTimes(1);
  stage.remove();
});
it('mints the burst from the core: individual timing per element, the timeline on the stage', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const stage = document.createElement('div');
  stage.innerHTML = '<img src="/ui/weekly-vault/heroic.webp" alt="">';
  document.body.append(stage);
  const view = attachWeeklyVaultReveal(
    stage,
    ITEMS.orb_of_the_last_spring,
    'Reward 10',
    9,
    false,
    { itemIcon: () => '', attachTooltip: vi.fn() } as unknown as PainterHostPresentation,
    () => true,
    vi.fn(),
  );
  const layout = weeklyVaultBurstLayout();
  // The seam exists from the start (it carries the charging throb); the burst
  // itself is minted only when this tile actually opens.
  expect(stage.querySelector('.vault-seam-glow')).not.toBeNull();
  expect(stage.querySelector('.vault-light-spill')).toBeNull();
  expect(stage.querySelector('.vault-burst-stars')).toBeNull();
  view.animate();
  const timing = (selector: string, family: string) =>
    [...stage.querySelectorAll<HTMLElement>(selector)].map(
      (el) =>
        `${el.style.getPropertyValue(`--vault-${family}-delay`)}:${el.style.getPropertyValue(`--vault-${family}-duration`)}`,
    );
  const rays = timing('.vault-light-spill i', 'ray');
  expect(rays).toHaveLength(layout.rays.length);
  expect(new Set(rays).size).toBe(layout.rays.length);
  expect(rays.every((pair) => /^\d+ms:\d+ms$/.test(pair))).toBe(true);
  expect(stage.querySelectorAll('.vault-light-spill .vault-ray-wide').length).toBeGreaterThan(0);
  expect(stage.querySelectorAll('.vault-light-spill .vault-ray-thin').length).toBeGreaterThan(0);
  const stars = timing('.vault-burst-stars i', 'star');
  expect(stars).toHaveLength(layout.stars.length);
  expect(new Set(stars).size).toBe(layout.stars.length);
  const streaks = timing('.vault-burst-streaks i', 'streak');
  expect(streaks).toHaveLength(layout.streaks.length);
  expect(new Set(streaks).size).toBe(layout.streaks.length);
  expect(timing('.vault-opening-rings i', 'ring')).toHaveLength(layout.rings.length);
  for (const layer of ['.vault-seam-glow', '.vault-seam-line', '.vault-opening-flash'])
    expect(
      stage
        .querySelector(`.vault-reveal-trigger > .vault-light > ${layer}`)
        ?.getAttribute('aria-hidden'),
    ).toBe('true');
  // Every light layer, burst included, sits inside the one clipped container.
  expect(
    stage.querySelector('.vault-reveal-trigger > .vault-light > .vault-burst-stars'),
  ).not.toBeNull();
  // The timeline lives on the stage, where the loot (a trigger sibling) inherits it.
  for (const [name, value] of Object.entries(vaultTimelineVars()))
    expect(stage.style.getPropertyValue(name)).toBe(value);
  expect(stage.style.getPropertyValue('--vault-t-loot')).toBe(`${VAULT_TIMELINE.lootMs}ms`);
  // The light layers sit under the frame and door in DOM order too.
  const children = [...stage.querySelector('.vault-reveal-trigger')!.children].map(
    (c) => c.className,
  );
  expect(children.indexOf('vault-light')).toBeGreaterThanOrEqual(0);
  expect(children.indexOf('vault-light')).toBeLessThan(children.indexOf('vault-reveal-frame'));
  expect(children.indexOf('vault-reveal-frame')).toBeLessThan(
    children.indexOf('vault-reveal-door'),
  );
  view.dispose();
  stage.remove();
});
it('marks a pending host opening as charging (cosmetic), and never before the item is known', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const stage = document.createElement('div');
  stage.innerHTML = '<img src="/ui/weekly-vault/normal.webp" alt="">';
  document.body.append(stage);
  const presentation = {
    itemIcon: () => '',
    attachTooltip: vi.fn(),
  } as unknown as PainterHostPresentation;
  const pending = attachWeeklyVaultReveal(
    stage,
    undefined,
    'Reward 1',
    0,
    false,
    presentation,
    () => true,
    vi.fn(),
    undefined,
    vi.fn(),
    true,
  );
  expect(stage.classList.contains('vault-is-charging')).toBe(true);
  expect(stage.classList.contains('vault-is-open')).toBe(false);
  expect(stage.querySelector('.vault-reveal-trigger')?.getAttribute('aria-busy')).toBe('true');
  pending.dispose();
  const idle = attachWeeklyVaultReveal(
    stage,
    undefined,
    'Reward 1',
    0,
    false,
    presentation,
    () => true,
    vi.fn(),
    undefined,
    vi.fn(),
  );
  expect(stage.classList.contains('vault-is-charging')).toBe(false);
  idle.dispose();
  stage.remove();
});
it('resumes an in-flight opening across a repaint instead of restarting it', () => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const presentation = {
    itemIcon: () => '',
    attachTooltip: vi.fn(),
  } as unknown as PainterHostPresentation;
  const mount = () => {
    const stage = document.createElement('div');
    stage.innerHTML = '<img src="/ui/weekly-vault/normal.webp" alt="">';
    document.body.append(stage);
    return stage;
  };
  const first = mount();
  const progress = {};
  const firstReveal = vi.fn();
  const view = attachWeeklyVaultReveal(
    first,
    ITEMS.orb_of_the_last_spring,
    'Reward 1',
    0,
    false,
    presentation,
    () => true,
    firstReveal,
    undefined,
    undefined,
    false,
    progress,
  );
  view.animate();
  expect(first.style.getPropertyValue('--vault-elapsed')).toBe('0ms');
  vi.advanceTimersByTime(1000);
  // The bank repaints mid-show: the tile is torn down and rebuilt for the same slot.
  view.dispose();
  first.remove();
  const second = mount();
  const reveal = vi.fn();
  const resumed = attachWeeklyVaultReveal(
    second,
    ITEMS.orb_of_the_last_spring,
    'Reward 1',
    0,
    false,
    presentation,
    () => true,
    reveal,
    undefined,
    undefined,
    false,
    progress,
  );
  resumed.animate();
  expect(second.classList.contains('vault-is-open')).toBe(true);
  expect(second.style.getPropertyValue('--vault-elapsed')).toBe('1000ms');
  vi.advanceTimersByTime(WEEKLY_REVEAL_DURATION_MS - 1000 - 1);
  expect(reveal).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(reveal).toHaveBeenCalledTimes(1);
  expect(firstReveal).not.toHaveBeenCalled();
  expect(second.classList.contains('vault-is-revealed')).toBe(true);
  resumed.dispose();
  second.remove();
  // A different reward session starts fresh even with the same slot and item.
  const third = mount();
  const again = attachWeeklyVaultReveal(
    third,
    ITEMS.orb_of_the_last_spring,
    'Reward 1',
    0,
    false,
    presentation,
    () => true,
    vi.fn(),
  );
  again.animate();
  expect(third.style.getPropertyValue('--vault-elapsed')).toBe('0ms');
  again.dispose();
  third.remove();
});
it('keeps a fresh opening independent of an abandoned opening', () => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const presentation = {
    itemIcon: () => '',
    attachTooltip: vi.fn(),
  } as unknown as PainterHostPresentation;
  const stage = document.createElement('div');
  stage.innerHTML = '<img src="/ui/weekly-vault/normal.webp" alt="">';
  document.body.append(stage);
  const view = attachWeeklyVaultReveal(
    stage,
    ITEMS.orb_of_the_last_spring,
    'Reward 2',
    1,
    false,
    presentation,
    () => true,
    vi.fn(),
  );
  view.animate();
  // Torn down before completion (window closed), then long forgotten.
  view.dispose();
  vi.advanceTimersByTime(WEEKLY_REVEAL_DURATION_MS + 5000);
  const later = document.createElement('div');
  later.innerHTML = '<img src="/ui/weekly-vault/normal.webp" alt="">';
  document.body.append(later);
  const fresh = attachWeeklyVaultReveal(
    later,
    ITEMS.orb_of_the_last_spring,
    'Reward 2',
    1,
    false,
    presentation,
    () => true,
    vi.fn(),
  );
  fresh.animate();
  expect(later.style.getPropertyValue('--vault-elapsed')).toBe('0ms');
  fresh.dispose();
  stage.remove();
  later.remove();
});
it('mints no burst for a vault that is already revealed when it mounts', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const stage = document.createElement('div');
  stage.innerHTML = '<img src="/ui/weekly-vault/normal.webp" alt="">';
  document.body.append(stage);
  const view = attachWeeklyVaultReveal(
    stage,
    ITEMS.orb_of_the_last_spring,
    'Reward 1',
    0,
    true,
    { itemIcon: () => '', attachTooltip: vi.fn() } as unknown as PainterHostPresentation,
    () => true,
    vi.fn(),
  );
  expect(stage.classList.contains('vault-is-revealed')).toBe(true);
  expect(stage.querySelector('.vault-light-spill')).toBeNull();
  expect(stage.querySelector('.vault-burst-streaks')).toBeNull();
  expect(stage.querySelector('.vault-opening-rings')).toBeNull();
  view.animate();
  expect(stage.querySelector('.vault-light-spill')).toBeNull();
  view.dispose();
  stage.remove();
});
it('completes synchronously under reduced motion and leaves no flight to resume', () => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const presentation = {
    itemIcon: () => '',
    attachTooltip: vi.fn(),
  } as unknown as PainterHostPresentation;
  const stage = document.createElement('div');
  stage.innerHTML = '<img src="/ui/weekly-vault/normal.webp" alt="">';
  document.body.append(stage);
  const reveal = vi.fn();
  const view = attachWeeklyVaultReveal(
    stage,
    ITEMS.orb_of_the_last_spring,
    'Reward 3',
    2,
    false,
    presentation,
    () => true,
    reveal,
  );
  view.animate();
  expect(reveal).toHaveBeenCalledTimes(1);
  expect(stage.classList.contains('vault-is-open')).toBe(true);
  expect(stage.classList.contains('vault-is-revealed')).toBe(true);
  expect(stage.querySelector<HTMLButtonElement>('.vault-reveal-loot')?.disabled).toBe(false);
  view.dispose();
  // The same slot mounted again starts from zero: the flight ended, nothing resumes.
  const again = document.createElement('div');
  again.innerHTML = '<img src="/ui/weekly-vault/normal.webp" alt="">';
  document.body.append(again);
  const next = attachWeeklyVaultReveal(
    again,
    ITEMS.orb_of_the_last_spring,
    'Reward 3',
    2,
    false,
    presentation,
    () => true,
    vi.fn(),
  );
  next.animate();
  expect(again.style.getPropertyValue('--vault-elapsed')).toBe('0ms');
  next.dispose();
  stage.remove();
  again.remove();
});
it('never reveals when the session goes stale before the timer fires, and the next opening starts fresh', () => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const presentation = {
    itemIcon: () => '',
    attachTooltip: vi.fn(),
  } as unknown as PainterHostPresentation;
  const stage = document.createElement('div');
  stage.innerHTML = '<img src="/ui/weekly-vault/normal.webp" alt="">';
  document.body.append(stage);
  let allowed = true;
  const reveal = vi.fn();
  const view = attachWeeklyVaultReveal(
    stage,
    ITEMS.orb_of_the_last_spring,
    'Reward 4',
    3,
    false,
    presentation,
    () => allowed,
    reveal,
  );
  view.animate();
  vi.advanceTimersByTime(500);
  allowed = false;
  vi.advanceTimersByTime(WEEKLY_REVEAL_DURATION_MS);
  expect(reveal).not.toHaveBeenCalled();
  expect(stage.classList.contains('vault-is-revealed')).toBe(false);
  expect(stage.querySelector<HTMLButtonElement>('.vault-reveal-loot')?.disabled).toBe(true);
  view.dispose();
  allowed = true;
  const fresh = document.createElement('div');
  fresh.innerHTML = '<img src="/ui/weekly-vault/normal.webp" alt="">';
  document.body.append(fresh);
  const next = attachWeeklyVaultReveal(
    fresh,
    ITEMS.orb_of_the_last_spring,
    'Reward 4',
    3,
    false,
    presentation,
    () => allowed,
    vi.fn(),
  );
  next.animate();
  expect(fresh.style.getPropertyValue('--vault-elapsed')).toBe('0ms');
  next.dispose();
  stage.remove();
  fresh.remove();
});
