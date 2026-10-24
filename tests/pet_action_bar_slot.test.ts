// Pet commands as action-bar slots: the closed id set, the stored-layout parse
// and the server's shape sanitizer, slot placement, the per-slot state a pet
// command paints, and the pad cross hotbar's refusal to seed one.

import { describe, expect, it } from 'vitest';
import { PET_GROWL_INTERVAL } from '../src/sim/types';
import { crossHotbarActionSlot } from '../src/ui/empower_hold_core';
import {
  ActionBarPainter,
  type ActionBarSlotElements,
} from '../src/ui/hud/action_bar/action_bar_painter';
import {
  ABILITY_ICON_PREFIX,
  type ActionBarSlotDescriptor,
  type ActionBarWorldInput,
  createActionBarView,
} from '../src/ui/hud/action_bar/action_bar_view';
import {
  applyLoadoutBar,
  type HotbarAction,
  hotbarPetCommand,
  parseHotbarActions,
  parseStoredHotbarAction,
  placePetOnSlot,
  readHotbarDragData,
  writeHotbarDragData,
} from '../src/ui/hud/action_bar/hotbar';
import {
  isPetSlotCommand,
  PET_SLOT_COMMANDS,
  type PetSlotPet,
  petSlotActive,
  petSlotCooldown,
  petSlotCooldownTotal,
  petSlotIconId,
  petSlotMode,
  petSlotUsable,
} from '../src/ui/hud/action_bar/pet_slot_core';
import { crossHotbarSeedActions } from '../src/ui/hud/cross_hotbar/cross_hotbar_controller';
import type { PainterHostWriters } from '../src/ui/painter_host';
import { PET_ACTION_ICONS } from '../src/ui/pet_action_icons';
import { sanitizeActionBarLayout } from '../src/world_api/action_bar';

const yes = () => true;
const no = () => false;

function pet(over: Partial<PetSlotPet> = {}): PetSlotPet {
  return {
    dead: false,
    templateId: 'forest_wolf',
    petMode: 'defensive',
    petTauntTimer: 0,
    ...over,
  };
}

describe('pet slot command set', () => {
  it('holds exactly the six pet-bar commands', () => {
    expect([...PET_SLOT_COMMANDS].sort()).toEqual(
      ['aggressive', 'assist', 'attack', 'defensive', 'stop', 'taunt'].sort(),
    );
    for (const id of PET_SLOT_COMMANDS) expect(isPetSlotCommand(id)).toBe(true);
    expect(isPetSlotCommand('follow')).toBe(false);
    expect(isPetSlotCommand('passive')).toBe(false);
    expect(isPetSlotCommand('__proto__')).toBe(false);
  });

  it('paints stop with the passive stance art and the rest with their own', () => {
    expect(petSlotIconId('attack')).toBe(PET_ACTION_ICONS.attack);
    expect(petSlotIconId('taunt')).toBe(PET_ACTION_ICONS.taunt);
    expect(petSlotIconId('stop')).toBe(PET_ACTION_ICONS.passive);
    expect(petSlotIconId('defensive')).toBe(PET_ACTION_ICONS.defensive);
    expect(petSlotIconId('aggressive')).toBe(PET_ACTION_ICONS.aggressive);
    // Assist has no art of its own: it wears Pet Attack's.
    expect(petSlotIconId('assist')).toBe(PET_ACTION_ICONS.attack);
    expect(petSlotMode('assist')).toBe('assist');
    expect(petSlotMode('stop')).toBe('passive');
    expect(petSlotMode('attack')).toBeNull();
    expect(petSlotMode('taunt')).toBeNull();
  });
});

describe('stored pet slots', () => {
  it('parses a known pet command and drops an unknown one', () => {
    expect(parseStoredHotbarAction('{"type":"pet","id":"taunt"}', no, no)).toEqual({
      type: 'pet',
      id: 'taunt',
    });
    expect(parseStoredHotbarAction('{"type":"pet","id":"follow"}', yes, yes)).toBeNull();
  });

  it('keeps pet commands in a stored bar and does not dedupe them', () => {
    const parsed = parseHotbarActions(
      [
        { type: 'pet', id: 'attack' },
        { type: 'pet', id: 'attack' },
        { type: 'pet', id: 'nope' },
      ],
      3,
      no,
      no,
    );
    expect(parsed).toEqual([{ type: 'pet', id: 'attack' }, { type: 'pet', id: 'attack' }, null]);
  });

  it('round-trips through the drag payload', () => {
    const data = new Map<string, string>();
    const dt = {
      setData: (k: string, v: string) => data.set(k, v),
      getData: (k: string) => data.get(k) ?? '',
    };
    writeHotbarDragData(dt, { type: 'pet', id: 'stop' });
    expect(readHotbarDragData(dt, no, no)).toEqual({ type: 'pet', id: 'stop' });
    expect(data.get('text/plain')).toBe('stop');
  });

  it('survives the server layout sanitizer, which still rejects unknown types', () => {
    const clean = sanitizeActionBarLayout({
      forms: {
        normal: {
          bar: [
            { type: 'pet', id: 'aggressive' },
            { type: 'macro', id: 'x' },
          ],
          attack: { type: 'pet', id: 'attack' },
        },
      },
    });
    expect(clean?.forms.normal?.bar).toEqual([{ type: 'pet', id: 'aggressive' }, null]);
    expect(clean?.forms.normal?.attack).toEqual({ type: 'pet', id: 'attack' });
  });
});

