import * as THREE from 'three';
import type { SimEvent } from '../sim/types';

export const PALADIN_AEGIS_DOME_RADIUS = 10;
const TAU = Math.PI * 2;
const RUNE_COUNT = 8;
const DOME_GEOMETRY = new THREE.SphereGeometry(
  PALADIN_AEGIS_DOME_RADIUS,
  40,
  18,
  0,
  TAU,
  0,
  Math.PI / 2,
);
const GROUND_RING_GEOMETRY = new THREE.TorusGeometry(PALADIN_AEGIS_DOME_RADIUS, 0.08, 8, 64);
const SUN_GEOMETRY = new THREE.SphereGeometry(0.72, 20, 12);
const BLADE_GEOMETRY = new THREE.BoxGeometry(0.1, 1.75, 0.05);
const GUARD_GEOMETRY = new THREE.BoxGeometry(0.7, 0.08, 0.08);

function buildSolarRuneTexture(): THREE.DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - size / 2;
      const dy = y - size / 2;
      const radius = Math.hypot(dx, dy);
      const ring = Math.abs(radius - 20) < 1.8;
      const cross =
        (Math.abs(dx) < 2 && Math.abs(dy) < 14) || (Math.abs(dy) < 2 && Math.abs(dx) < 14);
      const diagonal = Math.abs(Math.abs(dx) - Math.abs(dy)) < 1.5 && radius > 17 && radius < 27;
      if (!ring && !cross && !diagonal) continue;
      const offset = (y * size + x) * 4;
      data[offset] = 255;
      data[offset + 1] = 240;
      data[offset + 2] = 150;
      data[offset + 3] = cross ? 255 : 205;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

const SOLAR_RUNE_TEXTURE = buildSolarRuneTexture();

function additiveMaterial(color: number, opacity: number, side: THREE.Side = THREE.DoubleSide) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    side,
    blending: THREE.AdditiveBlending,
  });
}

export class PaladinAegisVisual {
  readonly group = new THREE.Group();
  private readonly dome: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private readonly groundRing: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  private readonly sun: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private readonly sunHalo: THREE.Sprite;
  private readonly plantedWeapon = new THREE.Group();
  private readonly runes: THREE.Sprite[] = [];
  private time = 0;
  private pulseEnergy = 0;
  private completionRemaining = 0;
  private readonly pulseUniform = { value: 0 };
  private disposed = false;
  private readonly ownedMaterials = new Set<THREE.Material>();

