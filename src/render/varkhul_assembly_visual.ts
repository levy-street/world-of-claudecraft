// Master's Assembly rune clock. Ten separate stations surround the room in
// two alternating player waves. Every actionable control follows its glyph.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  type ActiveVarkhulAssembly,
  VARKHUL_ASSEMBLY_RUNE_CONTROL_OFFSET,
  VARKHUL_ASSEMBLY_RUNE_CONTROL_RADIUS,
  VARKHUL_ASSEMBLY_RUNE_COUNT,
  VARKHUL_ASSEMBLY_RUNE_TRACK_RADIUS,
} from '../sim/varkhul_assembly';
import {
  type VarkhulAssemblyFocusPlan,
  type VarkhulAssemblyRuneVisualMode,
  type VarkhulAssemblyViewerFocus,
  varkhulAssemblyFocusPlanInto,
} from './varkhul_assembly_focus_core';

const SYMBOL_COLORS = [
  0x47d7ff, 0xff4ecb, 0xffd23f, 0x68ff72, 0xb578ff, 0xff812d, 0x4b79ff, 0xff4d50, 0xa8ff3d,
  0xf4f1ff,
] as const;
const GROUND_LIFT = 0.08;

interface AssemblyVisual {
  root: THREE.Group;
  forge: THREE.Group;
  forgeSegments: THREE.Mesh[];
  barrierMaterial: THREE.MeshBasicMaterial;
  guideArrow: THREE.Mesh;
  cores: Map<string, THREE.Group>;
  activeCores: Set<string>;
  runes: RuneVisual[];
  focusPlan: VarkhulAssemblyFocusPlan;
  phase: number;
}

interface RuneVisual {
  root: THREE.Group;
  stationTrack: THREE.Mesh;
  target: THREE.Group;
  rotor: THREE.Group;
  ownerCrest: THREE.Mesh;
  inner: THREE.Mesh;
  outer: THREE.Mesh;
  socket: THREE.Mesh;
  stabilizer: THREE.Mesh;
  embers: THREE.InstancedMesh;
  thread: THREE.Mesh;
  lock: THREE.Group;
  focusHalo: THREE.Mesh;
  guideBeam: THREE.Group;
  lockProgress: number;
  wasLocked: boolean;
}

function additive(color: number, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

function floorGeometry(geometry: THREE.BufferGeometry, y = 0): THREE.BufferGeometry {
  return geometry.rotateX(-Math.PI / 2).translate(0, y, 0);
}

function polygon(points: readonly [number, number][]): THREE.Shape {
  const shape = new THREE.Shape();
  points.forEach(([x, y], index) => {
    if (index === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  });
  shape.closePath();
  return shape;
}

function regularPolygon(points: number, radius: number, rotation = -Math.PI / 2): THREE.Shape {
  return polygon(
    Array.from({ length: points }, (_, index) => {
      const angle = rotation + (index / points) * Math.PI * 2;
      return [Math.cos(angle) * radius, Math.sin(angle) * radius] as [number, number];
    }),
  );
}

function symbolShape(symbol: number, radius = 1): THREE.Shape {
  switch (Math.max(0, Math.floor(symbol)) % VARKHUL_ASSEMBLY_RUNE_COUNT) {
    case 0: {
      const shape = new THREE.Shape();
      shape.absarc(0, 0, radius, 0, Math.PI * 2, false);
      return shape;
    }
    case 1:
      return regularPolygon(3, radius);
    case 2:
      return regularPolygon(5, radius);
    case 3:
      return regularPolygon(4, radius);
    case 4:
      return polygon(
        Array.from({ length: 10 }, (_, index) => {
          const angle = -Math.PI / 2 + (index / 10) * Math.PI * 2;
          const pointRadius = index % 2 === 0 ? radius : radius * 0.42;
          return [Math.cos(angle) * pointRadius, Math.sin(angle) * pointRadius] as [number, number];
        }),
      );
    case 5:
      return regularPolygon(6, radius);
    case 6:
      return polygon([
        [-radius, radius * 0.72],
        [0, -radius],
        [radius, radius * 0.72],
        [radius * 0.42, radius],
        [0, -radius * 0.18],
        [-radius * 0.42, radius],
      ]);
    case 7:
      return polygon([
        [-radius * 0.28, -radius],
        [radius * 0.28, -radius],
        [radius * 0.28, -radius * 0.28],
        [radius, -radius * 0.28],
        [radius, radius * 0.28],
        [radius * 0.28, radius * 0.28],
        [radius * 0.28, radius],
        [-radius * 0.28, radius],
        [-radius * 0.28, radius * 0.28],
        [-radius, radius * 0.28],
        [-radius, -radius * 0.28],
        [-radius * 0.28, -radius * 0.28],
      ]);
    case 8:
      return polygon([
        [-radius, -radius],
        [radius, -radius],
        [radius * 0.28, 0],
        [radius, radius],
        [-radius, radius],
        [-radius * 0.28, 0],
      ]);
    default:
      return polygon([
        [-radius * 0.2, -radius],
        [radius * 0.72, -radius * 0.18],
        [radius * 0.16, -radius * 0.08],
        [radius * 0.38, radius],
        [-radius * 0.76, radius * 0.02],
        [-radius * 0.12, -radius * 0.08],
      ]);
  }
}

export function buildVarkhulRuneSymbol(symbol: number, radius = 1): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.ShapeGeometry(symbolShape(symbol, radius)),
    additive(SYMBOL_COLORS[symbol % SYMBOL_COLORS.length], 0.94),
  );
  mesh.userData.symbol = symbol;
  return mesh;
}

