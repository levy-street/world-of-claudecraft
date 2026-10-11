// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ABILITIES } from '../src/sim/content/classes';
import type { ResolvedAbility } from '../src/sim/sim';
import type { ActionBarWorldInput } from '../src/ui/hud/action_bar/action_bar_view';
import {
  COOLDOWN_WORLD_FIELDS,
  CooldownManagerController,
  type CooldownManagerWorld,
} from '../src/ui/hud/cooldown_manager/cooldown_manager_controller';
import { CooldownManagerSettingsPanel } from '../src/ui/hud/cooldown_manager/cooldown_manager_settings';
import type { PainterHostWriters } from '../src/ui/painter_host';

// Additive, never bare: only the canvas-touching iconDataUrl is stubbed (the
// Other Spells section draws procedural icons, and happy-dom has no canvas).
vi.mock('../src/ui/icons', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/ui/icons')>()),
  iconDataUrl: () => 'data:,',
}));

const CUE = 'ui_aura_hard_bell';

beforeEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

const writers = {
  toggleClass: (el: HTMLElement, cls: string, on: boolean) => el.classList.toggle(cls, on),
  setText: (el: HTMLElement, text: string) => {
    el.textContent = text;
  },
  setStyleProp: (el: HTMLElement, prop: string, value: string) => {
    el.style.setProperty(prop, value);
  },
} as unknown as PainterHostWriters;

function resolved(id: string): ResolvedAbility {
  const def = ABILITIES[id];
  return { def, cost: 10, cooldown: def.cooldown, effects: [] } as unknown as ResolvedAbility;
}

/** A druid that knows Flense (rake), Rendclaw (claw) and Gorebite (ferocious_bite). */
function rig(opts: { inCombat?: boolean; extra?: string[] } = {}) {
  const known = ['rake', 'claw', 'ferocious_bite', ...(opts.extra ?? [])].map(resolved);
  const world = {
    cfg: { playerClass: 'druid' },
    player: { name: 'Bob', inCombat: opts.inCombat ?? false },
    known,
    entities: new Map(),
    resolvedAbility: (id: string) => known.find((ability) => ability.def.id === id) ?? null,
  } as unknown as CooldownManagerWorld & { player: { inCombat: boolean } };
  const cues: [string, number][] = [];
  let auraGlow: ReadonlySet<string> = new Set();
  const controller = new CooldownManagerController({
    world,
    writers,
    playCue: (id, volume) => cues.push([id, volume]),
    auraGlowIds: () => auraGlow,
  });
  const cooldowns = new Map<string, number>();
  const snapshot = {
    player: {
      id: 1,
      autoAttack: false,
      dead: false,
      resource: 100,
      resourceType: 'energy',
      savedMana: 0,
      cooldowns,
      gcdRemaining: 0,
      potionCdRemaining: 0,
      queuedOnSwing: null,
      pos: { x: 0, y: 0, z: 0 },
      auras: [{ kind: 'form_cat' }],
    },
    target: null,
    inventory: [],
    stealthed: false,
    entities: [],
    activeAimSlot: null,
  } as unknown as ActionBarWorldInput;
  return {
    controller,
    hooks: controller.settingsHooks(),
    world,
    cooldowns,
    snapshot,
    cues,
    setAuraGlow: (ids: string[]) => {
      auraGlow = new Set(ids);
    },
    layer: () => document.getElementById('cooldown-manager') as HTMLElement,
  };
}