describe('placing pet slots', () => {
  it('copies a command onto the target slot without clearing another copy', () => {
    const bar: HotbarAction[] = [{ type: 'pet', id: 'attack' }, null, null];
    expect(placePetOnSlot(bar, 'attack', 2)).toEqual([
      { type: 'pet', id: 'attack' },
      null,
      { type: 'pet', id: 'attack' },
    ]);
    expect(placePetOnSlot(bar, 'attack', 9)).toEqual(bar);
  });

  it('keeps pet slots across a talent-loadout bar switch', () => {
    const current: HotbarAction[] = [
      { type: 'pet', id: 'taunt' },
      { type: 'ability', id: 'old' },
    ];
    expect(applyLoadoutBar(current, [null, 'new'], 2, (id) => id === 'new')).toEqual([
      { type: 'pet', id: 'taunt' },
      { type: 'ability', id: 'new' },
    ]);
  });

  it('reads the command back off a slot', () => {
    expect(hotbarPetCommand({ type: 'pet', id: 'defensive' })).toBe('defensive');
    expect(hotbarPetCommand({ type: 'ability', id: 'defensive' })).toBeNull();
    expect(hotbarPetCommand(null)).toBeNull();
  });
});

describe('pet slot state', () => {
  it('greys every command out with no living pet', () => {
    for (const command of PET_SLOT_COMMANDS) {
      expect(petSlotUsable(command, null)).toBe(false);
      expect(petSlotUsable(command, pet({ dead: true }))).toBe(false);
      expect(petSlotActive(command, null)).toBe(false);
      expect(petSlotCooldown(command, null)).toBe(0);
    }
  });

  it('lights only the stance the pet is in, reading an unset mode as defensive', () => {
    expect(petSlotActive('aggressive', pet({ petMode: 'aggressive' }))).toBe(true);
    expect(petSlotActive('defensive', pet({ petMode: 'aggressive' }))).toBe(false);
    expect(petSlotActive('stop', pet({ petMode: 'passive' }))).toBe(true);
    expect(petSlotActive('defensive', pet({ petMode: undefined }))).toBe(true);
    expect(petSlotActive('attack', pet())).toBe(false);
  });

  it('runs the taunt cooldown the pet bar shows, and refuses a pet that cannot taunt', () => {
    const cooling = pet({ petTauntTimer: 4 });
    expect(petSlotCooldown('taunt', cooling)).toBe(4);
    expect(petSlotCooldownTotal('taunt', cooling)).toBe(PET_GROWL_INTERVAL);
    expect(petSlotUsable('taunt', cooling)).toBe(false);
    expect(petSlotUsable('taunt', pet())).toBe(true);
    // Only taunt has a cooldown; the timer never greys out the other commands.
    expect(petSlotCooldown('attack', cooling)).toBe(0);
    expect(petSlotUsable('attack', cooling)).toBe(true);

    const ranged = pet({ templateId: 'water_elemental', petTauntTimer: 3 });
    expect(petSlotUsable('taunt', ranged)).toBe(false);
    // The water elemental's timer is Water Jet's, not a taunt cooldown.
    expect(petSlotCooldown('taunt', ranged)).toBe(0);
  });
});

function world(petInput: PetSlotPet | null): ActionBarWorldInput {
  return {
    player: {
      id: 1,
      autoAttack: false,
      dead: false,
      resource: 100,
      cooldowns: new Map(),
      gcdRemaining: 0,
      potionCdRemaining: 0,
      resourceType: 'mana',
      savedMana: 0,
      queuedOnSwing: null,
      pos: { x: 0, y: 0, z: 0 },
      auras: [],
    },
    target: null,
    inventory: [],
    stealthed: false,
    entities: [],
    activeAimSlot: null,
    pet: petInput,
  } as unknown as ActionBarWorldInput;
}

