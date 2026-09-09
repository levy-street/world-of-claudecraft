// @vitest-environment happy-dom
//
// The shared corpse-harvest preference CONTROLLER (Intentional Gathering
// PR3): the one visit/world-identity coordinator the Field Kit use,
// Professions, and corpse Change entrances all call, painting the SAME
// content renderer (renderHarvestPreferencePicker). The controller owns the
// VISIT (capture/restore-once, generation-guarded stale/reentrant
// callbacks) and WORLD IDENTITY (a world swapped out from under an open
// picker refuses a stale Apply) halves; the picker owns its own
// terminal/DOM-ownership guards (tests/harvest_preference_window.test.ts).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ITEMS } from '../src/sim/data';
import {
  HARVEST_PREFERENCE_ALL,
  HARVEST_PREFERENCE_ALL_TOKEN,
  type HarvestPreference,
} from '../src/sim/professions/harvest_preference';
import { itemDisplayName } from '../src/ui/entity_i18n';
import { HarvestPreferenceController } from '../src/ui/hud/professions/harvest_preference_controller';
import { ensureLocaleLoaded, setLanguage, t } from '../src/ui/i18n';
import type { IWorld } from '../src/world_api';

class StubWorld {
  harvestPreference: HarvestPreference | null = HARVEST_PREFERENCE_ALL;
  setHarvestPreference = vi.fn<(raw: string) => void>();
}

type PreferenceWorld = Pick<IWorld, 'harvestPreference' | 'setHarvestPreference'>;

function radioRows(root: HTMLElement): HTMLButtonElement[] {
  return [...root.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
}

function radioRowFor(root: HTMLElement, token: string): HTMLButtonElement {
  const found = radioRows(root).find((r) => r.dataset.harvestChoice === token);
  if (!found) throw new Error(`no radio row for token ${token}`);
  return found;
}

function isChecked(button: HTMLButtonElement): boolean {
  return button.getAttribute('aria-checked') === 'true';
}

function buttonByText(root: HTMLElement, text: RegExp): HTMLButtonElement {
  const found = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.getAttribute('role') !== 'radio' && text.test(b.textContent ?? ''),
  );
  if (!found) throw new Error(`no button matching ${text}`);
  return found;
}

let root: HTMLElement;
let world: StubWorld;
let currentWorld: PreferenceWorld;
let opener: HTMLButtonElement;
let closeOthersSpy: ReturnType<typeof vi.fn<() => void>>;
let captureFocusSpy: ReturnType<typeof vi.fn<() => HTMLElement | null>>;
let restoreFocusSpy: ReturnType<typeof vi.fn<(target: HTMLElement | null) => void>>;
let onVisibilityChangeSpy: ReturnType<typeof vi.fn<() => void>>;

function makeController(): HarvestPreferenceController {
  return new HarvestPreferenceController({
    root: () => root,
    world: () => currentWorld,
    closeOthers: closeOthersSpy,
    captureFocus: captureFocusSpy,
    restoreFocus: restoreFocusSpy,
    onVisibilityChange: onVisibilityChangeSpy,
  });
}

beforeEach(() => {
  // A real production-like root: the shared `.window.panel` family starts
  // hidden via inline style (the CSS class alone has no effect in happy-dom,
  // which loads no stylesheet), the same shape as every `#*-window` root in
  // index.html (e.g. `#plant-sheet-window`).
  document.body.innerHTML =
    '<div id="harvest-preference-window" class="window panel" style="display:none"></div>';
  root = document.getElementById('harvest-preference-window') as HTMLElement;
  world = new StubWorld();
  currentWorld = world as unknown as PreferenceWorld;
  opener = document.createElement('button');
  document.body.appendChild(opener);
  closeOthersSpy = vi.fn<() => void>();
  captureFocusSpy = vi.fn<() => HTMLElement | null>(() => opener);
  restoreFocusSpy = vi.fn<(target: HTMLElement | null) => void>();
  onVisibilityChangeSpy = vi.fn<() => void>();
});

describe('harvest preference controller: open paints, never commands', () => {
  it('open reads the latest global preference and paints without sending a command', () => {
    const ctl = makeController();
    ctl.open(['hide']);
    expect(world.setHarvestPreference).not.toHaveBeenCalled();
    expect(isChecked(radioRowFor(root, HARVEST_PREFERENCE_ALL_TOKEN))).toBe(true);
  });

  it("open() with no tags shows the general catalog; open(tags) shows only that body's materials", () => {
    const ctl = makeController();
    ctl.open();
    expect(radioRows(root).length).toBeGreaterThan(2);
    ctl.close();
    ctl.open(['hide']);
    expect(radioRows(root)).toHaveLength(2);
  });

  it('a saved material preference preselects that row on open', () => {
    world.harvestPreference = { kind: 'material', itemId: 'rough_hide' };
    const ctl = makeController();
    ctl.open(['hide']);
    expect(isChecked(radioRowFor(root, 'rough_hide'))).toBe(true);
  });
});

