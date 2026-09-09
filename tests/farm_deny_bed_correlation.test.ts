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

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
import { stripComments } from './helpers/strip_comments';

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
    //
    // Derived from the SOURCE, never from a second list beside this one: the
    // hardcoded 11-element array this replaces compared a list against a list,
    // so a new gate reusing an existing reason (a second 'locked' arm that
    // forgot its bedId, say) added nothing to either side and reddened
    // nothing. plantDenyReasonsIn below is exercised against synthetic source
    // in its own arm, so the extractor cannot go blind unnoticed.
    const covered = [...new Set(ARMS.map(([reason]) => reason))].sort();
    expect(covered).toEqual([...plantDenyReasonsIn(farmingSource())].sort());
  });

  it('every farmDenied emit in the ladder carries bedId, in the source itself', () => {
    // The correlation contract read straight off plantCrop, and the arm that
    // closes the hole the reason-set floor structurally cannot: a NEW gate
    // reusing an EXISTING reason word (a second 'locked' arm, say) changes
    // neither list, so only this one can see it go out bedId-free.
    const emits = plantDenyEmitsIn(farmingSource());
    expect(emits.length, 'plantCrop should still have a deny ladder to check').toBeGreaterThan(9);
    for (const emit of emits) {
      expect(emit, 'a plantCrop farmDenied emit without bedId').toContain('bedId');
      expect(emit, 'a plantCrop farmDenied emit without cropId').toContain('cropId');
    }
  });
});

// ---------------------------------------------------------------------------
// The vacuity floor's own input: plantCrop's deny ladder, read from the module.
// ---------------------------------------------------------------------------

const FARMING_SRC = resolve(process.cwd(), 'src/sim/professions/farming.ts');
const PLANT_CROP_OPENER = 'export function plantCrop(';

function farmingSource(): string {
  return readFileSync(FARMING_SRC, 'utf8');
}

/** plantCrop's body alone, comment-stripped. A free function, so its body ends
 *  at the first column-0 close after the opener; both anchors throw rather
 *  than slicing an empty (vacuously passing) span. */
function plantCropBody(source: string): string {
  const stripped = stripComments(source);
  const start = stripped.indexOf(PLANT_CROP_OPENER);
  if (start === -1) throw new Error(`plantCrop opener not found: ${PLANT_CROP_OPENER}`);
  const end = stripped.indexOf('\n}', start);
  if (end === -1) throw new Error('plantCrop has no column-0 close');
  return stripped.slice(start, end);
}

/**
 * Every farmDenied reason plantCrop can emit, read off its two emit shapes:
 * an inline `reason: 'x'` property, and a `const reason = cond ? 'x' : 'y'`
 * assignment the emit then shorthands. Comments are stripped first, so a
 * reason NAMED in prose can never stand in for one the code emits.
 *
 * The shape check below is what keeps this honest: every farmDenied emit in
 * the body must be accounted for by one of those two forms, so a third emit
 * shape (a helper call, a reason held in a differently named variable) fails
 * loudly here instead of quietly shrinking the derived set.
 */
function plantDenyReasonsIn(source: string): Set<string> {
  const body = plantCropBody(source);
  const reasons = new Set<string>();
  let inline = 0;
  for (const m of body.matchAll(/reason:\s*'([a-z_]+)'/g)) {
    reasons.add(m[1]);
    inline++;
  }
  let assigned = 0;
  for (const m of body.matchAll(/\breason\s*=[^;]*;/g)) {
    for (const lit of m[0].matchAll(/'([a-z_]+)'/g)) reasons.add(lit[1]);
    assigned++;
  }
  const emits = [...body.matchAll(/type:\s*'farmDenied'/g)].length;
  if (emits !== inline + assigned) {
    throw new Error(
      `plantCrop has ${emits} farmDenied emits but ${inline} inline reasons and ` +
        `${assigned} reason assignments: teach this extractor the new emit shape`,
    );
  }
  return reasons;
}

