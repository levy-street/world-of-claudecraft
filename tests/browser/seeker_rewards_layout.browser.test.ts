import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { cleanup } from './_harness';

const EPSILON = 0.5;

function mountSeekerHud(compact: boolean): {
  chest: HTMLButtonElement;
  target: HTMLElement;
} {
  document.body.className = [
    'mobile-touch',
    'game-active',
    'seeker-wallet-enabled',
    compact ? 'hud-mobile-compact' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const controls = document.createElement('div');
  controls.id = 'mobile-combat-controls';
  controls.style.setProperty('--btn-scale', '1.3');
  for (const id of [
    'mobile-chat',
    'mobile-social',
    'mobile-quests',
    'mobile-settings',
    'mobile-more',
  ]) {
    const button = document.createElement('button');
    button.id = id;
    button.className = 'mobile-btn';
    controls.appendChild(button);
  }
  const chest = document.createElement('button');
  chest.id = 'mobile-daily-rewards';
  chest.className = 'mobile-btn';
  controls.appendChild(chest);

  const target = document.createElement('div');
  target.id = 'target-frame';
  target.className = 'unitframe';
  target.style.display = 'flex';
  const bars = document.createElement('div');
  bars.className = 'uf-bars';
  bars.textContent = 'Target';
  const portrait = document.createElement('div');
  portrait.className = 'portrait-wrap';
  target.append(bars, portrait);

  document.body.append(controls, target);
  return { chest, target };
}

function overlaps(a: DOMRect, b: DOMRect): boolean {
  return (
    a.left < b.right - EPSILON &&
    a.right > b.left + EPSILON &&
    a.top < b.bottom - EPSILON &&
    a.bottom > b.top + EPSILON
  );
}

afterEach(() => {
  cleanup();
  document.body.className = '';
});

describe('Seeker Daily Rewards mobile placement', () => {
  it.each([
    { label: 'portrait', width: 390, height: 844, compact: false },
    { label: 'compact landscape', width: 844, height: 390, compact: true },
  ])('keeps the promoted chest clear of the target frame in $label', async (layout) => {
    await page.viewport(layout.width, layout.height);
    const { chest, target } = mountSeekerHud(layout.compact);
    const chestRect = chest.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();

    expect(chestRect.width).toBeGreaterThanOrEqual(40 - EPSILON);
    expect(chestRect.height).toBeGreaterThanOrEqual(40 - EPSILON);
    expect(overlaps(chestRect, targetRect)).toBe(false);

    const hit = document.elementFromPoint(
      targetRect.left + targetRect.width / 2,
      targetRect.top + targetRect.height / 2,
    );
    expect(
      hit === target || target.contains(hit),
      `expected target center to remain actionable, but hit ${hit?.id || hit?.tagName || 'nothing'}; chest=${JSON.stringify(chestRect.toJSON())}; target=${JSON.stringify(targetRect.toJSON())}`,
    ).toBe(true);

    chest.hidden = true;
    expect(getComputedStyle(chest).display).toBe('none');
  });
});
