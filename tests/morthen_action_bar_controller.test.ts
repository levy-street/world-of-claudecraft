// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { morthenIdentityAura } from '../src/sim/graveyard_shift/morthen_identity';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity } from '../src/sim/types';
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

function makeBar(world: object, cancel = vi.fn()) {
  document.body.innerHTML = '<div id="ui"></div>';
  return new VehicleActionBarController({
    world: world as ConstructorParameters<typeof VehicleActionBarController>[0]['world'],
    writers: makeWriterFacet(new Map(), new Map(), new Map(), new Map(), vi.fn(), () => {}),
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
      'gshift_gravecall',
      'gshift_shadow_pulse',
      'gshift_sextons_chain',
      'gshift_barrow_shroud',
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

  it('shows five keyed slots and hides the player bars through the body class', () => {
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
    expect(buttons).toHaveLength(5);
    expect(buttons.map((b) => b.querySelector('.keybind')!.textContent)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
    ]);
    expect(buttons[1].getAttribute('aria-label')).toBe('Action slot 2: Gravecall');
    expect(root.querySelector('.vehicle-bar-title')!.textContent).toBe('Morthen the Gravecaller');
    // The cannon bar stays hidden: no vehicle session.
    expect(document.getElementById('vehicle-action-bar')!.style.display).toBe('none');

    world.player.auras.length = 0;
    bar.update();
    expect(root.style.display).toBe('none');
    expect(document.body.classList.contains('morthen-shift')).toBe(false);
  });

  it('ignores slot presses once the identity is gone', () => {
    const world = fakeWorld(false);
    const bar = makeBar(world);
    bar.chooseSlot(1);
    expect(world.castAbility).not.toHaveBeenCalled();
  });
});

describe('Morthen bar on a real offline run', () => {
  it('casts Barrow Shroud from key 5 through the normal cast path', () => {
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
    bar.update();
    expect(morthenButtons()[4].getAttribute('aria-label')).toBe('Action slot 5: Barrow Shroud');
    bar.chooseSlot(4);
    sim.tick();
    expect(sim.player.auras.some((a) => a.kind === 'shield_wall')).toBe(true);
    expect(sim.player.cooldowns.get('gshift_barrow_shroud') ?? 0).toBeGreaterThan(40);
    bar.update();
    expect(morthenButtons()[4].querySelector('.cdtext')!.textContent).not.toBe('');
    sim.chat('/dev graveyardshift end');
    sim.tick();
    expect(VehicleActionBarController.blocksPlayerActions(sim)).toBe(false);
  });
});
