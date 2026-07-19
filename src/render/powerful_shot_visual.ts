import * as THREE from 'three';

const LENGTH_SEGMENTS = 24;
const CLEARANCE = 0.12;
const OUTLINE_TINT = new THREE.Color(0xffffff);

/** Reusable, terrain-draped rectangular preview for Powershot's piercing lane. */
export class PowerfulShotTelegraph {
  readonly group = new THREE.Group();
  readonly fill: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  readonly outline: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly groundHeight: (x: number, z: number) => number,
  ) {
    const fillGeometry = new THREE.BufferGeometry();
    fillGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(LENGTH_SEGMENTS * 6 * 3), 3),
    );
    const fillMaterial = new THREE.MeshBasicMaterial({
      color: 0xffcc66,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.fill = new THREE.Mesh(fillGeometry, fillMaterial);
    this.fill.renderOrder = 3;
    this.fill.frustumCulled = false;

    const outlineGeometry = new THREE.BufferGeometry();
    outlineGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array((LENGTH_SEGMENTS * 4 + 4) * 3), 3),
    );
    const outlineMaterial = new THREE.LineBasicMaterial({
      color: 0xffe3a3,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    this.outline = new THREE.LineSegments(outlineGeometry, outlineMaterial);
    this.outline.renderOrder = 4;
    this.outline.frustumCulled = false;

    this.group.name = 'powerful-shot-telegraph';
    this.group.add(this.fill, this.outline);
    this.group.visible = false;
    this.scene.add(this.group);
  }

  update(x: number, z: number, length: number, width: number, facing: number, color: number): void {
    const baseY = this.groundHeight(x, z);
    const sin = Math.sin(facing);
    const cos = Math.cos(facing);
    const halfWidth = width / 2;
    const halfLength = length / 2;
    const fillPositions = this.fill.geometry.getAttribute('position') as THREE.BufferAttribute;
    let fillCursor = 0;
    for (let segment = 0; segment < LENGTH_SEGMENTS; segment++) {
      const z0 = -halfLength + (length * segment) / LENGTH_SEGMENTS;
      const z1 = -halfLength + (length * (segment + 1)) / LENGTH_SEGMENTS;
      fillPositions.setXYZ(
        fillCursor++,
        -halfWidth,
        this.localGroundY(-halfWidth, z0, x, z, baseY, sin, cos),
        z0,
      );
      fillPositions.setXYZ(
        fillCursor++,
        halfWidth,
        this.localGroundY(halfWidth, z0, x, z, baseY, sin, cos),
        z0,
      );
      fillPositions.setXYZ(
        fillCursor++,
        halfWidth,
        this.localGroundY(halfWidth, z1, x, z, baseY, sin, cos),
        z1,
      );
      fillPositions.setXYZ(
        fillCursor++,
        -halfWidth,
        this.localGroundY(-halfWidth, z0, x, z, baseY, sin, cos),
        z0,
      );
      fillPositions.setXYZ(
        fillCursor++,
        halfWidth,
        this.localGroundY(halfWidth, z1, x, z, baseY, sin, cos),
        z1,
      );
      fillPositions.setXYZ(
        fillCursor++,
        -halfWidth,
        this.localGroundY(-halfWidth, z1, x, z, baseY, sin, cos),
        z1,
      );
    }
    fillPositions.needsUpdate = true;

    const outlinePositions = this.outline.geometry.getAttribute(
      'position',
    ) as THREE.BufferAttribute;
    let outlineCursor = 0;
    for (let segment = 0; segment < LENGTH_SEGMENTS; segment++) {
      const z0 = -halfLength + (length * segment) / LENGTH_SEGMENTS;
      const z1 = -halfLength + (length * (segment + 1)) / LENGTH_SEGMENTS;
      outlinePositions.setXYZ(
        outlineCursor++,
        -halfWidth,
        this.localGroundY(-halfWidth, z0, x, z, baseY, sin, cos),
        z0,
      );
      outlinePositions.setXYZ(
        outlineCursor++,
        -halfWidth,
        this.localGroundY(-halfWidth, z1, x, z, baseY, sin, cos),
        z1,
      );
      outlinePositions.setXYZ(
        outlineCursor++,
        halfWidth,
        this.localGroundY(halfWidth, z0, x, z, baseY, sin, cos),
        z0,
      );
      outlinePositions.setXYZ(
        outlineCursor++,
        halfWidth,
        this.localGroundY(halfWidth, z1, x, z, baseY, sin, cos),
        z1,
      );
    }
    outlinePositions.setXYZ(
      outlineCursor++,
      -halfWidth,
      this.localGroundY(-halfWidth, -halfLength, x, z, baseY, sin, cos),
      -halfLength,
    );
    outlinePositions.setXYZ(
      outlineCursor++,
      halfWidth,
      this.localGroundY(halfWidth, -halfLength, x, z, baseY, sin, cos),
      -halfLength,
    );
    outlinePositions.setXYZ(
      outlineCursor++,
      -halfWidth,
      this.localGroundY(-halfWidth, halfLength, x, z, baseY, sin, cos),
      halfLength,
    );
    outlinePositions.setXYZ(
      outlineCursor++,
      halfWidth,
      this.localGroundY(halfWidth, halfLength, x, z, baseY, sin, cos),
      halfLength,
    );
    outlinePositions.needsUpdate = true;

    this.group.position.set(x, baseY, z);
    this.group.rotation.y = facing;
    this.fill.material.color.setHex(color);
    this.outline.material.color.setHex(color).lerp(OUTLINE_TINT, 0.35);
    this.group.visible = true;
  }

  private localGroundY(
    localX: number,
    localZ: number,
    centerX: number,
    centerZ: number,
    baseY: number,
    sin: number,
    cos: number,
  ): number {
    const worldX = centerX + localX * cos + localZ * sin;
    const worldZ = centerZ - localX * sin + localZ * cos;
    return this.groundHeight(worldX, worldZ) - baseY + CLEARANCE;
  }

  setOpacity(opacity: number): void {
    this.fill.material.opacity = opacity * 0.3;
    this.outline.material.opacity = opacity * 0.9;
  }

  hide(): void {
    this.group.visible = false;
  }

  dispose(): void {
    this.scene.remove(this.group);
    this.fill.geometry.dispose();
    this.fill.material.dispose();
    this.outline.geometry.dispose();
    this.outline.material.dispose();
  }
}
