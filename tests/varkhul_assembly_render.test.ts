import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  buildVarkhulAssemblyPrewarmVisual,
  buildVarkhulRuneControlArrowGeometry,
  buildVarkhulRuneSymbol,
  VarkhulAssemblyVisuals,
} from '../src/render/varkhul_assembly_visual';
import { VarkhulForgestormVisuals } from '../src/render/varkhul_forgestorm_visual';
import type { ActiveVarkhulAssembly } from '../src/sim/varkhul_assembly';
import {
  VARKHUL_ASSEMBLY_RUNE_CONTROL_OFFSET,
  VARKHUL_ASSEMBLY_RUNE_CONTROL_RADIUS,
  varkhulAssemblyAdjacentRuneSymbols,
  varkhulAssemblyRuneSlots,
  varkhulAssemblyRuneStation,
} from '../src/sim/varkhul_assembly';

const SLOTS = varkhulAssemblyRuneSlots('normal', 0);
const RUNES = Array.from({ length: 10 }, (_, symbol) => {
  const station = varkhulAssemblyRuneStation({ x: 0, z: 0 }, SLOTS[symbol]);
  return {
    symbol,
    ...station,
    radius: VARKHUL_ASSEMBLY_RUNE_CONTROL_RADIUS,
    assignedPlayerId: symbol < 5 ? symbol + 100 : null,
    orphaned: false,
    locked: symbol === 1,
    targetAngle: 0.4 + symbol * 0.1,
    glyphAngle: 0.7 + symbol * 0.1,
    control: symbol === 0 ? ('counterclockwise' as const) : ('off' as const),
    controlProgress: symbol === 0 ? 0.5 : 0,
    alignmentProgress: symbol === 1 ? 1 : 0,
    aligned: symbol === 1,
  };
});

const ASSEMBLY: ActiveVarkhulAssembly = {
  bossId: 42,
  difficulty: 'heroic',
  phase: 'links',
  forgeX: 0,
  forgeZ: 22,
  forgeHp: 60,
  forgeMaxHp: 100,
  forgeOverheat: 0,
  forgeBeamActiveMask: 0,
  forgeBeamWarmupRemaining: 0,
  forgeMeltdownRemaining: 0,
  addWave: 0,
  addWaves: 0,
  addsRemaining: 0,
  forgeBeams: [],
  interceptBeam: null,
  cores: [{ id: 'core', x: 1, z: 2, carrierId: null, delivered: false }],
  deliveryWindowRemaining: 0,
  assignments: RUNES.filter((rune) => rune.assignedPlayerId !== null).map((rune) => ({
    playerId: rune.assignedPlayerId ?? 0,
    symbol: rune.symbol,
    locked: rune.locked,
  })),
  runes: RUNES,
  round: 0,
  rounds: 2,
  remaining: 18,
};

const LOCAL_VIEWER = {
  playerId: 100,
  x: 0,
  z: 0,
  assignedSymbol: 0,
} as const;

function visibleMeshCount(root: THREE.Object3D): number {
  let visible = 0;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    let current: THREE.Object3D | null = object;
    while (current) {
      if (!current.visible) return;
      current = current.parent;
    }
    visible++;
  });
  return visible;
}

