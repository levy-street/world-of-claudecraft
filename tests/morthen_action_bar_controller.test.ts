// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { morthenIdentityAura } from '../src/sim/graveyard_shift/morthen_identity';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity } from '../src/sim/types';
import {
  MORTHEN_SHIFT_BODY_CLASS,
  MorthenActionBarController,
} from '../src/ui/hud/vehicle/morthen_action_bar_controller';
import { MORTHEN_HINT_MS } from '../src/ui/hud/vehicle/morthen_hint_view';
import { VehicleActionBarController } from '../src/ui/hud/vehicle/vehicle_action_bar_controller';
import { makeWriterFacet } from '../src/ui/painter_host';
import { EMPTY_TEST_WORLD } from './sim_shared';

vi.mock('../src/ui/icons', () => ({ iconDataUrl: (_kind: string, key: string) => `/${key}.webp` }));
vi.mock('../src/game/sfx', () => ({ sfx: { preload: vi.fn(), playUi: vi.fn() } }));

afterEach(() => {
  document.body.replaceChildren();
  document.body.className = '';
});

function fakeWorld(identity: boolean) {
  const player = {
    id: 1,
    auras: (identity ? [morthenIdentityAura(1)] : []) as Aura[],
    autoAttack: false,
    dead: false,
    gcdRemaining: 0,
    cooldowns: new Map<string, number>(),
    pos: { x: 0, y: 0, z: 0 },
    targetId: null as number | null,
  } as unknown as Entity;
  return {
    vehicleSession: null,
    player,
    entities: new Map<number, Entity>([[1, player]]),
    enterVehicle: vi.fn(),
    useVehicleAction: vi.fn(),
    leaveVehicle: vi.fn(),
    castAbility: vi.fn(),
    startAutoAttack: vi.fn(() => {
      player.autoAttack = true;
    }),
    stopAutoAttack: vi.fn(() => {
      player.autoAttack = false;
    }),
  };
}

function makeWriters() {
  return makeWriterFacet(new Map(), new Map(), new Map(), new Map(), vi.fn(), () => {});
}

function makeBar(world: object, cancel = vi.fn(), writers = makeWriters()) {
  document.body.innerHTML = '<div id="ui"></div>';
  return new VehicleActionBarController({
    world: world as ConstructorParameters<typeof VehicleActionBarController>[0]['world'],
    writers,
    keyLabel: (slot) => String(slot + 1),
    consumePeek: () => false,
    cancelOnEnter: [{ cancel }],
    attachTooltip: () => {},
  });
}

const morthenButtons = () => [
  ...document.querySelectorAll<HTMLButtonElement>('#morthen-action-bar .vehicle-action'),
];

