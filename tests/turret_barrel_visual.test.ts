import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { setBuildSpanSink } from '../src/render/build_spans';
import { CannonPuffBursts } from '../src/render/cannon_puff_burst_core';
import { PUFF } from '../src/render/cannon_puff_core';
import { drawProgramSignature } from '../src/render/draw_program_signature_core';
import { floorVfxRenderOrder } from '../src/render/floor_vfx_layer';
import { gfxInternalsForTest } from '../src/render/gfx';
import { collectNonResidentTextures } from '../src/render/texture_prep_core';
import {
  TURRET_BARREL_FIRE_PUFFS,
  TURRET_BARREL_LOOK,
  TURRET_BARREL_SHARDS,
  TURRET_FUSE_FIXED_PUFFS,
  TURRET_KEG_BARE_ASPECT,
  TURRET_KEG_MARK,
  TURRET_KEG_MARK_FRAME,
  TURRET_KEG_SHAPE,
  turretBarrelCounts,
  turretKegBombTriangles,
  turretKegFacetNormalInto,
  turretKegMarkLayout,
  turretKegMarkTexels,
  turretKegWickTipInto,
  turretKegYaw,
} from '../src/render/turret_barrel_core';
import {
  resetTurretKegMarkTexelsForTest,
  TURRET_BARREL_BURSTS,
  TURRET_BARREL_MATERIAL_PREFIX,
  TURRET_BARREL_NAME,
  type TurretBarrelField,
  TurretBarrelVisual,
  turretBarrelBlast,
} from '../src/render/turret_barrel_visual';
import { TURRET_CONTACT_PUFFS } from '../src/render/turret_contact_dust_core';
import {
  buildWorldQuestTraceStandIn,
  worldQuestTraceMaterials,
} from '../src/render/world_quest_trace_materials';
import { TURRET_EXPLOSIVE_BARREL } from '../src/sim/content/turret_defense';
import type { TurretEvent } from '../src/sim/minigames/turret_defense';
import { DT } from '../src/sim/types';
import type { TurretSessionView } from '../src/world_api/vehicles';
import { drawsUnder, threeProgramKeys } from './helpers/three_program_keys';

type Barrel = TurretSessionView['defense']['barrels'][number];

/** Lets a case make the mark's bomb and wick fail to merge. */
const merge = vi.hoisted(() => ({ fail: false }));
vi.mock('three/examples/jsm/utils/BufferGeometryUtils.js', async (importOriginal) => {
  const real =
    await importOriginal<typeof import('three/examples/jsm/utils/BufferGeometryUtils.js')>();
  return {
    ...real,
    mergeGeometries: (...args: Parameters<typeof real.mergeGeometries>) =>
      merge.fail ? null : real.mergeGeometries(...args),
  };
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const CENTRE = { cx: 0, cz: 0 };

/** hex_barrel.glb's shape as GLTFLoader builds it: one eight-staved keg on the kit's textured material. */
function kegModel(): THREE.Group {
  const atlas = new THREE.DataTexture(new Uint8Array([120, 70, 50, 255]), 1, 1);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.needsUpdate = true;
  const material = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0, map: atlas });
  material.name = 'hexagons_medieval';
  const scene = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.2117, 8), material);
  mesh.name = 'barrel';
  mesh.position.y = 0.2117 / 2;
  scene.add(mesh);
  return scene;
}

function barrel(over: Partial<Barrel> = {}): Barrel {
  return { id: 1, x: 10, y: 2, z: 20, litTick: -1, blowTick: -1, ...over };
}

function field(barrels: readonly Barrel[], centre = CENTRE): TurretBarrelField {
  return { barrels, ...centre };
}

async function built(gate = vi.fn((_t: THREE.Object3D) => Promise.resolve())) {
  const parent = new THREE.Group();
  const source = vi.fn(async () => kegModel());
  const visual = new TurretBarrelVisual(() => 2, gate, source);
  visual.prepare(parent);
  await flush();
  return { visual, parent, source, gate };
}

function slotRoots(visual: TurretBarrelVisual): THREE.Group[] {
  const kegs = visual.group.getObjectByName(`${TURRET_BARREL_NAME}:kegs`);
  return (kegs?.children ?? []) as THREE.Group[];
}

