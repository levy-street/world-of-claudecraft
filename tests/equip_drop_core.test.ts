// @vitest-environment happy-dom
//
// The bags -> paperdoll drag: the pure drop decision (equip_drop_core.ts) and the
// touch release hit test (item_drop_hit_test.ts).
//
// The decision core is the client's FEEDBACK half of the equip rule; the sim's
// equipItem is the authority. This suite pins them to the same answer for every
// arm, so a lit socket is always one the sim will accept and a refused drop is one
// it would have refused anyway.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { EquipSlot } from '../src/sim/types';
import {
  dropRequiredLevel,
  isPaperdollDraggable,
  paperdollDropAction,
} from '../src/ui/equip_drop_core';
import { Hud } from '../src/ui/hud';
import { resolveDropTargetAt } from '../src/ui/item_drop_hit_test';

function equipmentOf(sim: Sim & Record<string, any>, pid: number): Record<string, string> {
  const meta = sim.players.get(pid);
  if (!meta) throw new Error(`no player ${pid}`);
  return meta.equipment;
}

const RING = ITEMS.seal_of_the_nine_oaths;
const HELM = ITEMS.cryptbone_helm; // mail
const POTION = ITEMS.minor_healing_potion;
const ONE_HAND_WEAPON = ITEMS.training_mace;
const TWO_HAND_WEAPON = ITEMS.eastbrook_greatsword;

describe('paperdollDropAction', () => {
  it('equips a ring dropped on EITHER finger', () => {
    expect(paperdollDropAction(RING, 'ring1', 'warrior', 20)).toBe('equip');
    expect(paperdollDropAction(RING, 'ring2', 'warrior', 20)).toBe('equip');
  });

  it('refuses a piece dropped on a socket it does not fit', () => {
    expect(paperdollDropAction(HELM, 'ring1', 'warrior', 20)).toBe('blockedSlot');
    expect(paperdollDropAction(RING, 'helmet', 'warrior', 20)).toBe('blockedSlot');
  });

  it('refuses a non-gear item outright (a potion is never worn)', () => {
    expect(paperdollDropAction(POTION, 'chest', 'warrior', 20)).toBe('blockedSlot');
  });

  it('refuses armor the class cannot wear, naming the CLASS reason', () => {
    expect(paperdollDropAction(HELM, 'helmet', 'mage', 20)).toBe('blockedClass');
    expect(paperdollDropAction(HELM, 'helmet', 'warrior', 20)).toBe('equip');
  });

  it('refuses gear above the level gate, naming the LEVEL reason', () => {
    const gate = dropRequiredLevel(RING);
    expect(gate).toBeGreaterThan(1);
    expect(paperdollDropAction(RING, 'ring1', 'warrior', gate - 1)).toBe('blockedLevel');
    expect(paperdollDropAction(RING, 'ring1', 'warrior', gate)).toBe('equip');
  });

  it('checks the socket BEFORE the class, so a mage aiming a mail helm at a ring reads blockedSlot', () => {
    expect(paperdollDropAction(HELM, 'ring1', 'mage', 20)).toBe('blockedSlot');
  });

  it('accepts a one-hand weapon on offhand only when the active spec can dual wield', () => {
    expect(paperdollDropAction(ONE_HAND_WEAPON, 'offhand', 'warrior', 40, 'fury')).toBe('equip');
    expect(paperdollDropAction(ONE_HAND_WEAPON, 'offhand', 'rogue', 40)).toBe('equip');
    expect(paperdollDropAction(ONE_HAND_WEAPON, 'offhand', 'warrior', 40, 'arms')).toBe(
      'blockedClass',
    );
  });

  it('accepts a two-hand weapon on offhand only for Fury Titan Grip', () => {
    expect(paperdollDropAction(TWO_HAND_WEAPON, 'offhand', 'warrior', 40, 'fury')).toBe('equip');
    expect(paperdollDropAction(TWO_HAND_WEAPON, 'offhand', 'warrior', 40, 'arms')).toBe(
      'blockedClass',
    );
  });
});

