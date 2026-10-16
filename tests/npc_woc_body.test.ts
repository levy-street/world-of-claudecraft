// @vitest-environment happy-dom
// A world NPC on its WOC body, through the real factory
// (src/render/characters/index.ts createCharacterVisual) and the real CharacterVisual,
// with only asset IO stubbed (tests/helpers/woc_visual_harness.ts): the body of its
// class, born wearing its authored look and body size, in its class kit with the HEAD
// BARE (no helm or hood ever covers an NPC's face), holding its fixed props in place of
// the class's own weapons. The roster itself is pinned pure in tests/npc_looks.test.ts.
//
// An NPC is also the one WOC body the renderer POOLS and never diffs per frame, so two
// things a player's body gets for free are pinned here for it: a pooled body handed its
// gate alone still rides the renderer's work queue, and it calls the under-armor atlas
// retry from its own frame, the call a player's worn-set diff makes for a player.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VisualDef } from '../src/render/characters/manifest';
import type { Entity } from '../src/sim/types';
import {
  IDLE,
  KEY,
  player,
  releaseWocVisualHarness,
  type WocHarnessVisual,
  type WocVisualHarnessOptions,
  wocVisualHarness,
} from './helpers/woc_visual_harness';

type Visual = WocHarnessVisual;
type Gate = Parameters<Visual['setFarBakeGate']>[0];

/** Brother Halven: a paladin on the male body, the def the harness fixtures (KEY). */
const HALVEN = 'brother_halven';
const QUIFF = 'models/chars/players/woc/head_type_a_hair_quiff.glb';
const HAIR_QUIFF = 'WocHead_A_hair_quiff';

const npc = (templateId: string): Entity =>
  ({
    kind: 'npc',
    id: 21,
    templateId,
    color: 0x8fb7ff,
    skin: 0,
    mainhandItemId: null,
    offhandItemId: null,
    auras: [],
  }) as unknown as Entity;

const drawn = (v: Visual, name: string): boolean => {
  for (let at = v.root.getObjectByName(name) ?? null; at; at = at.parent) {
    if (!at.visible) return false;
    if (at === v.root) return true;
  }
  return false;
};
const defOf = (v: Visual): VisualDef => (v as unknown as { def: VisualDef }).def;

/** The renderer's background work queue as a body sees it, holding every unit until the
 *  case runs it (tests/woc_merge_visual.test.ts has the long form). */
function heldQueue() {
  const units: { run: () => void; label: string | undefined }[] = [];
  return {
    units,
    run<T>(work: () => T | Promise<T>, _priority?: number, label?: string): Promise<T> {
      return new Promise<T>((resolve) => {
        units.push({ run: () => resolve(work() as T), label });
      });
    },
  };
}

async function world(opts: WocVisualHarnessOptions = {}) {
  const h = await wocVisualHarness(opts);
  const index = await import('../src/render/characters/index');
  const manifest = await import('../src/render/characters/manifest');
  const looks = await import('../src/render/characters/npc_looks');
  const diff = await import('../src/render/live_look_diff');
  const body = (e: Entity): Visual => {
    const v = index.createCharacterVisual(e);
    if (!v) throw new Error('the world body did not build');
    return v;
  };
  const frame = (v: Visual): void => {
    h.nextFrame(16);
    v.update(0.016, IDLE, true);
  };
  const gate: Gate = (target, settle) => h.gates.push({ target, settle });
  /** Settle every gate ask in flight (the links landed). */
  const link = (): void => {
    for (const ask of h.gates.splice(0)) ask.settle(() => true);
  };
  return { h, body, frame, gate, link, manifest, looks, diff };
}

afterEach(() => releaseWocVisualHarness());

