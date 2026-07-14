import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HotbarAction } from '../src/ui/hotbar';
import { Hud } from '../src/ui/hud';

vi.mock('../src/render/characters', () => ({ CharacterPreview: class {} }));
vi.mock('../src/render/characters/assets', () => ({ preloadMechAssets: vi.fn() }));
vi.mock('../src/render/characters/portrait', () => ({
  onPortraitsReady: vi.fn(),
  playerPortraitDataUrl: vi.fn(),
  visualPortraitDataUrl: vi.fn(),
}));

const BAR_SLOTS = 22;

type HotbarHarness = {
  sim: {
    cfg: { playerClass: string };
    player: { name: string; auras: { kind: string }[] };
    known: { def: { id: string } }[];
    cupInfo: { match: { team: number | null } } | null;
  };
  activeHotbarForm: string;
  hotbarActions: HotbarAction[];
  loadedSlotMapFromStorage: boolean;
  knownAbilityIdsAtLastSlotSync: Set<string> | null;
  dragAction: null;
  mobileActionPage: number;
  mobileHotbarDrag: {
    pointerId: number;
    sourceIndex: number;
    startX: number;
    startY: number;
    active: boolean;
    timer: number;
    targetIndex: number | null;
  } | null;
  playerHotbarForm(): string;
  formKitAbilityIds(form: string): string[];
  saveSlotMap(): void;
  syncActiveHotbarForm(): void;
  syncSlotMap(): void;
};

function bar(...abilityIds: string[]): HotbarAction[] {
  return Array.from({ length: BAR_SLOTS }, (_, index) => {
    const id = abilityIds[index];
    return id ? { type: 'ability' as const, id } : null;
  });
}

function makeHarness(
  playerClass: string,
  knownAbilityIds: string[],
  initialBar: HotbarAction[],
): HotbarHarness {
  const hud = Object.create(Hud.prototype) as HotbarHarness;
  hud.sim = {
    cfg: { playerClass },
    player: { name: 'ActionbarTester', auras: [] },
    known: knownAbilityIds.map((id) => ({ def: { id } })),
    cupInfo: null,
  };
  hud.activeHotbarForm = 'normal';
  hud.hotbarActions = initialBar;
  hud.loadedSlotMapFromStorage = false;
  hud.knownAbilityIdsAtLastSlotSync = null;
  hud.dragAction = null;
  hud.mobileActionPage = 0;
  hud.mobileHotbarDrag = null;
  return hud;
}

function storageStub(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  } as Storage;
}

