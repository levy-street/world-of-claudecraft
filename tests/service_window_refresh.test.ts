// @vitest-environment happy-dom
// The service-window family's slow-band latch
// (src/ui/hud/vendor/service_window_refresh.ts).
//
// Pins: the signature moves on every dimension the vendor / quartermaster /
// train / unbind painters read; a repeated identical poll never repaints; the
// latch is built only while a service root is shown; an open buy prompt or
// confirm dialog skips the poll without moving the latch (the next poll
// catches up); an explicit repaint re-latches; an expired train Learn flight
// moves the signature on its own.

import { beforeEach, describe, expect, it } from 'vitest';
import type { InvSlot, QuestProgress } from '../src/sim/types';
import {
  ServiceWindowRefresh,
  serviceWindowShown,
} from '../src/ui/hud/vendor/service_window_refresh';
import {
  type ServiceTrainLearns,
  type ServiceWindowWorld,
  serviceWindowSig,
} from '../src/ui/hud/vendor/service_window_refresh_core';
import { TRAIN_PENDING_TTL_MS, TrainLearnTracker } from '../src/ui/hud/vendor/train_learn_core';

type MutableWorld = {
  -readonly [K in keyof ServiceWindowWorld]: ServiceWindowWorld[K];
};

function makeWorld(): MutableWorld {
  let riding: 0 | 1 | 2 = 0;
  const owned: string[] = [];
  const pending: string[] = [];
  return {
    copper: 100,
    honor: 0,
    heroicMarks: 0,
    inventory: [{ itemId: 'linen_cloth', count: 2 }] as InvSlot[],
    equipment: {},
    vendorBuyback: [],
    factions: { a: 0 } as unknown as ServiceWindowWorld['factions'],
    factionCurrencies: { a: 0 } as unknown as ServiceWindowWorld['factionCurrencies'],
    gatheringProficiency: {},
    questLog: new Map<string, QuestProgress>(),
    questsDone: new Set<string>(),
    ridingTrainingTier: () => riding,
    craftingIdentity: {
      knownRecipes: [],
      craftSkills: {},
    } as unknown as ServiceWindowWorld['craftingIdentity'],
    stationPlacements: [],
    ownedBuddies: () => owned as unknown as ReturnType<ServiceWindowWorld['ownedBuddies']>,
    pendingBuddies: () => pending as unknown as ReturnType<ServiceWindowWorld['pendingBuddies']>,
    // test hooks
    ...{ setRiding: (t: 0 | 1 | 2) => (riding = t), owned, pending },
  } as MutableWorld;
}

describe('serviceWindowSig', () => {
  const learns = new TrainLearnTracker();

  it('moves on every dimension the service painters read', () => {
    const cases: Array<[string, (w: MutableWorld) => void]> = [
      ['copper', (w) => (w.copper += 1)],
      ['honor', (w) => (w.honor += 1)],
      ['heroic marks', (w) => (w.heroicMarks += 1)],
      ['inventory count', (w) => (w.inventory[0].count += 1)],
      ['inventory item', (w) => w.inventory.push({ itemId: 'crucible_sigil', count: 1 })],
      [
        'bound flag',
        (w) => (w.inventory[0] = { ...w.inventory[0], instance: { boundTo: 7 } as never }),
      ],
      ['equipment', (w) => (w.equipment = { ring1: 'band' })],
      ['buyback', (w) => w.vendorBuyback.push({ itemId: 'x', count: 1 })],
      ['faction standing', (w) => ((w.factions as Record<string, number>).a = 3000)],
      ['faction currency', (w) => ((w.factionCurrencies as Record<string, number>).a = 5)],
      ['proficiency', (w) => (w.gatheringProficiency = { mining: 10 })],
      [
        'quest accepted',
        (w) => w.questLog.set('q1', { questId: 'q1', counts: [], state: 'active' }),
      ],
      ['quest done', (w) => w.questsDone.add('q2')],
      ['riding tier', (w) => (w as unknown as { setRiding(t: 1): void }).setRiding(1)],
      [
        'known recipes',
        (w) => {
          w.craftingIdentity = { ...w.craftingIdentity, knownRecipes: ['r1'] };
        },
      ],
      [
        'craft skill',
        (w) => {
          w.craftingIdentity = { ...w.craftingIdentity, craftSkills: { smithing: 5 } };
        },
      ],
      ['station placements', (w) => (w.stationPlacements = [{ id: 's' } as never])],
      ['buddies', (w) => (w as unknown as { owned: string[] }).owned.push('b1')],
      ['pending buddies', (w) => (w as unknown as { pending: string[] }).pending.push('b1')],
      [
        'Perfecting flag',
        (w) =>
          (w.inventory[0] = { ...w.inventory[0], instance: { perfectingBound: true } as never }),
      ],
    ];
    for (const [label, mutate] of cases) {
      const w = makeWorld();
      const before = serviceWindowSig(w, learns, 0);
      expect(serviceWindowSig(w, learns, 0), label).toBe(before);
      mutate(w);
      expect(serviceWindowSig(w, learns, 0), label).not.toBe(before);
    }
  });

  it('moves when a pending buddy turns owned (the counts are not summed)', () => {
    const w = makeWorld();
    const hooks = w as unknown as { owned: string[]; pending: string[] };
    hooks.pending.push('b1');
    const before = serviceWindowSig(w, learns, 0);
    hooks.pending.pop();
    hooks.owned.push('b1');
    expect(serviceWindowSig(w, learns, 0)).not.toBe(before);
  });

  it('moves on an in-flight and on a confirmed train Learn', () => {
    const w = makeWorld();
    let pendingIds = new Set<string>();
    let confirmed = new Set<string>();
    const fake: ServiceTrainLearns = {
      pendingIds: () => pendingIds,
      confirmedIds: () => confirmed,
    };
    const before = serviceWindowSig(w, fake, 0);
    pendingIds = new Set(['r1']);
    const inFlight = serviceWindowSig(w, fake, 0);
    expect(inFlight).not.toBe(before);
    pendingIds = new Set();
    confirmed = new Set(['r1']);
    const done = serviceWindowSig(w, fake, 0);
    expect(done).not.toBe(before);
    expect(done).not.toBe(inFlight);
  });

  it('moves on a same-size recipe or station swap, not just a count change', () => {
    const w = makeWorld();
    w.craftingIdentity = { ...w.craftingIdentity, knownRecipes: ['r1'] };
    w.stationPlacements = [{ id: 's1', type: 'forge' } as never];
    const before = serviceWindowSig(w, learns, 0);
    w.craftingIdentity = { ...w.craftingIdentity, knownRecipes: ['r2'] };
    const swappedRecipe = serviceWindowSig(w, learns, 0);
    expect(swappedRecipe).not.toBe(before);
    w.stationPlacements = [{ id: 's2', type: 'forge' } as never];
    expect(serviceWindowSig(w, learns, 0)).not.toBe(swappedRecipe);
  });

  it('moves on a quest state flip and on a Learn flight opening and expiring', () => {
    const w = makeWorld();
    w.questLog.set('q1', { questId: 'q1', counts: [], state: 'active' });
    const active = serviceWindowSig(w, learns, 0);
    w.questLog.set('q1', { questId: 'q1', counts: [], state: 'ready' });
    expect(serviceWindowSig(w, learns, 0)).not.toBe(active);

    const flights = new TrainLearnTracker();
    const idle = serviceWindowSig(w, flights, 0);
    flights.begin('r1', 0);
    const inFlight = serviceWindowSig(w, flights, 1);
    expect(inFlight).not.toBe(idle);
    // A lost Learn expires on time alone: nothing else moved.
    expect(serviceWindowSig(w, flights, TRAIN_PENDING_TTL_MS)).toBe(idle);
  });
});