describe('paperdollDropAction agrees with the sim (the authority)', () => {
  // Every 'equip' the core promises must actually equip when the sim runs it, and
  // every refusal must leave the paperdoll untouched: the two can never drift.
  const cases: Array<{
    itemId: string;
    slot: EquipSlot;
    cls: 'warrior' | 'rogue' | 'mage';
    level: number;
    spec?: string;
  }> = [
    { itemId: 'seal_of_the_nine_oaths', slot: 'ring2', cls: 'warrior', level: 20 },
    { itemId: 'cryptbone_helm', slot: 'helmet', cls: 'warrior', level: 20 },
    { itemId: 'cryptbone_helm', slot: 'ring1', cls: 'warrior', level: 20 },
    { itemId: 'cryptbone_helm', slot: 'helmet', cls: 'mage', level: 20 },
    { itemId: 'seal_of_the_nine_oaths', slot: 'ring1', cls: 'warrior', level: 1 },
    { itemId: 'training_mace', slot: 'offhand', cls: 'rogue', level: 20 },
    { itemId: 'training_mace', slot: 'offhand', cls: 'warrior', level: 40, spec: 'fury' },
    { itemId: 'training_mace', slot: 'offhand', cls: 'warrior', level: 40, spec: 'arms' },
    {
      itemId: 'eastbrook_greatsword',
      slot: 'offhand',
      cls: 'warrior',
      level: 40,
      spec: 'fury',
    },
  ];

  for (const c of cases) {
    it(`${c.itemId} -> ${c.slot} (${c.cls} ${c.level})`, () => {
      const sim = new Sim({ seed: 5, playerClass: c.cls, noPlayer: true }) as Sim &
        Record<string, any>;
      const pid = sim.addPlayer(c.cls, 'Dropper');
      sim.setPlayerLevel(c.level, pid);
      if (c.spec) expect(sim.setSpec(c.spec, pid)).toBe(true);
      sim.addItem(c.itemId, 1, pid);
      const expected = paperdollDropAction(ITEMS[c.itemId], c.slot, c.cls, c.level, c.spec);
      sim.equipItemToSlot(c.itemId, c.slot, pid);
      const worn = equipmentOf(sim, pid)[c.slot];
      expect(worn === c.itemId, `core said ${expected}`).toBe(expected === 'equip');
    });
  }
});

describe('paperdollDropAction unique-equipped mirror', () => {
  const LEGENDARY = ITEMS.kingsbane_last_oath;
  const HEROIC_LEGENDARY = ITEMS.heroic_kingsbane_last_oath;

  it('refuses a second worn copy of a legendary, naming the UNIQUE reason', () => {
    expect(
      paperdollDropAction(LEGENDARY, 'offhand', 'warrior', 20, 'fury', {
        mainhand: 'kingsbane_last_oath',
      }),
    ).toBe('blockedUnique');
  });

  it('treats the heroic variant as the same family', () => {
    expect(
      paperdollDropAction(HEROIC_LEGENDARY, 'offhand', 'warrior', 20, 'fury', {
        mainhand: 'kingsbane_last_oath',
      }),
    ).toBe('blockedUnique');
  });

  it('accepts a legendary when no copy is worn elsewhere, or onto its own slot', () => {
    expect(paperdollDropAction(LEGENDARY, 'offhand', 'warrior', 20, 'fury', {})).toBe('equip');
    expect(
      paperdollDropAction(LEGENDARY, 'mainhand', 'warrior', 20, 'fury', {
        mainhand: 'kingsbane_last_oath',
      }),
    ).toBe('equip');
  });

  it('keeps the non-legendary Titan Grip same-id pair green', () => {
    expect(
      paperdollDropAction(TWO_HAND_WEAPON, 'offhand', 'warrior', 40, 'fury', {
        mainhand: 'eastbrook_greatsword',
      }),
    ).toBe('equip');
  });

  it('agrees with the sim on the refused duplicate (the authority check)', () => {
    const sim = new Sim({ seed: 6, playerClass: 'warrior', noPlayer: true }) as Sim &
      Record<string, any>;
    const pid = sim.addPlayer('warrior', 'Dropper');
    sim.setPlayerLevel(20, pid);
    expect(sim.setSpec('fury', pid)).toBe(true);
    sim.addItem('kingsbane_last_oath', 2, pid);
    sim.equipItemToSlot('kingsbane_last_oath', 'mainhand', pid);
    const equipment = equipmentOf(sim, pid);
    expect(paperdollDropAction(LEGENDARY, 'offhand', 'warrior', 20, 'fury', equipment)).toBe(
      'blockedUnique',
    );
    const offhandBefore = equipmentOf(sim, pid).offhand;
    sim.equipItemToSlot('kingsbane_last_oath', 'offhand', pid);
    expect(equipmentOf(sim, pid).offhand).toBe(offhandBefore);
  });
});

