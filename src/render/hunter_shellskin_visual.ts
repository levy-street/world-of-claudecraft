import * as THREE from 'three';
import { surfaceMat } from './gfx';
import {
  SHELLSKIN_PLATE_COUNT,
  type ShellskinAura,
  type ShellskinPlatePose,
  shellskinAura,
  shellskinPlateInto,
  shellskinReveal,
} from './hunter_shellskin_core';
import { markSharedGeometry } from './shared_resource';

let scute: THREE.BufferGeometry | null = null;
const UP = new THREE.Vector3(0, 1, 0);

/** Chiseled keratin, with a central keel, dark growth groove and worn lip. */
export function shellskinGeometry(): THREE.BufferGeometry {
  if (scute) return scute;
  const positions: number[] = [],
    colors: number[] = [],
    indices: number[] = [];
  const rings = [0, 0.26, 0.52, 0.68, 0.72, 0.77, 0.91, 1];
  const segments = 24;
  for (let band = 0; band < rings.length; band++) {
    const r = rings[band];
    for (let j = 0; j < segments; j++) {
      const sector = j / 4,
        corner = Math.floor(sector),
        mix = sector - corner;
      const a = (corner * Math.PI) / 3,
        b = ((corner + 1) * Math.PI) / 3;
      const uneven = 1 + Math.sin(j * 1.3) * 0.035;
      const x = ((1 - mix) * Math.cos(a) + mix * Math.cos(b)) * r * uneven;
      const y = ((1 - mix) * Math.sin(a) + mix * Math.sin(b)) * r * uneven;
      const keel = Math.max(0, 1 - Math.abs(x) * 2.5) * (1 - r) * 0.16;
      const z = 0.07 + (1 - r) ** 0.65 * 0.34 + keel - (band === 4 ? 0.045 : 0);
      positions.push(x, y, z);
      const groove = band === 4,
        lip = band >= 6;
      const grain = Math.sin(j * 2.4 + band * 3.1) * 0.026;
      colors.push(
        (groove ? 0.055 : lip ? 0.47 : 0.17 + (1 - r) * 0.13) + grain,
        (groove ? 0.08 : lip ? 0.43 : 0.23 + (1 - r) * 0.13) + grain,
        (groove ? 0.035 : lip ? 0.24 : 0.085 + (1 - r) * 0.06) + grain,
      );
      if (band === 0) continue;
      const previous = (band - 1) * segments,
        current = band * segments,
        next = (j + 1) % segments;
      indices.push(
        previous + j,
        current + j,
        current + next,
        previous + j,
        current + next,
        previous + next,
      );
    }
  }
  scute = markSharedGeometry(new THREE.BufferGeometry());
  scute.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  scute.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  scute.setIndex(indices);
  scute.computeVertexNormals();
  return scute;
}

export function shellskinMaterial(): THREE.Material {
  return surfaceMat({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.48,
    metalness: 0.12,
    emissive: 0x152008,
    emissiveIntensity: 0.45,
    side: THREE.DoubleSide,
  });
}

export class HunterShellskinVisual {
  readonly group = new THREE.Group();
  readonly plates = new THREE.InstancedMesh(
    shellskinGeometry(),
    shellskinMaterial(),
    SHELLSKIN_PLATE_COUNT,
  );
  private readonly dummy = new THREE.Object3D();
  private readonly pose: ShellskinPlatePose = {
    x: 0,
    y: 0,
    z: 0,
    rx: 0,
    ry: 0,
    rz: 0,
    sx: 1,
    sy: 1,
    sz: 1,
  };
  private readonly inverse = new THREE.Matrix4();
  private readonly elbow = new THREE.Vector3();
  private readonly hand = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly chest = new THREE.Vector3();
  private readonly spine = new THREE.Vector3();
  private readonly left = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly sideAxis = new THREE.Vector3();
  private readonly upAxis = new THREE.Vector3();
  private readonly frontAxis = new THREE.Vector3();
  private readonly basis = new THREE.Matrix4();
  private readonly torsoRotation = new THREE.Quaternion();
  private readonly farTransform = new THREE.Matrix4();
  private readonly lastFarTransform = new THREE.Matrix4();
  private staticSize = -1;
  private staticReveal = -1;
  private staticMobile = false;
  private rig: THREE.Object3D | null = null;
  private rigChildren = -1;
  private readonly armBones: (THREE.Object3D | null)[] = [null, null, null, null];
  private readonly torsoBones: (THREE.Object3D | null)[] = [null, null, null, null];
  private disposed = false;