describe('harvest preference controller: draft vs commit', () => {
  it('changing the draft never calls the world setter', () => {
    const ctl = makeController();
    ctl.open(['hide']);
    radioRowFor(root, 'rough_hide').click();
    expect(world.setHarvestPreference).not.toHaveBeenCalled();
  });

  it('Apply calls the current world setter once with the selected canonical token, then closes and restores focus through the dependency bridge', () => {
    const ctl = makeController();
    ctl.open(['hide']);
    radioRowFor(root, 'rough_hide').click();
    buttonByText(root, /apply/i).click();
    expect(world.setHarvestPreference).toHaveBeenCalledTimes(1);
    expect(world.setHarvestPreference).toHaveBeenCalledWith('rough_hide');
    expect(ctl.isOpen).toBe(false);
    expect(restoreFocusSpy).toHaveBeenCalledWith(opener);
  });

  it('Cancel discards without a setter call and closes', () => {
    const ctl = makeController();
    ctl.open(['hide']);
    radioRowFor(root, 'rough_hide').click();
    buttonByText(root, /cancel/i).click();
    expect(world.setHarvestPreference).not.toHaveBeenCalled();
    expect(ctl.isOpen).toBe(false);
  });

  it('close() (the Escape path) discards without a setter call, clears the rendered subtree, and restores focus', () => {
    const ctl = makeController();
    ctl.open(['hide']);
    ctl.close();
    expect(world.setHarvestPreference).not.toHaveBeenCalled();
    expect(ctl.isOpen).toBe(false);
    expect(root.children).toHaveLength(0);
    expect(restoreFocusSpy).toHaveBeenCalledWith(opener);
  });

  it('retained controls from a closed visit are inert', () => {
    const ctl = makeController();
    ctl.open(['hide']);
    const apply = buttonByText(root, /apply/i);
    ctl.close();
    apply.click();
    expect(world.setHarvestPreference).not.toHaveBeenCalled();
  });
});

describe('harvest preference controller: visit identity', () => {
  it('opening a different body resets the draft to the latest global preference, discarding an abandoned draft', () => {
    const ctl = makeController();
    ctl.open(['hide']);
    radioRowFor(root, 'rough_hide').click();
    ctl.open(['horn', 'tusk']);
    expect(world.setHarvestPreference).not.toHaveBeenCalled();
    expect(isChecked(radioRowFor(root, HARVEST_PREFERENCE_ALL_TOKEN))).toBe(true);
  });

  it('captures focus exactly once per fresh open, never on a same-window reopen for a different body', () => {
    const ctl = makeController();
    ctl.open(['hide']);
    expect(captureFocusSpy).toHaveBeenCalledTimes(1);
    ctl.open(['horn', 'tusk']);
    expect(captureFocusSpy).toHaveBeenCalledTimes(1);
  });

  it('restores focus only on an actual close of the current visit, never on a superseded reopen', () => {
    const ctl = makeController();
    ctl.open(['hide']);
    ctl.open(['horn', 'tusk']);
    expect(restoreFocusSpy).not.toHaveBeenCalled();
    ctl.close();
    expect(restoreFocusSpy).toHaveBeenCalledTimes(1);
  });

  it('a reopen after a later authoritative preference update reads that update', () => {
    const ctl = makeController();
    ctl.open(['hide']);
    ctl.close();
    world.harvestPreference = { kind: 'material', itemId: 'rough_hide' };
    ctl.open(['hide']);
    expect(isChecked(radioRowFor(root, 'rough_hide'))).toBe(true);
  });

  it('a stale Apply from a superseded visit cannot close a newly opened window or send a command', () => {
    const ctl = makeController();
    ctl.open(['hide']);
    const staleApply = buttonByText(root, /apply/i);
    ctl.close();
    ctl.open(['horn', 'tusk']);
    staleApply.click();
    expect(world.setHarvestPreference).not.toHaveBeenCalled();
    expect(ctl.isOpen).toBe(true);
  });

  it('refuses a stale Apply when the world identity changed under an open picker, sends no command to either world, and retires the visit (no dead window)', () => {
    const ctl = makeController();
    ctl.open(['hide']);
    radioRowFor(root, 'rough_hide').click();
    const otherWorld = new StubWorld();
    currentWorld = otherWorld as unknown as PreferenceWorld;
    buttonByText(root, /apply/i).click();
    expect(world.setHarvestPreference).not.toHaveBeenCalled();
    expect(otherWorld.setHarvestPreference).not.toHaveBeenCalled();
    expect(ctl.isOpen).toBe(false);
    expect(root.children).toHaveLength(0);
    expect(restoreFocusSpy).toHaveBeenCalledWith(opener);
  });

  it('a reentrant setter that opens a new visit is not closed by the Apply that triggered it', () => {
    const ctl = makeController();
    ctl.open(['hide']);
    radioRowFor(root, 'rough_hide').click();
    world.setHarvestPreference.mockImplementation(() => {
      // Simulated reentrancy: the command handler itself opens a fresh visit
      // before the original Apply's own closing logic runs.
      ctl.open(['horn', 'tusk']);
    });
    buttonByText(root, /apply/i).click();
    expect(world.setHarvestPreference).toHaveBeenCalledTimes(1);
    expect(ctl.isOpen).toBe(true);
    expect(radioRows(root)).toHaveLength(2); // the reentrant visit's own rows
    expect(isChecked(radioRowFor(root, HARVEST_PREFERENCE_ALL_TOKEN))).toBe(true);
  });
});

