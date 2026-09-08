import * as THREE from "three";
import type { TemporalHourglassDisposition } from "../world_api/combat";
import {
  HOURGLASS_FIELD_STYLES,
  hourglassTickRadius,
} from "./hourglass_field_core";
import { markSharedGeometry, markSharedMaterial } from "./shared_resource";

const TICK = markSharedGeometry(new THREE.BoxGeometry(1, 1, 1));
TICK.setAttribute(
  "color",
  new THREE.BufferAttribute(
    new Float32Array(TICK.getAttribute("position").count * 3).fill(1),
    3,
  ),
);
// Pierced clock hands: a narrow waist, split shoulder and open jewel socket.
// Facet shading remains legible in the inexpensive material profile too.
function clockHandGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.5);
  for (const [x, y] of [
    [0.075, 0.12],
    [0.045, -0.06],
    [0.105, -0.32],
    [0.06, -0.36],
    [0.11, -0.5],
    [-0.11, -0.5],
    [-0.06, -0.36],
    [-0.105, -0.32],
    [-0.045, -0.06],
    [-0.075, 0.12],
  ])
    shape.lineTo(x, y);
  shape.closePath();
  const socket = new THREE.Path();
  socket.moveTo(0, -0.1);
  socket.lineTo(-0.035, -0.27);
  socket.lineTo(0, -0.36);
  socket.lineTo(0.035, -0.27);
  socket.closePath();
  shape.holes.push(socket);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.034,
    bevelEnabled: true,
    bevelSize: 0.006,
    bevelThickness: 0.006,
    bevelSegments: 1,
    steps: 1,
  });
  geometry.translate(0, 0, -0.017);
  const normal = geometry.getAttribute("normal"),
    position = geometry.getAttribute("position");
  const colors = new Float32Array(normal.count * 3);
  for (let i = 0; i < normal.count; i++) {
    const value = Math.min(
      1,
      0.46 +
        Math.abs(normal.getZ(i)) * 0.38 +
        Math.max(0, position.getY(i)) * 0.5,
    );
    colors.set([value, value, value], i * 3);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.clearGroups();
  return markSharedGeometry(geometry);
}
const TOOTH = clockHandGeometry();
const INK = markSharedMaterial(
  new THREE.MeshBasicMaterial({ color: 0x172333 }),
);
const COLORS = new Map<TemporalHourglassDisposition, THREE.MeshBasicMaterial>();
export function hourglassFieldMaterial(
  mode: TemporalHourglassDisposition,
): THREE.MeshBasicMaterial {
  let material = COLORS.get(mode);
  if (!material) {
    material = markSharedMaterial(
      new THREE.MeshBasicMaterial({
        color: HOURGLASS_FIELD_STYLES[mode].color,
        vertexColors: true,
      }),
    );
    COLORS.set(mode, material);
  }
  return material;
}

/** Clockwork perimeter: inward protective brackets, raised hostile teeth,
 * neutral double ticks. The central hourglass stays the class identity. */
export class HourglassFieldVisual {
  readonly group = new THREE.Group();
  readonly ticks = new THREE.InstancedMesh(
    TICK,
    hourglassFieldMaterial("unknown"),
    36,
  );
  readonly backing = new THREE.InstancedMesh(TICK, INK, 36);
  readonly spires = new THREE.InstancedMesh(
    TOOTH,
    hourglassFieldMaterial("unknown"),
    12,
  );
  private readonly pose = new THREE.Object3D();
  private lastX = NaN;
  private lastZ = NaN;
  private lastRadius = NaN;
  private lastMode: TemporalHourglassDisposition | null = null;
  private disposed = false;

  constructor() {
    this.group.name = "temporal-hourglass-capture-edge";
    for (const mesh of [this.ticks, this.backing, this.spires])
      mesh.frustumCulled = false;
    this.group.add(this.backing, this.ticks, this.spires);
  }

  update(
    x: number,
    z: number,
    radius: number,
    mode: TemporalHourglassDisposition,
    groundY: (x: number, z: number) => number,
  ): void {
    if (this.disposed) return;
    if (
      x === this.lastX &&
      z === this.lastZ &&
      radius === this.lastRadius &&
      mode === this.lastMode
    )
      return;
    this.lastX = x;
    this.lastZ = z;
    this.lastRadius = radius;
    this.lastMode = mode;
    const style = HOURGLASS_FIELD_STYLES[mode];
    this.ticks.material = this.spires.material = hourglassFieldMaterial(mode);
    for (let hour = 0; hour < 12; hour++) {
      const a = (hour / 12) * Math.PI * 2;
      for (let part = 0; part < 3; part++) {
        const r = hourglassTickRadius(radius, part, mode);
        const side = part === 1 ? -1 : 1;
        const tangent = part === 0 ? 0 : side * 0.105;
        const px = x + Math.cos(a) * r - Math.sin(a) * tangent;
        const pz = z + Math.sin(a) * r + Math.cos(a) * tangent;
        this.pose.position.set(px, groundY(px, pz) + 0.075, pz);
        this.pose.rotation.set(
          0,
          -a + (part === 0 ? 0 : mode === "protective" ? side * 0.65 : 0),
          0,
        );
        this.pose.scale.set(
          part === 0 ? 0.065 : 0.21,
          0.035,
          hour % 3 === 0 ? 0.12 : 0.07,
        );
        this.pose.updateMatrix();
        this.ticks.setMatrixAt(hour * 3 + part, this.pose.matrix);
        this.pose.position.y -= 0.023;
        this.pose.scale.x += 0.035;
        this.pose.scale.z += 0.04;
        this.pose.scale.y = 0.026;
        this.pose.updateMatrix();
        this.backing.setMatrixAt(hour * 3 + part, this.pose.matrix);
      }
    }
    this.spires.count = style.spires;
    for (let i = 0; i < style.spires; i++) {
      const a = (i / style.spires) * Math.PI * 2;
      const px = x + Math.cos(a) * (radius - 0.12),
        pz = z + Math.sin(a) * (radius - 0.12);
      this.pose.position.set(px, groundY(px, pz) + style.height / 2 + 0.09, pz);
      this.pose.rotation.set(0, a + Math.PI / 4, style.turn);
      this.pose.scale.set(1, style.height, 1);
      this.pose.updateMatrix();
      this.spires.setMatrixAt(i, this.pose.matrix);
    }
    for (const mesh of [this.ticks, this.backing, this.spires])
      mesh.instanceMatrix.needsUpdate = true;
  }

  invalidate(): void {
    this.lastMode = null;
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.group.visible = false;
    this.group.removeFromParent();
    this.ticks.dispose();
    this.backing.dispose();
    this.spires.dispose();
  }
}