describe('a world NPC on its WOC body', () => {
  it('builds on the body of its class, wearing its authored face and size', async () => {
    const { body, manifest, looks } = await world();
    const look = looks.npcLookFor(HALVEN);
    if (!look) throw new Error('no look');
    // the fixture def IS the body the roster names for him
    expect(manifest.visualKeyFor(npc(HALVEN))).toBe(KEY);
    const v = body(npc(HALVEN));
    expect(v.wocHeadLook?.look).toEqual({
      hair: look.app.headHair,
      beard: look.app.headBeard,
      nose: look.app.headNose,
      mouth: look.app.headMouth,
      brows: look.app.headBrows,
      ears: look.app.headEars,
      eyes: look.app.headEyes,
      piercing: look.app.headPiercing,
    });
    // the face controls land as morph influences, not the sculpt's rest face
    expect(v.wocHeadLook?.morphs.FS_Eyes_Spacing).toBeCloseTo(look.app.headShape.eyeSpacing, 6);
    expect(v.wocHeadLook?.morphs.FS_Chin_Softness).toBeCloseTo(look.app.headShape.chinWidth, 6);
    // and the body draws at his authored size (not the def's own)
    expect(look.app.bodyScale).not.toBe(1);
    expect(v.height).toBeCloseTo(manifest.VISUALS[KEY].height * look.app.bodyScale, 6);
  });

  it('wears its class kit with the head bare: the helm never shows, the hair does', async () => {
    const { body, frame, diff } = await world();
    const e = npc(HALVEN);
    const v = body(e);
    expect(drawn(v, 'Chest')).toBe(true);
    expect(drawn(v, 'Helm')).toBe(false);
    expect(v.wocHeadDrawnLook?.hair).toBe('quiff');
    expect(drawn(v, HAIR_QUIFF)).toBe(true);
    // nothing dresses an NPC per frame (the worn-set diff is the players'), and the
    // first-frame "nobody dressed this body" fallback must not put the full kit back on
    expect(diff.diffWornArmor(e, v)).toBe(false);
    frame(v);
    frame(v);
    expect(drawn(v, 'Helm')).toBe(false);
    expect(drawn(v, HAIR_QUIFF)).toBe(true);
    expect(drawn(v, 'Chest')).toBe(true);
  });

  it('is built with its fixed props as its attach list and no weapon swap slot', async () => {
    const { body, manifest, looks } = await world();
    const look = looks.npcLookFor(HALVEN);
    const v = body(npc(HALVEN));
    // the class def keeps a swap slot for a player's equipped weapon...
    expect(manifest.VISUALS[KEY].weaponSlots?.length ?? 0).toBeGreaterThan(0);
    // ...the NPC's body has none: its attach list IS its props
    expect(look?.props).toBe('staff');
    expect(defOf(v).attach).toEqual([
      { url: 'models/weapons/staff_rare_a_teal.glb', bone: 'handslot.r' },
    ]);
    expect(defOf(v).weaponSlots).toBeUndefined();
    expect(defOf(v).offhandSlot).toBeUndefined();
    // the shared class def itself is untouched
    expect(manifest.VISUALS[KEY].attach?.[0]?.url).not.toBe('models/weapons/staff_rare_a_teal.glb');
  });

  it('asks for its own hairstyle: the bare head stands in until the file lands', async () => {
    const { h, body, frame, gate, link } = await world({ held: [QUIFF] });
    const v = body(npc(HALVEN));
    v.setFarBakeGate(gate);
    // built at once, bare headed in both senses, with his hairstyle on the wire
    expect(v.wocHeadLook?.look.hair).toBe('quiff');
    expect(v.wocHeadDrawnLook?.hair).toBe('bald');
    expect(h.releases.has(QUIFF)).toBe(true);
    frame(v);
    h.releases.get(QUIFF)?.();
    await vi.waitFor(() => expect(h.heads.wocHeadFileResident(QUIFF)).toBe(true));
    frame(v);
    link();
    expect(drawn(v, HAIR_QUIFF)).toBe(true);
    expect(v.wocHeadDrawnLook?.hair).toBe('quiff');
    // and the helm stayed off the whole way
    expect(drawn(v, 'Helm')).toBe(false);
  });

  it('leaves a player of the same class on the equipment path', async () => {
    const { h, body, frame } = await world();
    const v = body(player({ ...h.DEFAULT_APPEARANCE, headHair: 'swept' }));
    // a player's hands are the class's own
    expect(defOf(v).weaponSlots?.length ?? 0).toBeGreaterThan(0);
    // and nobody hid its helm: left undressed, its first frame shows the whole default kit
    frame(v);
    expect(drawn(v, 'Helm')).toBe(true);
    expect(v.height).toBeCloseTo(defOf(v).height, 6);
  });

  it('a mob that shares an NPC template id keeps the class hands, the helm and the default face', async () => {
    const { body, frame, manifest, looks } = await world();
    // Halven's id on a MOB (Sexton Marrow is the shipped case: an NPC and a dungeon mob
    // under one id). A mob with no key of its own draws the outlaw body; alias that key to
    // the fixture so the real factory builds it from the files the harness serves.
    const mob = { ...npc(HALVEN), kind: 'mob' } as Entity;
    expect(looks.npcLookFor(HALVEN, 'mob')).toBeNull();
    expect(manifest.visualKeyFor(mob)).toBe('mob_bandit');
    manifest.VISUALS.mob_bandit = manifest.VISUALS[KEY];
    const v = body(mob);
    // none of Halven's look reached it: the class's own hands, the def's own size...
    expect(defOf(v).weaponSlots?.length ?? 0).toBeGreaterThan(0);
    expect(v.height).toBeCloseTo(manifest.VISUALS[KEY].height, 6);
    // ...the whole default kit, helm on, from its first frame...
    frame(v);
    expect(drawn(v, 'Helm')).toBe(true);
    // ...and never his hairstyle: a mob is handed no look at all (the head pieces a
    // default mob body hangs are the type's own)
    expect(v.root.getObjectByName(HAIR_QUIFF)).toBeUndefined();
    expect(v.root.getObjectByName('WocHead_A_hair_swept')).toBeDefined();
  });

  // A quest escortee is a mob the escort driver walks, drawn as the townsperson it is
  // (npc_looks.ts MOB_LOOK_IDS). Gravedigger Mosley rides the rogue's male body; alias
  // that key to the fixture so the real factory builds him from the files the harness
  // serves, as the case above does.
  it('a mob-kind escortee is born wearing its roster look: face, size, bare head, props', async () => {
    const { body, frame, manifest, looks, diff } = await world();
    const MOSLEY = 'gravedigger_mosley';
    const mob = { ...npc(MOSLEY), kind: 'mob', color: 0x8a7a5a } as Entity;
    const look = looks.npcLookFor(MOSLEY, 'mob');
    if (!look) throw new Error('no look');
    expect(manifest.visualKeyFor(mob)).toBe('player_rogue');
    manifest.VISUALS.player_rogue = manifest.VISUALS[KEY];
    const v = body(mob);
    // his own face, not the type's default
    expect(v.wocHeadLook?.look).toEqual({
      hair: 'bald',
      beard: 'none',
      nose: 'default',
      mouth: 'default',
      brows: 'rounded',
      ears: 'default',
      eyes: 'default',
      piercing: 'lip',
    });
    expect(v.wocHeadLook?.morphs.FS_Eyes_Spacing).toBeCloseTo(look.app.headShape.eyeSpacing, 6);
    // his authored size
    expect(look.app.bodyScale).toBe(1.02);
    expect(v.height).toBeCloseTo(manifest.VISUALS[KEY].height * 1.02, 6);
    // his axe is the whole attach list: no swap slot for the rogue's own blades
    expect(defOf(v).attach).toEqual([
      { url: 'models/weapons/notched_woodaxe.glb', bone: 'handslot.r' },
    ]);
    expect(defOf(v).weaponSlots).toBeUndefined();
    expect(defOf(v).offhandSlot).toBeUndefined();
    // the class kit with the head bare, and nothing puts the hood back on a later frame
    expect(diff.diffWornArmor(mob, v)).toBe(false);
    frame(v);
    frame(v);
    expect(drawn(v, 'Chest')).toBe(true);
    expect(drawn(v, 'Helm')).toBe(false);
  });
});