beforeEach(() => {
  vi.stubGlobal('localStorage', storageStub());
  vi.stubGlobal('document', {
    body: { classList: { remove: vi.fn() } },
    querySelectorAll: () => [],
  });
  vi.stubGlobal('window', { clearTimeout: vi.fn() });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('stealth action-bar persistence', () => {
  it('keeps the Rogue normal and stealth pages independently editable', () => {
    const normal = bar('sinister_strike', 'stealth');
    const stealth = bar('ambush', 'garrote', 'stealth');
    const hud = makeHarness('rogue', ['sinister_strike', 'stealth', 'ambush', 'garrote'], normal);

    hud.sim.player.auras = [{ kind: 'stealth' }];
    hud.syncActiveHotbarForm();
    expect(hud.activeHotbarForm).toBe('stealth');
    expect(hud.hotbarActions).toEqual(bar());

    hud.hotbarActions = stealth;
    hud.saveSlotMap();
    hud.sim.player.auras = [];
    hud.syncActiveHotbarForm();
    expect(hud.activeHotbarForm).toBe('normal');
    expect(hud.hotbarActions).toEqual(normal);

    hud.sim.player.auras = [{ kind: 'stealth' }];
    hud.syncActiveHotbarForm();
    expect(hud.hotbarActions).toEqual(stealth);
  });

  it('migrates a legacy Rogue clone to blank without overwriting later customization', () => {
    const normal = bar('sinister_strike', 'stealth');
    const customStealth = bar('garrote', 'stealth');
    const hud = makeHarness('rogue', ['sinister_strike', 'stealth', 'garrote'], normal);
    localStorage.setItem('woc_hotbar_rogue_ActionbarTester_stealth', JSON.stringify(normal));

    hud.sim.player.auras = [{ kind: 'stealth' }];
    hud.syncActiveHotbarForm();
    expect(hud.hotbarActions).toEqual(bar());

    hud.hotbarActions = customStealth;
    hud.saveSlotMap();
    hud.sim.player.auras = [];
    hud.syncActiveHotbarForm();
    hud.sim.player.auras = [{ kind: 'stealth' }];
    hud.syncActiveHotbarForm();

    expect(hud.hotbarActions).toEqual(customStealth);
  });

  it('preserves a pre-existing customized Rogue stealth page during migration', () => {
    const normal = bar('sinister_strike', 'stealth');
    const customStealth = bar('garrote', 'stealth');
    const hud = makeHarness('rogue', ['sinister_strike', 'stealth', 'garrote'], normal);
    localStorage.setItem('woc_hotbar_rogue_ActionbarTester_stealth', JSON.stringify(customStealth));

    hud.sim.player.auras = [{ kind: 'stealth' }];
    hud.syncActiveHotbarForm();

    expect(hud.hotbarActions).toEqual(customStealth);
  });

  it('preserves distinct raw storage that only normalizes to the parent layout', () => {
    const normal = bar('sinister_strike', 'stealth');
    const legacyEncoded = normal.map((action) => (action?.type === 'ability' ? action.id : action));
    const hud = makeHarness('rogue', ['sinister_strike', 'stealth'], normal);
    localStorage.setItem('woc_hotbar_rogue_ActionbarTester', JSON.stringify(normal));
    localStorage.setItem('woc_hotbar_rogue_ActionbarTester_stealth', JSON.stringify(legacyEncoded));

    hud.sim.player.auras = [{ kind: 'stealth' }];
    hud.syncActiveHotbarForm();

    expect(hud.hotbarActions).toEqual(normal);
  });

  it('retries clone migration when persisting the blank page fails', () => {
    const normal = bar('sinister_strike', 'stealth');
    const normalKey = 'woc_hotbar_rogue_ActionbarTester';
    const stealthKey = `${normalKey}_stealth`;
    const markerKey = `${stealthKey}_blank_v1`;
    const storage = storageStub();
    storage.setItem(normalKey, JSON.stringify(normal));
    storage.setItem(stealthKey, JSON.stringify(normal));
    const write = storage.setItem.bind(storage);
    const blankJson = JSON.stringify(bar());
    let failBlankWrite = true;
    storage.setItem = (key, value) => {
      if (failBlankWrite && key === stealthKey && value === blankJson) {
        throw new Error('quota exceeded');
      }
      write(key, value);
    };
    vi.stubGlobal('localStorage', storage);

    const firstHud = makeHarness('rogue', ['sinister_strike', 'stealth'], normal);
    firstHud.sim.player.auras = [{ kind: 'stealth' }];
    firstHud.syncActiveHotbarForm();
    expect(firstHud.hotbarActions).toEqual(bar());
    expect(storage.getItem(markerKey)).toBeNull();

    failBlankWrite = false;
    const retryHud = makeHarness('rogue', ['sinister_strike', 'stealth'], normal);
    retryHud.sim.player.auras = [{ kind: 'stealth' }];
    retryHud.syncActiveHotbarForm();
    expect(retryHud.hotbarActions).toEqual(bar());
    expect(storage.getItem(markerKey)).toBe('1');
  });

  it('preserves an intentionally empty Rogue stealth page', () => {
    const normal = bar('sinister_strike', 'stealth');
    const hud = makeHarness('rogue', ['sinister_strike', 'stealth'], normal);

    hud.sim.player.auras = [{ kind: 'stealth' }];
    hud.syncActiveHotbarForm();
    hud.hotbarActions = bar();
    hud.saveSlotMap();

    hud.sim.player.auras = [];
    hud.syncActiveHotbarForm();
    hud.sim.player.auras = [{ kind: 'stealth' }];
    hud.syncActiveHotbarForm();

    expect(hud.hotbarActions).toEqual(bar());
    hud.knownAbilityIdsAtLastSlotSync = new Set(['sinister_strike', 'stealth']);
    hud.sim.known = ['sinister_strike', 'stealth', 'ambush'].map((id) => ({ def: { id } }));
    hud.syncSlotMap();
    expect(hud.hotbarActions).toEqual(bar());
  });

  it('keeps the Druid caster, Wolf, and stealthed Wolf pages independently editable', () => {
    const caster = bar('wrath', 'moonfire', 'cat_form');
    const wolf = bar('claw', 'rip', 'prowl', 'cat_form');
    const stealthedWolf = bar('pounce', 'rake', 'prowl', 'cat_form');
    const hud = makeHarness(
      'druid',
      ['wrath', 'moonfire', 'cat_form', 'claw', 'rip', 'prowl', 'rake', 'pounce'],
      caster,
    );

    hud.sim.player.auras = [{ kind: 'form_cat' }];
    hud.syncActiveHotbarForm();
    expect(hud.activeHotbarForm).toBe('cat');
    hud.hotbarActions = wolf;
    hud.saveSlotMap();

    hud.sim.player.auras = [{ kind: 'form_cat' }, { kind: 'stealth' }];
    hud.syncActiveHotbarForm();
    expect(hud.activeHotbarForm).toBe('cat_stealth');
    expect(hud.hotbarActions).toEqual(bar());
    hud.hotbarActions = stealthedWolf;
    hud.saveSlotMap();

    hud.sim.player.auras = [{ kind: 'form_cat' }];
    hud.syncActiveHotbarForm();
    expect(hud.activeHotbarForm).toBe('cat');
    expect(hud.hotbarActions).toEqual(wolf);

    hud.sim.player.auras = [];
    hud.syncActiveHotbarForm();
    expect(hud.activeHotbarForm).toBe('normal');
    expect(hud.hotbarActions).toEqual(caster);

    hud.sim.player.auras = [{ kind: 'form_cat' }];
    hud.syncActiveHotbarForm();
    expect(hud.hotbarActions).toEqual(wolf);
    hud.sim.player.auras = [{ kind: 'form_cat' }, { kind: 'stealth' }];
    hud.syncActiveHotbarForm();
    expect(hud.hotbarActions).toEqual(stealthedWolf);
  });

  it('migrates a legacy Wolf clone to blank', () => {
    const wolf = bar('claw', 'prowl', 'cat_form');
    const hud = makeHarness('druid', ['cat_form', 'claw', 'prowl', 'rake'], wolf);
    hud.activeHotbarForm = 'cat';
    localStorage.setItem('woc_hotbar_druid_ActionbarTester_cat', JSON.stringify(wolf));
    localStorage.setItem('woc_hotbar_druid_ActionbarTester_cat_stealth', JSON.stringify(wolf));

    hud.sim.player.auras = [{ kind: 'form_cat' }, { kind: 'stealth' }];
    hud.syncActiveHotbarForm();

    expect(hud.activeHotbarForm).toBe('cat_stealth');
    expect(hud.hotbarActions).toEqual(bar());
  });

  it('preserves a completely empty stealthed Wolf page', () => {
    const caster = bar('wrath', 'cat_form');
    const wolf = bar('claw', 'prowl', 'cat_form');
    const hud = makeHarness('druid', ['wrath', 'cat_form', 'claw', 'prowl', 'pounce'], caster);

    hud.sim.player.auras = [{ kind: 'form_cat' }];
    hud.syncActiveHotbarForm();
    hud.hotbarActions = wolf;
    hud.saveSlotMap();
    hud.sim.player.auras = [{ kind: 'form_cat' }, { kind: 'stealth' }];
    hud.syncActiveHotbarForm();
    hud.hotbarActions = bar();
    hud.saveSlotMap();

    hud.sim.player.auras = [{ kind: 'form_cat' }];
    hud.syncActiveHotbarForm();
    hud.sim.player.auras = [{ kind: 'stealth' }, { kind: 'form_cat' }];
    hud.syncActiveHotbarForm();

    expect(hud.hotbarActions).toEqual(bar());
    hud.syncSlotMap();
    expect(hud.hotbarActions).toEqual(bar());
  });

  it('does not seed a default kit onto the Wolf stealth page', () => {
    const hud = makeHarness(
      'druid',
      ['wrath', 'cat_form', 'claw', 'prowl', 'rake', 'pounce'],
      bar('wrath'),
    );

    const kit = hud.formKitAbilityIds('cat_stealth');

    expect(kit).toEqual([]);
  });

  it('does not auto-place newly learned abilities or the form toggle on the stealth page', () => {
    const hud = makeHarness('druid', ['wrath', 'cat_form', 'prowl'], bar('prowl'));
    hud.activeHotbarForm = 'cat_stealth';
    hud.loadedSlotMapFromStorage = true;
    hud.knownAbilityIdsAtLastSlotSync = new Set(['wrath', 'cat_form', 'prowl']);
    hud.sim.known = ['wrath', 'cat_form', 'prowl', 'moonfire', 'pounce'].map((id) => ({
      def: { id },
    }));

    hud.syncSlotMap();

    expect(hud.hotbarActions).toEqual(bar('prowl'));
  });

  it('keeps the Vale Cup sport page ahead of every class stealth page', () => {
    const rogue = makeHarness('rogue', ['stealth'], bar('stealth'));
    rogue.sim.cupInfo = { match: { team: 0 } };
    rogue.sim.player.auras = [{ kind: 'stealth' }];

    const druid = makeHarness('druid', ['cat_form', 'prowl'], bar('cat_form'));
    druid.sim.cupInfo = { match: { team: 1 } };
    druid.sim.player.auras = [{ kind: 'stealth' }, { kind: 'form_cat' }];

    expect(rogue.playerHotbarForm()).toBe('sport');
    expect(druid.playerHotbarForm()).toBe('sport');
  });

  it('cancels a mobile drag before loading a different stealth page', () => {
    const hud = makeHarness('rogue', ['sinister_strike', 'stealth'], bar('stealth'));
    hud.mobileHotbarDrag = {
      pointerId: 7,
      sourceIndex: 2,
      startX: 10,
      startY: 20,
      active: true,
      timer: 99,
      targetIndex: 4,
    };

    hud.sim.player.auras = [{ kind: 'stealth' }];
    hud.syncActiveHotbarForm();

    expect(hud.mobileHotbarDrag).toBeNull();
    expect(window.clearTimeout).toHaveBeenCalledWith(99);
  });
});
