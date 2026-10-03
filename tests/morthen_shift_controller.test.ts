// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { morthenIdentityAura } from '../src/sim/graveyard_shift/morthen_identity';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity } from '../src/sim/types';
import { MORTHEN_HINT_MS } from '../src/ui/hud/vehicle/morthen_hint_view';
import {
  MORTHEN_SHIFT_BODY_CLASS,
  MorthenShiftController,
} from '../src/ui/hud/vehicle/morthen_shift_controller';
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
    resource: 0,
    pos: { x: 0, y: 0, z: 0 },
  } as unknown as Entity;
  return { vehicleSession: null, player, entities: new Map<number, Entity>([[1, player]]) };
}

function makeWriters() {
  return makeWriterFacet(new Map(), new Map(), new Map(), new Map(), vi.fn(), () => {});
}

function makeShift(world: ReturnType<typeof fakeWorld>, now = () => 1000) {
  const cancel = vi.fn();
  const showHint = vi.fn();
  const refreshPadBar = vi.fn();
  const shift = new MorthenShiftController({
    world,
    writers: makeWriters(),
    cancelOnEnter: [{ cancel }],
    showHint,
    refreshPadBar,
    now,
  });
  return { shift, cancel, showHint, refreshPadBar };
}

describe('Morthen shift state', () => {
  it('never blocks the normal action bar: the kit rides it', () => {
    expect(VehicleActionBarController.blocksPlayerActions(fakeWorld(true))).toBe(false);
  });

  it('stamps the body class, cancels carried aims and refreshes the pad bar on each flip', () => {
    const world = fakeWorld(false);
    const { shift, cancel, refreshPadBar } = makeShift(world);
    shift.update();
    expect(document.body.classList.contains(MORTHEN_SHIFT_BODY_CLASS)).toBe(false);
    expect(refreshPadBar).not.toHaveBeenCalled();
    world.player.auras.push(morthenIdentityAura(1));
    shift.update();
    shift.update();
    expect(document.body.classList.contains(MORTHEN_SHIFT_BODY_CLASS)).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(refreshPadBar).toHaveBeenCalledTimes(1);
    world.player.auras.length = 0;
    shift.update();
    expect(document.body.classList.contains(MORTHEN_SHIFT_BODY_CLASS)).toBe(false);
    expect(refreshPadBar).toHaveBeenCalledTimes(2);
  });

  it("writes the Sexton's Chain hint once, not on every frame", () => {
    const world = fakeWorld(true);
    const { shift, showHint } = makeShift(world);
    shift.update();
    shift.update();
    expect(showHint).toHaveBeenCalledTimes(1);
    expect(showHint).toHaveBeenCalledWith(
      "Sexton's Chain: pick one of them and drag them to you. The healer is a fine start.",
    );
  });

  it('shows the next line after the hold, and every line again on the next shift', () => {
    const world = fakeWorld(true);
    let now = 1000;
    const { shift, showHint } = makeShift(world, () => now);
    shift.update();
    world.player.resource = 25;
    shift.update();
    expect(showHint).toHaveBeenCalledTimes(1);
    now += MORTHEN_HINT_MS;
    shift.update();
    expect(showHint).toHaveBeenCalledTimes(2);
    expect(showHint.mock.calls[1][0]).toMatch(/^Shadow Pulse is ready/);
    world.player.auras.length = 0;
    shift.update();
    world.player.auras.push(morthenIdentityAura(1));
    shift.update();
    expect(showHint).toHaveBeenCalledTimes(3);
    expect(showHint.mock.calls[2][0]).toMatch(/^Sexton's Chain/);
  });
});

describe('Morthen shift inside the vehicle bar family, on a real offline run', () => {
  it('forwards the hint to the chat-log tip dep and leaves slot presses to the action bar', () => {
    const sim = new Sim({
      seed: 42,
      playerClass: 'mage',
      autoEquip: true,
      devCommands: true,
      offlineHost: true,
      world: EMPTY_TEST_WORLD,
    });
    sim.setPlayerLevel(10);
    document.body.innerHTML = '<div id="ui"></div>';
    const logTip = vi.fn();
    const refreshPadBar = vi.fn();
    const bar = new VehicleActionBarController({
      world: sim as unknown as ConstructorParameters<typeof VehicleActionBarController>[0]['world'],
      writers: makeWriters(),
      keyLabel: (slot) => String(slot + 1),
      consumePeek: () => false,
      cancelOnEnter: [],
      attachTooltip: () => {},
      logTip,
      refreshPadBar,
    });
    sim.chat('/dev graveyardshift start');
    bar.update();
    expect(VehicleActionBarController.blocksPlayerActions(sim)).toBe(false);
    expect(document.body.classList.contains(MORTHEN_SHIFT_BODY_CLASS)).toBe(true);
    expect(logTip).toHaveBeenCalledWith(expect.stringMatching(/^Sexton's Chain/));
    expect(refreshPadBar).toHaveBeenCalledTimes(1);
    expect(document.getElementById('morthen-action-bar')).toBeNull();
    sim.chat('/dev graveyardshift end');
    sim.tick();
    bar.update();
    expect(document.body.classList.contains(MORTHEN_SHIFT_BODY_CLASS)).toBe(false);
  });
});

describe('Morthen shift hide rule', () => {
  it('stands down only what Morthen cannot use, never the bar, ring or pad bar the kit rides', () => {
    // happy-dom applies no stylesheet, so the rule is pinned as text.
    const css = readFileSync(resolve(process.cwd(), 'src/styles/hud.css'), 'utf8');
    const rule = css.match(/body\.morthen-shift\s*:is\(([^)]*)\)\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    const [, bars, body] = rule!;
    const hidden = bars.split(',').map((b) => b.trim());
    expect(hidden).toEqual(
      expect.arrayContaining(['#actionbar2', '#actionbar3', '#stancebar', '#petbar']),
    );
    for (const kept of [
      '#actionbar',
      '#cross-hotbar',
      '#mobile-action-ring',
      '#mobile-action-radial',
      '#mobile-combat-controls',
    ]) {
      expect(hidden).not.toContain(kept);
    }
    expect(body).toMatch(/display:\s*none\s*!important/);
    expect(css).not.toMatch(/\.morthen-shift[^{]*#actionbar\s*[,)]/);
  });
});