/** Each farmDenied emit statement in plantCrop's body, comment-stripped. The
 *  emits are single object literals with no nested brace of their own, so the
 *  first `})` closes each one. */
function plantDenyEmitsIn(source: string): string[] {
  return [...plantCropBody(source).matchAll(/ctx\.emit\(\{[\s\S]*?\}\);/g)]
    .map((m) => m[0])
    .filter((emit) => emit.includes("'farmDenied'"));
}

describe('the deny-reason extractor behind that floor', () => {
  it('reads both live emit shapes out of the real module', () => {
    const found = plantDenyReasonsIn(farmingSource());
    // Both shapes are genuinely present today: an inline literal arm and a
    // ternary-assigned one. If either class ever disappears the floor above
    // is still correct, but this says so out loud.
    expect(found.has('bad_bed')).toBe(true);
    expect(found.has('locked')).toBe(true);
    expect(found.size).toBeGreaterThan(5);
  });

  it('picks up a NEW deny arm that reuses an existing reason word', () => {
    // The exact hole the hardcoded list could not see. Injected into the REAL
    // source text (never the file), so the extractor is proven against the
    // shape it actually has to read.
    const injected = farmingSource().replace(
      '  const bed = farmBedById(bedId);',
      "  if (bedId === 'scratch_only') {\n" +
        "    ctx.emit({ type: 'farmDenied', pid: meta.entityId, reason: 'scratch_only', cropId });\n" +
        '    return;\n' +
        '  }\n' +
        '  const bed = farmBedById(bedId);',
    );
    expect(injected).not.toBe(farmingSource());
    expect(plantDenyReasonsIn(injected).has('scratch_only')).toBe(true);
  });

  it('refuses to guess when an emit stops matching either known shape', () => {
    // A reason routed through anything else (a helper, a differently named
    // variable) must fail loudly rather than shrink the set in silence.
    const injected = farmingSource().replace(
      '  const bed = farmBedById(bedId);',
      "  if (bedId === 'scratch_only') {\n" +
        '    const why = pickReason();\n' +
        "    ctx.emit({ type: 'farmDenied', pid: meta.entityId, reason: why, cropId });\n" +
        '    return;\n' +
        '  }\n' +
        '  const bed = farmBedById(bedId);',
    );
    expect(() => plantDenyReasonsIn(injected)).toThrow(/teach this extractor/);
  });

  it('the bedId floor bites on an id-free arm that reuses an existing reason', () => {
    // The proof that the source-read floor is decisive where the two-list one
    // was blind: this arm adds NO new reason word, so the reason-set floor
    // sees nothing at all. Injected into the REAL source text, never the file.
    const injected = farmingSource().replace(
      '  const bed = farmBedById(bedId);',
      "  if (bedId === 'scratch_only') {\n" +
        "    ctx.emit({ type: 'farmDenied', pid: meta.entityId, reason: 'locked' });\n" +
        '    return;\n' +
        '  }\n' +
        '  const bed = farmBedById(bedId);',
    );
    expect(injected).not.toBe(farmingSource());
    // Unchanged reason set: the old floor's whole input.
    expect([...plantDenyReasonsIn(injected)].sort()).toEqual(
      [...plantDenyReasonsIn(farmingSource())].sort(),
    );
    // The bedId floor sees it.
    const idFree = plantDenyEmitsIn(injected).filter((emit) => !emit.includes('bedId'));
    expect(idFree).toHaveLength(1);
  });

  it('never reads a reason out of a COMMENT', () => {
    const injected = farmingSource().replace(
      '  const bed = farmBedById(bedId);',
      "  // a future arm will emit reason: 'commented_only' here\n" +
        '  const bed = farmBedById(bedId);',
    );
    expect(plantDenyReasonsIn(injected).has('commented_only')).toBe(false);
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
