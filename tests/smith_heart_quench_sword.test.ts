// The Smith's four blades on the Frozen Lake drawn with the Quench's painted rebuild's
// sword (quench_env_kit.ts Env_IceSword, design doc section 5.24): the fight's painter
// (smith_heart_fx/quench_blades_fx.ts) stands it in the old piece's frame, so the fight's
// motion is the same; the sword carries its own point, so the old tip never draws; its
// fuller strips take each blade's own glow (lit on its own as its line aims), on a copy
// the painter owns; the lake's heaved plates round its foot are the painted collar. The
// painter never fetches the painted kit (it is built with the renderer, at boot): it waits
// for the load the raid's interior starts, and swaps the sword in through its compile gate
// when it lands, the old kit's piece never taking its place after. The two kits are
// stubbed; the fight reads a fake world.

import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

const kits = vi.hoisted(() => ({
  painted: false,
  old: false,
  sword: null as Map<string, unknown> | null,
  collar: null as Map<string, unknown> | null,
  landed: [] as (() => void)[],
  oldLands: null as null | (() => void),
  fetchedPainted: 0,
}));

vi.mock('../src/render/smith_heart/quench_env_kit', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/render/smith_heart/quench_env_kit')>();
  const three = await import('three');
  const mats = new Map<string, unknown>();
  return {
    ...real,
    quenchEnvKitReady: () => kits.painted,
    ensureQuenchEnvKit: () => {
      kits.fetchedPainted++;
      return Promise.resolve();
    },
    onQuenchEnvKitLanded: (cb: () => void) => {
      if (kits.painted) {
        cb();
        return () => undefined;
      }
      kits.landed.push(cb);
      return () => {
        kits.landed = kits.landed.filter((x) => x !== cb);
      };
    },
    quenchEnvPieceParts: (piece: string) =>
      !kits.painted
        ? null
        : piece === 'Env_IceSword'
          ? kits.sword
          : piece === 'Env_IceCollar'
            ? kits.collar
            : null,
    quenchEnvMaterial: (painting: string) => {
      const have = mats.get(painting);
      if (have) return have;
      const m = new three.MeshStandardMaterial({ name: painting });
      mats.set(painting, m);
      return m;
    },
  };
});

vi.mock('../src/render/smith_heart/heart_kit', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/render/smith_heart/heart_kit')>();
  const three = await import('three');
  const QUENCH = real.SMITH_HEART_QUENCH_KIT_URL;
  return {
    ...real,
    heartKitLoaded: (url: string) => (url === QUENCH ? kits.old : real.heartKitLoaded(url)),
    ensureHeartKit: (url: string) =>
      url === QUENCH
        ? new Promise<void>((resolve) => {
            kits.oldLands = resolve;
          })
        : real.ensureHeartKit(url),
    heartKitMeshes: (url: string, piece: string) => {
      if (url !== QUENCH || piece !== 'Kit_SunkBlade' || !kits.old) return null;
      // The old kit's sunk blade, in its own frame (a blade and a plate of its collar).
      const g = new three.BufferGeometry();
      g.setAttribute(
        'position',
        new three.BufferAttribute(new Float32Array([0, 1, 0, 0.5, 1, 0, 0, 6, 0]), 3),
      );
      g.setAttribute('color', new three.BufferAttribute(new Float32Array(9).fill(0.5), 3));
      const group = new three.Group();
      const m = new three.Mesh(g, new three.MeshStandardMaterial());
      m.name = 'Kit_SunkBlade:ice';
      group.add(m);
      return group;
    },
  };
});

const { QuenchBladesFx } = await import('../src/render/smith_heart_fx/quench_blades_fx');
const { BLADE_HOMES } = await import('../src/render/smith_heart_fx/quench_fight_fx_core');
const { DUNGEONS, instanceOrigin } = await import('../src/sim/data');
const { bladeTemplate, QUENCH_GUARDIAN } = await import(
  '../src/sim/encounters/smith_heart/quench_ids'
);

function strip(y0: number, y1: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array([0, y0, 0, 0.2, y0, 0, 0, y1, 0]), 3),
  );
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(9).fill(1), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(6), 2));
  g.userData.sharedRendererResource = true;
  return g;
}

