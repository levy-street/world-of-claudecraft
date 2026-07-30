import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { cleanup } from './_harness';

beforeEach(async () => {
  await page.viewport(844, 390);
  document.body.className = 'mobile-touch game-active mobile-window-open';
});

afterEach(() => {
  cleanup();
  document.body.className = '';
});

describe('mobile heroic loot and Bags coexistence', () => {
  it('hit-tests the managed bag sheet above the pointer-active loot-roll rail', () => {
    const ui = document.createElement('div');
    ui.id = 'ui';

    const bags = document.createElement('div');
    bags.id = 'bags';
    bags.className = 'window panel';
    bags.style.display = 'flex';
    // First managed window after the desktop production z-floor (50). Mobile
    // CSS must override this inline value without changing desktop stacking.
    bags.style.zIndex = '51';
    const bagTarget = document.createElement('button');
    bagTarget.type = 'button';
    bagTarget.textContent = 'Bag item';
    bagTarget.style.position = 'absolute';
    bagTarget.style.right = '14px';
    bagTarget.style.bottom = '112px';
    bagTarget.style.width = '360px';
    bagTarget.style.height = '100px';
    bags.appendChild(bagTarget);

    const rail = document.createElement('div');
    rail.id = 'loot-rolls';
    rail.style.display = 'flex';
    const roll = document.createElement('div');
    roll.className = 'loot-roll panel';
    roll.style.height = '100px';
    rail.appendChild(roll);
    ui.append(bags, rail);
    document.body.appendChild(ui);

    const rollRect = roll.getBoundingClientRect();
    const hit = document.elementFromPoint(
      rollRect.left + rollRect.width / 2,
      rollRect.top + rollRect.height / 2,
    );
    expect(getComputedStyle(rail).zIndex).toBe('65');
    expect(getComputedStyle(bags).zIndex).toBe('95');
    expect(Number(getComputedStyle(bags).zIndex)).toBeGreaterThan(
      Number(getComputedStyle(rail).zIndex),
    );
    expect(hit === bagTarget || bagTarget.contains(hit)).toBe(true);
  });

  it('keeps the desktop loot-roll rail above a first-opened managed bag window', () => {
    document.body.className = 'game-active mobile-window-open';
    const ui = document.createElement('div');
    ui.id = 'ui';

    const bags = document.createElement('div');
    bags.id = 'bags';
    bags.className = 'window panel';
    bags.style.display = 'flex';
    bags.style.zIndex = '51';
    const bagTarget = document.createElement('button');
    bagTarget.type = 'button';
    bagTarget.textContent = 'Bag item';
    bagTarget.style.position = 'absolute';
    bagTarget.style.right = '14px';
    bagTarget.style.bottom = '112px';
    bagTarget.style.width = '360px';
    bagTarget.style.height = '100px';
    bags.appendChild(bagTarget);

    const rail = document.createElement('div');
    rail.id = 'loot-rolls';
    rail.style.display = 'flex';
    const roll = document.createElement('div');
    roll.className = 'loot-roll panel';
    roll.style.height = '100px';
    rail.appendChild(roll);
    ui.append(bags, rail);
    document.body.appendChild(ui);

    const rollRect = roll.getBoundingClientRect();
    const hit = document.elementFromPoint(
      rollRect.left + rollRect.width / 2,
      rollRect.top + rollRect.height / 2,
    );
    expect(getComputedStyle(bags).zIndex).toBe('51');
    expect(getComputedStyle(rail).zIndex).toBe('65');
    expect(hit === roll || roll.contains(hit)).toBe(true);
  });

  it('removes the desktop vote strip from short mobile action cards', () => {
    const votes = document.createElement('div');
    votes.className = 'loot-roll-votes';
    document.body.appendChild(votes);
    expect(getComputedStyle(votes).display).toBe('none');
  });
});
