// The pad reel decision (src/game/pad_reel.ts): mid fishing cast, the
// controller's interact press re-uses a carried fishing implement to answer
// the bite; every other state stays a plain interact. Pure core plus the
// main.ts wiring pin (the dispatch is a closure a unit test cannot reach).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BIND_ACTIONS } from '../src/game/keybinds';
import { padReelItemId } from '../src/game/pad_reel';
import { ITEMS } from '../src/sim/data';
import { FISHING_CAST_ID, GATHER_CAST_ID } from '../src/sim/types';

describe('padReelItemId', () => {
  it('answers the carried implement only during a live fishing cast', () => {
    const pole = [{ itemId: 'simple_fishing_pole', count: 1 }];
    // Sanity on the fixture: the pole really is the fishing use kind.
    expect(ITEMS.simple_fishing_pole.use?.type).toBe('fishing');
    expect(padReelItemId(FISHING_CAST_ID, pole)).toBe('simple_fishing_pole');
    // Not casting, casting something else, or a gather cast: plain interact.
    expect(padReelItemId(null, pole)).toBeNull();
    expect(padReelItemId('fireball', pole)).toBeNull();
    expect(padReelItemId(GATHER_CAST_ID, pole)).toBeNull();
  });

  it('a tiered rod (gatherTool fishing) reels too; land tools never do', () => {
    const rod = [{ itemId: 'ironreel_fishing_rod', count: 1 }];
    expect(ITEMS.ironreel_fishing_rod.use).toMatchObject({
      type: 'gatherTool',
      professionId: 'fishing',
    });
    expect(padReelItemId(FISHING_CAST_ID, rod)).toBe('ironreel_fishing_rod');
    const pick = [{ itemId: 'copper_mining_pick', count: 1 }];
    expect(padReelItemId(FISHING_CAST_ID, pick)).toBeNull();
    expect(padReelItemId(FISHING_CAST_ID, [])).toBeNull();
  });

  it('the touch Use button reels too: onInteract tries the rod before the scan (source pin)', () => {
    // The phase 14 QA found the touch path still had the exact failure the
    // pad arm closed: onInteract dispatched interactKey() directly, so a
    // mid-cast tap ran the nearby scan over a live bobber. Comment-stripped
    // so the arm's own prose cannot satisfy the pin.
    const mainTs = readFileSync(join(__dirname, '../src/main.ts'), 'utf8').replace(
      /^\s*\/\/.*$/gm,
      '',
    );
    const start = mainTs.indexOf('onInteract: () => {');
    expect(start).toBeGreaterThan(-1);
    const body = mainTs.slice(start, mainTs.indexOf('onChat:', start));
    expect(body).toContain(
      'const reelRod = padReelItemId(world.player.castingAbility, world.inventory);',
    );
    expect(body.indexOf('padReelItemId')).toBeLessThan(body.indexOf('interactKey()'));
    expect(body).toContain('world.useItem(reelRod);');
  });

  it('main.ts wires the reel ahead of the nearby-interaction scan (source pin)', () => {
    // Comment-stripped (the repo scrape rule): the arm's own prose names
    // padReelItemId and interactKey.
    const mainTs = readFileSync(join(__dirname, '../src/main.ts'), 'utf8').replace(
      /^\s*\/\/.*$/gm,
      '',
    );
    // The braced form is unique to the pad dispatch (the keyboard Input
    // callbacks carry their own unbraced interact/bags pair earlier), so the
    // bags terminator must be searched FROM the pad case.
    const start = mainTs.indexOf("case 'interact': {");
    expect(start).toBeGreaterThan(-1);
    const end = mainTs.indexOf("case 'bags':", start);
    expect(end).toBeGreaterThan(start);
    const interactCase = mainTs.slice(start, end);
    expect(interactCase).toContain(
      'const reelRod = padReelItemId(world.player.castingAbility, world.inventory);',
    );
    // The reel wins BEFORE interactKey runs: a live bobber must never be
    // answered with a nearby scan.
    expect(interactCase.indexOf('padReelItemId')).toBeLessThan(
      interactCase.indexOf('interactKey()'),
    );
  });
});