describe('isPaperdollDraggable', () => {
  it('is true for gear with a slot and false for everything else', () => {
    expect(isPaperdollDraggable(HELM)).toBe(true);
    expect(isPaperdollDraggable(RING)).toBe(true);
    expect(isPaperdollDraggable(POTION)).toBe(false);
  });
});

describe('resolveDropTargetAt (touch release)', () => {
  function stubEl(html: string): Element {
    const host = document.createElement('div');
    host.innerHTML = html;
    return host.firstElementChild as Element;
  }

  it('resolves a paperdoll socket by its data-equip-slot', () => {
    const el = stubEl('<div class="equip-slot" data-equip-slot="ring2"><img></div>');
    expect(resolveDropTargetAt(10, 10, () => el)).toEqual({ kind: 'equip', slot: 'ring2' });
  });

  it('resolves through a CHILD of the socket (the finger lands on the icon)', () => {
    const socket = stubEl('<div class="equip-slot" data-equip-slot="helmet"><img id="i"></div>');
    document.body.appendChild(socket);
    const icon = socket.querySelector('#i') as Element;
    expect(resolveDropTargetAt(10, 10, () => icon)).toEqual({ kind: 'equip', slot: 'helmet' });
    socket.remove();
  });

  it('rejects a bogus data-equip-slot rather than trusting it', () => {
    const el = stubEl('<div class="equip-slot" data-equip-slot="pocket"></div>');
    expect(resolveDropTargetAt(10, 10, () => el)).toEqual({ kind: 'none' });
  });

  it('resolves the action-slot arms: desktop bar seat and mobile ring seat (the UX pass)', () => {
    // The desktop row button carries the 1-based bar slot...
    const bar = stubEl('<button class="action-btn" data-hotbar-slot="4"><span></span></button>');
    expect(resolveDropTargetAt(10, 10, () => bar)).toEqual({ kind: 'actionSlot', slot: 4 });
    // ...through a child, the finger-lands-on-the-icon shape.
    document.body.appendChild(bar);
    const icon = bar.querySelector('span') as Element;
    expect(resolveDropTargetAt(10, 10, () => icon)).toEqual({ kind: 'actionSlot', slot: 4 });
    bar.remove();
    // The mobile ring button carries its RING position; the HUD maps it to
    // a bar slot through the live page at drop time, never here.
    const ring = stubEl('<button class="mobile-action-slot" data-mobile-index="2"></button>');
    expect(resolveDropTargetAt(10, 10, () => ring)).toEqual({
      kind: 'actionRingSlot',
      ringIndex: 2,
    });
    // Malformed attributes resolve to no target, the equip-arm rule.
    const bogus = stubEl('<button class="action-btn" data-hotbar-slot="0"></button>');
    expect(resolveDropTargetAt(10, 10, () => bogus)).toEqual({ kind: 'none' });
    const bogusRing = stubEl('<button class="mobile-action-slot" data-mobile-index="x"></button>');
    expect(resolveDropTargetAt(10, 10, () => bogusRing)).toEqual({ kind: 'none' });
  });

  it('resolves a bag cell by its data-bag-index (the manual-order drop)', () => {
    const el = stubEl('<button class="bag-item" data-bag-index="5"></button>');
    expect(resolveDropTargetAt(10, 10, () => el)).toEqual({ kind: 'bagCell', index: 5 });
    // A free square stamps the end index, so a stack dropped there goes last.
    const free = stubEl('<div class="bag-item empty" data-bag-index="3"></div>');
    expect(resolveDropTargetAt(10, 10, () => free)).toEqual({ kind: 'bagCell', index: 3 });
  });

  it('leaves an unstamped bag cell inert (a sorted/filtered grid names no index)', () => {
    const el = stubEl('<button class="bag-item"></button>');
    expect(resolveDropTargetAt(10, 10, () => el)).toEqual({ kind: 'none' });
  });

  it('resolves the world canvas', () => {
    const el = stubEl('<canvas id="game-canvas"></canvas>');
    expect(resolveDropTargetAt(10, 10, () => el)).toEqual({ kind: 'world' });
  });

  it('is inert over any other surface (releasing over the chat box destroys nothing)', () => {
    const el = stubEl('<div id="chatlog"></div>');
    expect(resolveDropTargetAt(10, 10, () => el)).toEqual({ kind: 'none' });
    expect(resolveDropTargetAt(10, 10, () => null)).toEqual({ kind: 'none' });
  });
});

