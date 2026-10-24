import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GPU_WORK_PRIORITY } from '../src/render/background_gpu_queue';
import {
  armorFile,
  bones,
  type HeldQueue,
  armorStoreHarness as harness,
  heldQueue,
  manifest,
  model,
  partNames,
  releaseArmorStoreHarness,
} from './helpers/woc_armor_store_harness';

// The streamed-armor lifecycle one character sees (the 2026-09-25 character size gameplan,
// steps 5 and 6): a set not yet resident draws nothing (the suit), a resident lower tier
// stands in while the wanted tier streams, the wanted tier takes over once its reveal
// settles (the file it replaces drawing until then: 2026-10-03), every attached node goes
// through the host's setup and compile gate, and a set nobody wears is freed by the idle
// rule of its tier. A body with the renderer's work queue behind it attaches a file as ONE
// unit of that queue, once the store prepared it as a unit of its own, and never inside a
// frame's poll; a body with none (a preview, a portrait) attaches on the spot. And the
// merged stand-in a world view asks for (woc_armor_merge.ts): never mounted by default,
// built from the poll, dropped at once by the host's redress when the drawn parts change,
// taken down before a file it folds detaches. Only the loader and the graphics profile are
// stubbed (tests/helpers/woc_armor_store_harness.ts). Most cases dress a CROWD character (the
// medium file on any preset but low), a set's one-file path; the local player's assembled
// high pack has its own suite (tests/woc_armor_high_pack.test.ts), and the store's own rules
// theirs (tests/woc_armor_packs.test.ts).

afterEach(() => {
  releaseArmorStoreHarness();
});