  constructor() {
    this.group.name = 'hunter-shellskin-carapace';
    this.group.visible = false;
    this.plates.name = 'hunter-shellskin-scutes';
    this.plates.frustumCulled = false;
    this.plates.userData.renderCategory = 'vfx';
    this.plates.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.plates);
  }

  update(
    aura: ShellskinAura | null,
    height: number,
    rig: THREE.Object3D | null,
    farBody: THREE.Object3D | null = null,
  ): void {
    if (this.disposed) return;
    this.group.visible = aura !== null;
    if (!aura) return;
    if (rig !== this.rig || rig?.children.length !== this.rigChildren) {
      this.rig = rig;
      this.rigChildren = rig?.children.length ?? -1;
      for (const [i, name] of ['lowerarm.l', 'hand.l', 'lowerarm.r', 'hand.r'].entries())
        this.armBones[i] =
          rig?.getObjectByName(name) ??
          rig?.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name)) ??
          null;
      for (const [i, name] of ['chest', 'spine', 'upperarm.l', 'upperarm.r'].entries())
        this.torsoBones[i] =
          rig?.getObjectByName(name) ??
          rig?.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name)) ??
          null;
    }
    const size = Math.max(0.4, height / 1.8),
      reveal = shellskinReveal(aura),
      mobile = aura.value < 0.5;
    this.group.updateWorldMatrix(true, false);
    this.inverse.copy(this.group.matrixWorld).invert();
    this.plates.count = farBody ? 20 : SHELLSKIN_PLATE_COUNT;
    if (farBody) {
      farBody.updateWorldMatrix(true, false);
      this.farTransform.multiplyMatrices(this.inverse, farBody.matrixWorld);
      if (
        size === this.staticSize &&
        reveal === this.staticReveal &&
        mobile === this.staticMobile &&
        this.lastFarTransform.equals(this.farTransform)
      )
        return;
      this.staticSize = size;
      this.staticReveal = reveal;
      this.staticMobile = mobile;
      this.lastFarTransform.copy(this.farTransform);
    } else this.staticSize = -1;
    const [chestBone, spineBone, leftBone, rightBone] = this.torsoBones;
    let followsTorso = false;
    if (!farBody && chestBone && spineBone && leftBone && rightBone) {
      chestBone.getWorldPosition(this.chest).applyMatrix4(this.inverse);
      spineBone.getWorldPosition(this.spine).applyMatrix4(this.inverse);
      leftBone.getWorldPosition(this.left).applyMatrix4(this.inverse);
      rightBone.getWorldPosition(this.right).applyMatrix4(this.inverse);
      this.sideAxis.subVectors(this.left, this.right).normalize();
      this.upAxis.subVectors(this.chest, this.spine);
      this.upAxis.addScaledVector(this.sideAxis, -this.upAxis.dot(this.sideAxis)).normalize();
      this.frontAxis.crossVectors(this.sideAxis, this.upAxis).normalize();
      followsTorso = this.frontAxis.lengthSq() > 0.5;
      if (followsTorso) {
        this.basis.makeBasis(this.sideAxis, this.upAxis, this.frontAxis);
        this.torsoRotation.setFromRotationMatrix(this.basis);
      }
    }
    for (let i = 0; i < this.plates.count; i++) {
      shellskinPlateInto(i, mobile, this.pose);
      const p = this.pose;
      this.dummy.position.set(p.x * size, p.y * size, p.z * size);
      this.dummy.rotation.set(p.rx, p.ry, p.rz);
      if (i < 20 && followsTorso) {
        this.dummy.position
          .copy(this.chest)
          .addScaledVector(this.sideAxis, p.x * size)
          .addScaledVector(this.upAxis, (p.y - 0.7) * size)
          .addScaledVector(this.frontAxis, p.z * size);
        this.dummy.quaternion.premultiply(this.torsoRotation);
      }
      if (i >= 20) {
        const arm = i < 23 ? 0 : 2,
          row = (i - 20) % 3;
        const lower = this.armBones[arm],
          wrist = this.armBones[arm + 1];
        if (lower && wrist) {
          // Resolve only two segments, directly from the moving native rig.
          if (row === 0) {
            lower.getWorldPosition(this.elbow).applyMatrix4(this.inverse);
            wrist.getWorldPosition(this.hand).applyMatrix4(this.inverse);
            this.direction.subVectors(this.hand, this.elbow);
          }
          if (this.direction.lengthSq() > 1e-6) {
            this.dummy.position.lerpVectors(this.elbow, this.hand, 0.2 + row * 0.3);
            this.dummy.position.z += 0.07 * size;
            this.dummy.quaternion.setFromUnitVectors(UP, this.direction.normalize());
          }
        }
      }
      this.dummy.scale.set(p.sx * size * reveal, p.sy * size * reveal, p.sz * size * reveal);
      this.dummy.updateMatrix();
      if (farBody) this.dummy.matrix.premultiply(this.farTransform);
      this.plates.setMatrixAt(i, this.dummy.matrix);
    }
    this.plates.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.group.visible = false;
    this.group.removeFromParent();
    this.plates.dispose();
    // Geometry and surfaceMat are shared with prewarm and other wearers.
  }
}

export interface ShellskinView {
  hunterShellskinVisual: HunterShellskinVisual | null;
  group: THREE.Group;
  height: number;
}
export function syncHunterShellskin(
  view: ShellskinView,
  entity: { dead: boolean; auras: readonly ShellskinAura[] },
  rig: THREE.Object3D,
  farBody: THREE.Object3D | null = null,
): void {
  const aura = shellskinAura(entity.auras, entity.dead);
  if (aura && !view.hunterShellskinVisual) {
    view.hunterShellskinVisual = new HunterShellskinVisual();
    view.group.add(view.hunterShellskinVisual.group);
  }
  view.hunterShellskinVisual?.update(aura, view.height, rig, farBody);
}
