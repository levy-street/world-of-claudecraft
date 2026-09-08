import * as THREE from 'three';
import type {
  ActiveRuneOfPower,
  RuneOfPowerDisposition,
} from '../world_api/combat';
import { markSharedGeometry } from './shared_resource';

const BAR = markSharedGeometry(new THREE.BoxGeometry(1, 1, 1));
const CRYSTAL = markSharedGeometry(new THREE.OctahedronGeometry(1, 0));
const MAX_STROKES = 512;
const AXIS = new THREE.Vector3(1, 0, 0);

/** Mage inscription: braided conduits, individual glyphs and six arcane foci.
 * Only the small perimeter characters communicate benefit disposition. */
export class RuneOfPowerVisual {
  readonly group = new THREE.Group();
  readonly strokes: THREE.InstancedMesh;
  readonly backing: THREE.InstancedMesh;
  readonly crystals: THREE.InstancedMesh;
  private readonly ink = new THREE.MeshBasicMaterial({
    color: 0x211336,
    transparent: true,
    depthWrite: false,
  });
  private readonly light = new THREE.MeshBasicMaterial({
    color: new THREE.Color(1.8, 1.8, 1.8),
    toneMapped: false,
    transparent: true,
    depthWrite: false,
  });
  private readonly gem = new THREE.MeshBasicMaterial({ color: 0xc2a4ff });
  private readonly pose = new THREE.Object3D();
  private readonly direction = new THREE.Vector3();
  private readonly color = new THREE.Color();
  private count = 0;
  private x = NaN;
  private z = NaN;
  private radius = NaN;
  private disposition: RuneOfPowerDisposition | null = null;
  private ground: (x: number, z: number) => number = () => 0;
  private elapsed = 0;
  private remaining = 0;
  private duration = 1;
  private disposed = false;
  private readonly owned = new Set<{ dispose(): void }>();
  private readonly authoredColors = new Float32Array(MAX_STROKES * 3);
  private readonly crystalGround = new Float32Array(6);
  private detail = 1;

