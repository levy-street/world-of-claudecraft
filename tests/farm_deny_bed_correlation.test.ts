// The plant deny CORRELATION contract (the Phase 18 bedId-free deny race).
//
// The plant sheet keeps one in-flight send and re-arms its Plant control on
// the deny that answers it. That only works while the answer can be told from
// somebody else's: a farmDenied with no bedId (the husk trade, the shared
// feast) racing an in-flight plant used to clear the sheet's send arm, so a
// second click could leave before the real answer landed.
//
// The seam that fixes it is this file's subject: EVERY plantCrop deny arm
// carries the bedId (and cropId) the command named, so the sheet can match on
// identity instead of accepting an unlabelled deny. The two arms plantCrop
// answers WITHOUT a farmDenied (dead, busy) stay on ctx.error, which the Hud
// forwards to the sheet as the notifyErrorToast backstop; they are pinned here
// too, because the sheet's backstop is only correct while those two arms emit
// no farmDenied at all.
//
// Driven through the real Sim, one arm per deny reason, so a new deny arm that
// forgets its bedId reds here rather than in a HUD test that cannot see it.

import { describe, expect, it } from 'vitest';
import {
  FARM_COMPOST_ITEM_ID,
  FARM_CROPS,
  FARM_GROWTH_TONIC_ITEM_ID,
  type FarmCropDef,
  farmCropById,
} from '../src/sim/content/farm_crops';
import { farmBedById } from '../src/sim/content/farm_patches';
import { setItemLocked } from '../src/sim/item_lock';
import { canPlantCrop } from '../src/sim/professions/farming';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

const BED = 'bed_eastbrook_1';
const CROP_ID = 'vale_wheat';
const SEED_ID = 'vale_wheat_seed';
const HOE_ID = 'garden_hoe';
const START_MS = 1_700_000_000_000;

interface Harness {
  sim: Sim;
  pid: number;
  meta: PlayerMeta;
}

/** Clear the (flavor) plant cast so the busy gate does not eat the next
 *  plant. Real play lets the cast tick out; these arms are about the command
 *  body's deny ladder. */
function clearCast(sim: Sim): void {
  sim.player.castingAbility = null;
  sim.player.castRemaining = 0;
}

/** The first catalog crop a zero-proficiency farmer may not plant, through the
 *  sim's own predicate. */
function gatedCrop(): FarmCropDef & { id: string } {
  for (const id of Object.keys(FARM_CROPS)) {
    const crop = farmCropById(id);
    if (crop && !canPlantCrop(crop, 0)) return { ...crop, id };
  }
  throw new Error('no skill-gated crop in the catalog');
}