describe('touch drop routing beyond the hit-test (the phase 14 QA gaps)', () => {
  const stripped = (rel: string): string =>
    readFileSync(join(__dirname, rel), 'utf8').replace(/^\s*\/\/.*$/gm, '');

  it('the bags release routes both action arms into the HUD deps (source pin)', () => {
    const bags = stripped('../src/ui/bags_window.ts');
    expect(bags).toContain(
      "if (target.kind === 'equip') this.deps.dropOnEquipSlot(s.itemId, target.slot);",
    );
    expect(bags).toContain(
      "else if (target.kind === 'actionSlot') this.deps.dropOnActionSlot(s.itemId, target.slot);",
    );
    expect(bags).toContain('this.deps.dropOnActionRingSlot(s.itemId, target.ringIndex);');
  });

  it('the ring wiring bounds the index against the live ring (source pin)', () => {
    const hud = stripped('../src/ui/hud.ts');
    const idx = hud.indexOf('dropOnActionRingSlot: (itemId, ringIndex) => {');
    expect(idx).toBeGreaterThan(-1);
    const body = hud.slice(idx, hud.indexOf('},', idx));
    expect(body).toContain('if (ringIndex >= this.mobileRingSlotBtns.length) return;');
    expect(body).toContain(
      'this.placeHotbarItemFromTouch(itemId, this.mobileSourceSlotForButton(ringIndex));',
    );
  });

  it('placeHotbarItemFromTouch refuses bad slots and non-hotbar items, places the rest', () => {
    // The three behaviors on the real prototype method: the slot >= 1
    // integer refusal, the isHotbarItemId silent cancel, and the placement
    // with its save and stale-tooltip rule.
    const rig = () => {
      const replaceActions = vi.fn();
      const h = Object.create(Hud.prototype) as unknown as {
        actionBarController: {
          isHotbarItemId(id: string): boolean;
          actions: unknown[];
          replaceActions: ReturnType<typeof vi.fn>;
        };
        saveSlotMap: ReturnType<typeof vi.fn>;
        hideTooltip: ReturnType<typeof vi.fn>;
        placeHotbarItemFromTouch(itemId: string, slot: number): void;
      };
      // The hotbarActions accessor pair delegates to the controller: the
      // getter reads `actions`, the setter calls `replaceActions`.
      h.actionBarController = {
        isHotbarItemId: (id: string) => id === 'simple_fishing_pole',
        actions: [null, null, null, null],
        replaceActions,
      };
      h.saveSlotMap = vi.fn();
      h.hideTooltip = vi.fn();
      return h;
    };
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      const h = rig();
      h.placeHotbarItemFromTouch('simple_fishing_pole', bad);
      expect(h.saveSlotMap, `slot ${bad}`).not.toHaveBeenCalled();
      expect(h.actionBarController.replaceActions).not.toHaveBeenCalled();
    }
    const notHotbar = rig();
    notHotbar.placeHotbarItemFromTouch('iron_ore', 2);
    expect(notHotbar.saveSlotMap).not.toHaveBeenCalled();
    const ok = rig();
    ok.placeHotbarItemFromTouch('simple_fishing_pole', 2);
    const placed = ok.actionBarController.replaceActions.mock.calls[0]?.[0] as unknown[];
    expect(placed?.[1]).toMatchObject({ type: 'item', id: 'simple_fishing_pole' });
    expect(ok.saveSlotMap).toHaveBeenCalledTimes(1);
    expect(ok.hideTooltip).toHaveBeenCalledTimes(1);
  });
});

