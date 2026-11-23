// @vitest-environment happy-dom
// A streamed armor set through the REAL CharacterVisual, wired the way the world view wires
// a body (index.ts createCharacterVisual, then renderer.ts createCharacterVisualWithRetry:
// the compile gate with the renderer's work queue riding in beside it), with only asset IO
// stubbed (tests/helpers/woc_visual_harness.ts). The dressing and the store are pinned
// against a fake host elsewhere (tests/woc_armor_dressing.test.ts,
// tests/woc_armor_packs.test.ts); this suite pins the visual's half of that seam, which
// nothing else would notice going missing: the store learns the queue from the first world
// view, a body with the queue behind it never attaches a set inside its own frame (one
// prepare unit for the file, then one attach unit a body), a body built directly still
// attaches on the spot, a build that finds the set resident is born wearing it, and the
// visual's teardown reaches the armor backstop whatever a file does on its way out.
import type * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GPU_WORK_PRIORITY } from '../src/render/background_gpu_queue';
import {
  IDLE,
  KEY,
  manifest,
  player,
  releaseWocVisualHarness,
  type WocHarnessVisual,
  type WocVisualHarnessOptions,
  wocVisualHarness,
} from './helpers/woc_visual_harness';

type Visual = WocHarnessVisual;

/** The label kinds of a pack's prepare and of one body's attach (what the budget prices). */
const PREPARE = 'woc-armor-prepare';
const ATTACH = 'woc-armor-attach';
const kindOf = (label: string | undefined): string => (label ?? '').split(':')[0];
/** The attached file's Group of skinned parts on the model (woc_armor_packs.ts). */
const CONTAINER = 'woc_armor_fixture';
/** Equipment that dresses both slots of the fixture kit. */
const WORN = { helmet: 'any-helm', chest: 'any-chest' };

interface Unit {
  readonly run: () => void;
  readonly priority: number | undefined;
  readonly label: string | undefined;
}

/** The renderer's background work queue as a body and the store see it, holding every unit
 *  until the case runs it. */
function heldQueue() {
  const units: Unit[] = [];
  return {
    units,
    run<T>(work: () => T | Promise<T>, priority?: number, label?: string): Promise<T> {
      return new Promise<T>((resolve) => {
        units.push({ run: () => resolve(work() as T), priority, label });
      });
    },
    /** The armor units waiting, in the order they were asked for. */
    armor: (): Unit[] => units.filter((unit) => unit.label?.startsWith('woc-armor-')),
    /** The kinds of the armor units waiting, in the order they were asked for. */
    armorKinds: (): string[] =>
      units.filter((unit) => unit.label?.startsWith('woc-armor-')).map((u) => kindOf(u.label)),
    /** Run the first unit waiting under the label kind `kind`. */
    runOne(kind: string): void {
      const at = units.findIndex((unit) => kindOf(unit.label) === kind);
      if (at < 0) throw new Error(`no ${kind} unit queued`);
      units.splice(at, 1)[0].run();
    },
    drain(): void {
      for (const unit of units.splice(0)) unit.run();
    },
  };
}

async function world(opts: WocVisualHarnessOptions = {}) {
  const h = await wocVisualHarness(opts);
  const { createCharacterVisual } = await import('../src/render/characters/index');
  const queue = heldQueue();
  const gate = (target: THREE.Object3D, settle: (ready?: () => boolean) => void): void => {
    h.gates.push({ target, settle });
  };
  /** A crowd character the world view just built: the factory, then the gate and the queue,
   *  then its first worn-set diff. */
  const body = (): Visual => {
    const v = createCharacterVisual(player({ ...h.DEFAULT_APPEARANCE }));
    if (!v) throw new Error('the fixture body did not build');
    v.setFarBakeGate(gate, queue);
    v.setWocEquipment(WORN, false);
    return v;
  };
  /** One frame of every body given, then every gate request in flight settles. */
  const frame = (bodies: readonly Visual[]): void => {
    h.nextFrame(16);
    for (const v of bodies) v.update(0.016, IDLE, true);
    for (const g of h.gates.splice(0)) g.settle(() => true);
  };
  return { h, queue, body, frame, gate };
}

