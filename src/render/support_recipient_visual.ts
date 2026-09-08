import * as THREE from 'three';
import { markSharedGeometry } from './shared_resource';
import { syncRigMatrixFreeze } from './rig_visibility_freeze';
import {
  AEGIS_RECIPIENT,
  DAWN_SPEED_RECIPIENT,
  RUNE_RECIPIENT,
  supportRecipientBits,
  type SupportAura,
} from './support_recipient_core';

const CRYSTAL = markSharedGeometry(new THREE.OctahedronGeometry(1, 0));
/** A hollow sun-shield framed by six tapered, etched wing feathers. */
function solarWardGeometry(): THREE.BufferGeometry {
  const positions: number[] = [],
    colors: number[] = [];
  const triangle = (
    a: number[],
    b: number[],
    c: number[],
    brightness: number,
  ) => {
    for (const point of [a, b, c]) {
      positions.push(point[0], point[1], 0.015);
      colors.push(brightness, brightness, brightness);
    }
  };
  const quad = (
    a: number[],
    b: number[],
    c: number[],
    d: number[],
    brightness: number,
  ) => {
    triangle(a, b, c, brightness);
    triangle(a, c, d, brightness);
  };
  const corners = [
    [0, 0.23],
    [0.15, 0.13],
    [0.13, -0.1],
    [0, -0.25],
    [-0.13, -0.1],
    [-0.15, 0.13],
  ];
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i],
      b = corners[(i + 1) % corners.length];
    quad(
      a,
      b,
      [b[0] * 0.77, b[1] * 0.77],
      [a[0] * 0.77, a[1] * 0.77],
      i % 2 ? 0.7 : 1.35,
    );
  }
  for (const sign of [-1, 1])
    for (let row = 0; row < 3; row++) {
      const y = 0.12 - row * 0.1,
        end = 0.42 - row * 0.065;
      quad(
        [sign * 0.16, y],
        [sign * end, y + 0.16],
        [sign * (end - 0.045), y + 0.075],
        [sign * 0.18, y - 0.035],
        1.05 - row * 0.12,
      );
      quad(
        [sign * 0.18, y - 0.055],
        [sign * (end - 0.035), y + 0.04],
        [sign * (end - 0.055), y + 0.015],
        [sign * 0.19, y - 0.07],
        0.45,
      );
    }
  // A small eight-ray sun sits inside the open shield without masking the wearer.
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4,
      c = Math.cos(a),
      d = Math.sin(a);
    quad(
      [c * 0.055 - d * 0.009, d * 0.055 + c * 0.009],
      [c * 0.105 - d * 0.009, d * 0.105 + c * 0.009],
      [c * 0.105 + d * 0.009, d * 0.105 - c * 0.009],
      [c * 0.055 + d * 0.009, d * 0.055 - c * 0.009],
      1.4,
    );
  }
  const geometry = markSharedGeometry(new THREE.BufferGeometry());
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}
const SOLAR_WARD = solarWardGeometry();
const NAMES = [
  'lowerarm.l',
  'hand.l',
  'lowerarm.r',
  'hand.r',
  'chest',
  'foot.l',
  'foot.r',
];

/** Three class-specific silhouettes, attached to the beneficiary's current rig. */
export class SupportRecipientVisual {
  readonly group = new THREE.Group();
  readonly conduits = this.mesh(
    CRYSTAL,
    0xa897ff,
    16,
    'rune-recipient-conduits',
  );
  readonly wards = this.mesh(
    SOLAR_WARD,
    0xffcc58,
    2,
    'aegis-recipient-sunward',
  );
  readonly feathers = this.mesh(
    CRYSTAL,
    0xffedaa,
    12,
    'dawn-recipient-feathers',
  );
  private readonly dummy = new THREE.Object3D();
  private readonly inverse = new THREE.Matrix4();
  private readonly farTransform = new THREE.Matrix4();
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly bones: (THREE.Object3D | null)[] = NAMES.map(() => null);
  private readonly chestRotation = new THREE.Quaternion();
  private readonly parentRotation = new THREE.Quaternion();
  private rig: THREE.Object3D | null = null;
  private rigChildren = -1;
  private disposed = false;
  private readonly owned = new Set<{ dispose(): void }>();

  constructor() {
    this.group.name = 'support-recipient-visual';
    this.group.visible = false;
    for (const mesh of [this.conduits, this.wards, this.feathers]) {
      this.group.add(mesh);
      this.owned.add(mesh);
      this.owned.add(mesh.material);
    }
  }