describe('a WOC character wearing streamed armor', () => {
  it('draws the suit until its set lands, then attaches it through the host the frame it does', async () => {
    const h = await harness('high');
    const d = new h.dressing.WocArmorDressing(h.host, manifest, 'crowd');
    expect(d.want(['test'])).toBe(false);
    expect(d.isWaiting).toBe(true);
    expect(d.attachedFiles).toEqual([]);
    const medium = h.core.wocArmorPackUrl('male', 'test', 'medium');
    expect([...h.pending.keys()]).toEqual([medium]); // the wanted tier only, never the others
    expect(d.poll()).toBe(false); // nothing new yet
    await h.land('medium');
    expect(d.poll()).toBe(true);
    expect(d.isWaiting).toBe(false);
    expect(d.attachedFiles).toEqual([{ set: 'test', url: medium }]);
    // the Group of skinned parts and the rigid pad's wrapper, each set up and gated
    expect(h.host.adopt).toHaveBeenCalledTimes(2);
    expect(h.host.reveal).toHaveBeenCalledTimes(2);
    const helm = h.host.model.getObjectByName('Armor_Test_Helm') as THREE.SkinnedMesh;
    expect(helm.isSkinnedMesh).toBe(true);
    expect(helm.visible).toBe(false); // the dressing, not the attach, decides visibility
    const pad = h.host.model.getObjectByName('Armor_Test_Shoulder_L');
    expect(pad?.parent?.parent?.name).toBe('spine');
    expect(h.packs.wocArmorPackRefs(medium)).toBe(1);
    expect(d.poll()).toBe(false); // steady state: free
  });

  it('stands a resident lower tier in while the wanted tier streams, then swaps it', async () => {
    const h = await harness('high', 'now');
    const low = h.core.wocArmorPackUrl('male', 'test', 'low');
    const medium = h.core.wocArmorPackUrl('male', 'test', 'medium');
    h.packs.ensureWocArmorPack(low);
    await h.land('low');
    const d = new h.dressing.WocArmorDressing(h.host, manifest, 'crowd');
    expect(d.want(['test'])).toBe(true);
    expect(d.attachedFiles).toEqual([{ set: 'test', url: low }]);
    expect(d.isWaiting).toBe(true);
    expect(h.pending.has(medium)).toBe(true);
    await h.land('medium');
    expect(d.poll()).toBe(true);
    expect(d.attachedFiles).toEqual([{ set: 'test', url: medium }]);
    // the stand-in's pieces left the bookkeeping and the model, and its reference went back
    expect(h.host.forget).toHaveBeenCalledTimes(2);
    expect(h.packs.wocArmorPackRefs(low)).toBe(0);
    expect(h.packs.wocArmorPackRefs(medium)).toBe(1);
    const helms: string[] = [];
    h.host.model.traverse((o) => {
      if (o.name === 'Armor_Test_Helm')
        helms.push(((o as THREE.Mesh).material as THREE.Material).name);
    });
    expect(helms).toEqual(['medium']);
    // the take-over was told once: the next frame is free
    expect(d.poll()).toBe(false);
  });

  it('keeps the file it replaces drawing until every piece of the new one is revealed, then takes it off in that step', async () => {
    const h = await harness('high', 'gated');
    const low = h.core.wocArmorPackUrl('male', 'test', 'low');
    const medium = h.core.wocArmorPackUrl('male', 'test', 'medium');
    h.packs.ensureWocArmorPack(low);
    await h.land('low');
    const d = new h.dressing.WocArmorDressing(h.host, manifest, 'crowd');
    d.want(['test']);
    h.settle();
    const lowHelm = h.host.model.getObjectByName('Armor_Test_Helm') as THREE.Mesh;
    const lowPieces = h.packs.wocArmorPieces(h.packs.wocArmorContainers(h.host.model)[0]);
    lowHelm.visible = true; // the host's part pass
    const drawn = (node: THREE.Object3D): boolean => {
      for (let at: THREE.Object3D | null = node; at; at = at.parent) if (!at.visible) return false;
      return true;
    };
    expect(drawn(lowHelm)).toBe(true);
    await h.land('medium');
    // the replacement attaches (the host dresses its parts: the files changed)...
    expect(d.poll()).toBe(true);
    expect(h.packs.wocArmorContainers(h.host.model)).toHaveLength(2);
    // ...hidden behind the gate, while the file it replaces keeps drawing, whole
    expect(h.host.forget).not.toHaveBeenCalled();
    expect(drawn(lowHelm)).toBe(true);
    expect(lowPieces.every((piece) => piece.parent !== null && piece.visible)).toBe(true);
    expect(h.packs.wocArmorPackRefs(low)).toBe(1);
    // what draws is what a far bake keys on: still the old file
    expect(d.attachedFiles).toEqual([{ set: 'test', url: low }]);
    const next = h.packs.wocArmorContainers(h.host.model)[1];
    const nextPieces = h.packs.wocArmorPieces(next);
    expect(nextPieces.every((piece) => !piece.visible)).toBe(true);
    // one piece's link settles: it waits hidden for the others (one step, never both files)
    h.settleOne();
    expect(nextPieces.every((piece) => !piece.visible)).toBe(true);
    expect(drawn(lowHelm)).toBe(true);
    expect(d.poll()).toBe(false);
    // the last one settles: the new file draws and the old one is off, in that very step
    h.settle();
    expect(nextPieces.every((piece) => piece.visible)).toBe(true);
    expect(lowPieces.every((piece) => piece.parent === null)).toBe(true);
    expect(h.host.forget).toHaveBeenCalledTimes(2);
    expect(h.packs.wocArmorPackRefs(low)).toBe(0);
    expect(h.packs.wocArmorPackRefs(medium)).toBe(1);
    expect(d.attachedFiles).toEqual([{ set: 'test', url: medium }]);
    // the host hears of it on its next frame, once, and re-dresses
    expect(d.poll()).toBe(true);
    expect(d.poll()).toBe(false);
  });

  it('asks an unprepared replacement again while the old file draws, then keeps the old file and stops asking', async () => {
    const h = await harness('high', 'gated');
    const low = h.core.wocArmorPackUrl('male', 'test', 'low');
    const medium = h.core.wocArmorPackUrl('male', 'test', 'medium');
    h.packs.ensureWocArmorPack(low);
    await h.land('low');
    const d = new h.dressing.WocArmorDressing(h.host, manifest, 'crowd');
    d.want(['test']);
    h.settle();
    const lowPieces = h.packs.wocArmorPieces(h.packs.wocArmorContainers(h.host.model)[0]);
    await h.land('medium');
    d.poll();
    const next = h.packs.wocArmorContainers(h.host.model)[1];
    const nextPieces = h.packs.wocArmorPieces(next);
    expect(nextPieces).toHaveLength(2);
    let reveals = h.host.reveal.mock.calls.length;
    // the gate gives up on both pieces: the old file stands in, so each is asked again
    h.settle(false);
    expect(h.host.reveal.mock.calls.length).toBe(reveals + 2);
    expect(nextPieces.every((piece) => !piece.visible)).toBe(true);
    expect(lowPieces.every((piece) => piece.parent !== null && piece.visible)).toBe(true);
    expect(h.host.forget).not.toHaveBeenCalled();
    expect(d.attachedFiles).toEqual([{ set: 'test', url: low }]);
    // ...and again: each piece has tries of its own (two pieces missing once each are not one
    // piece missing twice)
    h.settle(false);
    expect(h.host.reveal.mock.calls.length).toBe(reveals + 4);
    expect(h.packs.wocArmorContainers(h.host.model)).toHaveLength(2);
    // a third miss on the very materials asked: the replacement comes off unseen. It never
    // takes over unproven (that would link or upload inside a live frame), and the file it was
    // to replace, the same armor at another sharpness, keeps drawing
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    h.settle(false);
    // (named once on the dev channel: a body kept at the tier below is never a silent loss)
    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0][0])).toContain(medium);
    expect(h.packs.wocArmorContainers(h.host.model)).toHaveLength(1);
    expect(nextPieces.every((piece) => piece.parent === null)).toBe(true);
    expect(lowPieces.every((piece) => piece.parent !== null && piece.visible)).toBe(true);
    expect(d.attachedFiles).toEqual([{ set: 'test', url: low }]);
    expect(h.packs.wocArmorPackRefs(medium)).toBe(0);
    expect(h.packs.wocArmorPackRefs(low)).toBe(1);
    // only the replacement's two nodes left the host's bookkeeping
    expect(h.host.forget.mock.calls.map(([node]) => node)).toEqual(nextPieces);
    // the host hears once (the replacement's nodes are gone), and then every frame is free:
    // refused, so nothing attaches it again and nothing asks the gate again
    reveals = h.host.reveal.mock.calls.length;
    expect(d.poll()).toBe(true);
    for (let frame = 0; frame < 5; frame++) expect(d.poll()).toBe(false);
    expect(d.isWaiting).toBe(false);
    expect(h.host.reveal.mock.calls.length).toBe(reveals);
    expect(h.packs.wocArmorContainers(h.host.model)).toHaveLength(1);
    // the same kit handed in again changes nothing
    expect(d.want(['test'])).toBe(false);
    expect(h.packs.wocArmorContainers(h.host.model)).toHaveLength(1);
    expect(h.host.reveal.mock.calls.length).toBe(reveals);
    // a kit that really changed gives the file another try, and this time the gate links it
    d.want(['test', 'other']);
    expect(h.packs.wocArmorContainers(h.host.model)).toHaveLength(2);
    expect(h.host.reveal.mock.calls.length).toBe(reveals + 2);
    h.settle();
    expect(d.attachedFiles).toEqual([{ set: 'test', url: medium }]);
    d.dispose();
  });

  it('gives a refused replacement another try under a replaced gate', async () => {
    const h = await harness('high', 'gated');
    const medium = h.core.wocArmorPackUrl('male', 'test', 'medium');
    h.packs.ensureWocArmorPack(h.core.wocArmorPackUrl('male', 'test', 'low'));
    await h.land('low');
    const d = new h.dressing.WocArmorDressing(h.host, manifest, 'crowd');
    d.want(['test']);
    h.settle();
    await h.land('medium');
    d.poll();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (let round = 0; round < 3; round++) h.settle(false);
    expect(h.packs.wocArmorContainers(h.host.model)).toHaveLength(1);
    expect(d.poll()).toBe(true);
    expect(d.poll()).toBe(false);
    // the renderer generation changed: the refusal was the old gate's verdict
    d.gateChanged();
    expect(d.poll()).toBe(true);
    expect(h.packs.wocArmorContainers(h.host.model)).toHaveLength(2);
    h.settle();
    expect(d.attachedFiles).toEqual([{ set: 'test', url: medium }]);
    d.dispose();
  });

  it('does not count a reveal an effect edge spoiled: what the pieces wear now is asked for, as often as it takes', async () => {
    const h = await harness('high', 'gated');
    const low = h.core.wocArmorPackUrl('male', 'test', 'low');
    const medium = h.core.wocArmorPackUrl('male', 'test', 'medium');
    h.packs.ensureWocArmorPack(low);
    await h.land('low');
    const d = new h.dressing.WocArmorDressing(h.host, manifest, 'crowd');
    d.want(['test']);
    h.settle();
    await h.land('medium');
    d.poll();
    const next = h.packs.wocArmorContainers(h.host.model)[1];
    const nextPieces = h.packs.wocArmorPieces(next);
    /** The host mounts another effect state (a buff glow, a hit response) on every mesh of
     *  the replacement while the gate links it. */
    const effectEdge = (): void => {
      for (const piece of nextPieces) {
        piece.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh) mesh.material = (mesh.material as THREE.Material).clone();
        });
      }
    };
    // far more unproven settles than a file's tries, every one of them because the materials
    // moved under the gate: no verdict on the file, so it is neither refused nor taken over
    for (let edge = 0; edge < 8; edge++) {
      effectEdge();
      h.settle(false);
      expect(h.linking()).toBe(nextPieces.length);
    }
    expect(h.packs.wocArmorContainers(h.host.model)).toHaveLength(2);
    expect(d.attachedFiles).toEqual([{ set: 'test', url: low }]);
    // the edges did not spend the file's own tries either: it still has both
    h.settle(false);
    h.settle(false);
    expect(h.packs.wocArmorContainers(h.host.model)).toHaveLength(2);
    // the gate links what the pieces wear: the set is handed over
    h.settle();
    expect(d.attachedFiles).toEqual([{ set: 'test', url: medium }]);
    expect(h.packs.wocArmorContainers(h.host.model)).toHaveLength(1);
    d.dispose();
  });

  it('needs no proof for a piece with no mesh of its own (the Group of a file whose parts are all rigid)', async () => {
    // a file with no skinned part: its Group is empty, and the renderer's proof for a target
    // with no material is always "not prepared" (compile_target_readiness.ts)
    const rigidOnly = (fileTier: string) => {
      const r = bones();
      const material = new THREE.MeshBasicMaterial();
      material.name = fileTier;
      const pad = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), material);
      pad.name = 'Armor_Test_Shoulder_L';
      r.spine.add(pad);
      return { scene: r.root, animations: [] as never[] };
    };
    const h = await harness('high', 'gated', rigidOnly);
    const low = h.core.wocArmorPackUrl('male', 'test', 'low');
    const medium = h.core.wocArmorPackUrl('male', 'test', 'medium');
    h.packs.ensureWocArmorPack(low);
    await h.land('low');
    const d = new h.dressing.WocArmorDressing(h.host, manifest, 'crowd');
    d.want(['test']);
    h.settle();
    await h.land('medium');
    d.poll();
    const next = h.packs.wocArmorContainers(h.host.model)[1];
    const [group, wrapper] = h.packs.wocArmorPieces(next);
    expect(group.children).toEqual([]);
    expect(wrapper.children).toHaveLength(1);
    // the empty Group settles unproven, as it always will: not a miss, and never asked again
    const reveals = h.host.reveal.mock.calls.length;
    h.settleOne(false);
    expect(h.host.reveal.mock.calls.length).toBe(reveals);
    expect(d.attachedFiles).toEqual([{ set: 'test', url: low }]);
    // the one piece that draws is proven: the set is handed over
    h.settleOne(true);
    expect(d.attachedFiles).toEqual([{ set: 'test', url: medium }]);
    expect(h.packs.wocArmorContainers(h.host.model)).toHaveLength(1);
    d.dispose();
  });

  it("shows a set's first file whatever the gate answers: only the suit stood in for it", async () => {
    const h = await harness('medium', 'gated');
    const medium = h.core.wocArmorPackUrl('male', 'test', 'medium');
    const other = h.core.wocArmorPackUrl('male', 'other', 'medium');
    const d = new h.dressing.WocArmorDressing(h.host, manifest, 'crowd');
    d.want(['test']);
    await h.land('medium');
    expect(d.poll()).toBe(true);
    const pieces = h.packs.wocArmorPieces(h.packs.wocArmorContainers(h.host.model)[0]);
    let reveals = h.host.reveal.mock.calls.length;
    // the gate gives up: the file draws all the same (a set linking on its first draw beats
    // one that never shows), and is not asked for again
    h.settle(false);
    expect(pieces.every((piece) => piece.visible)).toBe(true);
    expect(d.attachedFiles).toEqual([{ set: 'test', url: medium }]);
    expect(h.host.reveal.mock.calls.length).toBe(reveals);
    expect(h.packs.wocArmorContainers(h.host.model)).toHaveLength(1);
    // a change of SET is that same arm: the old set is the wrong armor, so it comes off at
    // once, and the new set's first file attaches straight and shows on the gate's give-up
    h.packs.ensureWocArmorPack(other);
    await h.land('medium', 'other');
    reveals = h.host.reveal.mock.calls.length;
    expect(d.want(['other'])).toBe(true);
    expect(pieces.every((piece) => piece.parent === null)).toBe(true);
    expect(h.packs.wocArmorPackRefs(medium)).toBe(0);
    const otherPieces = h.packs.wocArmorPieces(h.packs.wocArmorContainers(h.host.model)[0]);
    expect(h.host.reveal.mock.calls.length).toBe(reveals + otherPieces.length);
    h.settle(false);
    expect(otherPieces.every((piece) => piece.visible)).toBe(true);
    expect(d.attachedFiles).toEqual([{ set: 'other', url: other }]);
    expect(h.host.model.getObjectByName(partNames('other')[0])).toBeDefined();
    expect(h.host.reveal.mock.calls.length).toBe(reveals + otherPieces.length);
    d.dispose();
  });

  it('asks a replaced gate again for every piece of a replacement, the old gate settling nothing', async () => {
    const h = await harness('high', 'gated');
    h.packs.ensureWocArmorPack(h.core.wocArmorPackUrl('male', 'test', 'low'));
    await h.land('low');
    const d = new h.dressing.WocArmorDressing(h.host, manifest, 'crowd');
    d.want(['test']);
    h.settle();
    await h.land('medium');
    d.poll();
    const nextPieces = h.packs.wocArmorPieces(h.packs.wocArmorContainers(h.host.model)[1]);
    // one piece linked under the old renderer generation, then the gate was replaced
    h.settleOne();
    const reveals = h.host.reveal.mock.calls.length;
    d.gateChanged();
    // every piece again, the one the old gate settled too
    expect(h.host.reveal.mock.calls.length).toBe(reveals + nextPieces.length);
    // the old gate's last settle lands late: it hands nothing over
    h.settleOne();
    expect(nextPieces.every((piece) => !piece.visible)).toBe(true);
    expect(h.packs.wocArmorContainers(h.host.model)).toHaveLength(2);
    // the new gate's settles do
    h.settle();
    expect(nextPieces.every((piece) => piece.visible)).toBe(true);
    expect(h.packs.wocArmorContainers(h.host.model)).toHaveLength(1);
    d.dispose();
  });

  it('takes off a replacement overtaken while it links, and one no longer wanted, never the drawn file', async () => {
    const h = await harness('high', 'gated');
    const low = h.core.wocArmorPackUrl('male', 'test', 'low');
    const medium = h.core.wocArmorPackUrl('male', 'test', 'medium');
    h.packs.ensureWocArmorPack(low);
    await h.land('low');
    const d = new h.dressing.WocArmorDressing(h.host, manifest, 'crowd');
    d.want(['test']);
    h.settle();
    await h.land('medium');
    d.poll();
    const next = h.packs.wocArmorContainers(h.host.model)[1];
    // a gate replaced mid-link is asked again for what it still owes
    const reveals = h.host.reveal.mock.calls.length;
    d.gateChanged();
    expect(h.host.reveal.mock.calls.length).toBe(reveals + h.packs.wocArmorPieces(next).length);
    // the set comes off before the link settles: the replacement goes, unseen, with it
    expect(d.want([])).toBe(true);
    expect(h.packs.wocArmorContainers(h.host.model)).toEqual([]);
    expect(h.packs.wocArmorPackRefs(low)).toBe(0);
    expect(h.packs.wocArmorPackRefs(medium)).toBe(0);
    // a stale settle of the gone replacement changes nothing
    h.settle();
    expect(h.packs.wocArmorContainers(h.host.model)).toEqual([]);
    expect(d.attachedFiles).toEqual([]);
    expect(d.poll()).toBe(false);
    d.dispose();
  });

  it('detaches a set no longer wanted, and keeps the file a crowd draws for the wearer who comes back', async () => {
    const h = await harness('medium');
    const url = h.core.wocArmorPackUrl('male', 'test', 'medium');
    const d = new h.dressing.WocArmorDressing(h.host, manifest, 'crowd');
    d.want(['test']);
    await h.land('medium');
    d.poll();
    const helm = h.host.model.getObjectByName('Armor_Test_Helm') as THREE.SkinnedMesh;
    const geometry = helm.geometry;
    const dispose = vi.spyOn(geometry, 'dispose');
    expect(d.want([])).toBe(true);
    expect(h.host.model.getObjectByName('Armor_Test_Helm')).toBeUndefined();
    expect(h.host.model.getObjectByName('Armor_Test_Shoulder_L')).toBeUndefined();
    expect(h.packs.wocArmorPackRefs(url)).toBe(0);
    // the crowd's tier on a desktop: idle for hours, and still in memory (nothing to read,
    // prepare and attach again every few minutes)
    h.advance(100 * h.core.WOC_ARMOR_IDLE_EVICT_MS);
    expect(h.packs.sweepWocArmorPacks()).toEqual([]);
    expect(h.packs.wocArmorPackResident(url)).toBe(true);
    expect(dispose).not.toHaveBeenCalled();
    expect(h.released).toEqual([]);
    // the wearer comes back: no fetch, no second prepare, the very geometry it left
    h.fetches.length = 0;
    expect(d.want(['test'])).toBe(true);
    expect(h.fetches).toEqual([]);
    expect(h.bind.prepareWocArmor).toHaveBeenCalledTimes(1);
    expect((h.host.model.getObjectByName('Armor_Test_Helm') as THREE.Mesh).geometry).toBe(geometry);
    d.dispose();
  });

  it('frees a file of a tier the preset draws for nobody after the long window, geometry and parse with it', async () => {
    const h = await harness('high', 'now');
    const low = h.core.wocArmorPackUrl('male', 'test', 'low');
    const medium = h.core.wocArmorPackUrl('male', 'test', 'medium');
    // a low file on a preset whose crowd draws medium (a portrait's own fetch, a preset
    // change): it stands in until the medium file lands
    h.packs.ensureWocArmorPack(low);
    await h.land('low');
    const d = new h.dressing.WocArmorDressing(h.host, manifest, 'crowd');
    d.want(['test']);
    const helm = h.host.model.getObjectByName('Armor_Test_Helm') as THREE.SkinnedMesh;
    const dispose = vi.spyOn(helm.geometry, 'dispose');
    // the rigid pad draws the parse's own geometry: freed with the file too
    const pad = h.host.model.getObjectByName('Armor_Test_Shoulder_L') as THREE.Mesh;
    const padDispose = vi.spyOn(pad.geometry, 'dispose');
    await h.land('medium');
    expect(d.poll()).toBe(true);
    expect(d.attachedFiles).toEqual([{ set: 'test', url: medium }]);
    expect(h.packs.wocArmorPackRefs(low)).toBe(0);
    // still in memory inside the window (a preset flipped back finds it, no fetch)
    h.advance(h.core.WOC_ARMOR_IDLE_EVICT_MS - 1);
    expect(h.packs.sweepWocArmorPacks()).toEqual([]);
    expect(h.packs.wocArmorPackResident(low)).toBe(true);
    expect(dispose).not.toHaveBeenCalled();
    h.advance(1);
    expect(h.packs.sweepWocArmorPacks()).toEqual([low]);
    expect(h.packs.wocArmorPackResident(low)).toBe(false);
    expect(dispose).toHaveBeenCalled();
    expect(padDispose).toHaveBeenCalled();
    expect(h.released).toEqual([low]);
    // the worn medium file is nobody's to free
    expect(h.packs.wocArmorPackResident(medium)).toBe(true);
    d.dispose();
  });

  it('frees an idle set from the per-frame poll alone on a phone, soon and with no later release', async () => {
    const h = await harness('medium');
    // the phone-class memory profile: low for everyone, and nothing kept past its window
    h.gfx.constrainedMemory = true;
    const url = h.core.wocArmorPackUrl('male', 'test', 'low');
    const d = new h.dressing.WocArmorDressing(h.host, manifest, 'crowd');
    d.want(['test']);
    await h.land('low');
    d.poll();
    d.want([]); // released now; nothing else will release again
    const other = new h.dressing.WocArmorDressing(h.hostOf(), manifest, 'crowd');
    h.advance(h.core.WOC_ARMOR_CONSTRAINED_IDLE_EVICT_MS - 1);
    other.poll();
    expect(h.packs.wocArmorPackResident(url)).toBe(true);
    // the poll sweeps on its own clock (a few seconds), so the set is gone within a sweep of
    // its window: well inside the minute after its last wearer left
    h.advance(1 + 5000);
    other.poll(); // any character's frame
    expect(h.packs.wocArmorPackResident(url)).toBe(false);
    expect(h.released).toEqual([url]);
    d.dispose();
    other.dispose();
  });

  it('takes a file off again when its attach throws, and does not try it again every frame', async () => {
    const h = await harness('medium', 'now');
    const url = h.core.wocArmorPackUrl('male', 'test', 'medium');
    const d = new h.dressing.WocArmorDressing(h.host, manifest, 'crowd');
    d.want(['test']);
    await h.land('medium');
    // the host's own per-mesh setup throws on the file's second node
    h.host.adopt
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw new Error('a host step that throws');
      });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let heard = false;
    expect(() => {
      heard = d.poll();
    }).not.toThrow();
    // all of the file is off again: no node on the model, no reference, nothing drawn of it
    expect(d.attachedFiles).toEqual([]);
    expect(h.packs.wocArmorContainers(h.host.model)).toEqual([]);
    expect(h.host.model.getObjectByName('Armor_Test_Helm')).toBeUndefined();
    expect(h.host.model.getObjectByName('Armor_Test_Shoulder_L')).toBeUndefined();
    expect(h.packs.wocArmorPackRefs(url)).toBe(0);
    expect(h.host.forget).toHaveBeenCalledTimes(2);
    expect(logged).toHaveBeenCalledTimes(1);
    // the host reads its parts afresh once, and then no frame tries the file again
    expect(heard).toBe(true);
    const adopts = h.host.adopt.mock.calls.length;
    for (let frame = 0; frame < 5; frame++) expect(d.poll()).toBe(false);
    expect(h.host.adopt.mock.calls.length).toBe(adopts);
    expect(d.isWaiting).toBe(false);
    // a kit that really changed tries it again, and this time it attaches
    d.want([]);
    expect(d.want(['test'])).toBe(true);
    expect(d.attachedFiles).toEqual([{ set: 'test', url }]);
    expect(h.packs.wocArmorPackRefs(url)).toBe(1);
    d.dispose();
  });

  it('keeps the file a replacement was to take over from when the replacement attach throws', async () => {
    const h = await harness('high', 'gated');
    const low = h.core.wocArmorPackUrl('male', 'test', 'low');
    const medium = h.core.wocArmorPackUrl('male', 'test', 'medium');
    h.packs.ensureWocArmorPack(low);
    await h.land('low');
    const d = new h.dressing.WocArmorDressing(h.host, manifest, 'crowd');
    d.want(['test']);
    h.settle();
    const lowPieces = h.packs.wocArmorPieces(h.packs.wocArmorContainers(h.host.model)[0]);
    await h.land('medium');
    h.host.adopt.mockImplementationOnce(() => {
      throw new Error('a host step that throws');
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => d.poll()).not.toThrow();
    // the stand-in tier still draws, whole, and nothing of the replacement is left behind
    expect(d.attachedFiles).toEqual([{ set: 'test', url: low }]);
    expect(h.packs.wocArmorContainers(h.host.model)).toHaveLength(1);
    expect(lowPieces.every((piece) => piece.parent !== null && piece.visible)).toBe(true);
    expect(h.packs.wocArmorPackRefs(medium)).toBe(0);
    expect(h.linking()).toBe(0);
    for (let frame = 0; frame < 3; frame++) d.poll();
    expect(h.packs.wocArmorContainers(h.host.model)).toHaveLength(1);
    d.dispose();
    expect(h.packs.wocArmorPackRefs(low)).toBe(0);
  });

  it('gives every file back on dispose', async () => {
    const h = await harness('low');
    const url = h.core.wocArmorPackUrl('male', 'test', 'low');
    const d = new h.dressing.WocArmorDressing(h.host, manifest);
    d.want(['test']);
    await h.land('low');
    d.poll();
    expect(h.packs.wocArmorPackRefs(url)).toBe(1);
    d.dispose();
    expect(h.packs.wocArmorPackRefs(url)).toBe(0);
    expect(h.packs.wocArmorContainers(h.host.model)).toEqual([]);
    expect(d.attachedFiles).toEqual([]);
  });
});