describe('touch drop reachability (the phase 14 QA blocker)', () => {
  // The hit-test arms above only matter if a release can REACH a target:
  // the full-screen bags sheet sits at z-index 95 and the action ring's
  // layer at 60, so without the drag-scoped raise every release hit-tests
  // the sheet and the drag-to-slot flow cannot be performed at all.
  const read = (rel: string): string =>
    readFileSync(join(__dirname, rel), 'utf8').replace(/^\s*\/\/.*$/gm, '');

  it('the drag lifecycle stamps and removes body.touch-item-dragging', () => {
    const drag = read('../src/ui/touch_item_drag.ts');
    expect(drag).toContain("document.body.classList.add('touch-item-dragging');");
    expect(drag).toContain("document.body.classList.remove('touch-item-dragging');");
  });

  it('the drag window raises the controls layer above the bags sheet', () => {
    const css = readFileSync(join(__dirname, '../src/styles/hud.mobile.css'), 'utf8');
    // The sheet's own literal, so a re-tiering of either side re-derives
    // this pair rather than passing silently.
    expect(css).toContain('z-index: 95 !important;');
    const idx = css.indexOf('body.mobile-touch.game-active.touch-item-dragging #mobile-controls');
    expect(idx).toBeGreaterThan(-1);
    const rule = css.slice(idx, css.indexOf('}', idx));
    expect(rule).toContain('z-index: 96;');
  });

  it('the raise keeps ONLY the ring pointer-active (the fix-round blocker)', () => {
    // The raise lifts the whole controls subtree above the open windows, so
    // without this rule the move zone silently ate equip drops in the
    // paired layout and the menu cluster ate bag-cell drops. Everything but
    // the ring goes pointer-events none for exactly the drag window.
    const css = readFileSync(join(__dirname, '../src/styles/hud.mobile.css'), 'utf8');
    // BOTH selector lines, pinned separately (the mutation check caught the
    // single-indexOf form surviving a half-broken group): the direct
    // children AND their descendants must be neutralized, or a nested
    // pointer-active control keeps eating drops.
    const child =
      'body.mobile-touch.game-active.touch-item-dragging #mobile-controls > :not(#mobile-action-ring),';
    const descendant =
      'body.mobile-touch.game-active.touch-item-dragging #mobile-controls > :not(#mobile-action-ring) * {';
    expect(css).toContain(child);
    expect(css).toContain(descendant);
    const idx = css.indexOf(descendant);
    const rule = css.slice(idx, css.indexOf('}', idx));
    expect(rule).toContain('pointer-events: none;');
  });
});