const containerOf = (v: Visual): THREE.Object3D | undefined => v.root.getObjectByName(CONTAINER);

/** Whether a kit part of a body is shown through its whole chain up to the body's root. */
function partShown(v: Visual, name: string): boolean {
  const part = v.root.getObjectByName(name);
  if (!part) return false;
  for (let at: THREE.Object3D | null = part; at && at !== v.root; at = at.parent) {
    if (!at.visible) return false;
  }
  return true;
}

afterEach(() => {
  releaseWocVisualHarness();
});

describe('a set landing for world bodies already in view', () => {
  it('is prepared once as a unit of the queue the first view handed over, then attached one body a unit, never inside a frame', async () => {
    const { h, queue, body, frame } = await world({ armorHeld: true });
    const bodies = [body(), body(), body()];
    frame(bodies);
    expect(queue.armor()).toEqual([]);
    for (const v of bodies) expect(containerOf(v)).toBeUndefined();

    // the set lands: the store asks the queue it learned from the first view for ONE prepare
    await h.landArmor();
    expect(queue.armorKinds()).toEqual([PREPARE]);
    expect(queue.armor()[0].priority).toBe(GPU_WORK_PRIORITY.VISIBLE_PREWARM);
    // a frame of all three: nothing attaches inside an update, and nothing is asked for yet
    frame(bodies);
    expect(queue.armorKinds()).toEqual([PREPARE]);
    for (const v of bodies) expect(containerOf(v)).toBeUndefined();

    queue.runOne(PREPARE);
    frame(bodies);
    // one attach unit a body, at the stand-ins' priority, and still nothing on any body
    expect(queue.armorKinds()).toEqual([ATTACH, ATTACH, ATTACH]);
    for (const unit of queue.armor()) expect(unit.priority).toBe(GPU_WORK_PRIORITY.VISIBLE_PREWARM);
    for (const v of bodies) {
      expect(containerOf(v)).toBeUndefined();
      // the suit stands in: the body itself draws throughout
      expect(partShown(v, 'Character_Body')).toBe(true);
    }
    // waiting frames ask nothing more
    frame(bodies);
    expect(queue.armor()).toHaveLength(3);

    // the queue's budget lets one through
    queue.runOne(ATTACH);
    expect(bodies.map((v) => containerOf(v) !== undefined)).toEqual([true, false, false]);
    // attached behind the compile gate: its nodes went to the gate, hidden until they link
    expect(h.gates.some((g) => g.target.name === CONTAINER)).toBe(true);
    expect(partShown(bodies[0], 'Helm')).toBe(false);
    // its next frame re-dresses it (the per-frame path), and the gate settles: it wears the kit
    frame(bodies);
    expect(partShown(bodies[0], 'Helm')).toBe(true);
    expect(partShown(bodies[0], 'Chest')).toBe(true);
    expect(partShown(bodies[1], 'Helm')).toBe(false);

    for (const unit of queue.armor().filter((u) => kindOf(u.label) === ATTACH)) unit.run();
    frame(bodies);
    for (const v of bodies) {
      expect(partShown(v, 'Helm')).toBe(true);
      expect(partShown(v, 'Chest')).toBe(true);
    }
    for (const v of bodies) v.dispose();
  });

  it('is skipped for a body gone before its unit ran, with no reference left behind', async () => {
    const { h, queue, body, frame } = await world({ armorHeld: true });
    const [stays, leaves] = [body(), body()];
    await h.landArmor();
    queue.runOne(PREPARE);
    frame([stays, leaves]);
    expect(queue.armorKinds()).toEqual([ATTACH, ATTACH]);
    const kit = h.armor.wocArmorContainers;
    leaves.dispose();
    queue.drain();
    expect(containerOf(leaves)).toBeUndefined();
    expect(containerOf(stays)).toBeDefined();
    const model = containerOf(stays)?.parent as THREE.Object3D;
    const url = kit(model)[0].userData.wocArmorPack as string;
    expect(h.armor.wocArmorPackRefs(url)).toBe(1);
    stays.dispose();
    expect(h.armor.wocArmorPackRefs(url)).toBe(0);
  });
});