describe('a WOC character with the work queue behind it', () => {
  /** The label kinds of the two units (what the frame budget prices). */
  const PREPARE = 'woc-armor-prepare';
  const ATTACH = 'woc-armor-attach';

  /** A world session: the store and every body ride one queue that holds its units until
   *  the case runs them, and each body was built the way assembleModel builds one (its
   *  build step is how the store learns the fit's rig). */
  async function world(tier: 'low' | 'medium' | 'high', reveals: 'now' | 'gated' = 'now') {
    const h = await harness(tier, reveals);
    const queue = heldQueue();
    h.packs.setWocArmorWorkQueue(queue);
    const rideQueue = (on: HeldQueue) => (work: () => void, label: string) => {
      // the visual's own wrapper: a unit the queue refuses is dropped
      void on.run(work, GPU_WORK_PRIORITY.VISIBLE_PREWARM, label).catch(() => undefined);
    };
    /** A crowd character of the world (built, then handed the queue with its gate), or a
     *  body built directly at full detail with no queue (`preview`: the character sheet, a
     *  portrait). `fetch: false` is a speculative build (the zone prewarm). */
    const body = (kind: 'world' | 'preview' = 'world', fetch = true) => {
      const host = h.hostOf();
      const detail = kind === 'world' ? 'crowd' : 'full';
      h.dressing.attachWocArmorAtBuild(host.model, manifest, undefined, fetch, detail);
      const d = new h.dressing.WocArmorDressing(host, manifest, detail);
      if (fetch) d.want(['test']);
      if (kind === 'world') host.schedule = rideQueue(queue);
      return { host, d };
    };
    /** A set's file, resident and prepared, as an earlier wearer left it. */
    const resident = async (fileTier: string, set = 'test'): Promise<string> => {
      const url = h.core.wocArmorPackUrl('male', set, fileTier as 'low');
      h.packs.ensureWocArmorPack(url);
      await h.land(fileTier, set);
      queue.runOne(PREPARE);
      expect(h.packs.wocArmorPackPrepared(url)).toBe(true);
      return url;
    };
    return { h, queue, body, resident, rideQueue };
  }

  it('prepares a landed file once, as a unit of its own, then attaches each waiting wearer as one unit, never inside a poll', async () => {
    const { h, queue, body } = await world('medium');
    const url = h.core.wocArmorPackUrl('male', 'test', 'medium');
    const wearers = [body(), body(), body()];
    for (const w of wearers) expect(w.d.want(['test'])).toBe(false);
    expect(queue.units).toEqual([]);
    await h.land('medium');
    // landed: ONE unit, the prepare, at the stand-ins' priority; nothing ran inside the landing
    expect(queue.kinds()).toEqual([PREPARE]);
    // (its label names the file after the kind the budget prices)
    expect(queue.labels()).toEqual(['woc-armor-prepare:male:test:medium']);
    expect(queue.units[0].priority).toBe(GPU_WORK_PRIORITY.VISIBLE_PREWARM);
    expect(h.bind.prepareWocArmor).not.toHaveBeenCalled();
    // a frame of every wearer: nothing attaches, nobody asks for anything more
    for (const w of wearers) expect(w.d.poll()).toBe(false);
    expect(queue.kinds()).toEqual([PREPARE]);
    expect(h.packs.wocArmorPackPrepared(url)).toBe(false);
    for (const w of wearers) {
      expect(w.host.adopt).not.toHaveBeenCalled();
      expect(w.d.isWaiting).toBe(true);
    }
    // the queue runs it: one prepare for all of them, before any attach was even asked for
    expect(h.spans).toEqual([]);
    queue.drain();
    expect(h.bind.prepareWocArmor).toHaveBeenCalledTimes(1);
    // ...named in the CPU build ledger under its own kind
    expect(h.spans).toEqual(['view:woc-armor-prepare']);
    expect(h.packs.wocArmorPackPrepared(url)).toBe(true);
    expect(h.packs.wocArmorPackRefs(url)).toBe(0);
    // the next frame: one attach unit a wearer, and still nothing attached inside a poll
    for (const w of wearers) expect(w.d.poll()).toBe(false);
    expect(queue.kinds()).toEqual([ATTACH, ATTACH, ATTACH]);
    expect(queue.labels()).toEqual(Array(3).fill('woc-armor-attach:male:test'));
    expect(queue.units.map((unit) => unit.priority)).toEqual(
      Array(3).fill(GPU_WORK_PRIORITY.VISIBLE_PREWARM),
    );
    for (const w of wearers) expect(w.host.adopt).not.toHaveBeenCalled();
    expect(h.packs.wocArmorContainers(wearers[0].host.model)).toEqual([]);
    // every frame until they run asks nothing more
    for (const w of wearers) w.d.poll();
    expect(queue.units).toHaveLength(3);
    // the queue's budget lets one through: one wearer wears it, the others keep their suit
    queue.units.shift()?.run();
    expect(wearers.map((w) => w.d.attachedFiles.length)).toEqual([1, 0, 0]);
    expect(h.spans).toEqual(['view:woc-armor-prepare', 'view:woc-armor-attach']);
    expect(wearers[0].host.adopt).toHaveBeenCalledTimes(2);
    expect(wearers[0].host.reveal).toHaveBeenCalledTimes(2);
    expect(h.packs.wocArmorPackRefs(url)).toBe(1);
    // its host hears on its next frame, once (the re-dress); the others hear nothing
    expect(wearers.map((w) => w.d.poll())).toEqual([true, false, false]);
    expect(wearers[0].d.poll()).toBe(false);
    expect(wearers[0].d.isWaiting).toBe(false);
    queue.drain();
    for (const w of wearers) expect(w.d.attachedFiles).toEqual([{ set: 'test', url }]);
    expect(h.packs.wocArmorPackRefs(url)).toBe(3);
    // still the one prepare: every wearer draws the one shared geometry
    expect(h.bind.prepareWocArmor).toHaveBeenCalledTimes(1);
    const helms = wearers.map(
      (w) => w.host.model.getObjectByName('Armor_Test_Helm') as THREE.SkinnedMesh,
    );
    expect(new Set(helms.map((helm) => helm.geometry)).size).toBe(1);
    expect(h.dressing.WOC_ARMOR_ATTACH_LABEL).toBe('woc-armor-attach');
    expect(h.packs.WOC_ARMOR_PREPARE_LABEL).toBe('woc-armor-prepare');
    for (const w of wearers) w.d.dispose();
    expect(h.packs.wocArmorPackRefs(url)).toBe(0);
  });

  it('skips a wearer disposed before its unit runs, and leaves the ledger balanced', async () => {
    const { h, queue, body } = await world('medium');
    const url = h.core.wocArmorPackUrl('male', 'test', 'medium');
    const [stays, leaves] = [body(), body()];
    stays.d.want(['test']);
    leaves.d.want(['test']);
    await h.land('medium');
    queue.drain();
    stays.d.poll();
    leaves.d.poll();
    expect(queue.kinds()).toEqual([ATTACH, ATTACH]);
    // gone (out of range, logged out) while its unit waited its turn
    leaves.d.dispose();
    queue.drain();
    // one attach ran, and one unit ran to nothing (no span of its own)
    expect(h.spans).toEqual(['view:woc-armor-prepare', 'view:woc-armor-attach']);
    expect(leaves.host.adopt).not.toHaveBeenCalled();
    expect(leaves.host.reveal).not.toHaveBeenCalled();
    expect(h.packs.wocArmorContainers(leaves.host.model)).toEqual([]);
    // one wearer, one reference: the unit of the one that left took none
    expect(stays.d.attachedFiles).toEqual([{ set: 'test', url }]);
    expect(h.packs.wocArmorPackRefs(url)).toBe(1);
    stays.d.dispose();
    expect(h.packs.wocArmorPackRefs(url)).toBe(0);
  });

  it('attaches nothing inside want either, and the set the body wears when its unit runs, not the one it wore when it asked', async () => {
    const { h, queue, body, resident } = await world('medium');
    const w = body();
    const test = await resident('medium');
    const other = await resident('medium', 'other');
    // resident and prepared, and still not attached inside the call: a unit is asked for
    expect(w.d.want(['test'])).toBe(false);
    expect(w.host.adopt).not.toHaveBeenCalled();
    expect(w.d.isWaiting).toBe(true);
    expect(queue.kinds()).toEqual([ATTACH]);
    // the kit changes before the queue runs it
    expect(w.d.want(['other'])).toBe(false);
    expect(queue.kinds()).toEqual([ATTACH, ATTACH]);
    queue.drain();
    expect(w.d.attachedFiles).toEqual([{ set: 'other', url: other }]);
    expect(h.packs.wocArmorPackRefs(test)).toBe(0);
    expect(h.packs.wocArmorPackRefs(other)).toBe(1);
    expect(w.host.model.getObjectByName('Armor_Test_Helm')).toBeUndefined();
    expect(w.host.model.getObjectByName(partNames('other')[0])).toBeDefined();
    // the first unit did nothing at all: the two nodes adopted are the second set's
    expect(w.host.adopt).toHaveBeenCalledTimes(2);
    expect(w.d.poll()).toBe(true);
    expect(w.d.poll()).toBe(false);
    w.d.dispose();
  });

  it('attaches the better tier that landed while its unit waited, never the stand-in it was asked for', async () => {
    const { h, queue, body, resident } = await world('high');
    const w = body();
    // the low file stands in for a crowd character whose medium file still streams
    const low = await resident('low');
    const medium = h.core.wocArmorPackUrl('male', 'test', 'medium');
    w.d.want(['test']);
    expect(queue.kinds()).toEqual([ATTACH]);
    expect(h.pending.has(medium)).toBe(true);
    // the medium file lands, and is prepared, before the attach gets its turn
    await h.land('medium');
    queue.runOne(PREPARE);
    queue.drain();
    expect(w.d.attachedFiles).toEqual([{ set: 'test', url: medium }]);
    expect(h.packs.wocArmorPackRefs(low)).toBe(0);
    expect(h.packs.wocArmorContainers(w.host.model)).toHaveLength(1);
    w.d.dispose();
  });

  it('waits for the prepare inside the unit too: a file that landed since is prepared as its own unit, never inside an attach', async () => {
    const { h, queue, body, resident } = await world('high');
    const w = body();
    await resident('low');
    const medium = h.core.wocArmorPackUrl('male', 'test', 'medium');
    w.d.want(['test']);
    await h.land('medium');
    // the attach unit runs ahead of the medium file's prepare: it attaches nothing (the file
    // the set draws from now is not prepared, and the stand-in is no longer that file)
    queue.runOne(ATTACH);
    expect(w.host.adopt).not.toHaveBeenCalled();
    expect(h.bind.prepareWocArmor).toHaveBeenCalledTimes(1);
    expect(w.d.poll()).toBe(false);
    expect(queue.kinds()).toEqual([PREPARE]);
    queue.drain();
    expect(h.bind.prepareWocArmor).toHaveBeenCalledTimes(2);
    expect(w.d.poll()).toBe(false);
    expect(queue.kinds()).toEqual([ATTACH]);
    queue.drain();
    expect(w.d.attachedFiles).toEqual([{ set: 'test', url: medium }]);
    w.d.dispose();
  });

  it('attaches on the spot on a full-detail body with no queue behind it, preparing the file itself when no unit has yet', async () => {
    const { h, queue, body } = await world('medium');
    const url = h.core.wocArmorPackUrl('male', 'test', 'medium');
    // the character sheet's body, a portrait's: built directly while the world runs
    const preview = body('preview');
    await h.land('medium');
    // the store asked the world's queue for the prepare; the unit has not run
    expect(queue.kinds()).toEqual([PREPARE]);
    // its own frame attaches it, whole, inside the poll
    expect(preview.d.poll()).toBe(true);
    expect(preview.d.attachedFiles).toEqual([{ set: 'test', url }]);
    expect(preview.host.adopt).toHaveBeenCalledTimes(2);
    expect(preview.d.isWaiting).toBe(false);
    expect(h.bind.prepareWocArmor).toHaveBeenCalledTimes(1);
    // (paid where the body stands: a step of that frame in the build ledger, no unit's span)
    expect(h.spans).toEqual(['view-part:woc-armor-prepare']);
    // the world's unit finds the file prepared: nothing is done twice
    queue.drain();
    expect(h.bind.prepareWocArmor).toHaveBeenCalledTimes(1);
    expect(h.spans).toEqual(['view-part:woc-armor-prepare']);
    // ...and a body BUILT with the file resident and prepared is born wearing it
    const born = body();
    expect(born.d.attachedFiles).toEqual([{ set: 'test', url }]);
    expect(born.d.want(['test'])).toBe(false);
    expect(queue.units).toEqual([]);
    preview.d.dispose();
    born.d.dispose();
  });

  it('is born in its suit as a crowd character whose file is resident but not prepared yet: the prepare stays the queue unit', async () => {
    const { h, queue, body } = await world('medium');
    const url = h.core.wocArmorPackUrl('male', 'test', 'medium');
    body(); // an earlier wearer: the fetch is kicked, the store has the rig
    await h.land('medium');
    expect(queue.kinds()).toEqual([PREPARE]);
    // the budget has not let the prepare run, and the next wearer's view is built in a live
    // frame: it must not pay the prepare inside its build
    const late = body();
    expect(late.d.attachedFiles).toEqual([]);
    expect(late.host.adopt).not.toHaveBeenCalled();
    expect(late.d.isWaiting).toBe(true);
    expect(h.bind.prepareWocArmor).not.toHaveBeenCalled();
    // frames ask for nothing while the unit waits its turn
    expect(late.d.poll()).toBe(false);
    expect(queue.kinds()).toEqual([PREPARE]);
    queue.drain();
    expect(h.bind.prepareWocArmor).toHaveBeenCalledTimes(1);
    expect(late.d.poll()).toBe(false);
    expect(queue.kinds()).toEqual([ATTACH]);
    queue.drain();
    expect(late.d.attachedFiles).toEqual([{ set: 'test', url }]);
    // the prepare and the attach each ran as a unit: nothing was paid inside a build
    expect(h.spans).toEqual(['view:woc-armor-prepare', 'view:woc-armor-attach']);
    late.d.dispose();
  });

  it.each([
    {
      who: 'a view built under an arrival cover (behind a loading screen there is no frame to protect)',
      build: 'covered',
    },
    {
      who: 'a full-detail body (the local player, a preview)',
      build: 'full',
    },
    {
      who: 'a speculative build (the zone prewarm, which fetches nothing and waits on nothing)',
      build: 'speculative',
    },
  ] as const)(
    'is born whole all the same as $who, the prepare paid where it stands',
    async ({ build }) => {
      const { h, queue, body } = await world('medium');
      const url = h.core.wocArmorPackUrl('male', 'test', 'medium');
      body(); // an earlier wearer: the fetch is kicked, the store has the rig
      await h.land('medium');
      // resident, and its prepare still waiting in the queue
      expect(queue.kinds()).toEqual([PREPARE]);
      expect(h.bind.prepareWocArmor).not.toHaveBeenCalled();
      if (build === 'covered') h.setArrivalCover(true);
      const born =
        build === 'full'
          ? body('preview')
          : build === 'speculative'
            ? body('world', false)
            : body();
      if (build === 'covered') h.setArrivalCover(false);
      // it cannot come out in its suit: attached inside its build, prepared there too
      expect(born.d.attachedFiles).toEqual([{ set: 'test', url }]);
      expect(h.bind.prepareWocArmor).toHaveBeenCalledTimes(1);
      expect(h.spans).toEqual(['view-part:woc-armor-prepare']);
      // the queued unit then runs to nothing
      queue.drain();
      expect(h.bind.prepareWocArmor).toHaveBeenCalledTimes(1);
      expect(h.spans).toEqual(['view-part:woc-armor-prepare']);
      born.d.dispose();
    },
  );

  it('asks a replaced queue again for the attach the old one still held', async () => {
    const { h, queue, body, resident, rideQueue } = await world('medium');
    const w = body();
    const url = await resident('medium');
    w.d.want(['test']);
    expect(queue.kinds()).toEqual([ATTACH]);
    // the renderer generation changed: the old queue never runs its unit
    const next = heldQueue();
    w.host.schedule = rideQueue(next);
    w.d.gateChanged();
    w.d.poll();
    expect(next.kinds()).toEqual([ATTACH]);
    next.drain();
    expect(w.d.attachedFiles).toEqual([{ set: 'test', url }]);
    // the old queue's unit, should it ever run after all, attaches nothing more
    queue.drain();
    expect(h.packs.wocArmorContainers(w.host.model)).toHaveLength(1);
    expect(h.packs.wocArmorPackRefs(url)).toBe(1);
    expect(w.host.adopt).toHaveBeenCalledTimes(2);
    w.d.dispose();
  });

  it('attaches a replacement as a unit as well, the file it replaces drawing until its reveal settles', async () => {
    const { h, queue, body, resident } = await world('high', 'gated');
    const w = body();
    const low = await resident('low');
    const medium = h.core.wocArmorPackUrl('male', 'test', 'medium');
    w.d.want(['test']);
    queue.drain();
    h.settle();
    expect(w.d.poll()).toBe(true);
    expect(w.d.attachedFiles).toEqual([{ set: 'test', url: low }]);
    await h.land('medium');
    queue.runOne(PREPARE);
    // the frame asks; nothing of the new file is on the body until the unit runs
    expect(w.d.poll()).toBe(false);
    expect(queue.kinds()).toEqual([ATTACH]);
    expect(h.packs.wocArmorContainers(w.host.model)).toHaveLength(1);
    queue.drain();
    expect(h.packs.wocArmorContainers(w.host.model)).toHaveLength(2);
    expect(w.d.attachedFiles).toEqual([{ set: 'test', url: low }]);
    expect(w.d.poll()).toBe(true); // the host dresses the new file's nodes too
    h.settle();
    expect(w.d.attachedFiles).toEqual([{ set: 'test', url: medium }]);
    expect(h.packs.wocArmorContainers(w.host.model)).toHaveLength(1);
    expect(w.d.poll()).toBe(true);
    expect(w.d.poll()).toBe(false);
    w.d.dispose();
  });

  it('contains an attach that throws inside its unit, and asks for no further unit frame after frame', async () => {
    const { h, body, resident } = await world('medium');
    const w = body();
    const url = await resident('medium');
    // this body's queue hands its units straight to the case, so a throw would be seen
    const units: (() => void)[] = [];
    w.host.schedule = (work) => units.push(work);
    w.d.want(['test']);
    expect(units).toHaveLength(1);
    w.host.adopt.mockImplementationOnce(() => {
      throw new Error('a host step that throws');
    });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => units.shift()?.()).not.toThrow();
    // nothing of the file is left on the body, and its reference is back
    expect(w.d.attachedFiles).toEqual([]);
    expect(h.packs.wocArmorContainers(w.host.model)).toEqual([]);
    expect(h.packs.wocArmorPackRefs(url)).toBe(0);
    expect(logged).toHaveBeenCalledTimes(1);
    // the host reads its parts afresh once; then no frame asks for the attach again
    expect(w.d.poll()).toBe(true);
    for (let frame = 0; frame < 5; frame++) expect(w.d.poll()).toBe(false);
    expect(units).toEqual([]);
    expect(w.d.isWaiting).toBe(false);
    w.d.dispose();
  });

  it('asks nothing every frame for a file its model cannot take', async () => {
    const { h, queue, body, resident, rideQueue } = await world('medium');
    body();
    await resident('medium');
    // a model with no rig of its own: nothing to bind armor to
    const host = h.hostOf(new THREE.Group());
    host.schedule = rideQueue(queue);
    const d = new h.dressing.WocArmorDressing(host, manifest, 'crowd');
    d.want(['test']);
    expect(queue.kinds()).toEqual([ATTACH]);
    queue.drain();
    expect(d.attachedFiles).toEqual([]);
    for (let frame = 0; frame < 5; frame++) expect(d.poll()).toBe(false);
    expect(queue.units).toEqual([]);
    expect(d.isWaiting).toBe(false);
    d.dispose();
  });
});

