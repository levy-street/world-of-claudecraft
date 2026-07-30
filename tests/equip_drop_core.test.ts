// @vitest-environment jsdom
//
// The bags -> paperdoll drag: the pure drop decision (equip_drop_core.ts) and the
// touch release hit test (item_drop_hit_test.ts).
//
// The decision core is the client's FEEDBACK half of the equip rule; the sim's
// equipItem is the authority. This suite pins them to the same answer for every
// arm, so a lit socket is always one the sim will accept and a refused drop is one
// it would have refused anyway.

import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { EquipSlot } from '../src/sim/types';
import {
  dropRequiredLevel,
  isPaperdollDraggable,
  paperdollDropAction,
} from '../src/ui/equip_drop_core';
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