function mergeFloorGeometries(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const nonIndexed = geometries.map((geometry) =>
    geometry.index === null ? geometry : geometry.toNonIndexed(),
  );
  const merged = mergeGeometries(nonIndexed, false);
  if (!merged) throw new Error('Varkhul rune floor geometry could not be merged');
  return merged;
}

export function buildVarkhulRuneControlArrowGeometry(
  control: 'counterclockwise' | 'clockwise',
): THREE.BufferGeometry {
  const direction = control === 'counterclockwise' ? -1 : 1;
  const arrow = polygon(
    [
      [-0.46, -0.13],
      [0.08, -0.13],
      [0.08, -0.34],
      [0.5, 0],
      [0.08, 0.34],
      [0.08, 0.13],
      [-0.46, 0.13],
    ].map(([x, y]) => [x * direction, y] as [number, number]),
  );
  return floorGeometry(new THREE.ShapeGeometry(arrow).scale(0.88, 0.88, 0.88), 0.055);
}

function buildForge(): {
  group: THREE.Group;
  segments: THREE.Mesh[];
  barrier: THREE.MeshBasicMaterial;
} {
  const group = new THREE.Group();
  group.name = 'varkhul-assembly-forge';
  const barrier = additive(0xff6b13, 0.54);
  const ring = new THREE.Mesh(floorGeometry(new THREE.RingGeometry(3.15, 3.55, 64), 0.12), barrier);
  ring.name = 'varkhul-assembly-forge-boundary';
  group.add(ring);

  const segments: THREE.Mesh[] = [];
  for (let index = 0; index < 10; index++) {
    const segment = new THREE.Mesh(
      new THREE.BoxGeometry(0.52, 0.22, 0.1),
      additive(0xffb21f, 0.96),
    );
    segment.name = `varkhul-assembly-forge-health-${index}`;
    segment.position.set(-2.34 + index * 0.52, 5.6, 0);
    group.add(segment);
    const cross = segment.clone();
    cross.rotation.y = Math.PI / 2;
    cross.name = `varkhul-assembly-forge-health-cross-${index}`;
    group.add(cross);
    segments.push(segment, cross);
  }
  return { group, segments, barrier };
}

function buildCore(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'varkhul-molten-core';
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.64, 1), additive(0xfff0a0, 1));
  const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(0.92, 1), additive(0xff3a06, 0.62));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.08, 0.08, 8, 28), additive(0xffb52d, 0.84));
  ring.rotation.x = Math.PI / 2;
  group.add(core, shell, ring);
  return group;
}

function buildPlayerGuideArrow(): THREE.Mesh {
  const shape = polygon([
    [-0.72, -0.64],
    [0, 0.18],
    [0.72, -0.64],
    [0.72, 0.08],
    [0, 0.9],
    [-0.72, 0.08],
  ]);
  const arrow = new THREE.Mesh(
    floorGeometry(new THREE.ShapeGeometry(shape), 0.12).rotateY(Math.PI),
    additive(0xffffff, 0.94),
  );
  arrow.name = 'varkhul-rune-player-guide';
  arrow.renderOrder = 18;
  arrow.visible = false;
  (arrow.material as THREE.MeshBasicMaterial).depthTest = false;
  return arrow;
}

function buildRuneFocusHalo(): THREE.Mesh {
  const outerRadius =
    VARKHUL_ASSEMBLY_RUNE_TRACK_RADIUS +
    VARKHUL_ASSEMBLY_RUNE_CONTROL_OFFSET +
    VARKHUL_ASSEMBLY_RUNE_CONTROL_RADIUS;
  const halo = new THREE.Mesh(
    floorGeometry(new THREE.RingGeometry(outerRadius + 0.12, outerRadius + 0.42, 64), 0.1),
    additive(0xffffff, 0.8),
  );
  halo.name = 'varkhul-rune-focus-halo';
  halo.renderOrder = 14;
  halo.visible = false;
  return halo;
}