  constructor() {
    this.group.name = 'rune-of-power-inscription';
    this.ink.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        '#include <color_fragment>\ndiffuseColor.a *= max(vColor.r, max(vColor.g, vColor.b));',
      );
    };
    this.ink.customProgramCacheKey = () => 'rune-conduit-ink-v1';
    this.light.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        '#include <color_fragment>\ndiffuseColor.a *= smoothstep(0.015, 0.18, max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b)));',
      );
    };
    this.light.customProgramCacheKey = () => 'rune-conduit-light-v1';
    this.strokes = new THREE.InstancedMesh(BAR, this.light, MAX_STROKES);
    this.backing = new THREE.InstancedMesh(BAR, this.ink, MAX_STROKES);
    this.crystals = new THREE.InstancedMesh(CRYSTAL, this.gem, 6);
    for (let i = 0; i < MAX_STROKES; i++)
      this.backing.setColorAt(i, this.color.setRGB(1, 1, 1));
    for (const mesh of [this.strokes, this.backing, this.crystals])
      mesh.frustumCulled = false;
    this.group.add(this.backing, this.strokes, this.crystals);
    for (const resource of [
      this.strokes,
      this.backing,
      this.crystals,
      this.ink,
      this.light,
      this.gem,
    ])
      this.owned.add(resource);
  }

  private line(
    ax: number,
    az: number,
    bx: number,
    bz: number,
    color: number,
    width = 0.055,
  ): void {
    if (this.count >= MAX_STROKES)
      throw new Error('Rune inscription exceeds its prepared stroke budget');
    const ay = this.ground(ax, az),
      by = this.ground(bx, bz);
    this.direction.set(bx - ax, by - ay, bz - az);
    this.pose.position.set((ax + bx) / 2, (ay + by) / 2 + 0.075, (az + bz) / 2);
    this.pose.scale.set(this.direction.length(), 0.025, width);
    this.pose.quaternion.setFromUnitVectors(AXIS, this.direction.normalize());
    this.pose.updateMatrix();
    this.strokes.setMatrixAt(this.count, this.pose.matrix);
    this.strokes.setColorAt(this.count, this.color.setHex(color));
    this.pose.position.y -= 0.025;
    this.pose.scale.z += 0.05;
    this.pose.scale.x += 0.03;
    this.pose.updateMatrix();
    this.backing.setMatrixAt(this.count++, this.pose.matrix);
  }

  sync(
    state: ActiveRuneOfPower,
    ground: (x: number, z: number) => number,
  ): void {
    if (this.disposed) return;
    if (
      this.remaining !== state.remaining ||
      this.duration !== state.duration
    ) {
      this.elapsed = Math.max(0, state.duration - state.remaining);
      this.remaining = state.remaining;
      this.duration = state.duration;
    }
    if (
      this.x === state.x &&
      this.z === state.z &&
      this.radius === state.radius &&
      this.disposition === state.disposition
    )
      return;
    this.x = state.x;
    this.z = state.z;
    this.radius = state.radius;
    this.disposition = state.disposition;
    this.ground = ground;
    this.count = 0;
    const r = state.radius,
      x = state.x,
      z = state.z;
    const accent =
      state.disposition === 'eligible'
        ? 0x9ae9ff
        : state.disposition === 'opponent'
          ? 0xf3b377
          : state.disposition === 'inactive'
            ? 0x947cab
            : 0xc2a4ff;
    // Segmented arc marks keep the exact radius at every phase; they never widen.
    for (let i = 0; i < 36; i++) {
      const a = (i * Math.PI) / 18,
        b = a + 0.11;
      const middle = (a + b) / 2;
      this.line(
        x + Math.cos(a) * r,
        z + Math.sin(a) * r,
        x + Math.cos(middle) * r,
        z + Math.sin(middle) * r,
        0x9276ec,
        0.07,
      );
      this.line(
        x + Math.cos(middle) * r,
        z + Math.sin(middle) * r,
        x + Math.cos(b) * r,
        z + Math.sin(b) * r,
        0xc6b3ff,
        0.07,
      );
    }
    // Two interlocking, braided triangles, individually draped over terrain.
    for (let tri = 0; tri < 2; tri++)
      for (let side = 0; side < 3; side++) {
        const a = ((side * 2) / 3 + tri / 3) * Math.PI,
          b = a + (Math.PI * 2) / 3;
        for (let segment = 0; segment < 12; segment++) {
          const t = segment / 12,
            end = (segment + 0.84) / 12;
          for (const lane of [-1, 1]) {
            const ring = r * 0.76 + lane * 0.07;
            this.line(
              x + (Math.cos(a) * (1 - t) + Math.cos(b) * t) * ring,
              z + (Math.sin(a) * (1 - t) + Math.sin(b) * t) * ring,
              x + (Math.cos(a) * (1 - end) + Math.cos(b) * end) * ring,
              z + (Math.sin(a) * (1 - end) + Math.sin(b) * end) * ring,
              segment % 3 === 0 ? 0xe3d8ff : 0x7651da,
              0.045,
            );
          }
        }
      }
    // Individually constructed runes, without a shared caster-circle texture.
    for (let i = 0; i < 24; i++) {
      const a = (i * Math.PI) / 12,
        c = Math.cos(a),
        s = Math.sin(a);
      const glyph = (u: number, v: number) => [
        x + c * (r * 0.88 + u) - s * v,
        z + s * (r * 0.88 + u) + c * v,
      ];
      const stroke = (u: number, v: number, w: number, q: number) => {
        const from = glyph(u, v),
          to = glyph(w, q);
        this.line(from[0], from[1], to[0], to[1], accent);
      };
      stroke(-0.2, 0, 0.2, 0);
      stroke(0.2, 0, 0.08, 0.16);
      stroke(i % 2 ? -0.15 : 0.05, -0.16, 0.05, 0.16);
      if (state.disposition === 'eligible') stroke(-0.2, 0, -0.08, -0.14);
      else if (state.disposition === 'opponent') stroke(0.2, 0, 0.08, -0.16);
      else stroke(-0.1, -0.17, -0.1, -0.04);
    }
    this.strokes.count = this.backing.count = this.count;
    this.strokes.instanceMatrix.needsUpdate =
      this.backing.instanceMatrix.needsUpdate = true;
    if (this.strokes.instanceColor)
      this.strokes.instanceColor.needsUpdate = true;
    this.authoredColors.set(this.strokes.instanceColor!.array);
    this.setDetail(this.detail, true);
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      this.crystalGround[i] = ground(
        x + Math.cos(a) * r * 0.76,
        z + Math.sin(a) * r * 0.76,
      );
    }
    this.gem.color.setHex(
      state.disposition === 'inactive' ? 0x897a9e : 0xc2a4ff,
    );
    this.update(0, true);
  }

  update(dt: number, reducedMotion = false): void {
    if (this.disposed || !Number.isFinite(this.radius)) return;
    this.elapsed += Math.max(0, dt);
    const active = this.disposition !== 'inactive';
    const phase = reducedMotion || !active ? 0 : this.elapsed;
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3,
        x = this.x + Math.cos(a) * this.radius * 0.76,
        z = this.z + Math.sin(a) * this.radius * 0.76;
      this.pose.position.set(
        x,
        this.crystalGround[i] +
          0.7 +
          Math.sin(phase * 2 + i) * (reducedMotion || !active ? 0 : 0.12),
        z,
      );
      this.pose.rotation.set(0.1, -a + phase * 0.2, 0.1);
      this.pose.scale.set(0.12, active ? 0.45 : 0.18, 0.12);
      this.pose.updateMatrix();
      this.crystals.setMatrixAt(i, this.pose.matrix);
    }
    this.crystals.instanceMatrix.needsUpdate = true;
    // Remaining lifetime affects the foci only, not the actionable ground edge.
    const fraction = Math.max(
      0,
      Math.min(1, (this.duration - this.elapsed) / this.duration),
    );
    this.gem.color
      .setHex(active ? 0xc2a4ff : 0x897a9e)
      .multiplyScalar(0.7 + fraction * 0.3);
  }

  /** De-emphasize only duplicate inner conduits under overlapping support fields.
   * Capture edges, eligibility glyphs and the spell's full radius remain intact. */
  setDetail(value: number, force = false): void {
    if (
      this.disposed ||
      (!force && value === this.detail) ||
      !this.strokes.instanceColor
    )
      return;
    this.detail = value;
    this.backing.renderOrder = 2;
    this.strokes.renderOrder = value === 1 ? 4 : 3;
    const colors = this.strokes.instanceColor.array;
    for (let i = 72 * 3; i < 216 * 3; i++)
      colors[i] = this.authoredColors[i] * value;
    this.strokes.instanceColor.needsUpdate = true;
    const inkColors = this.backing.instanceColor!.array;
    for (let i = 72 * 3; i < 216 * 3; i++) inkColors[i] = value;
    this.backing.instanceColor!.needsUpdate = true;
  }

  invalidate(): void {
    this.disposition = null;
    this.remaining = NaN;
  }
  dispose(): void {
    this.disposed = true;
    const errors: unknown[] = [];
    try {
      this.group.removeFromParent();
    } catch (error) {
      errors.push(error);
    }
    for (const resource of this.owned) {
      try {
        resource.dispose();
        this.owned.delete(resource);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length)
      throw new AggregateError(errors, 'Rune resource disposal failed');
  }
}