describe('a pooled NPC body', () => {
  // The pool hands a body its gate alone (PooledVisualLifecycle.take), and the zone
  // prewarm seeds NPC bodies that never met the renderer's queue at all. One taken before
  // any fresh build had paired that gate with the queue used to run its own units on the
  // spot (a merged head's fold, an armor attach) inside a live frame.
  it('rides the work queue its gate came with, even when handed the gate before the pairing', async () => {
    const { h, body, frame, gate } = await world();
    const queue = heldQueue();
    // the seed: built with no gate and no queue, then taken from the pool
    const pooled = body(npc(HALVEN));
    pooled.setFarBakeGate(gate);
    // only now does a fresh world build pair the gate with the renderer's queue
    const fresh = body(player({ ...h.DEFAULT_APPEARANCE }));
    fresh.setFarBakeGate(gate, queue);
    queue.units.length = 0;
    // the pooled body's own work is asked of the queue, never run where it stands
    frame(pooled);
    frame(pooled);
    const labels = queue.units.map((unit) => unit.label ?? '');
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) expect(label).toMatch(/^woc-/);
    // and nothing of it mounted yet: the queue holds every unit
    let merged = 0;
    pooled.root.traverse((o) => {
      if (o.userData.wocHeadMerged) merged++;
    });
    expect(merged).toBe(0);
  });

  it('calls the under-armor atlas retry from its own frame, with no worn-set diff', async () => {
    const { body, frame } = await world();
    const v = body(npc(HALVEN));
    const atlas = (v as unknown as { wocAtlas: { retryFailed(): void } }).wocAtlas;
    const retry = vi.spyOn(atlas, 'retryFailed');
    frame(v);
    frame(v);
    expect(retry).toHaveBeenCalledTimes(2);
  });

  it("a player body's own frame leaves the atlas retry to its worn-set diff", async () => {
    const { h, body, frame } = await world();
    const v = body(player({ ...h.DEFAULT_APPEARANCE }));
    v.setWocEquipment({}, false);
    const atlas = (v as unknown as { wocAtlas: { retryFailed(): void } }).wocAtlas;
    const retry = vi.spyOn(atlas, 'retryFailed');
    frame(v);
    expect(retry).not.toHaveBeenCalled();
  });
});