describe('a body that must come out whole', () => {
  it('attaches on the spot when built directly (a preview, a portrait), with the world queue running beside it', async () => {
    const { h, queue, body } = await world({ armorHeld: true });
    const peer = body(); // the store has the world's queue and the rig from here on
    // a body built directly: full detail, a gate of its own and no queue
    const preview = new h.CharacterVisual(KEY, 0xffffff, 0);
    preview.setFarBakeGate((_target, settle) => settle());
    preview.setWocEquipment(WORN, false);
    expect(containerOf(preview)).toBeUndefined();
    await h.landArmor();
    // its own frame attaches the set, inside the update, while the world's units still wait
    h.nextFrame(16);
    preview.update(0.016, IDLE, true);
    expect(containerOf(preview)).toBeDefined();
    preview.update(0.016, IDLE, true);
    expect(partShown(preview, 'Helm')).toBe(true);
    expect(containerOf(peer)).toBeUndefined();
    expect(queue.armorKinds().includes(ATTACH)).toBe(false);
    preview.dispose();
    peer.dispose();
  });

  it('is born in its suit as a crowd character built in a live frame while its file waits on its prepare, and whole behind an arrival cover', async () => {
    const { h, queue, body, frame } = await world({ armorHeld: true });
    const { wocArmorPackUrl } = await import('../src/render/characters/woc_armor_core');
    const cover = await import('../src/render/arrival_cover');
    const kit = wocArmorPackUrl('male', 'fixture', 'medium');
    const first = body();
    await h.landArmor();
    // resident, its prepare still waiting in the queue
    expect(queue.armorKinds()).toEqual([PREPARE]);
    // the next wearer's view is built in a live frame: nothing of the prepare is paid inside
    // its build, and it stands in its suit like the one that arrived before the file
    const late = body();
    expect(containerOf(late)).toBeUndefined();
    expect(partShown(late, 'Character_Body')).toBe(true);
    expect(h.armor.wocArmorPackPrepared(kit)).toBe(false);
    // a view built behind a loading screen (an entry, a teleport) cannot come out in its
    // suit: attached inside its build, the file prepared there
    cover.setArrivalCover(true);
    const covered = body();
    cover.setArrivalCover(false);
    expect(containerOf(covered)).toBeDefined();
    expect(partShown(covered, 'Helm')).toBe(true);
    expect(h.armor.wocArmorPackPrepared(kit)).toBe(true);
    // prepared: every later build is born whole
    const later = body();
    expect(containerOf(later)).toBeDefined();
    expect(partShown(later, 'Helm')).toBe(true);
    // the two still in their suits attach as units, one each; the two born whole ask for none
    frame([first, late, covered, later]);
    expect(queue.armorKinds().filter((kind) => kind === ATTACH)).toHaveLength(2);
    queue.drain();
    frame([first, late, covered, later]);
    for (const v of [first, late, covered, later]) {
      expect(partShown(v, 'Helm')).toBe(true);
      expect(partShown(v, 'Chest')).toBe(true);
    }
    for (const v of [first, late, covered, later]) v.dispose();
    expect(h.armor.wocArmorPackRefs(kit)).toBe(0);
  });
});