function buildRuneGuideBeam(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'varkhul-rune-guide-beam';
  group.visible = false;
  const geometries: THREE.BufferGeometry[] = [
    new THREE.TorusGeometry(1.28, 0.09, 8, 48).rotateX(Math.PI / 2).translate(0, 0.18, 0),
    new THREE.TorusGeometry(0.86, 0.07, 8, 48).rotateX(Math.PI / 2).translate(0, 5.85, 0),
  ];
  for (let index = 0; index < 4; index++) {
    const angle = (index * Math.PI) / 2 + Math.PI / 4;
    geometries.push(
      new THREE.BoxGeometry(0.09, 5.6, 0.09).translate(
        Math.sin(angle) * 1.05,
        3,
        Math.cos(angle) * 1.05,
      ),
    );
  }
  const effect = new THREE.Mesh(mergeFloorGeometries(geometries), additive(0xffffff, 0.62));
  effect.name = 'varkhul-rune-guide-beam-effect';
  effect.renderOrder = 15;
  group.add(effect);
  return group;
}

function buildRuneStationTrack(symbol: number): THREE.Mesh {
  const geometries: THREE.BufferGeometry[] = [
    floorGeometry(
      new THREE.RingGeometry(
        VARKHUL_ASSEMBLY_RUNE_TRACK_RADIUS - 0.13,
        VARKHUL_ASSEMBLY_RUNE_TRACK_RADIUS + 0.13,
        56,
      ),
      0.025,
    ),
    floorGeometry(new THREE.RingGeometry(0.72, 0.86, 32), 0.035),
  ];
  for (let index = 0; index < 8; index++) {
    const angle = (index * Math.PI * 2) / 8;
    const spoke = new THREE.BoxGeometry(0.08, 0.025, VARKHUL_ASSEMBLY_RUNE_TRACK_RADIUS - 1.05);
    spoke.rotateY(angle);
    spoke.translate(
      Math.sin(angle) * ((VARKHUL_ASSEMBLY_RUNE_TRACK_RADIUS + 0.82) / 2),
      0.03,
      Math.cos(angle) * ((VARKHUL_ASSEMBLY_RUNE_TRACK_RADIUS + 0.82) / 2),
    );
    geometries.push(spoke);
  }
  const material = additive(SYMBOL_COLORS[symbol], 0.24);
  material.userData.baseOpacity = 0.24;
  const track = new THREE.Mesh(mergeFloorGeometries(geometries), material);
  track.name = 'varkhul-rune-station-track';
  track.renderOrder = 4;
  return track;
}

function buildControlPad(symbol: number, control: 'counterclockwise' | 'clockwise'): THREE.Mesh {
  const geometry = mergeFloorGeometries([
    floorGeometry(new THREE.CircleGeometry(VARKHUL_ASSEMBLY_RUNE_CONTROL_RADIUS, 40), 0.025),
    floorGeometry(
      new THREE.RingGeometry(
        VARKHUL_ASSEMBLY_RUNE_CONTROL_RADIUS + 0.08,
        VARKHUL_ASSEMBLY_RUNE_CONTROL_RADIUS + 0.18,
        40,
      ),
      0.035,
    ),
    buildVarkhulRuneControlArrowGeometry(control),
  ]);
  const mesh = new THREE.Mesh(geometry, additive(SYMBOL_COLORS[symbol], 0.38));
  mesh.name = `varkhul-rune-control-${control}`;
  mesh.userData.control = control;
  mesh.renderOrder = 8;
  return mesh;
}