  private mesh(
    geometry: THREE.BufferGeometry,
    color: number,
    count: number,
    name: string,
  ) {
    const mesh = new THREE.InstancedMesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color,
        vertexColors: geometry.hasAttribute('color'),
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
      count,
    );
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.userData.renderCategory = 'vfx';
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    return mesh;
  }

  update(
    bits: number,
    height: number,
    rig: THREE.Object3D | null,
    farBody: THREE.Object3D | null = null,
  ): void {
    if (this.disposed) return;
    this.group.visible = bits !== 0;
    this.conduits.visible = !!(bits & RUNE_RECIPIENT);
    this.wards.visible = !!(bits & AEGIS_RECIPIENT);
    this.feathers.visible = !!(bits & DAWN_SPEED_RECIPIENT);
    if (!bits) return;
    if (rig !== this.rig || rig?.children.length !== this.rigChildren) {
      this.rig = rig;
      this.rigChildren = rig?.children.length ?? -1;
      for (let i = 0; i < NAMES.length; i++)
        this.bones[i] =
          rig?.getObjectByName(NAMES[i]) ??
          rig?.getObjectByName(
            THREE.PropertyBinding.sanitizeNodeName(NAMES[i]),
          ) ??
          null;
    }
    this.group.updateWorldMatrix(true, false);
    this.inverse.copy(this.group.matrixWorld).invert();
    if (farBody) {
      farBody.updateWorldMatrix(true, false);
      this.farTransform.multiplyMatrices(this.inverse, farBody.matrixWorld);
    }
    const size = Math.max(0.25, height / 1.8);
    if (this.conduits.visible) {
      for (let side = 0; side < 2; side++) {
        const sign = side === 0 ? 1 : -1;
        this.anchor(side * 2, this.a, sign * 0.36, 1.1, 0.02, size, farBody);
        this.anchor(
          side * 2 + 1,
          this.b,
          sign * 0.43,
          0.74,
          0.08,
          size,
          farBody,
        );
        for (let j = 0; j < 8; j++) {
          const t = j / 7,
            angle = t * Math.PI * 2 + side * Math.PI;
          this.dummy.position.lerpVectors(this.a, this.b, t);
          this.dummy.position.x += Math.cos(angle) * 0.095 * size;
          this.dummy.position.z += Math.sin(angle) * 0.095 * size;
          this.dummy.rotation.set(0, angle, sign * 0.35);
          this.dummy.scale.set(0.037 * size, 0.095 * size, 0.03 * size);
          this.write(this.conduits, side * 8 + j, farBody);
        }
      }
      this.conduits.instanceMatrix.needsUpdate = true;
    }
    if (this.wards.visible) {
      this.anchor(4, this.a, 0, 1.22, 0, size, farBody);
      this.chestRotation.identity();
      if (this.bones[4] && !farBody) {
        this.bones[4]!.getWorldQuaternion(this.chestRotation);
        this.group.getWorldQuaternion(this.parentRotation).invert();
        this.chestRotation.premultiply(this.parentRotation);
      }
      for (let face = 0; face < 2; face++) {
        this.dummy.position.set(0, -0.04 * size, (face ? -0.31 : 0.31) * size);
        this.dummy.position.applyQuaternion(this.chestRotation).add(this.a);
        this.dummy.quaternion.copy(this.chestRotation);
        this.dummy.scale.setScalar(size);
        this.write(this.wards, face, farBody);
      }
      this.wards.instanceMatrix.needsUpdate = true;
    }
    if (this.feathers.visible) {
      for (let side = 0; side < 2; side++) {
        this.anchor(
          5 + side,
          this.a,
          side ? -0.16 : 0.16,
          0.15,
          0,
          size,
          farBody,
        );
        for (let j = 0; j < 6; j++) {
          this.dummy.position
            .copy(this.a)
            .add(
              this.b.set(
                (side ? -1 : 1) * (0.11 + j * 0.055) * size,
                j * 0.018 * size,
                (-0.08 - j * 0.075) * size,
              ),
            );
          this.dummy.rotation.set(-0.5, 0, (side ? 1 : -1) * (0.1 + j * 0.19));
          this.dummy.scale.set(
            0.025 * size,
            (0.11 + j * 0.018) * size,
            0.025 * size,
          );
          this.write(this.feathers, side * 6 + j, farBody);
        }
      }
      this.feathers.instanceMatrix.needsUpdate = true;
    }
  }

  private anchor(
    index: number,
    out: THREE.Vector3,
    x: number,
    y: number,
    z: number,
    size: number,
    farBody: THREE.Object3D | null,
  ): void {
    const bone = this.bones[index];
    if (bone && !farBody) bone.getWorldPosition(out).applyMatrix4(this.inverse);
    else out.set(x * size, y * size, z * size);
  }

  private write(
    mesh: THREE.InstancedMesh,
    index: number,
    farBody: THREE.Object3D | null,
  ): void {
    this.dummy.updateMatrix();
    if (farBody) this.dummy.matrix.premultiply(this.farTransform);
    mesh.setMatrixAt(index, this.dummy.matrix);
  }

  dispose(): void {
    this.disposed = true;
    this.group.visible = false;
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
      throw new AggregateError(errors, 'Support recipient cleanup failed');
  }
}

export function syncSupportRecipient(
  view: {
    supportRecipientVisual: SupportRecipientVisual | null;
    group: THREE.Group;
    height: number;
  },
  entity: { dead: boolean; kind: string; auras: readonly SupportAura[] },
  rig: THREE.Object3D,
  farBody: THREE.Object3D | null,
): void {
  const bits = view.group.visible
    ? supportRecipientBits(entity.auras, entity.dead, entity.kind)
    : 0;
  if (bits) syncRigMatrixFreeze(view.group, true);
  if (bits && !view.supportRecipientVisual) {
    view.supportRecipientVisual = new SupportRecipientVisual();
    view.group.add(view.supportRecipientVisual.group);
  }
  view.supportRecipientVisual?.update(bits, view.height, rig, farBody);
}