/** A compile gate whose links the test settles by hand, in any order. */
function manualGate() {
  const pending: { target: THREE.Object3D; settle: () => void }[] = [];
  const gate = (target: THREE.Object3D) =>
    new Promise<unknown>((resolve) => pending.push({ target, settle: () => resolve(undefined) }));
  return { gate, pending };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the fight blades in the painted sword', () => {
  const o = instanceOrigin(DUNGEONS.smith_heart.index, 0);
  function rig(opts: { painted?: boolean; gate?: (t: THREE.Object3D) => Promise<unknown> } = {}) {
    kits.painted = opts.painted ?? true;
    kits.old = false;
    kits.landed = [];
    kits.oldLands = null;
    kits.fetchedPainted = 0;
    kits.sword = new Map([
      ['ice_sword', strip(-3.2, 12.6)],
      ['glow', strip(-1.8, 6.5)],
    ]);
    kits.collar = new Map([['lake', strip(0, 0.4)]]);
    const entity = (id: number, kind: string, templateId: string, x: number, z: number) =>
      ({
        id,
        kind,
        templateId,
        name: templateId,
        pos: { x, y: 0, z },
        prevPos: { x, y: 0, z },
        facing: 0.4,
        scale: 1,
        hp: 100,
        maxHp: 100,
        dead: false,
        auras: [],
        castingAbility: null,
        castTargetId: null,
        castRemaining: 0,
        castTotal: 0,
      }) as never;
    const entities = new Map<number, never>();
    const me = entity(1, 'player', 'warrior', o.x + 198, o.z - 2);
    entities.set(1, me);
    entities.set(2, entity(2, 'mob', QUENCH_GUARDIAN, o.x + 198, o.z - 2));
    const blades = BLADE_HOMES.map((h, i) => {
      const b = entity(10 + i, 'object', bladeTemplate('sunk'), o.x + h.x, o.z + h.z);
      entities.set(10 + i, b);
      return b as { templateId: string };
    });
    const world = { entities, entityRosterVersion: 1, player: me, playerId: 1 } as never;
    const scene = new THREE.Scene();
    const fx = new QuenchBladesFx(scene, () => -30, world, opts.gate);
    return { scene, fx, blades };
  }
  const frameOf = (scene: THREE.Scene, i: number) =>
    (scene.getObjectByName(`quenchBlade:${i}`) as THREE.Object3D).children[0];

  it('stands the painted sword in each blade frame, its strips on that blade own glow', () => {
    const { scene, fx } = rig();
    const glows = new Set<THREE.Material>();
    BLADE_HOMES.forEach((_, i) => {
      const sword = scene.getObjectByName(`smithHeartQuenchSword:${i}`) as THREE.Group;
      expect(sword, `blade ${i}`).toBeTruthy();
      const byName = new Map(sword.children.map((c) => [c.name, c as THREE.Mesh]));
      expect([...byName.keys()].sort()).toEqual(['Env_IceSword:glow', 'Env_IceSword:ice_sword']);
      // The ice on the kit's shared geometry; the strips on a copy carrying the glow's shade.
      expect(byName.get('Env_IceSword:ice_sword')?.geometry).toBe(kits.sword?.get('ice_sword'));
      const glow = byName.get('Env_IceSword:glow') as THREE.Mesh;
      expect(glow.geometry).not.toBe(kits.sword?.get('glow'));
      expect(glow.geometry.getAttribute('color')).toBeTruthy();
      expect(glow.geometry.userData.sharedRendererResource).toBeUndefined();
      glows.add(glow.material as THREE.Material);
      // No stand-in: the sword is there from the first frame.
      let standIn = false;
      sword.parent?.traverse((x) => {
        if (x.name === 'smithHeartQuenchBladeStandIn') standIn = true;
      });
      expect(standIn).toBe(false);
    });
    // One glow per blade, each blade on its own (a blade whose line aims blazes alone).
    expect(glows.size).toBe(BLADE_HOMES.length);
    BLADE_HOMES.forEach((_, i) => {
      const sword = scene.getObjectByName(`smithHeartQuenchSword:${i}`) as THREE.Group;
      const glow = sword.children.find((c) => c.name === 'Env_IceSword:glow') as THREE.Mesh;
      expect((glow.material as THREE.Material).name).toBe(`smithHeartQuenchBladeGlow:${i}`);
    });
    // Disposed, the fight frees its own copy of the strips and never the kit's geometry.
    const freed: string[] = [];
    const watch = (g: unknown, name: string) =>
      (g as THREE.BufferGeometry).addEventListener('dispose', () => freed.push(name));
    watch(kits.sword?.get('ice_sword'), 'kit ice');
    watch(kits.sword?.get('glow'), 'kit glow');
    watch(kits.collar?.get('lake'), 'kit collar');
    const sword0 = scene.getObjectByName('smithHeartQuenchSword:0') as THREE.Group;
    const ownGlow = (sword0.children.find((c) => c.name === 'Env_IceSword:glow') as THREE.Mesh)
      .geometry;
    watch(ownGlow, 'own glow');
    fx.dispose();
    expect(freed).toEqual(['own glow']);
  });

  it('never draws the old tip: the painted sword carries its own point', () => {
    const { scene, fx, blades } = rig();
    for (const b of blades) b.templateId = bladeTemplate('float');
    for (let i = 0; i < 90; i++) fx.update(1 / 60);
    let tips = 0;
    let shown = 0;
    scene.traverse((x) => {
      if (x.name !== 'smithHeartQuenchBladeTip') return;
      tips++;
      if (x.visible) shown++;
    });
    expect(tips).toBe(BLADE_HOMES.length);
    expect(shown).toBe(0);
    // Risen: the frame has lifted the sword's own point clear of the ice.
    expect(frameOf(scene, 0).position.y).toBeGreaterThan(3.2);
    fx.dispose();
  });

  it('lays the painted collar of heaved plates at each home', () => {
    const { scene, fx } = rig();
    for (let i = 0; i < 10; i++) fx.update(1 / 60);
    BLADE_HOMES.forEach((h, i) => {
      const collar = scene.getObjectByName(`smithHeartQuenchBladeCollar:${i}`) as THREE.Group;
      expect(collar).toBeTruthy();
      expect(collar.children.map((c) => c.name)).toEqual(['Env_IceCollar:lake']);
      expect(collar.visible).toBe(true);
      expect(collar.position.x).toBeCloseTo(o.x + h.x, 6);
      expect(collar.position.z).toBeCloseTo(o.z + h.z, 6);
    });
    fx.dispose();
  });

  it('never fetches the painted kit: built with the renderer, it waits for the raid door', () => {
    const { fx } = rig({ painted: false });
    expect(kits.fetchedPainted).toBe(0);
    expect(kits.landed.length).toBe(1);
    fx.dispose();
    // Disposed before the kit landed: it stops waiting.
    expect(kits.landed.length).toBe(0);
  });

  it('swaps the painted sword in through its gate when the kit lands late', async () => {
    const { gate, pending } = manualGate();
    const { scene, fx } = rig({ painted: false, gate });
    // The stand-in draws meanwhile.
    expect(scene.getObjectByName('smithHeartQuenchBladeStandIn')).toBeTruthy();
    for (let i = 0; i < 10; i++) fx.update(1 / 60);
    const shownBefore = (scene.getObjectByName('smithHeartQuenchBladeCollar:0') as THREE.Object3D)
      ?.visible;
    kits.painted = true;
    for (const cb of kits.landed) cb();
    // Staged hidden behind the gate: nothing swapped until its programs link.
    const staged = pending.find((p) => p.target.name === 'smithHeartQuenchBladeStaging');
    expect(staged).toBeTruthy();
    expect(staged?.target.visible).toBe(false);
    expect(scene.getObjectByName('smithHeartQuenchSword:0')?.parent?.name).toBe(
      'smithHeartQuenchBladeStaging',
    );
    staged?.settle();
    await settle();
    BLADE_HOMES.forEach((_, i) => {
      const sword = scene.getObjectByName(`smithHeartQuenchSword:${i}`) as THREE.Object3D;
      expect(sword.parent).toBe(frameOf(scene, i));
    });
    expect(scene.getObjectByName('smithHeartQuenchBladeStandIn')).toBeUndefined();
    expect(scene.getObjectByName('smithHeartQuenchBladeStaging')).toBeUndefined();
    // The collar's visibility carried over; the tip never draws again.
    const collar = scene.getObjectByName('smithHeartQuenchBladeCollar:0') as THREE.Object3D;
    expect(collar.children.map((c) => c.name)).toEqual(['Env_IceCollar:lake']);
    if (shownBefore !== undefined) expect(collar.visible).toBe(shownBefore);
    fx.dispose();
  });

  it('drops the old kit swap when it settles after the painted sword is in', async () => {
    const { gate, pending } = manualGate();
    const { scene, fx } = rig({ painted: false, gate });
    // The old kit lands first, its swap staged behind the gate.
    kits.old = true;
    kits.oldLands?.();
    await settle();
    expect(pending.filter((p) => p.target.name === 'smithHeartQuenchBladeStaging').length).toBe(1);
    // Then the painted kit, its swap staged too.
    kits.painted = true;
    for (const cb of kits.landed) cb();
    const staged = pending.filter((p) => p.target.name === 'smithHeartQuenchBladeStaging');
    expect(staged.length).toBe(2);
    // The painted swap settles first, the old one after: the painted sword stays.
    staged[1].settle();
    await settle();
    staged[0].settle();
    await settle();
    BLADE_HOMES.forEach((_, i) => {
      const frame = frameOf(scene, i);
      expect(frame.children.some((c) => c.name === `smithHeartQuenchSword:${i}`)).toBe(true);
      expect(
        frame.children.some((c) => c.children.some((m) => m.name === 'Kit_SunkBlade:ice')),
      ).toBe(false);
    });
    fx.dispose();
  });
});