function buildRune(symbol: number): RuneVisual {
  const color = SYMBOL_COLORS[symbol];
  const group = new THREE.Group();
  group.name = `varkhul-rune-${symbol}`;
  group.userData.renderCategory = 'ui3d';
  group.userData.actionable = true;
  group.userData.symbol = symbol;
  group.userData.controlRadius = VARKHUL_ASSEMBLY_RUNE_CONTROL_RADIUS;
  group.userData.controlOffset = VARKHUL_ASSEMBLY_RUNE_CONTROL_OFFSET;

  const stationTrack = buildRuneStationTrack(symbol);
  const inner = buildControlPad(symbol, 'counterclockwise');
  const outer = buildControlPad(symbol, 'clockwise');

  const target = new THREE.Group();
  target.name = 'varkhul-rune-target';
  const socket = new THREE.Mesh(
    mergeFloorGeometries([
      floorGeometry(new THREE.RingGeometry(0.62, 0.88, 48), 0.07),
      floorGeometry(new THREE.ShapeGeometry(symbolShape(symbol, 0.4)), 0.075),
      new THREE.TorusGeometry(1.04, 0.065, 8, 40).rotateX(Math.PI / 2).translate(0, 0.32, 0),
    ]),
    additive(color, 0.96),
  );
  socket.name = 'varkhul-rune-target-socket';
  socket.renderOrder = 9;
  const stabilizer = new THREE.Mesh(
    new THREE.CylinderGeometry(0.24, 0.72, 3.2, 18, 1, true).translate(0, 1.6, 0),
    additive(0xffe4a0, 0.25),
  );
  stabilizer.name = 'varkhul-rune-stabilizer';
  target.add(socket, stabilizer);

  const rotor = new THREE.Group();
  rotor.name = 'varkhul-rune-rotor';
  const glyph = new THREE.Mesh(
    mergeFloorGeometries([
      floorGeometry(new THREE.ShapeGeometry(symbolShape(symbol, 0.74)), 0.12),
      new THREE.OctahedronGeometry(0.3, 0).translate(0, 0.64, 0),
      new THREE.TorusGeometry(0.96, 0.055, 8, 36).rotateX(Math.PI / 2).translate(0, 0.22, 0),
    ]),
    additive(color, 1),
  );
  glyph.name = 'varkhul-rune-moving-glyph';
  glyph.renderOrder = 10;
  const embers = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(0.09, 0),
    additive(color, 0.82),
    8,
  );
  embers.name = 'varkhul-rune-embers';
  const matrix = new THREE.Matrix4();
  for (let index = 0; index < 8; index++) {
    const angle = (index / 8) * Math.PI * 2;
    matrix.makeTranslation(
      Math.sin(angle) * 1.05,
      0.28 + (index % 3) * 0.2,
      Math.cos(angle) * 1.05,
    );
    embers.setMatrixAt(index, matrix);
  }
  embers.instanceMatrix.needsUpdate = true;
  rotor.add(glyph, embers);

  const crestFront = new THREE.ShapeGeometry(symbolShape(symbol, 1.25)).translate(0, 1.65, 0);
  const crestCross = crestFront.clone().rotateY(Math.PI / 2);
  const ownerCrest = new THREE.Mesh(
    mergeFloorGeometries([crestFront, crestCross]),
    additive(color, 0.98),
  );
  ownerCrest.name = 'varkhul-rune-owner-crest';
  ownerCrest.position.y = 0.2;
  ownerCrest.renderOrder = 12;

  const thread = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.045, 1), additive(color, 0.56));
  thread.name = 'varkhul-rune-thread';
  thread.renderOrder = 7;

  const focusHalo = buildRuneFocusHalo();
  const guideBeam = buildRuneGuideBeam();

  const lock = new THREE.Group();
  lock.name = 'varkhul-rune-lock-burst';
  lock.visible = false;
  const lockGeometry = mergeFloorGeometries([
    floorGeometry(new THREE.RingGeometry(0.72, 1.28, 48), 0.1),
    floorGeometry(new THREE.ShapeGeometry(symbolShape(symbol, 0.52)), 0.12),
    new THREE.TorusGeometry(1.34, 0.08, 8, 48).rotateX(Math.PI / 2).translate(0, 0.18, 0),
    new THREE.CylinderGeometry(0.7, 1.05, 0.42, 24, 1, true).translate(0, 0.21, 0),
  ]);
  const lockEffect = new THREE.Mesh(lockGeometry, additive(0xffe49a, 0.82));
  lockEffect.name = 'varkhul-rune-lock-effect';
  lock.add(lockEffect);

  group.add(
    stationTrack,
    inner,
    outer,
    target,
    rotor,
    ownerCrest,
    thread,
    lock,
    focusHalo,
    guideBeam,
  );
  return {
    root: group,
    stationTrack,
    target,
    rotor,
    ownerCrest,
    inner,
    outer,
    socket,
    stabilizer,
    embers,
    thread,
    lock,
    focusHalo,
    guideBeam,
    lockProgress: 0,
    wasLocked: false,
  };
}

function disposeRoot(root: THREE.Object3D): void {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh instanceof THREE.InstancedMesh) mesh.dispose();
    if ('geometry' in mesh && mesh.geometry) mesh.geometry.dispose();
    if ('material' in mesh && mesh.material) {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) material.dispose();
    }
  });
  root.removeFromParent();
}