describe('Varkhul Assembly rune rendering', () => {
  it('authors ten geometry-distinct symbols instead of relying on color', () => {
    const signatures = Array.from({ length: 10 }, (_, symbol) => {
      const mesh = buildVarkhulRuneSymbol(symbol);
      const positions = mesh.geometry.getAttribute('position');
      const signature = Array.from({ length: positions.count }, (_, index) =>
        Math.hypot(positions.getX(index), positions.getY(index)).toFixed(3),
      )
        .sort()
        .join('|');
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      return signature;
    });
    expect(new Set(signatures).size).toBe(10);
  });

  it('draws genuinely opposite arrows without baking either control into a static ring', () => {
    const left = buildVarkhulRuneControlArrowGeometry('counterclockwise');
    const right = buildVarkhulRuneControlArrowGeometry('clockwise');
    left.computeBoundingBox();
    right.computeBoundingBox();
    if (!left.boundingBox || !right.boundingBox)
      throw new Error('Rune arrow geometry has no bounds');
    expect(Math.abs(left.boundingBox.min.x)).toBeGreaterThan(left.boundingBox.max.x);
    expect(right.boundingBox.max.x).toBeGreaterThan(Math.abs(right.boundingBox.min.x));
    expect((left.boundingBox.min.z + left.boundingBox.max.z) / 2).toBeCloseTo(0, 5);
    expect((right.boundingBox.min.z + right.boundingBox.max.z) / 2).toBeCloseTo(0, 5);
    left.dispose();
    right.dispose();
  });

  it('builds ten stations without the old central hub and collapses locks into floor seals', () => {
    const scene = new THREE.Scene();
    const visuals = new VarkhulAssemblyVisuals(scene, () => 0);
    visuals.sync([ASSEMBLY]);
    const root = scene.getObjectByName('varkhul-assembly-42') as THREE.Group;
    expect(root).toBeDefined();
    expect(root.getObjectByName('varkhul-rune-hub')).toBeUndefined();
    expect(root.children.filter((child) => /^varkhul-rune-\d+$/.test(child.name))).toHaveLength(10);
    expect(new Set(RUNES.map((data) => `${data.x.toFixed(4)}:${data.z.toFixed(4)}`)).size).toBe(10);

    for (let symbol = 0; symbol < 10; symbol++) {
      const data = RUNES[symbol];
      const rune = root.getObjectByName(`varkhul-rune-${symbol}`) as THREE.Group;
      expect(rune.position.x).toBeCloseTo(data.x, 5);
      expect(rune.position.z).toBeCloseTo(data.z, 5);
      expect(rune.userData.controlRadius).toBe(VARKHUL_ASSEMBLY_RUNE_CONTROL_RADIUS);
      expect(rune.userData.controlOffset).toBe(VARKHUL_ASSEMBLY_RUNE_CONTROL_OFFSET);
      expect(rune.getObjectByName('varkhul-rune-station-track')).toBeDefined();
      const inner = rune.getObjectByName('varkhul-rune-control-counterclockwise') as THREE.Mesh;
      const outer = rune.getObjectByName('varkhul-rune-control-clockwise') as THREE.Mesh;
      expect(Math.hypot(inner.position.x, inner.position.z)).toBeCloseTo(
        data.trackRadius - VARKHUL_ASSEMBLY_RUNE_CONTROL_OFFSET,
        5,
      );
      expect(Math.hypot(outer.position.x, outer.position.z)).toBeCloseTo(
        data.trackRadius + VARKHUL_ASSEMBLY_RUNE_CONTROL_OFFSET,
        5,
      );
      expect(rune.getObjectByName('varkhul-rune-target-socket')).toBeDefined();
      expect(rune.getObjectByName('varkhul-rune-moving-glyph')).toBeDefined();
      expect(rune.getObjectByName('varkhul-rune-owner-crest')).toBeDefined();
      expect(rune.getObjectByName('varkhul-rune-thread')).toBeDefined();
      expect(rune.getObjectByName('varkhul-rune-stabilizer')).toBeDefined();
    }

    const locked = root.getObjectByName('varkhul-rune-1') as THREE.Group;
    expect(locked.getObjectByName('varkhul-rune-lock-burst')?.visible).toBe(true);
    const lockEffect = locked.getObjectByName('varkhul-rune-lock-effect') as THREE.Mesh;
    lockEffect.geometry.computeBoundingBox();
    expect(
      (lockEffect.geometry.boundingBox?.max.y ?? 0) - (lockEffect.geometry.boundingBox?.min.y ?? 0),
    ).toBeLessThan(1.2);
    expect(visibleMeshCount(root)).toBeLessThanOrEqual(95);
    visuals.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('focuses the local rune, hides the waiting five, and removes navigation on arrival', () => {
    const scene = new THREE.Scene();
    const visuals = new VarkhulAssemblyVisuals(scene, () => 0);
    visuals.sync([ASSEMBLY], LOCAL_VIEWER);
    const focused = scene.getObjectByName('varkhul-rune-0') as THREE.Group;
    const active = scene.getObjectByName('varkhul-rune-2') as THREE.Group;
    const waiting = scene.getObjectByName('varkhul-rune-7') as THREE.Group;
    const focusedTrack = focused.getObjectByName('varkhul-rune-station-track') as THREE.Mesh;
    const activeCrest = active.getObjectByName('varkhul-rune-owner-crest') as THREE.Mesh;
    const runeRoots = scene.children
      .flatMap((child) => child.children)
      .filter((child) => /^varkhul-rune-\d+$/.test(child.name));
    expect(
      runeRoots
        .filter((rune) => rune.visible)
        .map((rune) => rune.userData.symbol)
        .sort((first, second) => first - second),
    ).toEqual([0, 1, 2, 3, 4]);
    expect(Math.hypot(activeCrest.position.x, activeCrest.position.z)).toBeCloseTo(0, 5);
    expect(focused.userData.visualMode).toBe('focused');
    expect(active.userData.visualMode).toBe('teammate');
    expect(waiting.visible).toBe(false);
    expect(focused.getObjectByName('varkhul-rune-focus-halo')?.visible).toBe(true);
    expect(focused.getObjectByName('varkhul-rune-guide-beam')?.visible).toBe(true);
    const guide = scene.getObjectByName('varkhul-rune-player-guide') as THREE.Mesh;
    expect(guide.visible).toBe(true);
    expect(guide.position.x).toBe(LOCAL_VIEWER.x);
    expect(guide.position.z).toBe(LOCAL_VIEWER.z);
    expect(guide.rotation.y).toBeCloseTo(
      Math.atan2(RUNES[0].x - LOCAL_VIEWER.x, RUNES[0].z - LOCAL_VIEWER.z),
      5,
    );
    expect((focusedTrack.material as THREE.MeshBasicMaterial).opacity).toBeGreaterThan(
      (
        (active.getObjectByName('varkhul-rune-station-track') as THREE.Mesh)
          .material as THREE.MeshBasicMaterial
      ).opacity,
    );
    for (const symbol of [2, 3, 4]) {
      const teammate = scene.getObjectByName(`varkhul-rune-${symbol}`) as THREE.Group;
      const teammateTrack = teammate.getObjectByName('varkhul-rune-station-track') as THREE.Mesh;
      expect(teammate.userData.visualMode).toBe('teammate');
      expect((teammateTrack.material as THREE.MeshBasicMaterial).opacity).toBeGreaterThan(0);
    }
    expect(focused.getObjectByName('varkhul-rune-embers')?.visible).toBe(true);
    expect(active.getObjectByName('varkhul-rune-embers')?.visible).toBe(false);

    const spectatorRunes = RUNES.map((rune) => ({
      ...rune,
      locked: false,
      aligned: false,
      alignmentProgress: 0,
    }));
    visuals.sync(
      [
        {
          ...ASSEMBLY,
          assignments: spectatorRunes
            .filter((rune) => rune.assignedPlayerId !== null)
            .map((rune) => ({
              playerId: rune.assignedPlayerId ?? 0,
              symbol: rune.symbol,
              locked: false,
            })),
          runes: spectatorRunes,
        },
      ],
      {
        playerId: 999,
        x: 0,
        z: 0,
        assignedSymbol: null,
      },
    );
    const spectatorRoots = runeRoots.filter((rune) => rune.visible);
    expect(spectatorRoots).toHaveLength(5);
    for (const rune of spectatorRoots) {
      const stationTrack = rune.getObjectByName('varkhul-rune-station-track') as THREE.Mesh;
      expect(rune.userData.visualMode).toBe('spectator');
      expect((stationTrack.material as THREE.MeshBasicMaterial).opacity).toBeGreaterThan(0);
    }

    visuals.sync([ASSEMBLY], LOCAL_VIEWER);

    visuals.sync([ASSEMBLY], {
      ...LOCAL_VIEWER,
      x: RUNES[0].x,
      z: RUNES[0].z,
    });
    expect(focused.getObjectByName('varkhul-rune-guide-beam')?.visible).toBe(false);
    expect(scene.getObjectByName('varkhul-rune-player-guide')?.visible).toBe(false);
    visuals.dispose();
  });

  it('marks a shuffled Heroic orphan and the two adjacent free-group owners', () => {
    const scene = new THREE.Scene();
    const visuals = new VarkhulAssemblyVisuals(scene, () => 0);
    const slots = varkhulAssemblyRuneSlots('heroic', 3);
    const adjacentSymbols = varkhulAssemblyAdjacentRuneSymbols(0, slots);
    const shuffledRunes = RUNES.map((rune) => ({
      ...rune,
      ...varkhulAssemblyRuneStation({ x: 0, z: 0 }, slots[rune.symbol]),
      assignedPlayerId:
        rune.symbol < 5 || adjacentSymbols.includes(rune.symbol) ? rune.symbol + 100 : null,
      orphaned: rune.symbol === 0,
      locked: adjacentSymbols.includes(rune.symbol),
    }));
    const rescuerSymbol = adjacentSymbols[0];
    visuals.sync([{ ...ASSEMBLY, round: 1, runes: shuffledRunes }], {
      playerId: rescuerSymbol + 100,
      x: 0,
      z: 0,
      assignedSymbol: rescuerSymbol,
    });
    const orphan = scene.getObjectByName('varkhul-rune-0') as THREE.Group;
    const orphanCrest = orphan.getObjectByName('varkhul-rune-owner-crest') as THREE.Mesh;
    expect(orphan.userData.orphaned).toBe(true);
    expect(orphan.userData.visualMode).toBe('focused');
    expect((orphanCrest.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0xff3526);
    const rescueBeam = orphan.getObjectByName('varkhul-rune-guide-beam') as THREE.Group;
    expect(rescueBeam.visible).toBe(true);
    const rescueBeamEffect = rescueBeam.getObjectByName(
      'varkhul-rune-guide-beam-effect',
    ) as THREE.Mesh;
    expect((rescueBeamEffect.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0x78efff);
    const rescueGuide = scene.getObjectByName('varkhul-rune-player-guide') as THREE.Mesh;
    expect(rescueGuide.visible).toBe(true);
    expect((rescueGuide.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0x78efff);
    expect(rescueGuide.position.x).toBe(0);
    expect(rescueGuide.position.z).toBe(0);
    expect(rescueGuide.rotation.y).toBeCloseTo(Math.atan2(orphan.position.x, orphan.position.z), 5);
    const rescuers = Array.from(
      { length: 10 },
      (_, symbol) => scene.getObjectByName(`varkhul-rune-${symbol}`) as THREE.Group,
    ).filter((rune) => rune.userData.rescueEligible === true);
    expect(rescuers.map((rune) => rune.userData.symbol).sort((a, b) => a - b)).toEqual(
      [...adjacentSymbols].sort((a, b) => a - b),
    );
    for (const rescuer of rescuers) {
      const crest = rescuer.getObjectByName('varkhul-rune-owner-crest') as THREE.Mesh;
      expect((crest.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0x78efff);
      expect((crest.material as THREE.MeshBasicMaterial).opacity).toBe(1);
    }
    visuals.update(0.1, false);
    const animatedScale = orphanCrest.scale.x;
    visuals.update(0.4, false);
    expect(orphanCrest.scale.x).not.toBeCloseTo(animatedScale, 5);
    visuals.update(0.1, true);
    expect(orphanCrest.scale.x).toBeCloseTo(1.12, 5);
    visuals.dispose();
  });

  it('dims a Normal orphan without exposing either moving control', () => {
    const scene = new THREE.Scene();
    const visuals = new VarkhulAssemblyVisuals(scene, () => 0);
    const normalRunes = RUNES.map((rune) =>
      rune.symbol === 0 ? { ...rune, orphaned: true } : rune,
    );
    visuals.sync([{ ...ASSEMBLY, difficulty: 'normal', runes: normalRunes }]);
    const orphan = scene.getObjectByName('varkhul-rune-0') as THREE.Group;
    const crest = orphan.getObjectByName('varkhul-rune-owner-crest') as THREE.Mesh;
    expect(orphan.userData.orphaned).toBe(false);
    expect((crest.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0x6d4038);
    expect((crest.material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(0.42, 5);
    expect(orphan.getObjectByName('varkhul-rune-rotor')?.visible).toBe(false);
    expect(orphan.getObjectByName('varkhul-rune-control-counterclockwise')?.visible).toBe(false);
    expect(orphan.getObjectByName('varkhul-rune-control-clockwise')?.visible).toBe(false);
    visuals.dispose();
  });

  it('holds the draw budget when wave two shows five completed locks and five active tracks', () => {
    const scene = new THREE.Scene();
    const visuals = new VarkhulAssemblyVisuals(scene, () => 0);
    const secondWave = RUNES.map((rune) => ({
      ...rune,
      assignedPlayerId: rune.symbol + 100,
      locked: rune.symbol < 5,
    }));
    visuals.sync(
      [
        {
          ...ASSEMBLY,
          round: 1,
          assignments: secondWave.map((rune) => ({
            playerId: rune.assignedPlayerId ?? 0,
            symbol: rune.symbol,
            locked: rune.locked,
          })),
          runes: secondWave,
        },
      ],
      { playerId: 105, x: 0, z: 0, assignedSymbol: 5 },
    );
    const root = scene.getObjectByName('varkhul-assembly-42') as THREE.Group;
    expect(visibleMeshCount(root)).toBeLessThanOrEqual(95);
    expect(root.getObjectByName('varkhul-rune-5')?.userData.visualMode).toBe('focused');
    expect(
      root.getObjectByName('varkhul-rune-5')?.getObjectByName('varkhul-rune-focus-halo')?.visible,
    ).toBe(true);
    expect(
      Array.from({ length: 5 }, (_, symbol) =>
        root.getObjectByName(`varkhul-rune-${symbol}`)?.getObjectByName('varkhul-rune-lock-burst'),
      ).every((lock) => lock?.visible),
    ).toBe(true);
    visuals.dispose();
  });

  it('hides controls immediately and collapses a new lock into a floor seal over 0.35 seconds', () => {
    const scene = new THREE.Scene();
    const visuals = new VarkhulAssemblyVisuals(scene, () => 0);
    visuals.sync([ASSEMBLY], LOCAL_VIEWER);
    const completed = {
      ...ASSEMBLY,
      runes: RUNES.map((rune) => (rune.symbol === 0 ? { ...rune, locked: true } : rune)),
    };
    visuals.sync([completed], LOCAL_VIEWER);
    const rune = scene.getObjectByName('varkhul-rune-0') as THREE.Group;
    const track = rune.getObjectByName('varkhul-rune-station-track') as THREE.Mesh;
    const seal = rune.getObjectByName('varkhul-rune-lock-burst') as THREE.Group;
    expect(rune.getObjectByName('varkhul-rune-control-counterclockwise')?.visible).toBe(false);
    expect(rune.getObjectByName('varkhul-rune-control-clockwise')?.visible).toBe(false);
    expect(seal.visible).toBe(true);

    visuals.update(0.34, false);
    expect(track.visible).toBe(true);
    visuals.update(0.01, false);
    expect(track.visible).toBe(false);
    expect(rune.getObjectByName('varkhul-rune-owner-crest')?.visible).toBe(false);

    visuals.dispose();
    const reducedScene = new THREE.Scene();
    const reducedVisuals = new VarkhulAssemblyVisuals(reducedScene, () => 0);
    reducedVisuals.sync([completed], LOCAL_VIEWER);
    reducedVisuals.update(0.01, true);
    expect(
      reducedScene.getObjectByName('varkhul-rune-0')?.getObjectByName('varkhul-rune-station-track')
        ?.visible,
    ).toBe(false);
    reducedVisuals.dispose();
  });

  it('places the socket, glyph, controls, and thread on authoritative orbital positions', () => {
    const scene = new THREE.Scene();
    const visuals = new VarkhulAssemblyVisuals(scene, () => 0);
    visuals.sync([ASSEMBLY], LOCAL_VIEWER);
    const rune = scene.getObjectByName('varkhul-rune-0') as THREE.Group;
    const target = rune.getObjectByName('varkhul-rune-target') as THREE.Group;
    const rotor = rune.getObjectByName('varkhul-rune-rotor') as THREE.Group;
    const inner = rune.getObjectByName('varkhul-rune-control-counterclockwise') as THREE.Mesh;
    const outer = rune.getObjectByName('varkhul-rune-control-clockwise') as THREE.Mesh;
    const thread = rune.getObjectByName('varkhul-rune-thread') as THREE.Mesh;
    expect(Math.hypot(target.position.x, target.position.z)).toBeCloseTo(RUNES[0].trackRadius, 5);
    expect(Math.atan2(target.position.x, target.position.z)).toBeCloseTo(RUNES[0].targetAngle, 5);
    expect(Math.hypot(rotor.position.x, rotor.position.z)).toBeCloseTo(RUNES[0].trackRadius, 5);
    expect(Math.atan2(rotor.position.x, rotor.position.z)).toBeCloseTo(RUNES[0].glyphAngle, 5);
    expect(Math.hypot(inner.position.x, inner.position.z)).toBeLessThan(RUNES[0].trackRadius);
    expect(Math.hypot(outer.position.x, outer.position.z)).toBeGreaterThan(RUNES[0].trackRadius);
    expect(Math.atan2(inner.position.x, inner.position.z)).toBeCloseTo(RUNES[0].glyphAngle, 5);
    expect(Math.atan2(outer.position.x, outer.position.z)).toBeCloseTo(RUNES[0].glyphAngle, 5);
    expect(Math.hypot(thread.position.x, thread.position.z)).toBeCloseTo(
      RUNES[0].trackRadius / 2,
      5,
    );
    expect((inner.material as THREE.MeshBasicMaterial).opacity).toBeGreaterThan(0.5);
    expect((inner.material as THREE.MeshBasicMaterial).color.getHex()).not.toBe(0xffffff);
    const movedGlyphAngle = RUNES[0].glyphAngle + 0.6;
    visuals.sync([
      {
        ...ASSEMBLY,
        runes: RUNES.map((candidate) =>
          candidate.symbol === 0 ? { ...candidate, glyphAngle: movedGlyphAngle } : candidate,
        ),
      },
    ]);
    expect(Math.atan2(inner.position.x, inner.position.z)).toBeCloseTo(movedGlyphAngle, 5);
    expect(Math.atan2(outer.position.x, outer.position.z)).toBeCloseTo(movedGlyphAngle, 5);
    visuals.sync([
      {
        ...ASSEMBLY,
        runes: RUNES.map((candidate) =>
          candidate.symbol === 0 ? { ...candidate, controlProgress: 1 } : candidate,
        ),
      },
    ]);
    expect((inner.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0xffffff);
    visuals.update(0.1, false);
    expect((rune.getObjectByName('varkhul-rune-embers') as THREE.Object3D).rotation.y).not.toBe(0);
    visuals.update(0.1, true);
    expect(target.scale.x).toBe(1);
    expect(thread.visible).toBe(true);
    visuals.dispose();
  });

  it('prewarms all symbols, station tracks, moving controls, threads, and lock effects', () => {
    const root = buildVarkhulAssemblyPrewarmVisual();
    expect(root.getObjectByName('varkhul-rune-hub')).toBeUndefined();
    expect(root.getObjectByName('varkhul-rune-player-guide')).toBeDefined();
    expect(root.children.filter((child) => /^varkhul-rune-\d+$/.test(child.name))).toHaveLength(10);
    for (let symbol = 0; symbol < 10; symbol++) {
      const rune = root.getObjectByName(`varkhul-rune-${symbol}`);
      expect(rune?.getObjectByName('varkhul-rune-station-track')).toBeDefined();
      expect(rune?.getObjectByName('varkhul-rune-control-counterclockwise')).toBeDefined();
      expect(rune?.getObjectByName('varkhul-rune-control-clockwise')).toBeDefined();
      expect(rune?.getObjectByName('varkhul-rune-thread')).toBeDefined();
      expect(rune?.getObjectByName('varkhul-rune-focus-halo')).toBeDefined();
      expect(rune?.getObjectByName('varkhul-rune-guide-beam')).toBeDefined();
      expect(rune?.getObjectByName('varkhul-rune-lock-burst')?.visible).toBe(true);
    }
  });

  it('runs through the production Forgestorm owner: stations, controls, focus, and guide arrow', () => {
    // The Links renderer is owned by VarkhulForgestormVisuals, the painter the
    // real renderer constructs: this drives that owner end to end so the
    // assembly clock can never be orphaned from the frame path again.
    const scene = new THREE.Scene();
    const owner = new VarkhulForgestormVisuals(scene, () => 0);
    const world = {
      activeVarkhulForgestormWarnings: [],
      activeVarkhulCinderFires: [],
      activeVarkhulCinderOrbProjectiles: [],
      activeVarkhulAssemblies: [ASSEMBLY],
      // The viewer focus derives from player id + pos and the assembly's own
      // assignment roster; no assignedSymbol is fed from outside.
      player: {
        id: LOCAL_VIEWER.playerId,
        pos: { x: LOCAL_VIEWER.x, z: LOCAL_VIEWER.z },
        auras: [],
      },
      entities: new Map<number, { auras: { id: string; remaining: number; duration: number }[] }>(),
    };
    owner.syncWorld(world);
    const root = scene.getObjectByName('varkhul-assembly-42') as THREE.Group;
    expect(root).toBeDefined();
    const focused = root.getObjectByName('varkhul-rune-0') as THREE.Group;
    expect(focused.visible).toBe(true);
    expect(focused.userData.visualMode).toBe('focused');
    expect(focused.getObjectByName('varkhul-rune-station-track')).toBeDefined();
    expect(focused.getObjectByName('varkhul-rune-control-counterclockwise')?.visible).toBe(true);
    expect(focused.getObjectByName('varkhul-rune-control-clockwise')?.visible).toBe(true);
    expect(focused.getObjectByName('varkhul-rune-focus-halo')?.visible).toBe(true);
    expect(root.getObjectByName('varkhul-rune-player-guide')?.visible).toBe(true);
    expect(root.getObjectByName('varkhul-molten-core')).toBeDefined();

    // The owner's frame tick reaches the assembly animation.
    const track = focused.getObjectByName('varkhul-rune-station-track') as THREE.Mesh;
    const restingOpacity = (track.material as THREE.MeshBasicMaterial).opacity;
    owner.update(0.1, false);
    expect((track.material as THREE.MeshBasicMaterial).opacity).not.toBeCloseTo(restingOpacity, 5);

    owner.dispose();
    expect(scene.getObjectByName('varkhul-assembly-42')).toBeUndefined();
    expect(scene.getObjectByName('varkhul-rune-player-guide')).toBeUndefined();
  });

  it('hides the complete rune clock outside links without hiding core transport', () => {
    const scene = new THREE.Scene();
    const visuals = new VarkhulAssemblyVisuals(scene, () => 0);
    visuals.sync([{ ...ASSEMBLY, phase: 'cores' }]);
    const root = scene.getObjectByName('varkhul-assembly-42') as THREE.Group;
    expect(root.getObjectByName('varkhul-rune-player-guide')?.visible).toBe(false);
    expect(root.getObjectByName('varkhul-rune-0')?.visible).toBe(false);
    expect(root.getObjectByName('varkhul-molten-core')).toBeDefined();
    visuals.dispose();
  });
});