  constructor() {
    this.group.name = 'paladin-aegis-visual';
    this.group.visible = false;

    this.dome = new THREE.Mesh(DOME_GEOMETRY, additiveMaterial(0xfff1b0, 0.13, THREE.BackSide));
    this.dome.material.onBeforeCompile = (shader) => {
      shader.uniforms.uAegisPulse = this.pulseUniform;
      shader.vertexShader = 'varying vec3 vAegisPoint;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvAegisPoint=position;',
      );
      shader.fragmentShader =
        'uniform float uAegisPulse;\nvarying vec3 vAegisPoint;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `
        #include <color_fragment>
        float angle=dot(vAegisPoint.xz,vAegisPoint.xz)<0.00001 ? 0.0 : atan(vAegisPoint.z,vAegisPoint.x);
        float height=vAegisPoint.y/10.0;
        float ribs=pow(max(0.0,cos(angle*12.0+height*0.55)),28.0);
        float engraving=pow(max(0.0,cos(height*75.0+sin(angle*24.0)*2.0)),18.0);
        float facets=pow(max(0.0,cos(angle*24.0-height*18.0)),12.0);
        float crown=smoothstep(0.84,0.98,height);
        diffuseColor.rgb*=1.0+ribs*2.4+crown*1.3+uAegisPulse*(ribs*3.0+engraving*1.8);
        diffuseColor.a*=0.7+ribs*3.0+engraving*0.6+facets*0.9+crown;
      `,
      );
    };
    this.dome.material.customProgramCacheKey = () => 'paladin-aegis-solar-vault-v2';
    this.dome.name = 'paladin-aegis-dome';
    this.dome.renderOrder = 6;
    this.group.add(this.dome);

    this.groundRing = new THREE.Mesh(GROUND_RING_GEOMETRY, additiveMaterial(0xffd86a, 0.72));
    this.groundRing.name = 'paladin-aegis-ground-ring';
    this.groundRing.rotation.x = Math.PI / 2;
    this.groundRing.position.y = 0.06;
    this.groundRing.renderOrder = 8;
    this.group.add(this.groundRing);

    this.sun = new THREE.Mesh(SUN_GEOMETRY, additiveMaterial(0xfff7d0, 0.92));
    this.sun.name = 'paladin-aegis-sun';
    this.sun.position.y = 5.8;
    this.sun.renderOrder = 9;
    this.group.add(this.sun);

    this.sunHalo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: SOLAR_RUNE_TEXTURE,
        color: 0xffdf72,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.sunHalo.name = 'paladin-aegis-sun-halo';
    this.sunHalo.position.y = 5.8;
    this.sunHalo.scale.setScalar(2.4);
    this.sunHalo.renderOrder = 10;
    this.group.add(this.sunHalo);

    const blade = new THREE.Mesh(BLADE_GEOMETRY, additiveMaterial(0xfff4bd, 0.9));
    blade.position.y = 1.05;
    const guard = new THREE.Mesh(GUARD_GEOMETRY, additiveMaterial(0xffcc58, 0.9));
    guard.position.y = 0.52;
    this.plantedWeapon.name = 'paladin-aegis-planted-weapon';
    this.plantedWeapon.add(blade, guard);
    this.group.add(this.plantedWeapon);

    for (let index = 0; index < RUNE_COUNT; index++) {
      const rune = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: SOLAR_RUNE_TEXTURE,
          color: index % 2 === 0 ? 0xffe58a : 0xffffff,
          transparent: true,
          opacity: 0.72,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      rune.name = `paladin-aegis-rune-${index + 1}`;
      rune.scale.setScalar(1.3);
      rune.renderOrder = 9;
      this.runes.push(rune);
      this.group.add(rune);
    }
    this.group.traverse((object) => {
      const material = (object as THREE.Mesh).material;
      if (material)
        for (const item of Array.isArray(material) ? material : [material])
          this.ownedMaterials.add(item);
    });
  }

  pulse(completed: boolean): void {
    if (this.disposed) return;
    this.pulseEnergy = 1;
    if (completed) this.completionRemaining = 0.55;
  }

  update(active: boolean, dt: number, reducedMotion: boolean, parentScale = 1): void {
    if (this.disposed) return;
    const seconds = Math.max(0, dt);
    this.pulseEnergy = Math.max(0, this.pulseEnergy - seconds * 3);
    this.completionRemaining = Math.max(0, this.completionRemaining - seconds);
    this.pulseUniform.value = this.pulseEnergy;
    this.group.visible = active || this.completionRemaining > 0;
    this.dome.visible = this.groundRing.visible = this.plantedWeapon.visible = active;
    for (const rune of this.runes) rune.visible = active;
    if (!this.group.visible) return;
    this.group.scale.setScalar(parentScale > 0 ? 1 / parentScale : 1);
    if (!reducedMotion) this.time += Math.max(0, dt);

    const phase = reducedMotion ? 0.35 : this.time * 0.48;
    this.dome.scale.setScalar(1);
    this.dome.material.opacity =
      (reducedMotion ? 0.13 : 0.11 + Math.sin(this.time * 2.2) * 0.025) + this.pulseEnergy * 0.055;
    this.groundRing.rotation.z = phase * 0.35;
    this.sun.scale.setScalar(reducedMotion ? 1 : 1 + Math.sin(this.time * 5) * 0.08);
    this.sunHalo.material.rotation = -phase * 1.7;
    const finish = this.completionRemaining / 0.55;
    this.sunHalo.material.opacity = active ? 0.95 : finish;
    this.sun.material.opacity = active ? 0.92 : finish;
    this.sunHalo.scale.setScalar(
      active ? 2.4 + this.pulseEnergy * 0.7 : 2.4 + (1 - finish) * (reducedMotion ? 0 : 1.6),
    );
    this.plantedWeapon.rotation.y = phase * 0.3;

    for (let index = 0; index < this.runes.length; index++) {
      const angle = phase + (index / RUNE_COUNT) * TAU;
      const y = index % 2 === 0 ? 3.2 : 5.25;
      const horizontalRadius = Math.sqrt(
        Math.max(0, PALADIN_AEGIS_DOME_RADIUS * PALADIN_AEGIS_DOME_RADIUS - y * y),
      );
      const rune = this.runes[index];
      rune.position.set(Math.cos(angle) * horizontalRadius, y, Math.sin(angle) * horizontalRadius);
      rune.material.rotation = -angle + phase * 0.4;
    }
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
    for (const material of this.ownedMaterials) {
      try {
        material.dispose();
        this.ownedMaterials.delete(material);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, 'Aegis material cleanup failed');
  }
}

export function syncPaladinAegisVisual(
  visual: PaladinAegisVisual | null,
  parent: THREE.Group,
  active: boolean,
  dt: number,
  reducedMotion: boolean,
  parentScale = 1,
  scene?: THREE.Scene,
): PaladinAegisVisual | null {
  let current = visual;
  if (active && !current) {
    current = new PaladinAegisVisual();
    (scene ?? parent).add(current.group);
  }
  if (current && scene) {
    if (current.group.parent !== scene) scene.add(current.group);
    // Entity view groups are direct scene children; hidden rigs may have frozen matrices.
    current.group.position.copy(parent.position);
  }
  current?.update(active, dt, reducedMotion, scene ? 1 : parentScale);
  return current;
}

/** Claim identified Aegis cues before generic zone rehit/ring dispatch. */
export function routePaladinAegisCue(
  event: Extract<SimEvent, { type: 'spellfxAt' }>,
  views: ReadonlyMap<number, { group: THREE.Group; paladinAegisVisual: PaladinAegisVisual | null }>,
  scene: THREE.Scene,
  completed?: (sourceId: number) => void,
): boolean {
  if (event.ability !== 'aegis_first_dawn' || (event.fx !== 'tick' && event.fx !== 'burst'))
    return false;
  if (event.fx === 'burst' && event.sourceId !== undefined) completed?.(event.sourceId);
  const view = event.sourceId === undefined ? undefined : views.get(event.sourceId);
  if (view) {
    if (!view.paladinAegisVisual) {
      view.paladinAegisVisual = new PaladinAegisVisual();
      scene.add(view.paladinAegisVisual.group);
    }
    view.paladinAegisVisual.group.position.copy(view.group.position);
    view.paladinAegisVisual.pulse(event.fx === 'burst');
  }
  return true;
}
