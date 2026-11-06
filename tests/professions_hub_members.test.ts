// @vitest-environment happy-dom
// A REAL member painter inside a real Professions hub (menu consolidation
// step 1): the Harvest Journal paints the shared strip under its title bar,
// takes the hub title and close name, re-wires the strip after its own
// rebuilds, and keeps keyboard focus on a hub tab across a rebuild (the
// focus-key carry the hub stamps on every tab).
import { beforeEach, describe, expect, it } from 'vitest';
import { FARM_PATCHES } from '../src/sim/content/farm_patches';
import { HarvestJournalWindow } from '../src/ui/hud/professions/harvest_journal_window';
import {
  ProfessionsHubController,
  type ProfessionsHubMember,
} from '../src/ui/hud/professions/professions_hub_controller';
import type { ProfessionsHubTab } from '../src/ui/hud/professions/professions_hub_view';
import { setLanguage } from '../src/ui/i18n';
import type { IWorld } from '../src/world_api';

class StubWorld {
  myFarmPlots = [];
  get farmPatches() {
    return FARM_PATCHES;
  }
  get professionsState() {
    return { skills: [{ professionId: 'farming', skill: 10, maxSkill: 100 }] };
  }
  farmNowMs(): number {
    return 0;
  }
}

function fakeMember(id: string): ProfessionsHubMember & { opened: number } {
  const el = document.createElement('div');
  el.id = id;
  document.body.appendChild(el);
  const member = {
    isOpen: false,
    opened: 0,
    open() {
      member.isOpen = true;
      member.opened++;
    },
    close() {
      member.isOpen = false;
    },
    rootElement: () => el,
  };
  return member;
}

let root: HTMLElement;
let journal: HarvestJournalWindow;
let hub: ProfessionsHubController;
let others: Record<Exclude<ProfessionsHubTab, 'harvest'>, ReturnType<typeof fakeMember>>;

beforeEach(() => {
  setLanguage('en');
  document.body.innerHTML = '';
  localStorage.clear();
  root = document.createElement('div');
  root.id = 'harvest-journal-window';
  root.className = 'window panel';
  root.style.display = 'none';
  document.body.appendChild(root);
  others = {
    overview: fakeMember('professions-window'),
    crafting: fakeMember('crafting-window'),
    perfecting: fakeMember('perfecting-window'),
  };
  const world = new StubWorld();
  hub = new ProfessionsHubController({
    members: () => ({ ...others, harvest: journal }),
    touch: () => false,
  });
  journal = new HarvestJournalWindow({
    root: () => root,
    world: () => world as unknown as IWorld,
    closeOthers: () => {},
    captureFocus: () => null,
    restoreFocus: () => {},
    hubStrip: hub.stripFor('harvest'),
  });
});

const hubTab = (id: string) => root.querySelector<HTMLElement>(`.prof-hub-tab[data-tab="${id}"]`);

describe('the Harvest Journal as a hub member', () => {
  it('paints the shared strip under the title bar with its own tab selected', () => {
    hub.open('harvest');
    const strip = root.querySelector('.prof-hub-tabs');
    expect(strip).not.toBeNull();
    expect(strip?.previousElementSibling?.classList.contains('panel-title')).toBe(true);
    expect(
      [...root.querySelectorAll<HTMLElement>('.prof-hub-tab')].map((tab) => [
        tab.textContent,
        tab.getAttribute('aria-selected'),
      ]),
    ).toEqual([
      ['Overview', 'false'],
      ['Crafting', 'false'],
      ['Perfecting', 'false'],
      ['Harvest Journal', 'true'],
    ]);
  });

  it('takes the hub title and a close button named for the whole hub', () => {
    hub.open('harvest');
    expect(root.querySelector('#harvest-journal-title')?.textContent).toBe('Professions');
    expect(root.querySelector('[data-close]')?.getAttribute('aria-label')).toBe(
      'Close professions',
    );
  });

  it('keeps keyboard focus on the hub tab across its own rebuild', () => {
    hub.open('harvest');
    hubTab('harvest')?.focus();
    expect(document.activeElement).toBe(hubTab('harvest'));
    // relocalize() forces one full rebuild of the window body (strip included).
    journal.relocalize();
    expect(document.activeElement).toBe(hubTab('harvest'));
    expect(document.activeElement?.getAttribute('data-focus-key')).toBe('profHub:harvest');
  });

  it('re-wires the strip after a rebuild: a click still switches tabs', () => {
    hub.open('harvest');
    journal.relocalize();
    hubTab('crafting')?.click();
    expect(journal.isOpen).toBe(false);
    expect(others.crafting.isOpen).toBe(true);
  });
});
