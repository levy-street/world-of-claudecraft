// @vitest-environment happy-dom
//
// Focused integration regression for the Field Kit + Professions shared
// picker HUD glue (Intentional Gathering PR3), driven against REAL seams
// only: the real HarvestPreferenceController, the real FocusManager +
// makeWindowFocus bridge every other window uses, the real
// syncWindowOpenBodyClasses scan, and the real professions-entry markup/wire
// pair (harvestPreferenceEntryHtml + wireHarvestEntries). No Hud instance is
// constructed (it is a monolith with no test-only construction path, the
// tests/farming_windows_body_class.test.ts precedent); the hud.ts glue this
// file cannot drive directly (the event-routing case, the closeAll case, the
// relocalize fan-out, the professions dep wiring) is proven by a source scan
// against the real file, the same "hud wires..." idiom that precedent uses,
// never by an invented stand-in function.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HarvestPreference } from '../src/sim/professions/harvest_preference';
import type { SimEvent } from '../src/sim/types';
import { FocusManager } from '../src/ui/focus_manager';
import { Hud } from '../src/ui/hud';
import { HarvestPreferenceController } from '../src/ui/hud/professions/harvest_preference_controller';
import {
  harvestPreferenceEntryHtml,
  harvestPreferenceLocalSig,
  wireHarvestEntries,
} from '../src/ui/hud/professions/professions_harvest_entry_controller';
import { makeWindowFocus } from '../src/ui/window_focus';
import { syncWindowOpenBodyClasses } from '../src/ui/window_open_state';
import type { IWorld } from '../src/world_api';
import { stripComments } from './helpers/strip_comments';

// happy-dom rewrites import.meta.url to an http scheme (the localization_fixes idiom).
const repoRoot = process.cwd();

class StubWorld {
  harvestPreference: HarvestPreference | null = { kind: 'all' };
  setHarvestPreference = vi.fn<(raw: string) => void>();
}

type PreferenceWorld = Pick<IWorld, 'harvestPreference' | 'setHarvestPreference'>;

const isVisible = (el: HTMLElement): boolean => getComputedStyle(el).display !== 'none';