describe('a WOC character giving its armor back', () => {
  it('gives every file back when one of them throws on the way out, and never throws itself', async () => {
    const h = await harness('medium', 'now');
    const test = h.core.wocArmorPackUrl('male', 'test', 'medium');
    const other = h.core.wocArmorPackUrl('male', 'other', 'medium');
    h.packs.ensureWocArmorPack(test);
    h.packs.ensureWocArmorPack(other);
    await h.land('medium');
    await h.land('medium', 'other');
    const d = new h.dressing.WocArmorDressing(h.host, manifest, 'crowd');
    d.want(['test', 'other']);
    expect([h.packs.wocArmorPackRefs(test), h.packs.wocArmorPackRefs(other)]).toEqual([1, 1]);
    // the first file's node cannot leave the model
    const [first] = h.packs.wocArmorContainers(h.host.model);
    first.removeFromParent = () => {
      throw new Error('a node that will not detach');
    };
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => d.dispose()).not.toThrow();
    // both references are back, the throwing file's too, and the other file left the model
    expect([h.packs.wocArmorPackRefs(test), h.packs.wocArmorPackRefs(other)]).toEqual([0, 0]);
    expect(h.host.model.getObjectByName(partNames('other')[0])).toBeUndefined();
    expect(d.attachedFiles).toEqual([]);
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it('gives its files back when taking its merged stand-in down throws', async () => {
    const h = await harness('medium', 'now', (fileTier) => {
      // one material, the same attributes on both parts: a kit that folds
      const r = bones();
      const material = new THREE.MeshBasicMaterial();
      material.name = fileTier;
      const geometry = new THREE.BoxGeometry(0.2, 0.2, 0.2);
      const count = geometry.getAttribute('position').count;
      const joints = new Uint16Array(count * 4);
      const weights = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) {
        joints[i * 4] = 1;
        weights[i * 4] = 1;
      }
      geometry.setAttribute('skinIndex', new THREE.BufferAttribute(joints, 4));
      geometry.setAttribute('skinWeight', new THREE.BufferAttribute(weights, 4));
      const helm = new THREE.SkinnedMesh(geometry, material);
      helm.name = 'Armor_Test_Helm';
      r.root.add(helm);
      helm.bind(new THREE.Skeleton(r.list));
      const pad = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), material);
      pad.name = 'Armor_Test_Shoulder_L';
      r.spine.add(pad);
      return { scene: r.root, animations: [] };
    });
    const url = h.core.wocArmorPackUrl('male', 'test', 'medium');
    const d = new h.dressing.WocArmorDressing(h.host, manifest, 'crowd');
    d.want(['test']);
    await h.land('medium');
    d.poll();
    for (const name of ['Armor_Test_Helm', 'Armor_Test_Shoulder_L']) {
      const part = h.host.model.getObjectByName(name);
      if (part) part.visible = true;
    }
    d.setMerged(true);
    d.redressed();
    d.poll();
    expect(d.isMerged).toBe(true);
    h.host.forget.mockImplementation(() => {
      throw new Error('a host that cannot forget');
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => d.dispose()).not.toThrow();
    expect(h.packs.wocArmorPackRefs(url)).toBe(0);
    expect(h.packs.wocArmorContainers(h.host.model)).toEqual([]);
  });
});

