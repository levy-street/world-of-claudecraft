import { afterEach, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import playHtml from '../../play.html?raw';
import { characterRowHtml, membershipSlotsHtml } from '../../src/ui/character_membership_view';
import { cleanup } from './_harness';

afterEach(async () => {
  cleanup();
  document.body.className = '';
  delete document.body.dataset.startPanel;
  await page.viewport(1280, 800);
});

it.each([
  [1280, 800, 'normal'],
  [390, 844, 'normal'],
  [844, 390, 'normal'],
  [1280, 800, 'expired'],
  [390, 844, 'expired'],
  [844, 390, 'expired'],
  [390, 844, 'empty'],
  [1280, 800, 'member'],
] as const)(
  'shows character slots within the roster at %sx%s (%s)',
  async (width, height, scenario) => {
    await page.viewport(width, height);
    document.body.className = `start-screen-open${width < 900 ? ' mobile-touch' : ''}`;
    document.body.dataset.startPanel = 'charselect-panel';
    const parsed = new DOMParser().parseFromString(playHtml, 'text/html');
    const source = parsed.getElementById('charselect-panel')!;
    const chain: Element[] = [];
    for (let el = source.parentElement; el && el !== parsed.body; el = el.parentElement)
      chain.unshift(el);
    let parent: Element = document.body;
    for (const ancestor of chain) {
      const copy = document.importNode(ancestor, false);
      parent.append(copy);
      parent = copy;
    }
    const panel = document.importNode(source, true);
    panel.removeAttribute('hidden');
    parent.append(panel);
    const list = panel.querySelector<HTMLElement>('#char-list')!;
    const active = scenario === 'member';
    const roster = Array.from({ length: scenario === 'empty' ? 0 : 9 }, (_, index) => ({
      membershipSlot: scenario === 'expired' && index === 8,
    }));
    list.innerHTML =
      roster
        .map(
          (character, index) =>
            `<li class="char-row${character.membershipSlot ? ' membership-locked' : ''}">${characterRowHtml(
              {
                name: `Adventurer ${index + 1}`,
                class: 'warrior',
                level: 1,
                online: false,
                forceRename: false,
                membershipLocked: character.membershipSlot,
              },
              '',
              0,
            )}</li>`,
        )
        .join('') + membershipSlotsHtml(roster, active, active ? 20 : 10);
    const boundary = list.children[Math.max(0, roster.length - 1)] as HTMLElement;
    boundary.scrollIntoView({ block: 'start' });
    expect(list.scrollWidth).toBeLessThanOrEqual(list.clientWidth + 1);
    const available = list.querySelector<HTMLElement>('.char-empty-slot:not(.membership-slot)')!;
    const premium = list.querySelector<HTMLElement>('.membership-slot')!;
    expect(list.querySelectorAll('.char-empty-slot')).toHaveLength(scenario === 'empty' ? 20 : 11);
    expect(list.querySelectorAll('.char-slot-lock')).toHaveLength(active ? 0 : 10);
    expect(available.textContent).toBe('Available character slot');
    expect(available.querySelector('svg')).toBeNull();
    expect(premium.textContent).toBe(
      active ? 'Available character slot' : 'Unlock slots with a membership',
    );
    expect(getComputedStyle(premium).filter).toBe(active ? 'none' : 'grayscale(1)');
    expect(getComputedStyle(available).filter).toBe('none');
    for (const row of [available, premium, boundary]) {
      expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1);
      expect(row.getBoundingClientRect().height).toBeGreaterThanOrEqual(40);
    }
  },
);