function createVisual(scene: THREE.Scene, bossId: number): AssemblyVisual {
  const root = new THREE.Group();
  root.name = `varkhul-assembly-${bossId}`;
  root.userData.renderCategory = 'ui3d';
  const forge = buildForge();
  const guideArrow = buildPlayerGuideArrow();
  root.add(forge.group, guideArrow);
  const runes = Array.from({ length: VARKHUL_ASSEMBLY_RUNE_COUNT }, (_, symbol) =>
    buildRune(symbol),
  );
  root.add(...runes.map((rune) => rune.root));
  scene.add(root);
  return {
    root,
    forge: forge.group,
    forgeSegments: forge.segments,
    barrierMaterial: forge.barrier,
    guideArrow,
    cores: new Map(),
    activeCores: new Set(),
    runes,
    focusPlan: {
      focusedSymbol: null,
      focusKind: null,
      guideVisible: false,
      guideAngle: 0,
      runeModes: Array(VARKHUL_ASSEMBLY_RUNE_COUNT).fill('hidden'),
    },
    phase: 0,
  };
}

/** Stages the complete Assembly material set when the Inner Crucible attaches. */
export function buildVarkhulAssemblyPrewarmVisual(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'varkhul-assembly-prewarm';
  const forge = buildForge();
  const guideArrow = buildPlayerGuideArrow();
  guideArrow.visible = true;
  root.add(forge.group, guideArrow);
  for (let symbol = 0; symbol < VARKHUL_ASSEMBLY_RUNE_COUNT; symbol++) {
    const { root: rune } = buildRune(symbol);
    rune.position.set((symbol - 4.5) * 4, 0, 22);
    rune.traverse((child) => {
      child.visible = true;
    });
    root.add(rune);
  }
  const core = buildCore();
  core.position.set(0, 2, 2);
  root.add(core);
  return root;
}

function setOrbitalPosition(object: THREE.Object3D, angle: number, radius: number): void {
  object.position.set(Math.sin(angle) * radius, object.position.y, Math.cos(angle) * radius);
  object.rotation.y = angle;
}

function runeModeIntensity(mode: VarkhulAssemblyRuneVisualMode): number {
  switch (mode) {
    case 'focused':
      return 1;
    case 'spectator':
      return 0.65;
    case 'orphan':
      return 1;
    case 'sealed':
      return 0.7;
    case 'teammate':
      return 0.38;
    default:
      return 0;
  }
}