function markOf(root: THREE.Object3D): THREE.Mesh {
  const mark = root.children.find((c) => c.name === `${TURRET_BARREL_MATERIAL_PREFIX}mark`);
  if (!mark) throw new Error('no mark');
  return mark as THREE.Mesh;
}

function kegMeshOf(root: THREE.Object3D): THREE.Mesh {
  let found: THREE.Mesh | null = null;
  root.traverse((node) => {
    if (!found && (node as THREE.Mesh).isMesh && node.name === 'barrel') found = node as THREE.Mesh;
  });
  if (!found) throw new Error('no keg');
  return found;
}

function rings(visual: TurretBarrelVisual): THREE.Mesh[] {
  return visual.rings.children as THREE.Mesh[];
}

function shardMesh(visual: TurretBarrelVisual): THREE.InstancedMesh {
  const mesh = visual.group.getObjectByName(`${TURRET_BARREL_MATERIAL_PREFIX}shards`);
  if (!mesh) throw new Error('no shards');
  return mesh as THREE.InstancedMesh;
}

describe('the barrel visual', () => {
  it('builds at the commitment: rings at once, shards and kegs each behind the gate', async () => {
    const gate = vi.fn((_t: THREE.Object3D) => new Promise<void>(() => {}));
    const spans: string[] = [];
    setBuildSpanSink((kind) => spans.push(kind));
    const { visual, parent, source } = await built(gate);
    setBuildSpanSink(null);
    expect(source).toHaveBeenCalledTimes(1);
    expect(spans.filter((kind) => kind === 'zone:turret-barrels')).toHaveLength(1);
    expect(visual.rings.parent).toBe(parent);
    expect(visual.group.parent).toBe(parent);
    expect(rings(visual)).toHaveLength(TURRET_EXPLOSIVE_BARREL.cap);
    const gated = gate.mock.calls.map(([target]) => target.name);
    expect(gated).toEqual([`${TURRET_BARREL_NAME}:shards`, `${TURRET_BARREL_NAME}:kegs`]);
    for (const [target] of gate.mock.calls) expect(target.visible).toBe(false);
    expect(slotRoots(visual)).toHaveLength(TURRET_EXPLOSIVE_BARREL.cap);
    visual.prepare(parent);
    expect(source).toHaveBeenCalledTimes(1);
    visual.dispose();
  });

  it('paints the mark once per page in the texel slot, the kegs waiting behind their rings', async () => {
    resetTurretKegMarkTexelsForTest();
    const spans: string[] = [];
    setBuildSpanSink((kind) => spans.push(kind));
    let open: () => void = () => {};
    const slot = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          open = resolve;
        }),
    );
    const gate = vi.fn((_t: THREE.Object3D) => Promise.resolve());
    const visual = new TurretBarrelVisual(
      () => 0,
      gate,
      async () => kegModel(),
      false,
      slot,
    );
    visual.prepare(new THREE.Group());
    await flush();
    expect(slot).toHaveBeenCalledTimes(1);
    expect(visual.modelReady).toBe(false);
    expect(spans).not.toContain('zone:turret-keg-mark');
    visual.update(field([barrel()]), false, 0, 0);
    expect(rings(visual).filter((r) => r.visible)).toHaveLength(1);
    open();
    await flush();
    expect(spans.filter((kind) => kind === 'zone:turret-keg-mark')).toHaveLength(1);
    expect(visual.modelReady).toBe(true);
    // A second seat reuses the page's texels: no slot waited on, nothing painted again.
    const again = new TurretBarrelVisual(
      () => 0,
      gate,
      async () => kegModel(),
      false,
      slot,
    );
    again.prepare(new THREE.Group());
    await flush();
    setBuildSpanSink(null);
    expect(slot).toHaveBeenCalledTimes(1);
    expect(again.modelReady).toBe(true);
    expect(spans.filter((kind) => kind === 'zone:turret-keg-mark')).toHaveLength(1);
    visual.dispose();
    again.dispose();
  });

  it('draws its warning rings on the programs the world-quest-trace prewarm stages', async () => {
    const { visual } = await built();
    visual.update(
      field([barrel(), barrel({ id: 2, x: -5, litTick: 10, blowTick: 15 })]),
      false,
      12,
      5,
    );
    const staged = drawsUnder(buildWorldQuestTraceStandIn());
    const signatures = new Set(staged.map((d) => drawProgramSignature(d.object, d.material)));
    const keys = new Set(staged.flatMap((d) => threeProgramKeys(d.material, d.object).split('\n')));
    const draws = drawsUnder(visual.rings);
    expect(draws).toHaveLength(TURRET_EXPLOSIVE_BARREL.cap);
    for (const draw of draws) {
      expect(signatures.has(drawProgramSignature(draw.object, draw.material))).toBe(true);
      for (const key of threeProgramKeys(draw.material, draw.object).split('\n')) {
        expect(keys.has(key)).toBe(true);
      }
    }
    visual.dispose();
  });

  it('stands a keg sized to the sim on a gold ring where the barrel is, popping up when new', async () => {
    const { visual } = await built();
    const b = barrel();
    visual.update(field([b]), false, 100, 5);
    const [ring] = rings(visual).filter((r) => r.visible);
    expect(ring.material).toBe(worldQuestTraceMaterials().gold);
    expect(ring.position.toArray()).toEqual([10, 2 + TURRET_BARREL_LOOK.ringLift, 20]);
    expect(ring.renderOrder).toBe(floorVfxRenderOrder('encounter'));
    const root = slotRoots(visual).find((r) => r.visible) ?? null;
    // First seen this very frame: its pop has not begun.
    expect(root).toBeNull();
    visual.update(field([b]), false, 101, 5 + TURRET_BARREL_LOOK.popSeconds / 2);
    const keg = slotRoots(visual).find((r) => r.visible);
    expect(keg).toBeDefined();
    expect(keg?.scale.x).toBeGreaterThan(0.5);
    visual.update(field([b]), false, 102, 5 + TURRET_BARREL_LOOK.popSeconds);
    expect(keg?.scale.x).toBe(1);
    expect(keg?.position.toArray()).toEqual([10, 2, 20]);
    // The model's height is the sim's barrel height, its foot on the barrel's ground.
    const model = keg?.children[0] as THREE.Object3D;
    keg?.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model, true);
    expect(box.max.y - box.min.y).toBeCloseTo(TURRET_EXPLOSIVE_BARREL.height, 6);
    expect(box.min.y).toBeCloseTo(2, 6);
    expect(Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2).toBeLessThanOrEqual(
      TURRET_EXPLOSIVE_BARREL.radius * Math.SQRT2,
    );
    visual.dispose();
  });

  it('turns the ring red and rattles and swells the keg through the fuse; a lost session holds it still', async () => {
    const { visual } = await built();
    const b = barrel({ litTick: 100, blowTick: 105 });
    visual.update(field([barrel()]), false, 90, 0);
    visual.update(field([b]), false, 104.5, 1);
    const [ring] = rings(visual).filter((r) => r.visible);
    expect(ring.material).toBe(worldQuestTraceMaterials().red);
    const keg = slotRoots(visual).find((r) => r.visible) as THREE.Group;
    expect(keg.scale.x).toBeGreaterThan(1.05);
    const moved = Math.hypot(keg.position.x - 10, keg.position.z - 20) + Math.abs(keg.rotation.x);
    expect(moved).toBeGreaterThan(0);
    // The mark and the wick ride the keg's own pose: they rattle and swell with it.
    expect(markOf(keg).parent).toBe(keg);
    visual.update(field([b]), true, 104.5, 1.1);
    expect(ring.material).toBe(worldQuestTraceMaterials().gold);
    expect(keg.scale.x).toBe(1);
    expect(keg.position.toArray()).toEqual([10, 2, 20]);
    visual.dispose();
  });

  it('turns every keg so its painted facet faces the tower, the wick on its lid', async () => {
    const { visual } = await built();
    const centre = { cx: 5, cz: -3 };
    const spots = [
      barrel({ id: 1, x: 25, z: -3 }),
      barrel({ id: 2, x: -12, z: 9 }),
      barrel({ id: 3, x: 5, z: -30 }),
      barrel({ id: 4, x: 19, z: 11 }),
    ];
    visual.update(field(spots, centre), false, 0, 0);
    visual.update(field(spots, centre), false, 1, 1);
    const normal = new THREE.Vector3();
    const toward = new THREE.Vector3();
    const top = new THREE.Vector3();
    const tip = { x: 0, y: 0, z: 0 };
    const corner = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    for (const b of spots) {
      const root = slotRoots(visual).find((r) => r.visible && r.position.x === b.x) as THREE.Group;
      root.updateMatrixWorld(true);
      const mark = markOf(root);
      // The bomb's first triangle lies on the facet's plane, facing out of it.
      const positions = mark.geometry.getAttribute('position');
      const index = mark.geometry.getIndex() as THREE.BufferAttribute;
      for (let k = 0; k < 3; k++) {
        corner[k].fromBufferAttribute(positions, index.getX(k)).applyMatrix4(mark.matrixWorld);
      }
      normal.subVectors(corner[1], corner[0]).cross(corner[2].clone().sub(corner[0])).normalize();
      toward.set(centre.cx - b.x, 0, centre.cz - b.z).normalize();
      expect(normal.dot(toward)).toBeGreaterThan(0.9999);
      // The wick's highest point is its tip, where a lit fuse burns.
      let best = Number.NEGATIVE_INFINITY;
      for (let i = 0; i < positions.count; i++) {
        const p = new THREE.Vector3()
          .fromBufferAttribute(positions, i)
          .applyMatrix4(mark.matrixWorld);
        if (p.y > best) {
          best = p.y;
          top.copy(p);
        }
      }
      turretKegWickTipInto(tip, b.x, b.y, b.z, turretKegYaw(b.x, b.z, centre.cx, centre.cz));
      expect(Math.hypot(top.x - tip.x, top.z - tip.z)).toBeLessThan(
        TURRET_KEG_MARK_FRAME.width / 4,
      );
      expect(top.y).toBeGreaterThan(b.y + TURRET_EXPLOSIVE_BARREL.height + 0.15);
    }
    visual.dispose();
  });

  it('paints one shared bomb mark and wick in every slot: an opaque mesh cut to the bomb on the facet, off it, between the bands', async () => {
    const { visual } = await built();
    const roots = slotRoots(visual);
    const marks = roots.map(markOf);
    expect(marks).toHaveLength(TURRET_EXPLOSIVE_BARREL.cap);
    const [first] = marks;
    const material = first.material as THREE.MeshStandardMaterial;
    expect(material.name).toBe(`${TURRET_BARREL_MATERIAL_PREFIX}mark`);
    for (const mark of marks) {
      expect(mark.geometry).toBe(first.geometry);
      expect(mark.material).toBe(material);
      expect(mark.castShadow).toBe(false);
      expect(mark.receiveShadow).toBe(true);
    }
    // No alpha test, no blending: the mark's outline is the mesh's own.
    expect(material.transparent).toBe(false);
    expect(material.alphaTest).toBe(0);
    // The keg's own surface under the paint: its colour and roughness, so the bare wood matches.
    const keg = kegMeshOf(roots[0]).material as THREE.MeshStandardMaterial;
    expect(material.color.getHex()).toBe(keg.color.getHex());
    expect(material.roughness).toBe(keg.roughness);
    expect(material.metalness).toBe(keg.metalness);
    const layout = turretKegMarkLayout(TURRET_KEG_MARK.texels);
    const map = material.map as THREE.DataTexture;
    expect(map.isDataTexture).toBe(true);
    expect(map.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(map.image.width).toBe(layout.width);
    expect(map.image.height).toBe(layout.height);
    expect(map.image.data).toEqual(turretKegMarkTexels(TURRET_KEG_MARK.texels));
    // The bomb: on a plane just off the painted facet, inside its corners, between the bands.
    const f = TURRET_KEG_MARK_FRAME;
    const h = TURRET_EXPLOSIVE_BARREL.height;
    const position = first.geometry.getAttribute('position');
    const normals = first.geometry.getAttribute('normal');
    const uv = first.geometry.getAttribute('uv');
    const n = { x: 0, z: 0 };
    let bomb = 0;
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const y = position.getY(i);
      const z = position.getZ(i);
      if (uv.getY(i) < layout.markBottom) continue;
      bomb++;
      expect(x * f.normalX + z * f.normalZ).toBeCloseTo(
        TURRET_KEG_SHAPE.facetApothem * h + TURRET_KEG_MARK.lift,
        5,
      );
      const side = (x * f.sideX + z * f.sideZ) / (f.width / 2);
      expect(Math.abs(side)).toBeLessThan(1);
      expect(y).toBeGreaterThan(TURRET_KEG_SHAPE.bareLow * h);
      expect(y).toBeLessThan(TURRET_KEG_SHAPE.bareHigh * h);
      // Its texture maps flat across the facet; its normals are the facet's own, blended between its corners.
      expect(uv.getX(i)).toBeCloseTo((side + 1) / 2, 5);
      const up = (y - f.centreY) / (f.width / 2) / TURRET_KEG_BARE_ASPECT;
      expect(uv.getY(i)).toBeCloseTo(
        layout.markBottom + ((1 - layout.markBottom) * (up + 1)) / 2,
        5,
      );
      turretKegFacetNormalInto(n, side);
      expect(normals.getX(i)).toBeCloseTo(n.x, 5);
      expect(normals.getY(i)).toBe(0);
      expect(normals.getZ(i)).toBeCloseTo(n.z, 5);
    }
    // One vertex per corner of the bomb's triangles, then the wick's cord above the lid.
    expect(bomb).toBe(turretKegBombTriangles().length / 2);
    expect(position.count - bomb).toBeGreaterThan(20);
    visual.dispose();
  });

  it.each([
    ['standard', true],
    ['lambert', false],
  ])(
    "draws the mark and the wick on the keg's own %s program and casts no shadow: nothing new to link",
    async (_family, standardMaterials) => {
      const restoreGfx = gfxInternalsForTest.overrideSettings({ standardMaterials });
      try {
        const { visual } = await built();
        const [root] = slotRoots(visual);
        const mark = markOf(root);
        const keg = kegMeshOf(root);
        expect((keg.material as THREE.Material).type).toBe(
          standardMaterials ? 'MeshStandardMaterial' : 'MeshLambertMaterial',
        );
        expect(threeProgramKeys(mark.material as THREE.Material, mark)).toBe(
          threeProgramKeys(keg.material as THREE.Material, keg),
        );
        visual.dispose();
      } finally {
        restoreGfx();
      }
    },
  );

  it("uploads the mark's texture behind the kegs' compile gate, never before the commitment", async () => {
    const visual = new TurretBarrelVisual(
      () => 0,
      () => Promise.resolve(),
      async () => kegModel(),
    );
    expect(visual.group.children).toHaveLength(0);
    const gate = vi.fn((_t: THREE.Object3D) => new Promise<void>(() => {}));
    const { visual: seated } = await built(gate);
    const kegs = gate.mock.calls[1][0];
    const cold = collectNonResidentTextures({ get: () => undefined }, kegs);
    const map = (markOf(slotRoots(seated)[0]).material as THREE.MeshStandardMaterial).map;
    expect(cold).toContain(map);
    visual.dispose();
    seated.dispose();
  });

  it('keeps each barrel on its slot and frees the slot of one gone', async () => {
    const { visual } = await built();
    const a = barrel({ id: 1 });
    const b = barrel({ id: 2, x: 30 });
    visual.update(field([a, b]), false, 0, 0);
    visual.update(field([a, b]), false, 1, 1);
    const kegOf = (x: number) => slotRoots(visual).find((r) => r.visible && r.position.x === x);
    const second = kegOf(30);
    visual.update(field([b]), false, 2, 2);
    expect(kegOf(30)).toBe(second);
    expect(kegOf(10)).toBeUndefined();
    expect(rings(visual).filter((r) => r.visible)).toHaveLength(1);
    visual.update(field([]), false, 3, 3);
    expect(rings(visual).filter((r) => r.visible)).toHaveLength(0);
    visual.dispose();
  });

  it('lights a fuse at the wick tip on one pooled burst and blows its fire column across two', async () => {
    const { visual } = await built();
    const bursts = new CannonPuffBursts(4, TURRET_CONTACT_PUFFS);
    const lit: TurretEvent = { type: 'barrelLit', id: 3, x: 10, y: 2, z: 20, fuseTicks: 5 };
    const centre = { cx: -4, cz: 6 };
    visual.light(lit as Extract<TurretEvent, { type: 'barrelLit' }>, centre, bursts.take(7), 7);
    const fuse = bursts.slots[0];
    expect(fuse.count).toBe(TURRET_FUSE_FIXED_PUFFS + turretBarrelCounts(false).fuseSparks);
    const tip = turretKegWickTipInto({ x: 0, y: 0, z: 0 }, 10, 2, 20, turretKegYaw(10, 20, -4, 6));
    expect(Math.hypot(tip.x - 10, tip.z - 20)).toBeGreaterThan(0.05);
    expect(fuse.puffs[0].kind).toBe(PUFF.glow);
    expect(fuse.puffs[0].x).toBeCloseTo(tip.x, 12);
    expect(fuse.puffs[0].z).toBeCloseTo(tip.z, 12);
    expect(fuse.puffs[0].y).toBeGreaterThanOrEqual(tip.y);
    expect(tip.y).toBeGreaterThan(2 + TURRET_EXPLOSIVE_BARREL.height);
    expect(fuse.life).toBeGreaterThanOrEqual(0.25);
    expect(fuse.at).toBe(7);
    const take = vi.fn((now: number) => bursts.take(now));
    const blast = {
      type: 'barrelExploded',
      id: 3,
      x: 10,
      y: 2,
      z: 20,
      hits: [],
    } as Extract<TurretEvent, { type: 'barrelExploded' }>;
    visual.explode(blast, take, 7.1);
    expect(take).toHaveBeenCalledTimes(2);
    const fire = bursts.slots.filter((s) => s !== fuse && s.active);
    expect(fire.reduce((n, s) => n + s.count, 0)).toBe(TURRET_BARREL_FIRE_PUFFS);
    for (const s of fire) expect(s.life).toBeGreaterThan(0.5);
    visual.dispose();
  });

  it('keeps a whole chain on its bursts: every fuse and fire column alive at once, none stolen', async () => {
    const { visual } = await built();
    const bursts = new CannonPuffBursts(TURRET_BARREL_BURSTS, TURRET_CONTACT_PUFFS);
    const take = (now: number) => {
      const free = bursts.slots.some((s) => !s.active || (s.life > 0 && now - s.at >= s.life));
      expect(free).toBe(true);
      return bursts.take(now);
    };
    const fuse = TURRET_EXPLOSIVE_BARREL.fuseTicks * DT;
    const lit = (id: number) =>
      ({ type: 'barrelLit', id, x: 10 * id, y: 0, z: 0, fuseTicks: 5 }) as Extract<
        TurretEvent,
        { type: 'barrelLit' }
      >;
    const blown = (id: number) =>
      ({ type: 'barrelExploded', id, x: 10 * id, y: 0, z: 0, hits: [] }) as Extract<
        TurretEvent,
        { type: 'barrelExploded' }
      >;
    // A ripple through the cap: each blast lights the next as it blows.
    visual.light(lit(1), CENTRE, take(0), 0);
    for (let id = 1; id <= TURRET_EXPLOSIVE_BARREL.cap; id++) {
      const now = id * fuse;
      visual.explode(blown(id), take, now);
      if (id < TURRET_EXPLOSIVE_BARREL.cap) visual.light(lit(id + 1), CENTRE, take(now), now);
    }
    const alive = bursts.slots.filter((s) => s.active && s.count > 0);
    expect(alive.length).toBeGreaterThan(12);
    visual.dispose();
  });

  it("throws the keg's shards and lets them fall and fade within their life", async () => {
    const { visual } = await built();
    const blast = {
      type: 'barrelExploded',
      id: 3,
      x: 10,
      y: 2,
      z: 20,
      hits: [],
    } as Extract<TurretEvent, { type: 'barrelExploded' }>;
    visual.update(field([]), false, 0, 1);
    expect(shardMesh(visual).visible).toBe(false);
    visual.explode(blast, () => null, 1);
    visual.update(field([]), false, 0, 1.3);
    const mesh = shardMesh(visual);
    expect(mesh.visible).toBe(true);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    let above = 0;
    for (let i = 0; i < TURRET_BARREL_SHARDS.perBlast; i++) {
      mesh.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      if (p.y > 2.5) above++;
    }
    expect(above).toBeGreaterThan(TURRET_BARREL_SHARDS.perBlast / 2);
    visual.update(field([]), false, 0, 1 + TURRET_BARREL_SHARDS.life + 0.01);
    expect(mesh.visible).toBe(false);
    expect(mesh.count).toBe(0);
    visual.dispose();
  });

  it('colours the shards as wood and iron bands, no paint left', async () => {
    const { visual } = await built();
    for (let id = 1; id <= TURRET_BARREL_SHARDS.pool; id++) {
      visual.explode({ type: 'barrelExploded', id, x: 0, y: 0, z: 0, hits: [] }, () => null, 1);
    }
    const mesh = shardMesh(visual);
    const c = new THREE.Color();
    let bands = 0;
    let wood = 0;
    for (let i = 0; i < TURRET_BARREL_SHARDS.pool * TURRET_BARREL_SHARDS.perBlast; i++) {
      mesh.getColorAt(i, c);
      if (c.b > c.r) {
        // An iron band: a cool grey.
        bands++;
        expect(c.b - c.r).toBeLessThan(0.2);
        continue;
      }
      wood++;
      // A brown: red over green over blue, never a painted red.
      expect(c.r).toBeGreaterThan(c.g);
      expect(c.g).toBeGreaterThan(c.b);
      expect(c.r / c.g).toBeLessThan(5);
    }
    expect(bands).toBeGreaterThan(0);
    expect(wood).toBeGreaterThan(bands * 2);
    visual.dispose();
  });

  it('draws its blast through the cannon visuals wider and hotter than a shell, on no shell id', () => {
    const blast = turretBarrelBlast({
      type: 'barrelExploded',
      id: 3,
      x: 10,
      y: 2,
      z: 20,
      hits: [{ id: 1, falloff: 1, damage: 120, x: 10, y: 2, z: 21 }],
    });
    expect(blast).toMatchObject({
      shotId: -3,
      x: 10,
      y: 2,
      z: 20,
      radius: TURRET_EXPLOSIVE_BARREL.blastRadius,
      scale: TURRET_BARREL_LOOK.blastScale,
    });
    expect(blast.scale).toBeGreaterThan(1);
    expect(blast.hits).toHaveLength(1);
  });

  it('owns its named materials, disposing them and never the loader cache', async () => {
    const source = kegModel();
    const kit = (source.children[0] as THREE.Mesh).material as THREE.Material;
    const kitDispose = vi.spyOn(kit, 'dispose');
    const visual = new TurretBarrelVisual(
      () => 0,
      () => Promise.resolve(),
      async () => source,
    );
    visual.prepare(new THREE.Group());
    await flush();
    const kitMap = (kit as THREE.MeshStandardMaterial).map as THREE.Texture;
    const kitMapDispose = vi.spyOn(kitMap, 'dispose');
    const mats = new Set<THREE.Material>();
    visual.group.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (mesh.isMesh) mats.add(mesh.material as THREE.Material);
    });
    expect([...mats].every((m) => m.name.startsWith(TURRET_BARREL_MATERIAL_PREFIX))).toBe(true);
    expect([...mats].map((m) => m.name).sort()).toEqual([
      `${TURRET_BARREL_MATERIAL_PREFIX}hexagons_medieval`,
      `${TURRET_BARREL_MATERIAL_PREFIX}mark`,
      `${TURRET_BARREL_MATERIAL_PREFIX}shard`,
    ]);
    expect(mats.has(kit)).toBe(false);
    const spies = [...mats].map((m) => vi.spyOn(m, 'dispose'));
    visual.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalled();
    expect(kitDispose).not.toHaveBeenCalled();
    expect(kitMapDispose).not.toHaveBeenCalled();
    expect(visual.group.parent).toBeNull();
  });

  it('builds and attaches nothing when disposed while the model is still on its way', async () => {
    let arrive: (scene: THREE.Object3D) => void = () => {};
    const source = vi.fn(
      () =>
        new Promise<THREE.Object3D>((resolve) => {
          arrive = resolve;
        }),
    );
    const gate = vi.fn((_t: THREE.Object3D) => Promise.resolve());
    const visual = new TurretBarrelVisual(() => 0, gate, source);
    visual.prepare(new THREE.Group());
    await flush();
    visual.dispose();
    arrive(kegModel());
    await flush();
    expect(visual.modelReady).toBe(false);
    for (const root of slotRoots(visual)) expect(root.children).toHaveLength(0);
    expect(gate.mock.calls.map(([target]) => target.name)).toEqual([
      `${TURRET_BARREL_NAME}:shards`,
    ]);
  });

  it('never reveals the kegs when disposed while their compile gate is pending', async () => {
    const pending: (() => void)[] = [];
    const gate = vi.fn(
      (_t: THREE.Object3D) =>
        new Promise<void>((resolve) => {
          pending.push(resolve);
        }),
    );
    const { visual } = await built(gate);
    const kegs = visual.group.getObjectByName(`${TURRET_BARREL_NAME}:kegs`) as THREE.Group;
    expect(kegs.visible).toBe(false);
    visual.dispose();
    for (const resolve of pending) resolve();
    await flush();
    expect(kegs.visible).toBe(false);
    expect(shardMesh(visual).parent?.visible).toBe(false);
  });

  it('lights, blows and draws nothing once disposed, and disposes once', async () => {
    const { visual } = await built();
    visual.update(field([barrel()]), false, 0, 0);
    const ring = rings(visual)[0];
    const shards = shardMesh(visual);
    const mark = markOf(slotRoots(visual)[0]);
    const markMaterial = mark.material as THREE.MeshStandardMaterial;
    const owned = [
      ring.geometry,
      shards.geometry,
      shards.material as THREE.Material,
      mark.geometry,
      markMaterial,
      markMaterial.map as THREE.Texture,
    ];
    const spies = owned.map((o) => vi.spyOn(o, 'dispose'));
    const kegMats = new Set<THREE.Material>();
    visual.group.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (mesh.isMesh && mesh !== shards && mesh.material !== markMaterial) {
        kegMats.add(mesh.material as THREE.Material);
      }
    });
    expect(kegMats.size).toBe(1);
    const kegSpies = [...kegMats].map((m) => vi.spyOn(m, 'dispose'));
    const traceDispose = vi.spyOn(worldQuestTraceMaterials().gold, 'dispose');
    visual.dispose();
    visual.dispose();
    for (const spy of [...spies, ...kegSpies]) expect(spy).toHaveBeenCalledTimes(1);
    expect(traceDispose).not.toHaveBeenCalled();
    const bursts = new CannonPuffBursts(4, TURRET_CONTACT_PUFFS);
    const burst = bursts.take(1);
    const lit = { type: 'barrelLit', id: 3, x: 0, y: 0, z: 0, fuseTicks: 5 } as const;
    visual.light(lit, CENTRE, burst, 1);
    expect(burst?.count).toBe(0);
    const take = vi.fn((now: number) => bursts.take(now));
    visual.explode({ type: 'barrelExploded', id: 3, x: 0, y: 0, z: 0, hits: [] }, take, 1);
    expect(take).not.toHaveBeenCalled();
    expect(() => visual.update(field([barrel({ id: 9, x: 44 })]), false, 1, 1)).not.toThrow();
    expect(ring.visible).toBe(true);
    expect(ring.position.x).toBe(10);
  });

  it('keeps its rings when the mark cannot be built, painting and attaching nothing for the kegs', async () => {
    resetTurretKegMarkTexelsForTest();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const spans: string[] = [];
    setBuildSpanSink((kind) => spans.push(kind));
    merge.fail = true;
    try {
      const { visual, gate } = await built();
      expect(errors).toHaveBeenCalledWith('Fire and Fly kegs could not be built, rings only');
      expect(visual.prepared).toBe(true);
      expect(visual.modelReady).toBe(false);
      expect(spans).not.toContain('zone:turret-keg-mark');
      expect(gate.mock.calls.map(([target]) => target.name)).toEqual([
        `${TURRET_BARREL_NAME}:shards`,
      ]);
      visual.update(field([barrel()]), false, 0, 0);
      expect(rings(visual).filter((r) => r.visible)).toHaveLength(1);
      visual.dispose();
    } finally {
      merge.fail = false;
      setBuildSpanSink(null);
      errors.mockRestore();
    }
  });

  it('keeps its rings when the model fails to load, and tries the load again', async () => {
    const source = vi.fn(() => Promise.reject(new Error('streaming')));
    const onUnavailable = vi.fn();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const visual = new TurretBarrelVisual(() => 0, undefined, source);
    const parent = new THREE.Group();
    visual.prepare(parent, onUnavailable);
    await flush();
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(visual.prepared).toBe(false);
    visual.update(field([barrel()]), false, 0, 0);
    expect(rings(visual).filter((r) => r.visible)).toHaveLength(1);
    visual.prepare(parent, onUnavailable);
    expect(source).toHaveBeenCalledTimes(2);
    expect(rings(visual)).toHaveLength(TURRET_EXPLOSIVE_BARREL.cap);
    errors.mockRestore();
    visual.dispose();
  });
});