describe('CooldownManagerController', () => {
  it('builds one floating group per kind with explicit grid cells, aria-hidden', () => {
    const { hooks, layer } = rig();
    const line = hooks.addGroup('line') as string;
    const grid = hooks.addGroup('grid') as string;
    const single = hooks.addGroup('single') as string;
    hooks.assign('rake', line);
    hooks.assign('claw', line);
    hooks.assign('ferocious_bite', single);
    hooks.patchGroup(grid, { perLine: 2 });
    expect(layer().getAttribute('aria-hidden')).toBe('true');
    const groups = Array.from(layer().querySelectorAll<HTMLElement>('.cdm-group'));
    expect(groups.map((g) => g.dataset.group)).toEqual([line, grid, single]);
    expect(groups[0].classList.contains('cdm-group--line')).toBe(true);
    const cells = Array.from(groups[0].querySelectorAll<HTMLElement>('.cdm-btn')).map((b) => [
      b.style.gridColumn,
      b.style.gridRow,
    ]);
    expect(cells).toEqual([
      ['1', '1'],
      ['2', '1'],
    ]);
    // A spell sits in one group: moving it empties its old slot.
    hooks.assign('claw', single);
    expect(hooks.groups().find((g) => g.id === single)?.spells).toEqual(['ferocious_bite']);
    hooks.assign('claw', grid);
    expect(hooks.groups().find((g) => g.id === line)?.spells).toEqual(['rake']);
  });

  it('never drains the shared entity iterator the action bar reads after it', () => {
    // The Hud hands every action-bar-family view ONE snapshot whose `entities`
    // is a single-use Map iterator. The manager paints first, so if its inner
    // bar view walked that iterator (a tracked Dominion summon does), the
    // desktop bar would then see no servants and misread its summon gate.
    const { hooks, controller, snapshot } = rig({ extra: ['raise_skeletal_warrior'] });
    hooks.assign('raise_skeletal_warrior', hooks.addGroup('line'));
    let pulls = 0;
    const servants = [{ id: 7 }];
    snapshot.entities = {
      [Symbol.iterator]() {
        pulls++;
        return servants[Symbol.iterator]();
      },
    } as unknown as ActionBarWorldInput['entities'];
    const shared = snapshot.entities;
    controller.paint(snapshot);
    expect(snapshot.entities).toBe(shared);
    expect(pulls).toBe(0);
  });

  it('remembers helpful auras seen on the player and offers them, never a debuff', () => {
    const { controller, hooks, snapshot } = rig();
    (snapshot.player as unknown as { auras: unknown[] }).auras = [
      {
        id: 'trinket_fury',
        kind: 'buff_ap',
        value: 50,
        name: 'Fury of the Ancients',
        remaining: 10,
      },
      { id: 'nasty_curse', kind: 'dot', value: 5, name: 'Curse', remaining: 10 },
    ];
    controller.paint(snapshot);
    const tokens = hooks.auraCatalog().map((entry) => entry.token);
    expect(tokens).toContain('aura:trinket_fury');
    expect(tokens).not.toContain('aura:nasty_curse');
    // The druid's own engines are there before anything was ever seen.
    expect(tokens).toContain('kind:old_blood');
    // Persisted: the next session still offers it.
    document.body.replaceChildren();
    expect(
      rig()
        .hooks.auraCatalog()
        .map((entry) => entry.token),
    ).toContain('aura:trinket_fury');
  });

  it('paints a tracked aura with the buff bar icon, its stacks and time left', () => {
    const { controller, hooks, snapshot, layer } = rig();
    const id = hooks.addGroup('single') as string;
    expect(hooks.assign('kind:old_blood', id)).toBe(true);
    (snapshot.player as unknown as { auras: unknown[] }).auras = [
      { id: 'old_blood', kind: 'old_blood', value: 0, stacks: 2, remaining: 12, name: 'Old Blood' },
    ];
    controller.paint(snapshot);
    const btn = layer().querySelector<HTMLElement>('.cdm-btn');
    expect(btn?.querySelector('.ui-socket-count')?.textContent).toBe('2');
    expect(btn?.querySelector('.ui-socket-cd-text')?.textContent).toBe('12');
    expect(btn?.classList.contains('is-ready')).toBe(true);
    expect(btn?.querySelector<HTMLElement>('.ui-socket-art')?.style.backgroundImage).toContain(
      'url(',
    );
  });

  it('persists groups per character and restores them on the next session', () => {
    const first = rig();
    const id = first.hooks.addGroup('line') as string;
    first.hooks.assign('rake', id);
    first.hooks.patchGroup(id, { orientation: 'vertical', padding: 8 });
    document.body.replaceChildren();
    const second = rig();
    expect(second.hooks.groups()).toMatchObject([
      { id, kind: 'line', spells: ['rake'], orientation: 'vertical', padding: 8 },
    ]);
    // Read the key itself: Object.keys over Storage is not portable (on Node 26
    // it lists the Storage methods rather than the stored keys).
    expect(localStorage.getItem('woc_cooldown_manager:druid:Bob')).not.toBeNull();
  });

  it('plays the spell cue on a ready edge, gated by the combat-only switch', () => {
    const { hooks, controller, snapshot, cues, world, cooldowns } = rig();
    const id = hooks.addGroup('single') as string;
    hooks.assign('rake', id);
    hooks.patchSpell('rake', { soundId: CUE, soundVolume: 0.5 });
    controller.paint(snapshot);
    expect(cues).toEqual([]);
    cooldowns.set('rake', 5);
    controller.paint(snapshot);
    cooldowns.delete('rake');
    controller.paint(snapshot);
    expect(cues).toEqual([[CUE, 0.5]]);

    hooks.patchLayout({ soundInCombatOnly: true });
    cooldowns.set('rake', 5);
    controller.paint(snapshot);
    cooldowns.delete('rake');
    controller.paint(snapshot);
    expect(cues).toHaveLength(1);
    world.player.inCombat = true;
    cooldowns.set('rake', 5);
    controller.paint(snapshot);
    cooldowns.delete('rake');
    controller.paint(snapshot);
    expect(cues).toHaveLength(2);
  });

  it('unions its hotbar glow with the Auras panel set, without allocating per frame', () => {
    const { hooks, controller, snapshot, setAuraGlow, cooldowns } = rig();
    const id = hooks.addGroup('line') as string;
    hooks.assign('rake', id);
    hooks.patchSpell('rake', { hotbarGlow: true });
    controller.paint(snapshot);
    const own = controller.readyGlowAbilityIds();
    expect([...own]).toEqual(['rake']);
    setAuraGlow(['execute']);
    controller.paint(snapshot);
    const union = controller.readyGlowAbilityIds();
    expect([...union].sort()).toEqual(['execute', 'rake']);
    // Built once per frame: the bar asks once per slot, and every later ask
    // until the next paint returns the stored set without rebuilding it.
    setAuraGlow(['judgement']);
    expect(controller.readyGlowAbilityIds()).toBe(union);
    expect([...union].sort()).toEqual(['execute', 'rake']);
    setAuraGlow(['execute']);
    cooldowns.set('rake', 5);
    controller.paint(snapshot);
    expect([...controller.readyGlowAbilityIds()]).toEqual(['execute']);
  });

  it('refreshes every action-bar input field per frame, not a hand-picked few', () => {
    // Required<> makes tsc fail here until a field added to ActionBarWorldInput
    // is added to this sample, and the key check then fails until it is added to
    // COOLDOWN_WORLD_FIELDS, so no field can stay frozen at its first frame.
    const sample: Required<ActionBarWorldInput> = {
      player: {} as ActionBarWorldInput['player'],
      target: null,
      inventory: [],
      stealthed: false,
      paladinSpec: null,
      playerClass: null,
      fateThreads: 0,
      entities: [],
      activeAimSlot: null,
      wornTrinketId: null,
    };
    const refreshed = Object.keys(sample).filter((key) => key !== 'entities');
    expect([...COOLDOWN_WORLD_FIELDS].sort()).toEqual(refreshed.sort());
  });

  it('hides a group by its visibility rule and shows every group while placing', () => {
    const { hooks, controller, snapshot, world, layer } = rig();
    const always = hooks.addGroup('single') as string;
    const combat = hooks.addGroup('single') as string;
    const hidden = hooks.addGroup('single') as string;
    hooks.patchGroup(combat, { visibility: 'combat' });
    hooks.patchGroup(hidden, { visibility: 'hidden' });
    const shown = () =>
      Array.from(layer().querySelectorAll<HTMLElement>('.cdm-group'))
        .filter((g) => g.style.display !== 'none')
        .map((g) => g.dataset.group);
    controller.paint(snapshot);
    expect(shown()).toEqual([always]);
    world.player.inCombat = true;
    controller.paint(snapshot);
    expect(shown()).toEqual([always, combat]);
    hooks.setPlacement(true);
    controller.paint(snapshot);
    expect(shown()).toEqual([always, combat, hidden]);
    expect(layer().classList.contains('placement')).toBe(true);
    hooks.patchLayout({ enabled: false });
    hooks.setPlacement(false);
    controller.paint(snapshot);
    expect(layer().style.display).toBe('none');
  });

  it('restyles a group in place for appearance changes and re-cells it for layout ones', () => {
    const { hooks, layer } = rig();
    const id = hooks.addGroup('grid') as string;
    hooks.assign('rake', id);
    hooks.assign('claw', id);
    const before = layer().querySelector('.cdm-group');
    hooks.patchGroup(id, { opacity: 0.5, showTimer: false });
    const same = layer().querySelector<HTMLElement>('.cdm-group');
    expect(same).toBe(before);
    expect(same?.style.getPropertyValue('--cdm-opacity')).toBe('0.5');
    expect(same?.classList.contains('hide-timer')).toBe(true);
    hooks.patchGroup(id, { orientation: 'vertical', perLine: 1 });
    const recelled = layer().querySelector<HTMLElement>('.cdm-group');
    expect(recelled).not.toBe(before);
    const cells = Array.from(recelled?.querySelectorAll<HTMLElement>('.cdm-btn') ?? []).map(
      (b) => `${b.style.gridColumn},${b.style.gridRow}`,
    );
    expect(cells).toEqual(['1,1', '2,1']);
  });
});