// The offered-but-dropped guard: the controller panel offers EVERY edge
// keybind action plus its own explicit escape row (options_window.ts
// gamepadActionOptions), so every one of them must have a dispatch arm, or
// binding it silently does nothing (the class that shipped Crafting, the
// dungeon finder, sheathe, and three pet edges dead on the pad).
describe('gamepad dispatch covers every action the controller panel offers', () => {
  const strip = (src: string): string => src.replace(/^\s*\/\/.*$/gm, '');
  const mainTs = strip(readFileSync(join(__dirname, '../src/main.ts'), 'utf8'));
  const dispatchBody = (): string => {
    const start = mainTs.indexOf('function dispatchGamepadAction');
    expect(start).toBeGreaterThan(-1);
    const end = mainTs.indexOf('const gamepad = new GamepadManager', start);
    // The end anchor must resolve AFTER the start (the phase 14 QA: an
    // unasserted -1 would slice to the end of the file and every arm would
    // pass vacuously).
    expect(end).toBeGreaterThan(start);
    return mainTs.slice(start, end);
  };

  it('every offered edge action id has a case in dispatchGamepadAction', () => {
    const body = dispatchBody();
    for (const action of BIND_ACTIONS) {
      if (action.kind !== 'edge') continue;
      if (action.id === 'attackMove') continue; // panel-excluded, pinned below
      if (action.id === 'jump' || action.id === 'autorun') continue; // gamepad.ts-handled, pinned below
      if (action.id.startsWith('slot')) continue; // the slotN prefix arm, pinned below
      expect(body.includes(`case '${action.id}'`), `pad dispatch drops '${action.id}'`).toBe(true);
    }
  });

  it("the guard's own exclusions hold: each excluded id is handled where the exemption claims", () => {
    // The phase 14 QA: an unpinned exemption is a hole the guard cannot
    // see. Each fact the loop above relies on gets its own literal.
    const panel = strip(readFileSync(join(__dirname, '../src/ui/options_window.ts'), 'utf8'));
    // attackMove: the panel genuinely never offers it.
    expect(panel).toContain("if (a.id === 'attackMove') continue;");
    // jump/autorun: intercepted in gamepad.ts BEFORE onAction dispatches.
    const pad = strip(readFileSync(join(__dirname, '../src/game/gamepad.ts'), 'utf8'));
    expect(pad).toContain("if (action === 'jump') {");
    expect(pad).toContain('this.input.triggerGamepadJump();');
    expect(pad).toContain("if (action === 'autorun') {");
    expect(pad).toContain('this.input.toggleAutorun();');
    // slotN: the prefix arm exists and dispatches to the hotbar, and the
    // registry genuinely offers slot ids as edges (so the arm is
    // load-bearing, not decorative).
    const body = dispatchBody();
    expect(body).toContain("if (id.startsWith('slot')) {");
    expect(body).toContain('hud.castSlot(Number(id.slice(4)));');
    expect(BIND_ACTIONS.some((a) => a.kind === 'edge' && a.id.startsWith('slot'))).toBe(true);
    // escape: a PANEL-extra row (not in BIND_ACTIONS), so the loop above
    // never checks it; pin the offer and the dispatch arm directly.
    expect(panel).toContain("{ value: 'escape', label: t('hudChrome.controller.menuAction') }");
    expect(body).toContain("if (id === 'escape') {");
    expect(body).toContain('if (!hud.closeAll()) hud.toggleOptionsMenu();');
  });

  it('the eight rewired actions dispatch to their exact keyboard handlers', () => {
    // Presence-only case labels satisfied `case 'petStop': break;` (the
    // phase 14 QA): pin each body to its real call, comment-stripped.
    const body = dispatchBody();
    const arms: Array<[string, string]> = [
      ['crafting', 'hud.toggleCrafting();'],
      ['petStop', "world.setPetMode('passive');"],
      ['petTaunt', 'world.petTaunt();'],
      ['petAttack', 'world.petAttack();'],
      ['petDefensive', "world.setPetMode('defensive');"],
      ['petAggressive', "world.setPetMode('aggressive');"],
      ['dungeonFinder', 'hud.toggleDungeonFinder();'],
    ];
    for (const [id, call] of arms) {
      const at = body.indexOf(`case '${id}'`);
      expect(at, `case '${id}' missing`).toBeGreaterThan(-1);
      const arm = body.slice(at, body.indexOf('break;', at));
      expect(arm, `case '${id}' body`).toContain(call);
    }
    // sheathe carries the keyboard arm's cue-on-state-change rule whole.
    const at = body.indexOf("case 'sheathe': {");
    expect(at).toBeGreaterThan(-1);
    const sheathe = body.slice(at, body.indexOf('}', body.indexOf('break;', at)));
    expect(sheathe).toContain('const wasStowed = world.player.weaponStowed;');
    expect(sheathe).toContain('world.toggleWeaponStow();');
    expect(sheathe).toContain('if (world.player.weaponStowed !== wasStowed) {');
    expect(sheathe).toContain('audio.weaponSheathe();');
    expect(sheathe).toContain('audio.weaponUnsheathe();');
  });
});