function petSlot(command: () => HotbarAction): ActionBarSlotDescriptor {
  return {
    slotIndex: 1,
    isAttack: () => false,
    hasAction: () => command() !== null,
    ability: () => null,
    item: () => null,
    petCommand: () => hotbarPetCommand(command()),
    keybindLabel: () => 'K1',
  };
}

const viewDeps = {
  t: (key: string, values?: Record<string, unknown>) =>
    values ? `${key}(${values.slot},${values.ability})` : key,
  abilityName: () => 'ability',
  itemName: () => 'item',
  slotLabel: (i: number) => `${i + 1}`,
  formatCount: (n: number) => String(n),
};

describe('action-bar view: pet slots', () => {
  it('paints a stance slot lit while its stance is current', () => {
    const view = createActionBarView(
      { slots: [petSlot(() => ({ type: 'pet', id: 'stop' }))] },
      viewDeps,
    );
    const s = view.tick(world(pet({ petMode: 'passive' }))).slots[0];
    expect(s.kind).toBe('pet');
    expect(s.petCommand).toBe('stop');
    expect(s.iconKey).toBe(`${ABILITY_ICON_PREFIX}${PET_ACTION_ICONS.passive}`);
    expect(s.usable).toBe(true);
    expect(s.queued).toBe(true);
    expect(s.ariaLabel).toBe('abilityUi.actionBar.slotAria(2,hud.pet.passive)');
  });

  it('greys a pet slot out without a pet and shows the taunt countdown with one', () => {
    const view = createActionBarView(
      { slots: [petSlot(() => ({ type: 'pet', id: 'taunt' }))] },
      viewDeps,
    );
    const none = view.tick(world(null)).slots[0];
    expect(none.kind).toBe('pet');
    expect(none.usable).toBe(false);
    expect(none.cdText).toBe('');

    const cooling = view.tick(world(pet({ petTauntTimer: 5 }))).slots[0];
    expect(cooling.usable).toBe(false);
    expect(cooling.cdText).toBe('5');
    expect(cooling.cooldownPercent).toBe(50);
  });

  it('clears the pet fields when the slot is rebound to something else', () => {
    let bound: HotbarAction = { type: 'pet', id: 'attack' };
    const view = createActionBarView({ slots: [petSlot(() => bound)] }, viewDeps);
    expect(view.tick(world(pet())).slots[0].petCommand).toBe('attack');
    bound = null;
    const s = view.tick(world(pet())).slots[0];
    expect(s.kind).toBe('empty');
    expect(s.petCommand).toBeNull();
    expect(s.queued).toBe(false);
  });
});

describe('action-bar painter: pet stance slots are toggles', () => {
  function paintPressed(command: 'stop' | 'attack', mode: 'passive' | 'defensive'): unknown {
    const attrs = new Map<string, unknown>();
    const writers = {
      setText: () => {},
      setDisplay: () => {},
      setTransform: () => {},
      setWidth: () => {},
      setStyleProp: () => {},
      toggleClass: () => {},
      setAttr: (_el: HTMLElement, name: string, value: string | null) => attrs.set(name, value),
    } as PainterHostWriters;
    const el = {} as HTMLElement;
    const elements: ActionBarSlotElements = {
      btn: el,
      label: el,
      countEl: el,
      keybindEl: el,
      cdOverlay: el,
      cdText: el,
      rechargeOverlay: el,
    };
    const painter = new ActionBarPainter(writers, { container: el, slots: [elements] }, () => '');
    const view = createActionBarView(
      { slots: [petSlot(() => ({ type: 'pet', id: command }))] },
      viewDeps,
    );
    painter.paint(view.tick(world(pet({ petMode: mode }))));
    return attrs.get('aria-pressed');
  }

  it('announces a stance slot as pressed or not, and a one-shot command as a plain button', () => {
    expect(paintPressed('stop', 'passive')).toBe('true');
    expect(paintPressed('stop', 'defensive')).toBe('false');
    expect(paintPressed('attack', 'defensive')).toBeNull();
  });
});

describe('the pad cross hotbar never takes a pet command', () => {
  it('seeds an empty cell where the bar holds a pet command', () => {
    const seeded = crossHotbarSeedActions(
      [{ type: 'pet', id: 'attack' }, { type: 'ability', id: 'fireball' }, null],
      [],
    );
    expect(seeded.bar).toEqual([null, { type: 'ability', id: 'fireball' }, null]);
  });

  it('never resolves a pad action to a bar slot holding a pet command', () => {
    const bar: HotbarAction[] = [null, { type: 'pet', id: 'attack' }];
    expect(crossHotbarActionSlot({ type: 'ability', id: 'attack' }, 1, (s) => bar[s] ?? null)).toBe(
      -1,
    );
  });
});