function standAtBed(sim: Sim, bedId: string): void {
  const bed = farmBedById(bedId);
  if (!bed) throw new Error(`no such bed: ${bedId}`);
  const p = sim.player;
  p.pos.x = bed.x;
  p.pos.z = bed.z;
  p.pos.y = terrainHeight(bed.x, bed.z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
}

/** A farmer standing at BED with the tier-1 hoe and one seed: every arm below
 *  removes exactly the one thing its own deny is about. */
function makeHarness(): Harness {
  const sim = new Sim({
    seed: 41,
    playerClass: 'warrior',
    autoEquip: false,
    lockoutNowMs: () => START_MS,
  });
  const pid = sim.playerId;
  const meta = sim.players.get(pid) as PlayerMeta;
  standAtBed(sim, BED);
  sim.addItem(HOE_ID, 1, pid);
  sim.addItem(SEED_ID, 1, pid);
  return { sim, pid, meta };
}

/** Every event a call produced, in order. */
function eventsFrom(sim: Sim, from: number): SimEvent[] {
  return sim.events.slice(from);
}

function denies(sim: Sim, from: number): Extract<SimEvent, { type: 'farmDenied' }>[] {
  return eventsFrom(sim, from).filter(
    (e): e is Extract<SimEvent, { type: 'farmDenied' }> => e.type === 'farmDenied',
  );
}

/** Run one plant and return the denies it produced. */
function plant(h: Harness, bedId = BED, cropId = CROP_ID): ReturnType<typeof denies> {
  const from = h.sim.events.length;
  h.sim.plantCrop(bedId, cropId, {}, h.pid);
  return denies(h.sim, from);
}

/** Every plant deny arm, as (reason, how to provoke it). The knob arms pass
 *  their own knobs, so they take a runner rather than a mutation. */
const ARMS: readonly (readonly [string, (h: Harness) => ReturnType<typeof denies>])[] = [
  // A bed id the catalog does not carry: the deny still echoes what was asked
  // for, which is exactly what the sheet needs to ignore it.
  ['bad_bed', (h) => plant(h, 'bed_not_a_bed')],
  [
    'range',
    (h) => {
      h.sim.player.pos.x += 50;
      return plant(h);
    },
  ],
  [
    'bed_taken',
    (h) => {
      h.sim.addItem(SEED_ID, 1, h.pid);
      plant(h);
      // The plant cast is flavor, but the busy gate is real: clear it or the
      // second plant answers through ctx.error instead of reaching bed_taken.
      clearCast(h.sim);
      return plant(h);
    },
  ],
  ['bad_crop', (h) => plant(h, BED, 'not_a_crop')],
  [
    'skill',
    (h) => {
      // A crop the harness farmer's zero proficiency cannot plant, PICKED off
      // the catalog through the sim's own predicate rather than named, so a
      // retune moves the fixture with the content instead of reddening here.
      const crop = gatedCrop();
      h.sim.addItem(crop.seedItemId, 1, h.pid);
      return plant(h, BED, crop.id);
    },
  ],
  [
    'no_seed',
    (h) => {
      h.sim.removeItem(SEED_ID, 1, h.pid);
      return plant(h);
    },
  ],
  [
    'locked',
    (h) => {
      // The lock-caused shortfall: the RAW count would have passed the gate
      // the unlocked count failed, so the deny reads 'locked', not 'no_seed'.
      const slotIndex = h.meta.inventory.findIndex((slot) => slot?.itemId === SEED_ID);
      const flip = setItemLocked(h.sim.ctx, SEED_ID, true, h.pid, slotIndex);
      expect(flip.ok).toBe(true);
      return plant(h);
    },
  ],
  [
    'no_compost',
    (h) => {
      const from = h.sim.events.length;
      h.sim.plantCrop(BED, CROP_ID, { compost: true }, h.pid);
      return denies(h.sim, from);
    },
  ],
  [
    'no_tonic',
    (h) => {
      const from = h.sim.events.length;
      h.sim.plantCrop(BED, CROP_ID, { tonic: true }, h.pid);
      return denies(h.sim, from);
    },
  ],
  [
    'no_fee_produce',
    (h) => {
      const from = h.sim.events.length;
      h.sim.plantCrop(BED, CROP_ID, { watch: true }, h.pid);
      return denies(h.sim, from);
    },
  ],
  [
    'tool',
    (h) => {
      h.sim.removeItem(HOE_ID, 1, h.pid);
      return plant(h);
    },
  ],
];

describe('every plantCrop deny arm carries the bed it was asked about', () => {
  it.each(ARMS)('%s echoes bedId and cropId', (reason, provoke) => {
    const h = makeHarness();
    const produced = provoke(h);
    expect(produced.map((e) => e.reason)).toEqual([reason]);
    const deny = produced[0];
    // The correlation contract itself: a plant deny is never bedId-free, and
    // the id it carries is the one the COMMAND named (a bad bed included), so
    // an in-flight sheet can match on identity.
    expect(deny.bedId).toBeDefined();
    expect(typeof deny.bedId).toBe('string');
    expect(deny.cropId).toBeDefined();
  });

  it('names the exact ids the command carried, not the sheet-open bed', () => {
    const h = makeHarness();
    const produced = plant(h, 'bed_not_a_bed', 'not_a_crop');
    expect(produced).toEqual([
      {
        type: 'farmDenied',
        pid: h.meta.entityId,
        reason: 'bad_bed',
        bedId: 'bed_not_a_bed',
        cropId: 'not_a_crop',
      },
    ]);
  });

  it('covers every plant deny reason the module can emit', () => {
    // Vacuity floor: the arm table must keep pace with plantCrop's ladder, or
    // a new deny arm could land bedId-free with every arm above still green.
    const covered = new Set(ARMS.map(([reason]) => reason));
    for (const reason of [
      'bad_bed',
      'range',
      'bed_taken',
      'bad_crop',
      'skill',
      'no_seed',
      'no_compost',
      'no_fee_produce',
      'no_tonic',
      'tool',
      'locked',
    ]) {
      expect(covered, reason).toContain(reason);
    }
  });
});

describe('the two arms that answer through ctx.error emit no farmDenied', () => {
  // The sheet's notifyErrorToast backstop exists for exactly these two, and
  // is only correct while they stay off the farmDenied channel: an error
  // toast re-arms WITHOUT a bed to match on.
  it('dead answers with an error line and no deny', () => {
    const h = makeHarness();
    h.sim.player.dead = true;
    const from = h.sim.events.length;
    h.sim.plantCrop(BED, CROP_ID, {}, h.pid);
    expect(denies(h.sim, from)).toEqual([]);
    expect(eventsFrom(h.sim, from).filter((e) => e.type === 'error')).toHaveLength(1);
  });

  it('busy answers with an error line and no deny', () => {
    const h = makeHarness();
    h.sim.addItem(SEED_ID, 1, h.pid);
    // The first plant starts the (flavor) plant cast; the second lands on the
    // busy gate.
    plant(h);
    const from = h.sim.events.length;
    h.sim.plantCrop(BED, CROP_ID, {}, h.pid);
    expect(denies(h.sim, from)).toEqual([]);
    expect(eventsFrom(h.sim, from).filter((e) => e.type === 'error')).toHaveLength(1);
  });
});

describe('the bedId-free denies this correlation must survive', () => {
  it('convert_husks denies with no bedId at all', () => {
    // The husk trade has no bed, so it can never carry one: it is exactly the
    // event class the sheet must now ignore rather than treat as its answer.
    const h = makeHarness();
    const from = h.sim.events.length;
    h.sim.convertHusks(h.pid);
    const produced = denies(h.sim, from);
    expect(produced).toHaveLength(1);
    expect(produced[0].bedId).toBeUndefined();
  });
});

describe('compost and tonic arms are provoked honestly', () => {
  it('a compost-knob plant with compost in bags does not deny', () => {
    // Non-vacuity for the no_compost / no_tonic arms above: they must fail on
    // the missing knob item, not on some unrelated gate.
    const h = makeHarness();
    h.sim.addItem(FARM_COMPOST_ITEM_ID, 1, h.pid);
    h.sim.addItem(FARM_GROWTH_TONIC_ITEM_ID, 1, h.pid);
    const from = h.sim.events.length;
    h.sim.plantCrop(BED, CROP_ID, { compost: true, tonic: true }, h.pid);
    expect(denies(h.sim, from)).toEqual([]);
  });
});