export class VarkhulAssemblyVisuals {
  private readonly visuals = new Map<number, AssemblyVisual>();
  private readonly active = new Set<number>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
  ) {}

  sync(
    assemblies: readonly ActiveVarkhulAssembly[],
    viewer: VarkhulAssemblyViewerFocus = {
      playerId: Number.MIN_SAFE_INTEGER,
      x: 0,
      z: 0,
      assignedSymbol: null,
    },
  ): void {
    this.active.clear();
    for (const state of assemblies) {
      this.active.add(state.bossId);
      let visual = this.visuals.get(state.bossId);
      if (!visual) {
        visual = createVisual(this.scene, state.bossId);
        this.visuals.set(state.bossId, visual);
      }
      visual.root.userData.phase = state.phase;
      visual.forge.position.set(
        state.forgeX,
        this.groundY(state.forgeX, state.forgeZ),
        state.forgeZ,
      );
      const health = Math.ceil((state.forgeHp / Math.max(1, state.forgeMaxHp)) * 10);
      visual.forgeSegments.forEach((segment, index) => {
        segment.visible = Math.floor(index / 2) < health;
      });
      visual.barrierMaterial.color.setHex(state.phase === 'stunned' ? 0x54d9ff : 0xff6b13);
      visual.barrierMaterial.opacity = state.phase === 'stunned' ? 0.84 : 0.46;

      const activeCores = visual.activeCores;
      activeCores.clear();
      for (const core of state.cores) {
        if (core.delivered) continue;
        activeCores.add(core.id);
        let coreVisual = visual.cores.get(core.id);
        if (!coreVisual) {
          coreVisual = buildCore();
          visual.root.add(coreVisual);
          visual.cores.set(core.id, coreVisual);
        }
        coreVisual.position.set(
          core.x,
          this.groundY(core.x, core.z) + (core.carrierId === null ? 1 : 3),
          core.z,
        );
      }
      for (const [id, core] of visual.cores) {
        if (activeCores.has(id)) continue;
        disposeRoot(core);
        visual.cores.delete(id);
      }

      const focusPlan = varkhulAssemblyFocusPlanInto(state, viewer, visual.focusPlan);
      visual.guideArrow.visible = state.phase === 'links' && focusPlan.guideVisible;
      if (visual.guideArrow.visible) {
        visual.guideArrow.position.set(
          viewer.x,
          this.groundY(viewer.x, viewer.z) + GROUND_LIFT,
          viewer.z,
        );
        visual.guideArrow.rotation.y = focusPlan.guideAngle;
        const guideMaterial = visual.guideArrow.material as THREE.MeshBasicMaterial;
        guideMaterial.color.setHex(focusPlan.focusKind === 'rescue' ? 0x78efff : 0xffffff);
      }

      for (const runeVisual of visual.runes) {
        runeVisual.root.userData.orphaned = false;
        runeVisual.root.userData.rescueEligible = false;
      }
      for (const orphan of state.runes) {
        if (
          !orphan.orphaned ||
          orphan.locked ||
          orphan.assignedPlayerId === null ||
          state.difficulty !== 'heroic'
        ) {
          continue;
        }
        let nearest: (typeof state.runes)[number] | null = null;
        let nearestDelta = Number.POSITIVE_INFINITY;
        let second: (typeof state.runes)[number] | null = null;
        let secondDelta = Number.POSITIVE_INFINITY;
        for (const candidate of state.runes) {
          if (candidate.symbol === orphan.symbol) continue;
          const delta = Math.abs(
            Math.atan2(
              Math.sin(candidate.ownerAngle - orphan.ownerAngle),
              Math.cos(candidate.ownerAngle - orphan.ownerAngle),
            ),
          );
          if (
            delta < nearestDelta ||
            (delta === nearestDelta && (nearest === null || candidate.symbol < nearest.symbol))
          ) {
            second = nearest;
            secondDelta = nearestDelta;
            nearest = candidate;
            nearestDelta = delta;
          } else if (
            delta < secondDelta ||
            (delta === secondDelta && (second === null || candidate.symbol < second.symbol))
          ) {
            second = candidate;
            secondDelta = delta;
          }
        }
        if (nearest && !nearest.orphaned) {
          visual.runes[nearest.symbol].root.userData.rescueEligible = true;
        }
        if (second && !second.orphaned) {
          visual.runes[second.symbol].root.userData.rescueEligible = true;
        }
      }

      for (let runeIndex = 0; runeIndex < state.runes.length; runeIndex++) {
        const rune = state.runes[runeIndex];
        const runeVisual = visual.runes[rune.symbol];
        const mode = focusPlan.runeModes[runeIndex] ?? 'hidden';
        const intensity = runeModeIntensity(mode);
        runeVisual.root.visible = state.phase === 'links' && mode !== 'hidden';
        runeVisual.root.position.set(rune.x, this.groundY(rune.x, rune.z) + GROUND_LIFT, rune.z);
        runeVisual.root.userData.trackIndex = rune.trackIndex;
        runeVisual.root.userData.trackRadius = rune.trackRadius;
        runeVisual.root.userData.visualMode = mode;
        runeVisual.root.userData.focusKind =
          focusPlan.focusedSymbol === rune.symbol ? focusPlan.focusKind : null;
        const color = SYMBOL_COLORS[rune.symbol];
        setOrbitalPosition(runeVisual.target, rune.targetAngle, rune.trackRadius);
        setOrbitalPosition(runeVisual.rotor, rune.glyphAngle, rune.trackRadius);
        setOrbitalPosition(
          runeVisual.inner,
          rune.glyphAngle,
          rune.trackRadius - VARKHUL_ASSEMBLY_RUNE_CONTROL_OFFSET,
        );
        setOrbitalPosition(
          runeVisual.outer,
          rune.glyphAngle,
          rune.trackRadius + VARKHUL_ASSEMBLY_RUNE_CONTROL_OFFSET,
        );
        runeVisual.ownerCrest.position.set(0, runeVisual.ownerCrest.position.y, 0);
        runeVisual.ownerCrest.rotation.y = rune.ownerAngle;
        runeVisual.lock.position.set(0, 0, 0);
        runeVisual.lock.rotation.y = rune.ownerAngle;
        runeVisual.thread.position.set(
          Math.sin(rune.glyphAngle) * (rune.trackRadius / 2),
          0.07,
          Math.cos(rune.glyphAngle) * (rune.trackRadius / 2),
        );
        runeVisual.thread.rotation.y = rune.glyphAngle;
        runeVisual.thread.scale.set(1, 1, rune.trackRadius);

        const heroicOrphan = rune.orphaned && state.difficulty === 'heroic';
        const normalOrphan = rune.orphaned && state.difficulty === 'normal';
        const rescueEligible = runeVisual.root.userData.rescueEligible === true;
        const actionable =
          rune.assignedPlayerId !== null && !rune.locked && (!rune.orphaned || heroicOrphan);
        const stationMaterial = runeVisual.stationTrack.material as THREE.MeshBasicMaterial;
        stationMaterial.color.setHex(
          heroicOrphan ? 0xff3526 : normalOrphan ? 0x6d4038 : rune.locked ? 0xffffff : color,
        );
        stationMaterial.userData.baseOpacity =
          (rune.locked
            ? 0.82
            : heroicOrphan
              ? 0.72
              : normalOrphan
                ? 0.16
                : actionable
                  ? 0.56
                  : 0.2) * intensity;
        stationMaterial.opacity = stationMaterial.userData.baseOpacity as number;
        const innerMaterial = runeVisual.inner.material as THREE.MeshBasicMaterial;
        const innerActive = rune.control === 'counterclockwise';
        innerMaterial.color.setHex(
          rune.locked || (innerActive && rune.controlProgress >= 1) ? 0xffffff : color,
        );
        innerMaterial.opacity = normalOrphan
          ? 0.08
          : !actionable
            ? 0.12
            : innerActive
              ? 0.48 + rune.controlProgress * 0.48
              : heroicOrphan
                ? 0.46
                : 0.36;
        innerMaterial.opacity *= intensity;
        runeVisual.inner.scale.setScalar(innerActive ? 0.92 + rune.controlProgress * 0.2 : 0.92);
        const outerMaterial = runeVisual.outer.material as THREE.MeshBasicMaterial;
        const outerActive = rune.control === 'clockwise';
        outerMaterial.color.setHex(
          rune.locked || (outerActive && rune.controlProgress >= 1) ? 0xffffff : color,
        );
        outerMaterial.opacity = normalOrphan
          ? 0.08
          : !actionable
            ? 0.12
            : outerActive
              ? 0.48 + rune.controlProgress * 0.48
              : heroicOrphan
                ? 0.46
                : 0.36;
        outerMaterial.opacity *= intensity;
        runeVisual.outer.scale.setScalar(outerActive ? 0.92 + rune.controlProgress * 0.2 : 0.92);
        const socketMaterial = runeVisual.socket.material as THREE.MeshBasicMaterial;
        socketMaterial.color.setHex(rune.locked || rune.aligned || heroicOrphan ? 0xffffff : color);
        socketMaterial.opacity = normalOrphan
          ? 0.1
          : !actionable && !rune.locked
            ? 0.18
            : rune.aligned
              ? 1
              : 0.94;
        socketMaterial.opacity *= intensity;
        const stabilizerMaterial = runeVisual.stabilizer.material as THREE.MeshBasicMaterial;
        stabilizerMaterial.opacity =
          (rune.aligned ? 0.3 + rune.alignmentProgress * 0.65 : 0.08) * intensity;
        runeVisual.stabilizer.scale.set(1, 0.18 + rune.alignmentProgress * 0.82, 1);
        const ownerMaterial = runeVisual.ownerCrest.material as THREE.MeshBasicMaterial;
        ownerMaterial.color.setHex(
          heroicOrphan
            ? 0xff3526
            : normalOrphan
              ? 0x6d4038
              : rescueEligible
                ? 0x78efff
                : rune.locked
                  ? 0xffffff
                  : color,
        );
        ownerMaterial.opacity =
          (rune.locked || heroicOrphan || rescueEligible
            ? 1
            : normalOrphan
              ? 0.42
              : actionable
                ? 0.98
                : 0.28) * intensity;
        if (rescueEligible) ownerMaterial.opacity = 1;
        const threadMaterial = runeVisual.thread.material as THREE.MeshBasicMaterial;
        threadMaterial.color.setHex(heroicOrphan ? 0xff3526 : color);
        threadMaterial.userData.baseOpacity = actionable ? 0.54 * intensity : 0;
        threadMaterial.opacity = threadMaterial.userData.baseOpacity as number;
        runeVisual.root.userData.ownerActive = actionable;
        runeVisual.root.userData.orphaned = heroicOrphan;
        runeVisual.root.userData.controlProgress = rune.controlProgress;
        runeVisual.root.userData.alignmentProgress = rune.alignmentProgress;
        if (rune.locked && !runeVisual.wasLocked) runeVisual.lockProgress = 0;
        if (!rune.locked) runeVisual.lockProgress = 0;
        runeVisual.wasLocked = rune.locked;
        runeVisual.lock.visible = rune.locked;
        runeVisual.stationTrack.visible = !rune.locked || runeVisual.lockProgress < 1;
        runeVisual.ownerCrest.visible = !rune.locked || runeVisual.lockProgress < 1;
        runeVisual.target.visible = actionable;
        runeVisual.rotor.visible = actionable;
        runeVisual.inner.visible = actionable;
        runeVisual.outer.visible = actionable;
        runeVisual.thread.visible = actionable;
        runeVisual.embers.visible = actionable && mode === 'focused';
        runeVisual.focusHalo.visible = actionable && mode === 'focused';
        runeVisual.guideBeam.visible = actionable && mode === 'focused' && focusPlan.guideVisible;
        const focusColor = focusPlan.focusKind === 'rescue' ? 0x78efff : 0xffffff;
        (runeVisual.focusHalo.material as THREE.MeshBasicMaterial).color.setHex(focusColor);
        const beamEffect = runeVisual.guideBeam.getObjectByName(
          'varkhul-rune-guide-beam-effect',
        ) as THREE.Mesh;
        (beamEffect.material as THREE.MeshBasicMaterial).color.setHex(focusColor);
      }
    }
    for (const [bossId, visual] of this.visuals) {
      if (this.active.has(bossId)) continue;
      disposeRoot(visual.root);
      this.visuals.delete(bossId);
    }
  }

  update(dt: number, reducedMotion: boolean): void {
    for (const visual of this.visuals.values()) {
      if (!reducedMotion) visual.phase += Math.max(0, dt) * 3.5;
      const pulse = reducedMotion ? 1 : 1 + Math.sin(visual.phase) * 0.1;
      visual.guideArrow.scale.setScalar(reducedMotion ? 1 : pulse);
      for (const rune of visual.runes) {
        const material = rune.stationTrack.material as THREE.MeshBasicMaterial;
        const baseOpacity = (material.userData.baseOpacity as number | undefined) ?? 0.2;
        material.opacity = reducedMotion
          ? baseOpacity
          : baseOpacity * (0.92 + Math.sin(visual.phase) * 0.08);
      }
      for (const core of visual.cores.values()) {
        core.rotation.y = reducedMotion ? 0 : visual.phase;
        core.scale.setScalar(pulse);
      }
      for (const rune of visual.runes) {
        rune.target.scale.setScalar(reducedMotion ? 1 : pulse);
        const crestScale = rune.root.userData.orphaned
          ? reducedMotion
            ? 1.12
            : 1.18 + Math.sin(visual.phase * 1.8) * 0.16
          : rune.root.userData.rescueEligible
            ? reducedMotion
              ? 1.05
              : 1.05 + Math.sin(visual.phase * 1.3) * 0.08
            : rune.root.userData.ownerActive
              ? reducedMotion
                ? 1
                : pulse
              : 0.9;
        rune.ownerCrest.scale.setScalar(crestScale);
        rune.focusHalo.scale.setScalar(reducedMotion ? 1 : pulse);
        rune.embers.rotation.y = reducedMotion ? 0 : visual.phase * 0.9;
        const threadMaterial = rune.thread.material as THREE.MeshBasicMaterial;
        const threadBase = (threadMaterial.userData.baseOpacity as number | undefined) ?? 0;
        threadMaterial.opacity = reducedMotion
          ? threadBase
          : threadBase * (0.74 + Math.sin(visual.phase * 2.2) * 0.26);
        if (rune.wasLocked) {
          rune.lockProgress = reducedMotion
            ? 1
            : Math.min(1, rune.lockProgress + Math.max(0, dt) / 0.35);
          const eased = 1 - (1 - rune.lockProgress) ** 3;
          const sealPulse = reducedMotion ? 1 : 1 + Math.sin(visual.phase * 1.4) * 0.05;
          rune.lock.scale.setScalar((0.42 + eased * 0.58) * sealPulse);
          const collapseScale = Math.max(0.001, 1 - eased);
          rune.stationTrack.scale.setScalar(collapseScale);
          rune.ownerCrest.scale.multiplyScalar(collapseScale);
          rune.stationTrack.visible = rune.lockProgress < 1;
          rune.ownerCrest.visible = rune.lockProgress < 1;
        } else {
          rune.lockProgress = 0;
          rune.lock.scale.setScalar(1);
          rune.stationTrack.scale.setScalar(1);
          rune.stationTrack.visible = true;
          rune.ownerCrest.visible = true;
        }
      }
      visual.forge.scale.setScalar(visual.root.userData.phase === 'stunned' ? 1 + pulse * 0.1 : 1);
    }
  }

  dispose(): void {
    for (const visual of this.visuals.values()) disposeRoot(visual.root);
    this.visuals.clear();
    this.active.clear();
  }
}