describe('ServiceWindowRefresh', () => {
  let world: MutableWorld;
  let learns: TrainLearnTracker;
  let repaints: number;
  let latch: ServiceWindowRefresh;

  beforeEach(() => {
    document.body.innerHTML =
      '<div id="vendor-window" style="display:block"></div><div id="train-window"></div>' +
      '<div id="prompt-stack"></div>';
    world = makeWorld();
    learns = new TrainLearnTracker();
    repaints = 0;
    latch = new ServiceWindowRefresh(() => {
      repaints++;
      latch.relatch(world, learns, 0);
    });
  });

  it('repaints when the data moves and never on a repeated identical poll', () => {
    expect(latch.refreshIfChanged(world, learns, 0)).toBe(true);
    expect(repaints).toBe(1);
    for (let i = 0; i < 3; i++) expect(latch.refreshIfChanged(world, learns, 0)).toBe(false);
    expect(repaints).toBe(1);
    world.honor = 50; // honor gained online: the WARFARE / vendor rows re-price
    expect(latch.refreshIfChanged(world, learns, 0)).toBe(true);
    expect(repaints).toBe(2);
  });

  it('builds the signature once per repainting poll (the repaint relatch is skipped)', () => {
    let builds = 0;
    const tier = world.ridingTrainingTier;
    world.ridingTrainingTier = () => {
      builds++;
      return tier();
    };
    expect(latch.refreshIfChanged(world, learns, 0)).toBe(true);
    expect(builds).toBe(1);
    // An explicit repaint outside the poll still re-latches.
    world.copper = 7;
    latch.relatch(world, learns, 0);
    expect(builds).toBe(2);
    expect(latch.refreshIfChanged(world, learns, 0)).toBe(false);
  });

  it('an explicit repaint re-latches, so the next poll does not rebuild again', () => {
    latch.refreshIfChanged(world, learns, 0);
    world.copper = 5;
    latch.relatch(world, learns, 0); // the inventory hook's repaint
    expect(latch.refreshIfChanged(world, learns, 0)).toBe(false);
    expect(repaints).toBe(1);
  });

  it('does nothing while no service root is shown', () => {
    const vendor = document.getElementById('vendor-window') as HTMLElement;
    vendor.style.display = 'none';
    expect(serviceWindowShown()).toBe(false);
    world.copper = 1;
    expect(latch.refreshIfChanged(world, learns, 0)).toBe(false);
    expect(repaints).toBe(0);
    (document.getElementById('train-window') as HTMLElement).style.display = 'block';
    expect(latch.refreshIfChanged(world, learns, 0)).toBe(true);
  });

  it('skips under an open buy prompt or confirm dialog and catches up after', () => {
    latch.refreshIfChanged(world, learns, 0);
    const prompt = document.createElement('div');
    prompt.className = 'buy-quantity-prompt';
    document.getElementById('prompt-stack')?.append(prompt);
    world.copper = 9;
    expect(latch.refreshIfChanged(world, learns, 0)).toBe(false);
    prompt.remove();
    const confirm = document.createElement('div');
    confirm.id = 'confirm-dialog';
    document.body.append(confirm);
    expect(latch.refreshIfChanged(world, learns, 0)).toBe(false);
    expect(repaints).toBe(1);
    confirm.remove();
    expect(latch.refreshIfChanged(world, learns, 0)).toBe(true);
    expect(repaints).toBe(2);
  });

  it('repaints when a lost train Learn expires', () => {
    learns.begin('r1', 0);
    latch.refreshIfChanged(world, learns, 1);
    expect(latch.refreshIfChanged(world, learns, 2)).toBe(false);
    expect(latch.refreshIfChanged(world, learns, TRAIN_PENDING_TTL_MS + 1)).toBe(true);
  });
});