describe('a WOC character drawing its armor merged', () => {
  const MERGED = 'woc_armor_merged';
  const PARTS = ['Armor_Test_Helm', 'Armor_Test_Shoulder_L'];

  /** An armor file whose two parts can share a draw: the helm (skinned to the spine) and
   *  the pad (rigid on it) on one material, carrying the same vertex attributes. */
  function kitFile(tier: string) {
    const r = bones();
    const material = new THREE.MeshBasicMaterial();
    material.name = tier;
    const geometry = new THREE.BoxGeometry(0.2, 0.2, 0.2);
    geometry.translate(0, 1.6, 0);
    const count = geometry.getAttribute('position').count;
    const joints = new Uint16Array(count * 4).fill(0);
    const weights = new Float32Array(count * 4).fill(0);
    for (let i = 0; i < count; i++) {
      joints[i * 4] = 1;
      weights[i * 4] = 1;
    }
    geometry.setAttribute('skinIndex', new THREE.BufferAttribute(joints, 4));
    geometry.setAttribute('skinWeight', new THREE.BufferAttribute(weights, 4));
    const helm = new THREE.SkinnedMesh(geometry, material);
    helm.name = 'Armor_Test_Helm';
    r.root.add(helm);
    helm.bind(new THREE.Skeleton(r.list));
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), material);
    pad.name = 'Armor_Test_Shoulder_L';
    pad.position.set(0.3, 0.2, 0);
    r.spine.add(pad);
    return { scene: r.root, animations: [] };
  }

  /** A crowd dressing on the `tier` preset with its set attached (its one file: low on the
   *  low preset, else medium). The fake host never dresses by itself: `dress` below is its
   *  part pass. */
  async function dressed(
    tier: 'low' | 'medium' | 'high',
    reveals: 'now' | 'gated' = 'now',
    file: (fileTier: string) => { scene: THREE.Object3D; animations: never[] } = kitFile,
  ) {
    const h = await harness(tier, reveals, file);
    const d = new h.dressing.WocArmorDressing(h.host, manifest, 'crowd');
    d.want(['test']);
    await h.land(tier === 'low' ? 'low' : 'medium');
    expect(d.poll()).toBe(true);
    return { h, d };
  }
  /** The host's part pass: show these parts, hide the rest, then tell the dressing. */
  const dress = (
    model: THREE.Object3D,
    d: { redressed(): void },
    shown: readonly string[] = PARTS,
  ): void => {
    // every node of a part's name, as the visual's pass does (woc_parts.ts): a file and the
    // replacement linking behind it carry the same parts
    model.traverse((node) => {
      if (PARTS.includes(node.name)) node.visible = shown.includes(node.name);
    });
    d.redressed();
  };
  const merged = (model: THREE.Object3D): THREE.Object3D | undefined =>
    model.children.find((child) => child.name === MERGED);
  const mergedMesh = (model: THREE.Object3D): THREE.SkinnedMesh => {
    const mesh = merged(model)?.children[0];
    if (!mesh) throw new Error('no merged mesh');
    return mesh as THREE.SkinnedMesh;
  };
  const masks = (model: THREE.Object3D): number[] =>
    PARTS.map((name) => model.getObjectByName(name)?.layers.mask ?? -1);
  /** The visual's blended overlay: a transparent clone on every mesh of the body. */
  const overlay = (model: THREE.Object3D): { lift(): void } => {
    const plain = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      plain.set(mesh, mesh.material);
      const ghost = (mesh.material as THREE.Material).clone();
      ghost.transparent = true;
      mesh.material = ghost;
    });
    return {
      lift: () => {
        for (const [mesh, material] of plain) mesh.material = material;
      },
    };
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps drawing part by part until a world view asks', async () => {
    const { h, d } = await dressed('high');
    dress(h.host.model, d);
    expect(d.poll()).toBe(false);
    expect(d.poll()).toBe(false);
    expect(d.isMerged).toBe(false);
    expect(merged(h.host.model)).toBeUndefined();
    expect(masks(h.host.model)).toEqual([1, 1]);
    // only the attach went through the host
    expect(h.host.adopt).toHaveBeenCalledTimes(2);
    // ...and the entry points a world view's host calls are nothing without the ask
    d.redressed();
    d.effectsChanged();
    d.gateChanged();
    d.poll();
    expect(merged(h.host.model)).toBeUndefined();
    expect(h.host.adopt).toHaveBeenCalledTimes(2);
  });

  it('folds the drawn parts from the poll once asked, and the poll still answers for the files alone', async () => {
    const { h, d } = await dressed('high');
    dress(h.host.model, d);
    d.setMerged(true);
    // asking mounts nothing: a mount belongs to the per-frame poll
    expect(merged(h.host.model)).toBeUndefined();
    expect(d.isMerged).toBe(false);
    // the files did not change (false), and the helm and the pad are one mesh now
    expect(d.poll()).toBe(false);
    const wrapper = merged(h.host.model);
    expect(wrapper?.children.map((child) => child.name)).toEqual([`${MERGED}_0`]);
    expect(d.isMerged).toBe(true);
    expect(masks(h.host.model)).toEqual([0, 0]);
    // the stand-in went through the host's setup and its compile gate like any attach
    expect(h.host.adopt).toHaveBeenLastCalledWith(wrapper);
    expect(h.host.adopt).toHaveBeenCalledTimes(3);
    expect(h.host.reveal).toHaveBeenCalledTimes(3);
    expect(h.host.reveal.mock.calls[2][0]).toBe(wrapper);
    const mesh = mergedMesh(h.host.model);
    const helm = h.host.model.getObjectByName('Armor_Test_Helm') as THREE.SkinnedMesh;
    expect(mesh.isSkinnedMesh).toBe(true);
    expect(mesh.skeleton).toBe(helm.skeleton);
    expect(mesh.material).toBe(h.packs.wocArmorFileMaterial(helm));
    d.dispose();
  });

  it('costs a flag read a frame once it stands: nothing read again, nothing mounted', async () => {
    const { h, d } = await dressed('high');
    dress(h.host.model, d);
    d.setMerged(true);
    d.poll();
    const wrapper = merged(h.host.model);
    const merge = await import('../src/render/characters/woc_armor_merge');
    const reconciles = vi.spyOn(merge.WocArmorMergeRig.prototype, 'sync');
    const mounts = vi.spyOn(merge.WocArmorMergeRig.prototype, 'mountPending');
    for (let frame = 0; frame < 5; frame++) expect(d.poll()).toBe(false);
    expect(reconciles).not.toHaveBeenCalled();
    expect(mounts).not.toHaveBeenCalled();
    expect(merged(h.host.model)).toBe(wrapper);
    expect(h.host.adopt).toHaveBeenCalledTimes(3);
    d.dispose();
  });

  it('asks once: a second ask keeps the stand-in it has', async () => {
    const { h, d } = await dressed('high');
    dress(h.host.model, d);
    d.setMerged(true);
    d.poll();
    const wrapper = merged(h.host.model);
    d.setMerged(true);
    d.poll();
    expect(merged(h.host.model)).toBe(wrapper);
    expect(h.host.model.children.filter((child) => child.name === MERGED)).toHaveLength(1);
    expect(h.host.adopt).toHaveBeenCalledTimes(3);
    expect(d.isMerged).toBe(true);
    d.dispose();
  });

  it('drops the stand-in the moment a redress changes the drawn parts, and mounts the next from the poll', async () => {
    const { h, d } = await dressed('high');
    dress(h.host.model, d);
    d.setMerged(true);
    d.poll();
    const first = merged(h.host.model);
    expect(d.isMerged).toBe(true);
    // the pad comes off: the stand-in still draws it, so it goes inside the redress
    dress(h.host.model, d, ['Armor_Test_Helm']);
    expect(d.isMerged).toBe(false);
    expect(merged(h.host.model)).toBeUndefined();
    expect(masks(h.host.model)).toEqual([1, 1]);
    expect(h.host.forget).toHaveBeenLastCalledWith(first);
    // one part left: nothing to fold, whatever the poll runs
    d.poll();
    expect(merged(h.host.model)).toBeUndefined();
    // the pad goes back on: the redress never mounts, the next poll does
    dress(h.host.model, d);
    expect(d.isMerged).toBe(false);
    expect(merged(h.host.model)).toBeUndefined();
    expect(d.poll()).toBe(false);
    expect(d.isMerged).toBe(true);
    expect(merged(h.host.model)).not.toBe(first);
    expect(masks(h.host.model)).toEqual([0, 0]);
    // a redress that changes nothing keeps it
    const second = merged(h.host.model);
    dress(h.host.model, d);
    expect(merged(h.host.model)).toBe(second);
    expect(d.isMerged).toBe(true);
    d.dispose();
  });

  it('hands the mount to the host work queue where there is one, one unit at a time, labelled by its cost', async () => {
    const { h, d } = await dressed('high');
    const queue: { work: () => void; label: string }[] = [];
    h.host.schedule = (work, label) => queue.push({ work, label });
    dress(h.host.model, d);
    d.setMerged(true);
    d.poll();
    // asked for, not done: the queue's frame budget decides when
    expect(queue.map((unit) => unit.label)).toEqual(['woc-armor-merge:male']);
    expect(h.dressing.WOC_ARMOR_MERGE_LABEL).toBe('woc-armor-merge');
    expect(h.dressing.WOC_ARMOR_MOUNT_LABEL).toBe('woc-armor-mount');
    expect(merged(h.host.model)).toBeUndefined();
    // every frame until it runs asks nothing more
    d.poll();
    d.poll();
    expect(queue).toHaveLength(1);
    queue.shift()?.work();
    expect(d.isMerged).toBe(true);
    expect(masks(h.host.model)).toEqual([0, 0]);
    d.poll();
    expect(queue).toHaveLength(0);
    // a kit somebody already built rides its own kind: the budget learns the two apart
    const peerHost = { ...h.host, model: model() };
    const other = new h.dressing.WocArmorDressing(peerHost, manifest, 'crowd');
    // (a body with the queue behind it attaches its file as a unit of it, too)
    other.want(['test']);
    expect(queue.map((unit) => unit.label)).toEqual(['woc-armor-attach:male:test']);
    queue.shift()?.work();
    expect(other.poll()).toBe(true);
    dress(peerHost.model, other);
    other.setMerged(true);
    other.poll();
    expect(queue.map((unit) => unit.label)).toEqual(['woc-armor-mount:male']);
    queue.shift()?.work();
    expect(other.isMerged).toBe(true);
    // one buffer for the two of them
    expect(mergedMesh(peerHost.model).geometry).toBe(mergedMesh(h.host.model).geometry);
    d.dispose();
    other.dispose();
  });

  it('looks again when its queued mount runs: the kit as it draws then, or nothing at all', async () => {
    const { h, d } = await dressed('high');
    const queue: (() => void)[] = [];
    h.host.schedule = (work) => queue.push(work);
    dress(h.host.model, d);
    d.setMerged(true);
    d.poll();
    // the pad came off while the unit waited: one part left, nothing to stand in for
    dress(h.host.model, d, ['Armor_Test_Helm']);
    queue.shift()?.();
    expect(merged(h.host.model)).toBeUndefined();
    expect(h.host.adopt).toHaveBeenCalledTimes(2);
    // back on and asked again, and the rig went far before the unit ran
    dress(h.host.model, d);
    d.poll();
    expect(queue).toHaveLength(1);
    h.host.rigDrawn = () => false;
    queue.shift()?.();
    expect(merged(h.host.model)).toBeUndefined();
    // near again: asked again, and the world view let go before it ran
    h.host.rigDrawn = () => true;
    d.poll();
    expect(queue).toHaveLength(1);
    d.setMerged(false);
    // ...and asked again at once: a unit of its own, the old one still in the queue
    d.setMerged(true);
    d.poll();
    expect(queue).toHaveLength(2);
    // the old unit belongs to a stand-in that is gone: it mounts nothing, and it does not
    // free the slot the new unit holds (no third unit for the same mount)
    queue.shift()?.();
    expect(merged(h.host.model)).toBeUndefined();
    d.poll();
    expect(queue).toHaveLength(1);
    // disposed before the new one ran
    d.dispose();
    queue.shift()?.();
    expect(merged(h.host.model)).toBeUndefined();
    expect(h.host.adopt).toHaveBeenCalledTimes(2);
  });

  it('mounts on the spot with no renderer behind the body, every wearer of a kit over one buffer', async () => {
    const { h, d } = await dressed('high');
    dress(h.host.model, d);
    d.setMerged(true);
    const peerHost = { ...h.host, model: model() };
    const other = new h.dressing.WocArmorDressing(peerHost, manifest, 'crowd');
    other.want(['test']);
    dress(peerHost.model, other);
    other.setMerged(true);
    // no queue, no timer of its own: both stand from their own poll
    d.poll();
    other.poll();
    expect(d.isMerged).toBe(true);
    expect(other.isMerged).toBe(true);
    expect(mergedMesh(peerHost.model).geometry).toBe(mergedMesh(h.host.model).geometry);
    d.dispose();
    other.dispose();
  });

  it('mounts nothing for a rig nobody sees, and mounts it the frame it draws', async () => {
    const { h, d } = await dressed('high');
    let drawn = false;
    h.host.rigDrawn = () => drawn;
    const queue: (() => void)[] = [];
    h.host.schedule = (work) => queue.push(work);
    dress(h.host.model, d);
    d.setMerged(true);
    // far, or hidden for its head: a stand-in nobody would see is not mounted, and not
    // one unit of the queue is spent asking
    for (let frame = 0; frame < 3; frame++) d.poll();
    expect(queue).toHaveLength(0);
    expect(merged(h.host.model)).toBeUndefined();
    expect(h.host.adopt).toHaveBeenCalledTimes(2);
    drawn = true;
    d.poll();
    expect(queue).toHaveLength(1);
    queue.shift()?.();
    expect(d.isMerged).toBe(true);
    // a rig that goes far again keeps the stand-in it has: hidden with it, it costs nothing
    drawn = false;
    d.poll();
    expect(d.isMerged).toBe(true);
    d.dispose();
  });

  it('goes back to its parts inside the host call that says an overlay landed, and stands again once it lifts', async () => {
    const { h, d } = await dressed('high');
    dress(h.host.model, d);
    d.setMerged(true);
    d.poll();
    const wrapper = merged(h.host.model);
    expect(d.isMerged).toBe(true);
    // the visual's ghost run committed: a blended clone on every mesh, then the host's call
    const ghost = overlay(h.host.model);
    d.effectsChanged();
    expect(d.isMerged).toBe(false);
    expect(masks(h.host.model)).toEqual([1, 1]);
    // parked, not gone: still mounted, hidden, nothing rebuilt when the overlay lifts
    expect(merged(h.host.model)).toBe(wrapper);
    expect(wrapper?.visible).toBe(false);
    d.poll();
    expect(d.isMerged).toBe(false);
    ghost.lift();
    // lifting is the host's material pass: the stand-in comes back from the poll
    d.effectsChanged();
    expect(d.isMerged).toBe(false);
    d.poll();
    expect(d.isMerged).toBe(true);
    expect(merged(h.host.model)).toBe(wrapper);
    expect(wrapper?.visible).toBe(true);
    expect(masks(h.host.model)).toEqual([0, 0]);
    expect(h.host.adopt).toHaveBeenCalledTimes(3);
    expect(h.host.forget).not.toHaveBeenCalled();
    d.dispose();
  });

  it('waits out an overlay that was on before it could mount, and asks for no mount meanwhile', async () => {
    const { h, d } = await dressed('high');
    const queue: (() => void)[] = [];
    h.host.schedule = (work) => queue.push(work);
    dress(h.host.model, d);
    const ghost = overlay(h.host.model);
    d.setMerged(true);
    for (let frame = 0; frame < 3; frame++) d.poll();
    // the parts draw blended, by themselves: not one unit queued for a mount under it
    expect(queue).toHaveLength(0);
    expect(merged(h.host.model)).toBeUndefined();
    ghost.lift();
    d.effectsChanged();
    d.poll();
    expect(queue).toHaveLength(1);
    queue.shift()?.();
    expect(d.isMerged).toBe(true);
    d.dispose();
  });

  it('asks a replaced gate and queue again for what the old ones still held', async () => {
    const { h, d } = await dressed('high', 'gated');
    h.settle();
    const queue: (() => void)[] = [];
    h.host.schedule = (work) => queue.push(work);
    dress(h.host.model, d);
    d.setMerged(true);
    d.poll();
    expect(queue).toHaveLength(1);
    // the renderer generation changed: the old queue never runs its unit
    d.gateChanged();
    d.poll();
    expect(queue).toHaveLength(2);
    queue[1]();
    const wrapper = merged(h.host.model);
    expect(wrapper).toBeDefined();
    expect(d.isMerged).toBe(false);
    const reveals = h.host.reveal.mock.calls.length;
    // ...and again while its programs link: the old gate never settles, the new one is asked
    d.gateChanged();
    d.poll();
    expect(merged(h.host.model)).toBe(wrapper);
    expect(h.host.reveal.mock.calls.length).toBe(reveals + 1);
    h.settle();
    expect(d.isMerged).toBe(true);
    // the old queue's unit, should it ever run after all, changes nothing
    queue[0]();
    expect(merged(h.host.model)).toBe(wrapper);
    expect(h.host.model.children.filter((child) => child.name === MERGED)).toHaveLength(1);
    d.dispose();
  });

  it('takes the stand-in down before the file it folds detaches', async () => {
    const { h, d } = await dressed('medium');
    dress(h.host.model, d);
    d.setMerged(true);
    d.poll();
    const helm = h.host.model.getObjectByName('Armor_Test_Helm') as THREE.Mesh;
    const pad = h.host.model.getObjectByName('Armor_Test_Shoulder_L') as THREE.Mesh;
    expect([helm.layers.mask, pad.layers.mask]).toEqual([0, 0]);
    h.host.forget.mockClear();
    expect(d.want([])).toBe(true);
    // the merged wrapper left the host's bookkeeping first, then the file's own nodes
    expect(h.host.forget.mock.calls.map(([node]) => node.name)).toEqual([
      MERGED,
      'woc_armor_test',
      'woc_armor_rigid_Armor_Test_Shoulder_L',
    ]);
    expect(merged(h.host.model)).toBeUndefined();
    expect(d.isMerged).toBe(false);
    // the parts left the model drawing as they were attached: another wearer of the file
    // shares their geometry, and a re-attach makes new meshes
    expect([helm.layers.mask, pad.layers.mask]).toEqual([1, 1]);
    d.poll();
    expect(merged(h.host.model)).toBeUndefined();
    d.dispose();
  });

  it('forgets a stand-in that only waited when its file detaches: none mounts for parts that are gone', async () => {
    const { h, d } = await dressed('medium');
    const queue: (() => void)[] = [];
    h.host.schedule = (work) => queue.push(work);
    dress(h.host.model, d);
    d.setMerged(true);
    d.poll();
    expect(queue).toHaveLength(1);
    expect(d.want([])).toBe(true);
    queue.shift()?.();
    d.poll();
    expect(merged(h.host.model)).toBeUndefined();
    expect(h.host.adopt).toHaveBeenCalledTimes(2);
    d.dispose();
  });

  it('follows a tier swap: down with the stand-in tier, up again on the file that landed', async () => {
    const h = await harness('high', 'now', kitFile);
    const low = h.core.wocArmorPackUrl('male', 'test', 'low');
    const medium = h.core.wocArmorPackUrl('male', 'test', 'medium');
    h.packs.ensureWocArmorPack(low);
    await h.land('low');
    const d = new h.dressing.WocArmorDressing(h.host, manifest, 'crowd');
    expect(d.want(['test'])).toBe(true);
    d.setMerged(true);
    dress(h.host.model, d);
    expect(d.poll()).toBe(false);
    expect(d.isMerged).toBe(true);
    const lowMesh = mergedMesh(h.host.model);
    expect((lowMesh.material as THREE.Material).name).toBe('low');
    // the wanted tier lands: the files change (true), and the low stand-in is gone with them
    await h.land('medium');
    h.host.forget.mockClear();
    expect(d.poll()).toBe(true);
    expect(h.host.forget.mock.calls[0][0].name).toBe(MERGED);
    expect(d.attachedFiles).toEqual([{ set: 'test', url: medium }]);
    expect(merged(h.host.model)).toBeUndefined();
    expect(d.isMerged).toBe(false);
    // the host re-dresses the new file's parts, and the next poll folds them
    dress(h.host.model, d);
    expect(merged(h.host.model)).toBeUndefined();
    expect(d.poll()).toBe(false);
    expect(d.isMerged).toBe(true);
    const highMesh = mergedMesh(h.host.model);
    expect((highMesh.material as THREE.Material).name).toBe('medium');
    expect(highMesh.geometry).not.toBe(lowMesh.geometry);
    expect(h.packs.wocArmorPackRefs(low)).toBe(0);
    d.dispose();
  });

  it('keeps the replaced file folded and drawing while its replacement links, then folds the new one', async () => {
    const h = await harness('high', 'gated', kitFile);
    h.packs.ensureWocArmorPack(h.core.wocArmorPackUrl('male', 'test', 'low'));
    await h.land('low');
    const d = new h.dressing.WocArmorDressing(h.host, manifest, 'crowd');
    d.want(['test']);
    h.settle();
    d.setMerged(true);
    dress(h.host.model, d);
    d.poll();
    h.settle();
    expect(d.isMerged).toBe(true);
    const lowMerged = merged(h.host.model);
    // the medium file lands and attaches behind the gate; the host dresses both files' parts
    await h.land('medium');
    expect(d.poll()).toBe(true);
    dress(h.host.model, d);
    // the low kit's stand-in still stands for exactly the parts that draw: the armor never
    // drops to its bare parts, let alone to nothing, while the new file links
    expect(d.isMerged).toBe(true);
    expect(merged(h.host.model)).toBe(lowMerged);
    expect(lowMerged?.visible).toBe(true);
    d.poll();
    expect(merged(h.host.model)).toBe(lowMerged);
    // the replacement's reveal settles: the low file and its stand-in leave in that step, the
    // medium parts draw by themselves at once
    h.settle();
    expect(merged(h.host.model)).toBeUndefined();
    expect(d.isMerged).toBe(false);
    const helms: THREE.Mesh[] = [];
    h.host.model.traverse((o) => {
      if (o.name === 'Armor_Test_Helm') helms.push(o as THREE.Mesh);
    });
    expect(helms).toHaveLength(1);
    expect((helms[0].material as THREE.Material).name).toBe('medium');
    expect(helms[0].layers.mask).toBe(1);
    expect(helms[0].visible && helms[0].parent?.visible).toBe(true);
    // the host re-dresses on its next frame, and the medium kit is folded from the one after
    expect(d.poll()).toBe(true);
    dress(h.host.model, d);
    d.poll();
    h.settle();
    expect(d.isMerged).toBe(true);
    expect((mergedMesh(h.host.model).material as THREE.Material).name).toBe('medium');
    d.dispose();
  });

  it('folds a file that attached behind the compile gate only once its reveal settles', async () => {
    const { h, d } = await dressed('high', 'gated');
    d.setMerged(true);
    dress(h.host.model, d);
    // the file's nodes are hidden while its programs link: nothing of it draws yet
    d.poll();
    expect(merged(h.host.model)).toBeUndefined();
    expect(d.isMerged).toBe(false);
    // its reveals settle with no redress following: the poll reads the parts again
    h.settle();
    d.poll();
    const wrapper = merged(h.host.model);
    expect(wrapper).toBeDefined();
    // ...and the stand-in waits behind the gate in its turn, the parts drawing meanwhile
    expect(d.isMerged).toBe(false);
    expect(wrapper?.visible).toBe(false);
    expect(masks(h.host.model)).toEqual([1, 1]);
    h.settle();
    expect(d.isMerged).toBe(true);
    expect(wrapper?.visible).toBe(true);
    expect(masks(h.host.model)).toEqual([0, 0]);
    d.dispose();
  });

  it('leaves a blended part drawing by itself', async () => {
    const glass = (fileTier: string) => {
      const out = kitFile(fileTier);
      out.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) (mesh.material as THREE.Material).transparent = true;
      });
      return out;
    };
    const { h, d } = await dressed('high', 'now', glass);
    dress(h.host.model, d);
    d.setMerged(true);
    d.poll();
    d.poll();
    expect(d.isMerged).toBe(false);
    expect(merged(h.host.model)).toBeUndefined();
    expect(masks(h.host.model)).toEqual([1, 1]);
    expect(h.host.adopt).toHaveBeenCalledTimes(2);
    d.dispose();
  });

  it('leaves parts that carry different vertex attributes in their own draws', async () => {
    // the plain fixture: the helm is a bare triangle (no normal, no uv), the pad a box
    // with both. One material, but two programs: nothing to fold
    const { h, d } = await dressed('high', 'now', armorFile);
    dress(h.host.model, d);
    d.setMerged(true);
    d.poll();
    expect(d.isMerged).toBe(false);
    expect(merged(h.host.model)).toBeUndefined();
    expect(masks(h.host.model)).toEqual([1, 1]);
    d.dispose();
  });

  it('takes the stand-in down when the world view lets go, and on dispose', async () => {
    const { h, d } = await dressed('low');
    const url = h.core.wocArmorPackUrl('male', 'test', 'low');
    dress(h.host.model, d);
    d.setMerged(true);
    d.poll();
    expect(d.isMerged).toBe(true);
    d.setMerged(false);
    expect(d.isMerged).toBe(false);
    expect(merged(h.host.model)).toBeUndefined();
    expect(masks(h.host.model)).toEqual([1, 1]);
    d.poll();
    expect(merged(h.host.model)).toBeUndefined();
    // asked again: the same kit, already built
    d.setMerged(true);
    d.poll();
    expect(d.isMerged).toBe(true);
    const helm = h.host.model.getObjectByName('Armor_Test_Helm') as THREE.Mesh;
    d.dispose();
    expect(d.isMerged).toBe(false);
    expect(merged(h.host.model)).toBeUndefined();
    expect(helm.layers.mask).toBe(1);
    expect(h.packs.wocArmorPackRefs(url)).toBe(0);
    expect(h.packs.wocArmorContainers(h.host.model)).toEqual([]);
  });

  it('remembers the material each attached part hangs with, whatever a host mounts on it', async () => {
    const { h, d } = await dressed('high');
    const helm = h.host.model.getObjectByName('Armor_Test_Helm') as THREE.Mesh;
    const pad = h.host.model.getObjectByName('Armor_Test_Shoulder_L') as THREE.Mesh;
    const file = helm.material as THREE.Material;
    expect(file.name).toBe('medium');
    expect(pad.material).toBe(file);
    // the visual's material pass: a tier material per mesh
    helm.material = file.clone();
    pad.material = file.clone();
    expect(h.packs.wocArmorFileMaterial(helm)).toBe(file);
    expect(h.packs.wocArmorFileMaterial(pad)).toBe(file);
    // a mesh the store did not attach has none
    expect(h.packs.wocArmorFileMaterial(h.host.model)).toBeNull();
    expect(
      h.packs.wocArmorFileMaterial(h.host.model.getObjectByName('Character_Body') as THREE.Mesh),
    ).toBeNull();
    d.dispose();
  });
});