describe('a tier landing over its stand-in on a world body', () => {
  it('is refused when the gate cannot prove it, the stand-in drawing on, and a buff glow that lands mid-link is no miss', async () => {
    const { h, queue, body } = await world({ armorHeld: true });
    const { wocArmorPackUrl } = await import('../src/render/characters/woc_armor_core');
    const low = wocArmorPackUrl('male', 'fixture', 'low');
    const medium = wocArmorPackUrl('male', 'fixture', 'medium');
    // the low file is in memory (a portrait fetched it): it stands in for the crowd's medium
    h.armor.ensureWocArmorPack(low);
    await h.landArmor();
    const v = body();
    const model = containerOf(v)?.parent as THREE.Object3D;
    const files = (): string[] =>
      h.armor.wocArmorContainers(model).map((c) => c.userData.wocArmorPack as string);
    expect(files()).toEqual([low]);
    const step = (): void => {
      h.nextFrame(16);
      v.update(0.016, IDLE, true);
    };
    step();
    for (const g of h.gates.splice(0)) g.settle(() => true);

    // the medium file lands, is prepared, and attaches as a unit: hidden behind the gate
    await h.landArmor();
    queue.runOne(PREPARE);
    step();
    queue.runOne(ATTACH);
    expect(files()).toEqual([low, medium]);
    const pieces = new Set(h.armor.wocArmorPieces(h.armor.wocArmorContainers(model)[1]));
    /** Settle every gate ask in flight for the incoming file's nodes; returns how many. */
    const settleIncoming = (proof: boolean): number => {
      let settled = 0;
      for (let i = h.gates.length - 1; i >= 0; i--) {
        if (!pieces.has(h.gates[i].target)) continue;
        const [asked] = h.gates.splice(i, 1);
        asked.settle(() => proof);
        settled++;
      }
      return settled;
    };
    step();
    // a buff glow lands and lifts while the file links: each settle reads unproven because
    // the materials moved under the gate, which says nothing about the file
    for (let edge = 0; edge < 6; edge++) {
      v.setAuraGlow(0xffaa00, edge % 2 === 0 ? 0.5 : 0);
      expect(settleIncoming(false)).toBeGreaterThan(0);
      expect(files()).toEqual([low, medium]);
    }
    expect(partShown(v, 'Helm')).toBe(true);
    // the gate gives up on the very materials it was asked with, try after try
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    settleIncoming(false);
    settleIncoming(false);
    expect(files()).toEqual([low, medium]);
    settleIncoming(false);
    expect(logged).toHaveBeenCalledTimes(1);
    // refused: the medium file came off unseen, and the low file is still what draws
    expect(files()).toEqual([low]);
    expect(h.armor.wocArmorPackRefs(medium)).toBe(0);
    for (let frame = 0; frame < 3; frame++) step();
    expect(partShown(v, 'Helm')).toBe(true);
    expect(partShown(v, 'Chest')).toBe(true);
    // ...and nothing asks for it again: no attach unit, no gate ask
    expect(files()).toEqual([low]);
    expect(queue.armorKinds().filter((kind) => kind === ATTACH)).toEqual([]);
    v.dispose();
    expect(h.armor.wocArmorPackRefs(low)).toBe(0);
  });
});

describe('a WOC body torn down while a file throws on its way out', () => {
  it('still reaches the armor backstop and the rest of its teardown', async () => {
    const { h, body } = await world();
    const v = body();
    const container = containerOf(v);
    if (!container?.parent) throw new Error('the fixture kit did not attach at build');
    const model = container.parent;
    const kit = container.userData.wocArmorPack as string;
    // a container the dressing never heard of: only the visual's backstop gives it back
    const { wocArmorPackUrl } = await import('../src/render/characters/woc_armor_core');
    const extra = wocArmorPackUrl('male', 'extra', 'medium');
    h.armor.ensureWocArmorPack(extra);
    await vi.waitFor(() => expect(h.armor.wocArmorPackResident(extra)).toBe(true));
    expect(h.armor.attachWocArmorPack(model, extra, 'extra', manifest)).not.toBeNull();
    expect([h.armor.wocArmorPackRefs(kit), h.armor.wocArmorPackRefs(extra)]).toEqual([1, 1]);
    expect(h.claimed()).toBeGreaterThan(0);
    // the kit's own node cannot leave the model
    container.removeFromParent = () => {
      throw new Error('a node that will not detach');
    };
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => v.dispose()).not.toThrow();
    // the dressing gave its reference back all the same, the backstop gave back the other,
    // and the teardown went on past both (its tinted materials are released)
    expect([h.armor.wocArmorPackRefs(kit), h.armor.wocArmorPackRefs(extra)]).toEqual([0, 0]);
    expect(h.claimed()).toBe(0);
  });
});