describe('Morthen bar inside the vehicle bar family', () => {
  it('blocks the normal action bar only while the identity is worn', () => {
    expect(VehicleActionBarController.blocksPlayerActions(fakeWorld(true))).toBe(true);
    expect(VehicleActionBarController.blocksPlayerActions(fakeWorld(false))).toBe(false);
    expect(VehicleActionBarController.blocksPlayerActions({ vehicleSession: null })).toBe(false);
  });

  it('routes slot keys to the kit and the Attack toggle', () => {
    const world = fakeWorld(true);
    const bar = makeBar(world);
    bar.chooseSlot(1);
    bar.chooseSlot(2);
    bar.chooseSlot(3);
    bar.chooseSlot(4);
    expect(world.castAbility.mock.calls.map(([id]) => id)).toEqual([
      'gshift_sextons_chain',
      'gshift_shadow_pulse',
      'gshift_raise_fallen',
    ]);
    bar.chooseSlot(0);
    expect(world.startAutoAttack).toHaveBeenCalledTimes(1);
    bar.chooseSlot(0);
    expect(world.stopAutoAttack).toHaveBeenCalledTimes(1);
    expect(world.useVehicleAction).not.toHaveBeenCalled();
  });

  it('a button click casts the same way as its key', () => {
    const world = fakeWorld(true);
    const bar = makeBar(world);
    bar.update();
    morthenButtons()[2].click();
    expect(world.castAbility).toHaveBeenCalledWith('gshift_shadow_pulse');
  });

  it('shows four keyed slots and hides the player bars through the body class', () => {
    const world = fakeWorld(true);
    const cancel = vi.fn();
    const bar = makeBar(world, cancel);
    const root = document.getElementById('morthen-action-bar')!;
    expect(root.style.display).toBe('none');
    bar.update();
    expect(root.style.display).toBe('grid');
    expect(document.body.classList.contains('morthen-shift')).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
    const buttons = morthenButtons();
    expect(buttons).toHaveLength(4);
    expect(buttons.map((b) => b.querySelector('.keybind')!.textContent)).toEqual([
      '1',
      '2',
      '3',
      '4',
    ]);
    expect(buttons[1].getAttribute('aria-label')).toBe("Action slot 2: Sexton's Chain");
    expect(root.querySelector('.vehicle-bar-title')!.textContent).toBe('Morthen the Gravecaller');
    // The cannon bar stays hidden: no vehicle session.
    expect(document.getElementById('vehicle-action-bar')!.style.display).toBe('none');

    world.player.auras.length = 0;
    bar.update();
    expect(root.style.display).toBe('none');
    expect(document.body.classList.contains('morthen-shift')).toBe(false);
  });

  it("shows the Sexton's Chain hint with its key once the identity lands", () => {
    const world = fakeWorld(false);
    const bar = makeBar(world);
    const root = document.getElementById('morthen-action-bar')!;
    const hint = root.querySelector<HTMLElement>('.vehicle-bar-hint')!;
    expect(hint).not.toBeNull();
    // Between the title and the slots.
    expect(hint.previousElementSibling!.classList.contains('vehicle-bar-title')).toBe(true);
    expect(hint.nextElementSibling!.classList.contains('vehicle-action-slots')).toBe(true);
    expect(hint.style.display).toBe('none');
    bar.update();
    expect(hint.style.display).toBe('none');
    world.player.auras.push(morthenIdentityAura(1));
    bar.update();
    expect(hint.style.display).toBe('block');
    expect(hint.textContent).toBe(
      "[2] Sexton's Chain: pick one of them and drag them to you. The healer is a fine start.",
    );
  });

  it('clears the hint after its hold and shows it again on the next shift', () => {
    document.body.innerHTML = '<div id="ui"></div>';
    const world = fakeWorld(true);
    let now = 1000;
    const bar = new MorthenActionBarController(
      world as unknown as ConstructorParameters<typeof MorthenActionBarController>[0],
      makeWriters(),
      (slot) => String(slot + 1),
      [],
      () => {},
      () => false,
      () => now,
    );
    const hint = document.querySelector<HTMLElement>('#morthen-action-bar .vehicle-bar-hint')!;
    bar.update();
    expect(hint.style.display).toBe('block');
    now += MORTHEN_HINT_MS;
    bar.update();
    expect(hint.style.display).toBe('none');
    world.player.auras.length = 0;
    bar.update();
    world.player.auras.push(morthenIdentityAura(1));
    bar.update();
    expect(hint.style.display).toBe('block');
    expect(hint.textContent).toContain("Sexton's Chain");
  });

  it('writes the bar title once, not on every frame', () => {
    const writers = makeWriters();
    const setText = vi.spyOn(writers, 'setText');
    const bar = makeBar(fakeWorld(true), vi.fn(), writers);
    const title = document.querySelector('#morthen-action-bar .vehicle-bar-title');
    bar.update();
    bar.update();
    bar.update();
    expect(setText.mock.calls.filter(([el]) => el === title)).toHaveLength(1);
    expect(title!.textContent).toBe('Morthen the Gravecaller');
  });

  it('ignores slot presses once the identity is gone', () => {
    const world = fakeWorld(false);
    const bar = makeBar(world);
    bar.chooseSlot(1);
    expect(world.castAbility).not.toHaveBeenCalled();
  });
});

describe('Morthen bar on a real offline run', () => {
  it('casts Shadow Pulse from key 3 through the normal cast path', () => {
    const sim = new Sim({
      seed: 42,
      playerClass: 'mage',
      autoEquip: true,
      devCommands: true,
      offlineHost: true,
      world: EMPTY_TEST_WORLD,
    });
    sim.setPlayerLevel(10);
    const bar = makeBar(sim);
    expect(VehicleActionBarController.blocksPlayerActions(sim)).toBe(false);
    sim.chat('/dev graveyardshift start');
    expect(VehicleActionBarController.blocksPlayerActions(sim)).toBe(true);
    sim.player.resource = 25;
    bar.update();
    expect(morthenButtons()[2].getAttribute('aria-label')).toBe('Action slot 3: Shadow Pulse');
    bar.chooseSlot(2);
    expect(sim.player.castingAbility).toBe('gshift_shadow_pulse');
    for (let i = 0; i < 20 * 2.5; i++) sim.tick();
    expect(sim.player.castingAbility).toBeFalsy();
    expect(sim.player.resource).toBe(0);
    expect(sim.player.cooldowns.get('gshift_shadow_pulse') ?? 0).toBeGreaterThan(5);
    bar.update();
    expect(morthenButtons()[2].querySelector('.cdtext')!.textContent).not.toBe('');
    sim.chat('/dev graveyardshift end');
    sim.tick();
    expect(VehicleActionBarController.blocksPlayerActions(sim)).toBe(false);
  });
});

describe('Morthen bar hide rule', () => {
  it('hides every player bar under the morthen-shift body class', () => {
    // happy-dom applies no stylesheet, so the rule is pinned as text: the body
    // class the controller toggles must sit in the selector that hides the bars.
    const css = readFileSync(resolve(process.cwd(), 'src/styles/hud.css'), 'utf8');
    const rule = css.match(/body:is\(([^)]*)\)\s*:is\(([^)]*)\)\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    const [, bodyClasses, bars, body] = rule!;
    expect(bodyClasses.split(',').map((c) => c.trim())).toContain(`.${MORTHEN_SHIFT_BODY_CLASS}`);
    expect(bars.split(',').map((b) => b.trim())).toEqual(
      expect.arrayContaining([
        '#actionbar',
        '#actionbar2',
        '#actionbar3',
        '#cross-hotbar',
        '#stancebar',
        '#petbar',
        '#mobile-action-ring',
        '#mobile-action-radial',
        '#mobile-consumable-strip',
        '#mobile-stance-radial',
        '#mobile-combat-controls',
      ]),
    );
    expect(body).toMatch(/display:\s*none\s*!important/);
  });
});