describe('harvest preference controller: relocalize', () => {
  afterEach(() => {
    setLanguage('en');
  });

  it('preserves the uncommitted draft, repaints with the active locale, and never sends a command', async () => {
    const ctl = makeController();
    ctl.open(['hide']);
    radioRowFor(root, 'rough_hide').click();

    await ensureLocaleLoaded('es');
    setLanguage('es');
    try {
      ctl.relocalize();

      expect(isChecked(radioRowFor(root, 'rough_hide'))).toBe(true);
      expect(radioRowFor(root, 'rough_hide').textContent).toBe(itemDisplayName(ITEMS.rough_hide));
      expect(radioRowFor(root, 'rough_hide').textContent).not.toBe('Rough Hide');
      expect(world.setHarvestPreference).not.toHaveBeenCalled();
    } finally {
      setLanguage('en');
    }
  });

  it('preserves EXACT focus on a focused row across relocalize, not merely the checked row', async () => {
    const ctl = makeController();
    ctl.open(['hide']);
    radioRowFor(root, 'rough_hide').focus();

    await ensureLocaleLoaded('es');
    setLanguage('es');
    try {
      ctl.relocalize();
      expect(document.activeElement).toBe(radioRowFor(root, 'rough_hide'));
    } finally {
      setLanguage('en');
    }
  });

  it('preserves EXACT focus on Apply across relocalize, even though Apply is not a radio row', async () => {
    const ctl = makeController();
    ctl.open(['hide']);
    buttonByText(root, /apply/i).focus();

    await ensureLocaleLoaded('es');
    setLanguage('es');
    try {
      ctl.relocalize();
      expect(document.activeElement).toBe(buttonByText(root, /apply/i));
    } finally {
      setLanguage('en');
    }
  });

  it('does not steal focus when it was outside the picker before relocalize', async () => {
    const ctl = makeController();
    ctl.open(['hide']);
    opener.focus();

    await ensureLocaleLoaded('es');
    setLanguage('es');
    try {
      ctl.relocalize();
      expect(document.activeElement).toBe(opener);
    } finally {
      setLanguage('en');
    }
  });

  it('closes instead of repainting stale character data when the world identity changed since open', () => {
    const ctl = makeController();
    ctl.open(['hide']);
    currentWorld = new StubWorld() as unknown as PreferenceWorld;
    ctl.relocalize();
    expect(ctl.isOpen).toBe(false);
    expect(root.children).toHaveLength(0);
  });

  it('relocalize on a closed controller does nothing', () => {
    const ctl = makeController();
    ctl.relocalize();
    expect(ctl.isOpen).toBe(false);
    expect(root.children).toHaveLength(0);
  });
});