function radioRows(root: HTMLElement): HTMLButtonElement[] {
  return [...root.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
}

let root: HTMLElement;
let world: StubWorld;
let currentWorld: PreferenceWorld;
let controller: HarvestPreferenceController;

beforeEach(() => {
  document.body.className = '';
  document.body.innerHTML =
    '<div id="harvest-preference-window" class="window panel" style="display:none"></div>' +
    '<div id="professions-window" class="window panel" style="display:none"></div>';
  root = document.getElementById('harvest-preference-window') as HTMLElement;
  world = new StubWorld();
  currentWorld = world as unknown as PreferenceWorld;
  const windowFocus = makeWindowFocus(new FocusManager(), () => root);
  controller = new HarvestPreferenceController({
    root: () => root,
    world: () => currentWorld,
    closeOthers: () => {},
    captureFocus: windowFocus.captureFocus,
    restoreFocus: windowFocus.restoreFocus,
    onVisibilityChange: () => syncWindowOpenBodyClasses(isVisible),
  });
});

describe('shared picker: real focus bridge + body-class mirror', () => {
  it('open/close installs and releases the ONE shared FocusManager trap, no independent listener', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    controller.open();
    expect(addSpy.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(1);
    controller.close();
    expect(removeSpy.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(1);
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it('follows real open/close for the mobile body-class mirror, exactly like every other window', () => {
    expect(document.body.classList.contains('mobile-window-open')).toBe(false);
    controller.open();
    expect(document.body.classList.contains('mobile-window-open')).toBe(true);
    controller.close();
    expect(document.body.classList.contains('mobile-window-open')).toBe(false);
  });
});

describe('shared entry: the real professions entry markup + wiring open the real controller', () => {
  it('clicking the rendered entry opens the SAME controller, showing the current preference, without changing it', () => {
    world.harvestPreference = { kind: 'material', itemId: 'rough_hide' };
    const entryRoot = document.createElement('div');
    entryRoot.innerHTML = harvestPreferenceEntryHtml(world.harvestPreference, true);
    // The real wiring pair: no invented handler shape, the actual production
    // callback contract professions_window.ts hands wireHarvestEntries.
    wireHarvestEntries(entryRoot, { openHarvestPreference: () => controller.open() });

    const button = entryRoot.querySelector<HTMLButtonElement>('[data-harvest-preference]');
    expect(button).not.toBeNull();
    // Real remembered-choice subtitle, resolved through the same
    // knownItemDef/itemDisplayName path the picker itself uses.
    expect(button?.textContent).toContain('Rough Hide');

    button?.click();

    expect(controller.isOpen).toBe(true);
    const checked = radioRows(root).find((r) => r.getAttribute('aria-checked') === 'true');
    expect(checked?.dataset.token).toBe('rough_hide');
    expect(world.setHarvestPreference).not.toHaveBeenCalled();
  });

  it('omits the entry entirely when the host has not wired it (no dead button)', () => {
    const entryRoot = document.createElement('div');
    entryRoot.innerHTML = harvestPreferenceEntryHtml(world.harvestPreference, false);
    expect(entryRoot.innerHTML).toBe('');
  });
});

describe('harvestPreferenceLocalSig: the pure repaint-signature extension professions_window.ts shares', () => {
  it('an "all" preference and null resolve to distinct signatures', () => {
    expect(harvestPreferenceLocalSig({ kind: 'all' })).toEqual(['all', null]);
    expect(harvestPreferenceLocalSig(null)).toEqual([null, null]);
  });

  it('a material preference carries the item id, so switching materials moves the signature', () => {
    expect(harvestPreferenceLocalSig({ kind: 'material', itemId: 'rough_hide' })).toEqual([
      'material',
      'rough_hide',
    ]);
    expect(harvestPreferenceLocalSig({ kind: 'material', itemId: 'sharp_fang' })).not.toEqual(
      harvestPreferenceLocalSig({ kind: 'material', itemId: 'rough_hide' }),
    );
  });

  it('undefined (a stub IWorld predating the field) reads exactly like a malformed null preference', () => {
    expect(harvestPreferenceLocalSig(undefined)).toEqual(harvestPreferenceLocalSig(null));
  });
});

describe('hud.ts wiring (source scan against the real file, the farming_windows_body_class idiom)', () => {
  const hud = stripComments(readFileSync(join(repoRoot, 'src/ui/hud.ts'), 'utf8'));

  it('routes the personal harvestPreferenceOpen event to the controller', () => {
    const start = hud.indexOf("case 'harvestPreferenceOpen':");
    expect(start, 'harvestPreferenceOpen case found').toBeGreaterThan(-1);
    const end = hud.indexOf("case 'harvestResult':", start);
    expect(end, 'end anchor past start').toBeGreaterThan(start);
    expect(hud.slice(start, end)).toContain('this.harvestPreferenceController.open();');
  });

  it('closeAll routes the window id through the controller, focus-returning close', () => {
    const start = hud.indexOf("case 'harvest-preference-window':");
    expect(start, 'harvest-preference-window case found').toBeGreaterThan(-1);
    const end = hud.indexOf('break;', start);
    expect(end, 'end anchor past start').toBeGreaterThan(start);
    expect(hud.slice(start, end)).toContain('this.harvestPreferenceController.close();');
  });

  it('the language-switch fan-out reaches the controller', () => {
    expect(hud).toContain('this.harvestPreferenceController.relocalize();');
  });

  it('the Professions window is wired to open the SAME controller', () => {
    const start = hud.indexOf('private readonly professionsWindow = new ProfessionsWindow({');
    expect(start, 'professionsWindow construction found').toBeGreaterThan(-1);
    const end = hud.indexOf(
      'private readonly harvestPreferenceController = new HarvestPreferenceController({',
      start,
    );
    expect(end, 'end anchor past start').toBeGreaterThan(start);
    expect(hud.slice(start, end)).toContain(
      'openHarvestPreference: () => this.harvestPreferenceController.open()',
    );
  });
});

describe('the spectator bug: the generic pid gate is not enough for harvestPreferenceOpen', () => {
  // Online, the server's event router maps a spectating moderator's session
  // to the ANCHOR's pid and delivers the anchor's personal events; ClientWorld's
  // applySnapshot re-anchors `playerId` to that same pid while spectating (see
  // src/net/CLAUDE.md, applySnapshot). So the generic `ev.pid !== sim.playerId`
  // gate at the top of handleEvents PASSES the anchor's own harvestPreferenceOpen
  // event straight through to a spectating moderator, who never asked for it.
  // This drives the real Hud.prototype.handleEvents (no test-local routing
  // stand-in) against a bare Object.create fixture, stubbing only the
  // per-event side effects this event's siblings might otherwise touch.
  const ANCHOR_PID = 7;

  // A standalone structural type, deliberately NOT intersected with `Hud`
  // itself: `Hud & { sim: unknown; ... }` collapses to `never` because
  // several of these field names (prevCraftSkills, craftTierUpDrains, ...)
  // are PRIVATE on the real class, and TS refuses an intersection where a
  // private member's declaring class differs. `handleEvents` is typed off
  // `Hud['handleEvents']` so the call below is the REAL public method's
  // exact signature; every other field the method body touches is named
  // here as `unknown` and assigned through it, never read back as Hud.
  interface HudTestHarness {
    handleEvents: Hud['handleEvents'];
    sim: unknown;
    renderer: unknown;
    meters: unknown;
    harvestPreferenceController: unknown;
    isNythraxisEvent: unknown;
    playEventSfx: unknown;
    prevCraftSkills: unknown;
    prevCraftSkillLevels: unknown;
    prevGatheringSkillLevels: unknown;
    craftTierUpDrains: unknown;
  }

  function makeHud(spectating: string | null): {
    hud: HudTestHarness;
    open: ReturnType<typeof vi.fn>;
  } {
    const open = vi.fn();
    const sim = {
      playerId: ANCHOR_PID,
      spectating,
      entities: new Map(),
      craftingIdentity: { synced: false },
      craftSkills: {},
      gatheringProficiency: {},
    };
    // Object.create(Hud.prototype) puts the REAL Hud.prototype.handleEvents
    // on the returned object's prototype chain; only the instance fields
    // that method's body reaches are stamped on directly.
    const hud = Object.create(Hud.prototype) as HudTestHarness;
    hud.sim = sim;
    hud.renderer = { handleEvent: vi.fn() };
    hud.meters = { onEvent: vi.fn() };
    hud.harvestPreferenceController = { open };
    hud.isNythraxisEvent = () => false;
    hud.playEventSfx = () => {};
    hud.prevCraftSkills = null;
    hud.prevCraftSkillLevels = null;
    hud.prevGatheringSkillLevels = null;
    hud.craftTierUpDrains = 0;
    return { hud, open };
  }

  const evFor = (pid: number): SimEvent[] => [{ type: 'harvestPreferenceOpen', pid }];

  it("opens for the viewer's own pid event, not spectating", () => {
    const { hud, open } = makeHud(null);
    hud.handleEvents(evFor(ANCHOR_PID));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('never opens for a foreign pid event, not spectating', () => {
    const { hud, open } = makeHud(null);
    hud.handleEvents(evFor(ANCHOR_PID + 1));
    expect(open).not.toHaveBeenCalled();
  });

  it("never opens for the spectated anchor's own event while spectating", () => {
    const { hud, open } = makeHud('SomeAnchorName');
    // The generic gate alone would pass this: sim.playerId reads the anchor's
    // pid while spectating, matching the event's pid exactly.
    hud.handleEvents(evFor(ANCHOR_PID));
    expect(open).not.toHaveBeenCalled();
  });
});