export class RunesOfPowerVisuals {
  private readonly active = new Map<string, RuneOfPowerVisual>();
  private readonly pool: RuneOfPowerVisual[] = [];
  private readonly pendingCleanup = new Set<RuneOfPowerVisual>();
  private readonly seen = new Set<string>();
  private disposed = false;
  constructor(
    private readonly scene: THREE.Scene,
    private readonly ground: (x: number, z: number) => number,
  ) {}
  private rank(
    row: ActiveRuneOfPower,
    viewer?: { id: number; pos: { x: number; z: number } },
  ): number {
    return (
      (row.sourceId === viewer?.id ? -1e12 : 0) +
      (row.x - (viewer?.pos.x ?? 0)) ** 2 +
      (row.z - (viewer?.pos.z ?? 0)) ** 2
    );
  }
  sync(
    rows: readonly ActiveRuneOfPower[],
    viewer?: { id: number; pos: { x: number; z: number } },
  ): void {
    if (this.disposed) return;
    this.seen.clear();
    for (const row of rows) {
      if (row.remaining <= 0) continue;
      this.seen.add(row.id);
      let visual = this.active.get(row.id);
      if (!visual) {
        visual = this.pool.pop() ?? new RuneOfPowerVisual();
        visual.invalidate();
        this.active.set(row.id, visual);
        this.scene.add(visual.group);
      }
      visual.sync(row, this.ground);
      const priority = this.rank(row, viewer);
      let overlapsPrimary = false;
      for (const other of rows) {
        if (
          other.id === row.id ||
          other.remaining <= 0 ||
          (other.disposition === 'eligible') !==
            (row.disposition === 'eligible') ||
          (other.x - row.x) ** 2 + (other.z - row.z) ** 2 >=
            (other.radius + row.radius) ** 2
        )
          continue;
        const otherRank = this.rank(other, viewer);
        if (
          otherRank < priority ||
          (otherRank === priority && other.id < row.id)
        ) {
          overlapsPrimary = true;
          break;
        }
      }
      visual.setDetail(overlapsPrimary ? 0.015 : 1);
    }
    for (const [id, visual] of this.active)
      if (!this.seen.has(id)) {
        this.active.delete(id);
        visual.group.removeFromParent();
        if (this.pool.length < 32) this.pool.push(visual);
        else {
          try {
            visual.dispose();
          } catch (error) {
            this.pendingCleanup.add(visual);
            throw error;
          }
        }
      }
  }
  update(dt: number, reducedMotion = false): void {
    if (!this.disposed)
      for (const visual of this.active.values())
        visual.update(dt, reducedMotion);
  }
  dispose(): void {
    this.disposed = true;
    const owned = new Set([
      ...this.active.values(),
      ...this.pool,
      ...this.pendingCleanup,
    ]);
    this.active.clear();
    this.pool.length = 0;
    this.pendingCleanup.clear();
    const errors: unknown[] = [];
    for (const visual of owned) {
      try {
        visual.dispose();
      } catch (error) {
        this.pendingCleanup.add(visual);
        errors.push(error);
      }
    }
    if (errors.length)
      throw new AggregateError(errors, 'Rune field disposal failed');
  }
}