describe('harvest preference controller: visibility (a real window-panel root)', () => {
  it('open makes a hidden window-panel root visible (flex, the professions family shape)', () => {
    expect(root.style.display).toBe('none');
    const ctl = makeController();
    ctl.open(['hide']);
    expect(root.style.display).toBe('flex');
    expect(ctl.isOpen).toBe(true);
  });

  it('close returns the root to hidden', () => {
    const ctl = makeController();
    ctl.open(['hide']);
    ctl.close();
    expect(root.style.display).toBe('none');
    expect(ctl.isOpen).toBe(false);
  });

  it('Apply returns the root to hidden', () => {
    const ctl = makeController();
    ctl.open(['hide']);
    buttonByText(root, /apply/i).click();
    expect(root.style.display).toBe('none');
    expect(ctl.isOpen).toBe(false);
  });

  it('Cancel returns the root to hidden', () => {
    const ctl = makeController();
    ctl.open(['hide']);
    buttonByText(root, /cancel/i).click();
    expect(root.style.display).toBe('none');
    expect(ctl.isOpen).toBe(false);
  });

  it('a world-identity refusal on Apply also returns the root to hidden (no dead visible window)', () => {
    const ctl = makeController();
    ctl.open(['hide']);
    currentWorld = new StubWorld() as unknown as PreferenceWorld;
    buttonByText(root, /apply/i).click();
    expect(root.style.display).toBe('none');
    expect(ctl.isOpen).toBe(false);
  });

  it('onVisibilityChange fires exactly on real open/close flips, matching actual visibility, never on a same-window reopen or relocalize', async () => {
    const ctl = makeController();

    ctl.open(['hide']);
    expect(onVisibilityChangeSpy).toHaveBeenCalledTimes(1);
    expect(root.style.display).toBe('flex');
    expect(ctl.isOpen).toBe(true);

    ctl.open(['horn', 'tusk']); // same-window reopen: no visibility flip
    expect(onVisibilityChangeSpy).toHaveBeenCalledTimes(1);
    expect(root.style.display).toBe('flex');

    await ensureLocaleLoaded('ru_RU');
    setLanguage('ru_RU');
    try {
      ctl.relocalize(); // repaint only: no visibility flip
      expect(onVisibilityChangeSpy).toHaveBeenCalledTimes(1);
      expect(root.style.display).toBe('flex');
    } finally {
      setLanguage('en');
    }

    ctl.close();
    expect(onVisibilityChangeSpy).toHaveBeenCalledTimes(2);
    expect(root.style.display).toBe('none');
    expect(ctl.isOpen).toBe(false);
  });
});

describe('harvest preference controller: focus enters the picker on open', () => {
  it('a fresh open moves focus inside, onto the checked row for a resolved preference, and never commits', () => {
    opener.focus();
    expect(document.activeElement).toBe(opener);
    const ctl = makeController();
    ctl.open(['hide']);
    expect(document.activeElement).toBe(radioRowFor(root, HARVEST_PREFERENCE_ALL_TOKEN));
    expect(world.setHarvestPreference).not.toHaveBeenCalled();
  });

  it('a fresh open with an unresolved (null) preference focuses the first, unchecked row, and never commits', () => {
    world.harvestPreference = null;
    opener.focus();
    const ctl = makeController();
    ctl.open(['hide']);
    const focused = document.activeElement;
    expect(focused).toBeInstanceOf(HTMLElement);
    expect(root.contains(focused as Node)).toBe(true);
    expect((focused as HTMLElement).getAttribute('role')).toBe('radio');
    expect(isChecked(focused as HTMLButtonElement)).toBe(false);
    expect(world.setHarvestPreference).not.toHaveBeenCalled();
  });

  it('a same-window reopen for a different body leaves focus at a valid, attached control inside the newly painted root, never body or a detached prior node', () => {
    opener.focus();
    const ctl = makeController();
    ctl.open(['hide']);
    const priorFocused = document.activeElement;
    ctl.open(['horn', 'tusk']);
    const focused = document.activeElement;
    expect(focused).toBeInstanceOf(HTMLElement);
    expect(focused).not.toBe(document.body);
    expect((focused as HTMLElement).isConnected).toBe(true);
    expect(root.contains(focused as Node)).toBe(true);
    expect(focused).not.toBe(priorFocused);
  });
});

describe('harvest preference controller: relocalize updates the accessible name', () => {
  afterEach(() => {
    setLanguage('en');
  });

  it('relocalize to a loaded non-English locale (ru_RU) updates the root accessible name and row labels, preserving exact focus and draft', async () => {
    const ctl = makeController();
    ctl.open(['hide']);
    const englishTitle = t('hudChrome.harvestPreference.title');
    expect(root.getAttribute('aria-label')).toBe(englishTitle);

    radioRowFor(root, 'rough_hide').click();
    radioRowFor(root, 'rough_hide').focus();

    await ensureLocaleLoaded('ru_RU');
    setLanguage('ru_RU');
    try {
      const ruTitle = t('hudChrome.harvestPreference.title');
      expect(ruTitle).not.toBe(englishTitle);

      ctl.relocalize();

      expect(root.getAttribute('aria-label')).toBe(ruTitle);
      expect(isChecked(radioRowFor(root, 'rough_hide'))).toBe(true);
      expect(radioRowFor(root, 'rough_hide').textContent).toBe(itemDisplayName(ITEMS.rough_hide));
      expect(radioRowFor(root, 'rough_hide').textContent).not.toBe('Rough Hide');
      expect(document.activeElement).toBe(radioRowFor(root, 'rough_hide'));
      expect(world.setHarvestPreference).not.toHaveBeenCalled();
    } finally {
      setLanguage('en');
    }
  });
});
