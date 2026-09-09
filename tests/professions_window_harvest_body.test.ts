// @vitest-environment happy-dom
//
// The Professions window's "Harvest a body" entry (intentional gathering
// PR1): the accessible route to the corpse choice popup for keyboard, pad and
// touch players, since Tab targeting skips dead mobs. The button is an
// EXAMINE control: it asks the host to open the choice for a nearby body and
// never sends a harvest itself. Painted in BOTH window modes, at skill zero,
// exactly when the host wires the dep. Drives the real ProfessionsWindow.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ProfessionsWindow,
  type ProfessionsWindowDeps,
} from '../src/ui/hud/professions/professions_window';

vi.mock('../src/ui/icons', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/ui/icons')>()),
  iconDataUrl: () => 'data:,',
  professionIconUrl: (id: string) => `/test-professions/${id}.webp`,
}));

interface Identity {
  version: 1;
  synced: boolean;
  craftSkills: Record<string, number>;
  activeArchetype: string | null;
  pairedMajor: string | null;
  hobbyCraft: string | null;
  attunedPairs: string[];
  switchCount: number;
  amendsProgress: number;
  amendsRequired: number;
}

const CRAFTS = [
  'engineering',
  'alchemy',
  'cooking',
  'leatherworking',
  'tailoring',
  'inscription',
  'enchanting',
  'jewelcrafting',
  'weaponcrafting',
  'armorcrafting',
];

function attunedIdentity(): Identity {
  return {
    version: 1,
    synced: true,
    craftSkills: Object.fromEntries(CRAFTS.map((c) => [c, c === 'armorcrafting' ? 49 : 0])),
    activeArchetype: 'armorcrafting',
    pairedMajor: 'weaponcrafting',
    hobbyCraft: 'leatherworking',
    attunedPairs: ['weaponcrafting+armorcrafting'],
    switchCount: 0,
    amendsProgress: 0,
    amendsRequired: 11,
  };
}

/** A brand-new character: nothing attuned, every craft and gather at zero,
 *  which the view core paints as the simplified body. */
function freshIdentity(): Identity {
  return {
    version: 1,
    synced: true,
    craftSkills: Object.fromEntries(CRAFTS.map((c) => [c, 0])),
    activeArchetype: null,
    pairedMajor: null,
    hobbyCraft: null,
    attunedPairs: [],
    switchCount: 0,
    amendsProgress: 0,
    amendsRequired: 11,
  };
}

function makeWindow(identity: Identity, depsOver: Partial<ProfessionsWindowDeps> = {}) {
  const el = document.createElement('div');
  el.id = 'professions-window';
  document.body.appendChild(el);
  const harvestCorpse = vi.fn();
  const deps: ProfessionsWindowDeps = {
    root: () => el,
    world: () =>
      ({
        craftingIdentity: identity,
        professionsState: { skills: [] },
        gatheringProficiency: {},
        toolEffectSlots: [],
        inventory: [],
        myFarmPlots: [],
        player: { name: 'Testchar' },
        harvestCorpse,
      }) as never,
    closeOthers: () => {},
    hideTooltip: () => {},
    consumePeek: () => false,
    captureFocus: () => null,
    restoreFocus: () => {},
    itemIcon: () => '',
    moneyHtml: () => '',
    itemTooltip: () => '',
    attachTooltip: () => {},
    ...depsOver,
  };
  const w = new ProfessionsWindow(deps);
  w.open();
  return { w, el, harvestCorpse };
}

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
});

describe('ProfessionsWindow: the Harvest a body entry', () => {
  it('paints a labelled, focus-keyed button in full mode and asks the host on click, sending nothing', () => {
    const harvestBody = vi.fn();
    const { el, harvestCorpse } = makeWindow(attunedIdentity(), { harvestBody });
    const button = el.querySelector<HTMLButtonElement>('button[data-harvest-body]');
    if (!button) throw new Error('expected the Harvest a body button');
    expect(button.textContent).toBe('Harvest a body');
    expect(button.dataset.focusKey).toBe('harvestBody');
    expect(el.querySelector('.prof-harvest-body-hint')?.textContent).toBe(
      'Opens the choice for a body in reach that can still be harvested. Nothing is gathered until you choose.',
    );
    const closeBefore = el.querySelector('[data-close]');

    button.click();

    expect(harvestBody).toHaveBeenCalledTimes(1);
    expect(harvestCorpse).not.toHaveBeenCalled();
    // An examine, not a send: no repaint, no guard, the second press asks again.
    expect(el.querySelector('[data-close]')).toBe(closeBefore);
    button.click();
    expect(harvestBody).toHaveBeenCalledTimes(2);
  });

  it('paints the same button in simplified mode for a fresh character with every skill at zero', () => {
    const harvestBody = vi.fn();
    const { el } = makeWindow(freshIdentity(), { harvestBody });
    expect(el.querySelector('.prof-cta')).not.toBeNull(); // the simplified body
    expect(el.querySelectorAll('.prof-gather-row')).toHaveLength(0);
    const button = el.querySelector<HTMLButtonElement>('button[data-harvest-body]');
    if (!button) throw new Error('expected the Harvest a body button');
    button.click();
    expect(harvestBody).toHaveBeenCalledTimes(1);
  });

  it('is reachable from the keyboard: Tab order from Close lands on it', () => {
    const { el } = makeWindow(freshIdentity(), { harvestBody: () => {} });
    const focusables = [
      ...el.querySelectorAll<HTMLElement>(
        'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ];
    expect(focusables.map((node) => node.hasAttribute('data-harvest-body'))).toEqual([false, true]);
  });

  it('paints no button when the host has not wired the entry', () => {
    const { el } = makeWindow(attunedIdentity());
    expect(el.querySelector('[data-harvest-body]')).toBeNull();
  });

  it('keeps the button under a rebuild and restores focus onto it by its key', () => {
    const { w, el } = makeWindow(attunedIdentity(), { harvestBody: () => {} });
    const before = el.querySelector<HTMLButtonElement>('button[data-harvest-body]');
    if (!before) throw new Error('expected the Harvest a body button');
    before.focus();
    w.render();
    const after = el.querySelector<HTMLButtonElement>('button[data-harvest-body]');
    expect(after).not.toBe(before);
    expect(document.activeElement).toBe(after);
  });
});