describe('CooldownManagerSettingsPanel', () => {
  function panel() {
    const r = rig();
    const clicks: number[] = [];
    const root = document.createElement('div');
    document.body.appendChild(root);
    const settings = new CooldownManagerSettingsPanel({
      hooks: r.hooks,
      click: () => clicks.push(1),
    });
    settings.render(root);
    return { ...r, root, settings };
  }
  const chips = (root: HTMLElement, section: string) =>
    Array.from(
      root.querySelectorAll<HTMLElement>(
        `.cdm-spell-section[data-group="${section}"] .cdm-spell-chip`,
      ),
    );

  it('adds the three group kinds from their buttons, one card each', () => {
    const { root } = panel();
    for (const kind of ['single', 'grid', 'line']) {
      root.querySelector<HTMLButtonElement>(`.cdm-add--${kind}`)?.click();
    }
    expect(root.querySelectorAll('.cdm-group-card')).toHaveLength(3);
    // A single button has no orientation, direction or padding to choose.
    const [single, grid] = Array.from(root.querySelectorAll<HTMLElement>('.cdm-group-card'));
    expect(single.querySelectorAll('select')).toHaveLength(1);
    expect(grid.querySelectorAll('select')).toHaveLength(3);
  });

  it('lists the whole castable spellbook as Not Displayed until a spell is placed', () => {
    const { root, hooks, settings } = panel();
    const id = hooks.addGroup('line') as string;
    settings.render(root);
    expect(chips(root, '').map((chip) => chip.dataset.focusKey)).toEqual([
      'cdm-spell:rake',
      'cdm-spell:claw',
      'cdm-spell:ferocious_bite',
    ]);
    // Select a spell, then pick its group in the detail card (the keyboard path).
    chips(root, '')[1].click();
    const select = root.querySelector<HTMLSelectElement>('[data-focus-key="cdm-detail-group"]');
    expect(select).not.toBeNull();
    if (!select) return;
    select.value = id;
    select.dispatchEvent(new Event('change'));
    expect(hooks.groups()[0].spells).toEqual(['claw']);
    expect(chips(root, id).map((chip) => chip.dataset.focusKey)).toEqual(['cdm-spell:claw']);
  });

  it('offers every druid spell from every spec, the unknown ones dimmed in Other Spells', () => {
    const { root } = panel();
    const other = chips(root, '__other').map((chip) => chip.dataset.focusKey?.slice(10));
    // The stub druid knows three spells; the rest of the class (other specs,
    // talents, higher levels) is still pickable.
    expect(other.length).toBeGreaterThan(10);
    expect(other).not.toContain('rake');
    expect(other).toContain('regrowth');
    const chip = chips(root, '__other')[0];
    expect(chip.classList.contains('is-unknown')).toBe(true);
    // Placing one works like any other spell: it waits in the group until known.
    const { hooks, settings } = panel();
    const id = hooks.addGroup('line') as string;
    settings.render(root);
    expect(hooks.assign('regrowth', id)).toBe(true);
    expect(hooks.groups()[0].spells).toEqual(['regrowth']);
  });

  it('lists engines and procs, and an aura card offers a stack goal but no hotbar glow', () => {
    const { root, hooks, settings } = panel();
    const auras = chips(root, '__auras').map((chip) => chip.dataset.focusKey);
    expect(auras).toContain('cdm-spell:kind:old_blood');
    const id = hooks.addGroup('line') as string;
    hooks.assign('kind:old_blood', id);
    settings.render(root);
    chips(root, id)[0].click();
    const card = root.querySelector<HTMLElement>('.cdm-detail-card');
    expect(card?.textContent).toContain('Alert at Stacks');
    expect(card?.textContent).not.toContain('Hotbar Glow');
    expect(card?.textContent).toContain('Only Show While Active');
  });

  it('moves a spell by drag and drop onto a group section', () => {
    const { root, hooks, settings } = panel();
    const id = hooks.addGroup('grid') as string;
    settings.render(root);
    const section = root.querySelector<HTMLElement>(`.cdm-spell-section[data-group="${id}"]`);
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', {
      value: {
        getData: (type: string) => (type === 'application/x-woc-cooldown-spell' ? 'rake' : ''),
      },
    });
    section?.dispatchEvent(drop);
    expect(hooks.groups()[0].spells).toEqual(['rake']);
  });

  it('refuses a drop that is not one of the listed spells (stray text, another class)', () => {
    const { root, hooks, settings } = panel();
    const id = hooks.addGroup('grid') as string;
    settings.render(root);
    const section = root.querySelector<HTMLElement>(`.cdm-spell-section[data-group="${id}"]`);
    for (const payload of [
      { type: 'text/plain', id: 'rake' },
      { type: 'application/x-woc-cooldown-spell', id: 'fireball' },
    ]) {
      const drop = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(drop, 'dataTransfer', {
        value: { getData: (type: string) => (type === payload.type ? payload.id : '') },
      });
      section?.dispatchEvent(drop);
    }
    expect(hooks.groups()[0].spells).toEqual([]);
  });

  it('renames a group from its card, and an empty name restores the numbered default', () => {
    const { root, hooks, settings } = panel();
    const id = hooks.addGroup('grid') as string;
    settings.render(root);
    const nameBox = () => root.querySelector<HTMLInputElement>(`[data-focus-key="cdm-name:${id}"]`);
    const title = () => root.querySelector('.cdm-group-card .perf-card-title')?.textContent;
    expect(nameBox()?.value).toBe('');
    expect(nameBox()?.placeholder).toBe(title());
    const defaultName = title();
    const box = nameBox();
    if (!box) throw new Error('no name box');
    box.value = '  Burst  ';
    box.dispatchEvent(new Event('change'));
    expect(hooks.groups()[0].name).toBe('Burst');
    // The card title and the Tracked Spells section follow the new name.
    expect(title()).toBe('Burst');
    expect(
      root.querySelector(`.cdm-spell-section[data-group="${id}"] .cdm-spell-section-title`)
        ?.textContent,
    ).toContain('Burst');
    // The rebuild puts focus back in the (new) name box.
    expect(document.activeElement).toBe(nameBox());
    const again = nameBox();
    if (!again) throw new Error('no name box');
    again.value = '';
    again.dispatchEvent(new Event('change'));
    expect(hooks.groups()[0].name).toBe('');
    expect(title()).toBe(defaultName);
  });

  it('filters every section by spell name as the player types, without a rebuild', () => {
    const { root, hooks, settings } = panel();
    hooks.assign('rake', hooks.addGroup('line'));
    settings.render(root);
    const search = root.querySelector<HTMLInputElement>('.cdm-search');
    expect(search).not.toBeNull();
    if (!search) return;
    search.value = 'CLAW';
    search.dispatchEvent(new Event('input'));
    const visible = Array.from(root.querySelectorAll<HTMLElement>('.cdm-spell-chip'))
      .filter((chip) => !chip.hidden)
      .map((chip) => chip.dataset.focusKey);
    // Rendclaw (known) and Sweeping Claws (another spec's, in Other Spells).
    expect(visible).toEqual(['cdm-spell:claw', 'cdm-spell:swipe']);
    // The query survives a rebuild (a move never clears the search).
    settings.render(root);
    expect(root.querySelector<HTMLInputElement>('.cdm-search')?.value).toBe('CLAW');
  });
});
