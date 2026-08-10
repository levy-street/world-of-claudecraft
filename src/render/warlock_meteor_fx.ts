import * as THREE from 'three';
import { loadTexture } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import {
  felMeteorHash01 as hash01,
  planRainMeteorShower,
  type RainMeteorSchedule,
  type WarlockMeteorSpawn,
} from './warlock_meteor_fx_core';

export {
  routeWarlockMeteorSpellfxAt,
  type WarlockMeteorSink,
  type WarlockMeteorSpawn,
  warlockMeteorDensityScale,
} from './warlock_meteor_fx_core';

const FEL_CORE = 0xb9ff62;
const FEL_FLAME = 0x58ff26;
const FEL_DEEP = 0x123d12;
const FEL_SMOKE = 0x0a160b;
const MAX_ACTIVE_METEORS = 72;
const MAX_ACTIVE_IMPACTS = 48;
const MAX_COSMETIC_SHOWERS = 12;

export const POWERFUL_FEL_METEOR_TEXTURE_URL = '/vfx/fel_meteor_impact.png';

let powerfulFelMeteorTexture: THREE.Texture | null = null;
// Deferred, never eager: a module-import registerPreload joins the launch
// fetch burst and re-opens the WKWebView OOM lane the deferred gate exists
// to prevent (tests/defer_launcher_preloads.test.ts pins the sanctioned set).
registerDeferredPreload(() =>
  loadTexture(POWERFUL_FEL_METEOR_TEXTURE_URL, { srgb: true }).then((texture) => {
    powerfulFelMeteorTexture = texture;
    return texture;
  }),
);

export interface WarlockMeteorImpact {
  kind: 'rain' | 'infernal';
  x: number;
  z: number;
  radius: number;
  sourceId?: number;
}

interface ActiveMeteor {
  root: THREE.Group;
  body: THREE.Group;
  rock: THREE.Mesh<THREE.IcosahedronGeometry, THREE.MeshStandardMaterial>;
  start: THREE.Vector3;
  end: THREE.Vector3;
  delay: number;
  fallDuration: number;
  age: number;
  kind: WarlockMeteorImpact['kind'];
  impactRadius: number;
  eventRadius: number;
  sourceId?: number;
  materials: THREE.Material[];
  geometries: THREE.BufferGeometry[];
}

interface ActiveImpactRing {
  mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  material: THREE.MeshBasicMaterial;
}

interface ActiveImpact {
  root: THREE.Group;
  kind: WarlockMeteorImpact['kind'];
  age: number;
  duration: number;
  rings: ActiveImpactRing[];
  smoke: THREE.MeshBasicMaterial;
  sparks: THREE.Group;
  light?: THREE.PointLight;
  powerfulBurst: THREE.Sprite | null;
  materials: THREE.Material[];
  geometries: THREE.BufferGeometry[];
}

interface ActiveShower {
  root: THREE.Group;
  boundary: THREE.LineLoop<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  boundaryDisposed: boolean;
  pending: RainMeteorSchedule[];
  age: number;
  duration: number;
  sourceId?: number;
  cosmeticsEnabled: boolean;
}

function disposeMaterials(materials: readonly THREE.Material[]): void {
  for (const material of new Set(materials)) material.dispose();
}

export class WarlockMeteorFx {
  private readonly meteorGeometry = new THREE.IcosahedronGeometry(1, 1);
  private readonly coreGeometry = new THREE.SphereGeometry(0.72, 10, 7);
  private readonly trailGeometry = new THREE.ConeGeometry(0.42, 3.4, 8, 1, true);
  private readonly sparkGeometry = new THREE.TetrahedronGeometry(0.11, 0);
  private readonly smokeGeometry = new THREE.SphereGeometry(0.42, 8, 6);
  private readonly ringGeometry = new THREE.RingGeometry(0.72, 1, 48);
  private readonly rainRockMaterial = new THREE.MeshStandardMaterial({
    color: FEL_DEEP,
    emissive: FEL_FLAME,
    emissiveIntensity: 3.7,
    roughness: 0.72,
    metalness: 0.08,
  });
  private readonly infernalRockMaterial = new THREE.MeshStandardMaterial({
    color: FEL_DEEP,
    emissive: FEL_FLAME,
    emissiveIntensity: 5.8,
    roughness: 0.72,
    metalness: 0.08,
  });
  private readonly coreMaterial = new THREE.MeshBasicMaterial({
    color: FEL_CORE,
    transparent: true,
    opacity: 0.86,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  private readonly trailMaterials = Array.from(
    { length: 5 },
    (_, index) =>
      new THREE.MeshBasicMaterial({
        color: index === 0 ? FEL_CORE : FEL_FLAME,
        transparent: true,
        opacity: Math.max(0.18, 0.72 - index * 0.1),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
  );
  private readonly meteors: ActiveMeteor[] = [];
  private readonly impacts: ActiveImpact[] = [];
  private readonly showers: ActiveShower[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly heightAt: (x: number, z: number) => number,
    private readonly onImpact: (impact: WarlockMeteorImpact) => void,
    private readonly powerfulImpactTexture: THREE.Texture | null = powerfulFelMeteorTexture,
  ) {}

  spawnRain(spawn: WarlockMeteorSpawn): void {
    const root = new THREE.Group();
    root.name = 'warlock-fel-meteor-rain';
    this.scene.add(root);

    const boundary = this.createDrapedTelegraph(
      'warlock-fel-rain-boundary',
      spawn.x,
      spawn.z,
      spawn.radius,
      0.22,
    );
    root.add(boundary);

    const plan = planRainMeteorShower(spawn);
    root.userData.fragmentCount = plan.count;
    root.userData.sourceId = spawn.sourceId;
    root.userData.cosmeticsEnabled = true;
    this.showers.push({
      root,
      boundary,
      boundaryDisposed: false,
      pending: plan.pending,
      age: 0,
      duration: plan.duration,
      sourceId: spawn.sourceId,
      cosmeticsEnabled: true,
    });
    this.trimCosmeticShowers();
  }

  stopRain(sourceId: number): void {
    for (let index = this.showers.length - 1; index >= 0; index--) {
      if (this.showers[index].sourceId !== sourceId) continue;
      this.disposeShower(this.showers[index]);
      this.showers.splice(index, 1);
    }
  }

  spawnInfernal(spawn: WarlockMeteorSpawn): void {
    const root = this.addMeteor({
      parent: this.scene,
      name: 'warlock-fel-infernal-meteor',
      kind: 'infernal',
      x: spawn.x,
      z: spawn.z,
      delay: 0,
      fallDuration: Math.max(0.1, spawn.duration),
      rockScale: 1.28,
      impactRadius: Math.max(2.4, spawn.radius * 0.56),
      eventRadius: spawn.radius,
      sourceId: spawn.sourceId,
      seed: (spawn.sourceId ?? 1) * 29 + Math.round(spawn.x * 13 + spawn.z * 23),
    });

    const telegraph = this.createDrapedTelegraph(
      'warlock-fel-infernal-telegraph',
      spawn.x,
      spawn.z,
      spawn.radius,
      0.38,
    );
    root.add(telegraph);
    const active = this.meteors[this.meteors.length - 1];
    active.materials.push(telegraph.material);
    active.geometries.push(telegraph.geometry);
    this.trimMeteorPool();
  }

  update(dt: number, reducedMotion = false): void {
    const step = Math.max(0, dt);
    this.updateImpacts(step, reducedMotion);
    this.updateShowers(step, reducedMotion);

    for (let index = this.meteors.length - 1; index >= 0; index--) {
      const meteor = this.meteors[index];
      meteor.age += step;
      if (meteor.age < meteor.delay) {
        meteor.root.visible = false;
        continue;
      }
      meteor.root.visible = true;
      const elapsed = meteor.age - meteor.delay;
      const progress = Math.min(1, elapsed / meteor.fallDuration);
      const eased = 1 - (1 - progress) ** 2.35;
      meteor.body.position.lerpVectors(meteor.start, meteor.end, eased);
      if (!reducedMotion) {
        meteor.rock.rotation.x += step * (meteor.kind === 'infernal' ? 3.8 : 7.2);
        meteor.rock.rotation.z += step * (meteor.kind === 'infernal' ? 2.5 : 5.4);
        const pressure = 0.82 + Math.sin(progress * Math.PI * 8) * 0.12;
        meteor.body.scale.setScalar(pressure);
      } else {
        meteor.body.scale.setScalar(1);
      }
      if (progress < 1) continue;

      this.spawnImpact({
        kind: meteor.kind,
        x: meteor.end.x,
        z: meteor.end.z,
        radius: meteor.impactRadius,
        sourceId: meteor.sourceId,
      });
      this.onImpact({
        kind: meteor.kind,
        x: meteor.end.x,
        z: meteor.end.z,
        radius: meteor.eventRadius,
        sourceId: meteor.sourceId,
      });
      meteor.root.removeFromParent();
      disposeMaterials(meteor.materials);
      for (const geometry of meteor.geometries) geometry.dispose();
      this.meteors.splice(index, 1);
    }
  }

  dispose(): void {
    for (const meteor of this.meteors) {
      meteor.root.removeFromParent();
      disposeMaterials(meteor.materials);
      for (const geometry of meteor.geometries) geometry.dispose();
    }
    for (const impact of this.impacts) this.disposeImpact(impact);
    for (const shower of this.showers) this.disposeShower(shower);
    this.meteors.length = 0;
    this.impacts.length = 0;
    this.showers.length = 0;
    this.meteorGeometry.dispose();
    this.coreGeometry.dispose();
    this.trailGeometry.dispose();
    this.sparkGeometry.dispose();
    this.smokeGeometry.dispose();
    this.ringGeometry.dispose();
    this.rainRockMaterial.dispose();
    this.infernalRockMaterial.dispose();
    this.coreMaterial.dispose();
    disposeMaterials(this.trailMaterials);
  }

  private addMeteor(options: {
    parent: THREE.Object3D;
    name: string;
    kind: WarlockMeteorImpact['kind'];
    x: number;
    z: number;
    delay: number;
    fallDuration: number;
    rockScale: number;
    impactRadius: number;
    eventRadius: number;
    sourceId?: number;
    seed: number;
  }): THREE.Group {
    const root = new THREE.Group();
    root.name = options.name;
    options.parent.add(root);

    const body = new THREE.Group();
    body.name = 'warlock-fel-meteor-body';
    root.add(body);

    const rockMaterial =
      options.kind === 'infernal' ? this.infernalRockMaterial : this.rainRockMaterial;
    const rock = new THREE.Mesh(this.meteorGeometry, rockMaterial);
    rock.name = 'warlock-fel-meteor-rock';
    rock.scale.set(options.rockScale * 0.82, options.rockScale * 1.16, options.rockScale);
    body.add(rock);

    const core = new THREE.Mesh(this.coreGeometry, this.coreMaterial);
    core.name = 'warlock-fel-meteor-core';
    core.scale.setScalar(options.rockScale * 0.72);
    body.add(core);

    const trail = new THREE.Group();
    trail.name = 'warlock-fel-meteor-trail';
    body.add(trail);
    const materials: THREE.Material[] = [];
    const trailCount = options.kind === 'infernal' ? 5 : 3;
    for (let index = 0; index < trailCount; index++) {
      const trailMaterial = this.trailMaterials[index];
      const tongue = new THREE.Mesh(this.trailGeometry, trailMaterial);
      const sway = hash01(options.seed + index * 3.7) - 0.5;
      tongue.position.set(sway * options.rockScale, 1.5 + index * 0.55, -sway * 0.5);
      tongue.scale.setScalar(options.rockScale * (1 - index * 0.08));
      trail.add(tongue);
    }

    const groundY = this.heightAt(options.x, options.z);
    const sideX = (hash01(options.seed + 31) - 0.5) * 12;
    const sideZ = (hash01(options.seed + 53) - 0.5) * 12;
    const end = new THREE.Vector3(options.x, groundY + 0.32, options.z);
    const start = new THREE.Vector3(
      options.x + sideX,
      groundY + 20 + options.rockScale * 5,
      options.z + sideZ,
    );
    body.position.copy(start);

    if (options.kind === 'infernal') {
      const light = new THREE.PointLight(FEL_FLAME, 9, 26, 1.7);
      light.name = 'warlock-fel-meteor-light';
      body.add(light);
    }

    this.meteors.push({
      root,
      body,
      rock,
      start,
      end,
      delay: options.delay,
      fallDuration: options.fallDuration,
      age: 0,
      kind: options.kind,
      impactRadius: options.impactRadius,
      eventRadius: options.eventRadius,
      sourceId: options.sourceId,
      materials,
      geometries: [],
    });
    root.visible = options.delay === 0;
    return root;
  }

  private spawnImpact(impact: WarlockMeteorImpact): void {
    const root = new THREE.Group();
    root.name = 'warlock-fel-meteor-impact';
    root.position.set(impact.x, this.heightAt(impact.x, impact.z) + 0.12, impact.z);
    root.scale.setScalar(impact.radius);
    this.scene.add(root);

    const materials: THREE.Material[] = [];
    const rings: ActiveImpactRing[] = [];
    let powerfulBurst: THREE.Sprite | null = null;
    if (this.powerfulImpactTexture) {
      const powerfulMaterial = new THREE.SpriteMaterial({
        map: this.powerfulImpactTexture,
        color: FEL_CORE,
        transparent: true,
        opacity: impact.kind === 'infernal' ? 1 : 0.82,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      powerfulBurst = new THREE.Sprite(powerfulMaterial);
      powerfulBurst.name = 'warlock-powerful-fel-impact';
      powerfulBurst.position.y = impact.kind === 'infernal' ? 0.58 : 0.34;
      powerfulBurst.scale.setScalar(impact.kind === 'infernal' ? 1.8 : 1.25);
      root.add(powerfulBurst);
      materials.push(powerfulMaterial);
    }
    for (let index = 0; index < 3; index++) {
      const material = new THREE.MeshBasicMaterial({
        color: index === 1 ? FEL_CORE : FEL_FLAME,
        transparent: true,
        opacity: 0.72 - index * 0.12,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(this.ringGeometry, material);
      ring.name = `warlock-fel-impact-ring-${index}`;
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = index * 0.05;
      ring.scale.setScalar(0.12 + index * 0.08);
      root.add(ring);
      materials.push(material);
      rings.push({ mesh: ring, material });
    }

    const fissureMaterial = new THREE.LineBasicMaterial({
      color: FEL_CORE,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const fissurePoints: THREE.Vector3[] = [];
    const fissureCount = impact.kind === 'infernal' ? 12 : 5;
    for (let index = 0; index < fissureCount; index++) {
      const angle = (index / fissureCount) * Math.PI * 2 + hash01(index + impact.x) * 0.22;
      fissurePoints.push(new THREE.Vector3(Math.cos(angle) * 0.08, 0.02, Math.sin(angle) * 0.08));
      fissurePoints.push(
        new THREE.Vector3(
          Math.cos(angle) * (0.55 + hash01(index + impact.z) * 0.32),
          0.02,
          Math.sin(angle) * (0.55 + hash01(index + impact.z) * 0.32),
        ),
      );
    }
    const fissureGeometry = new THREE.BufferGeometry().setFromPoints(fissurePoints);
    const fissures = new THREE.LineSegments(fissureGeometry, fissureMaterial);
    fissures.name = 'warlock-fel-impact-fissures';
    root.add(fissures);
    materials.push(fissureMaterial);

    const smokeMaterial = new THREE.MeshBasicMaterial({
      color: FEL_SMOKE,
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
    });
    const smokeCount = impact.kind === 'infernal' ? 9 : 3;
    for (let index = 0; index < smokeCount; index++) {
      const puff = new THREE.Mesh(this.smokeGeometry, smokeMaterial);
      const angle = (index / smokeCount) * Math.PI * 2;
      puff.position.set(Math.cos(angle) * 0.28, 0.18 + (index % 3) * 0.12, Math.sin(angle) * 0.28);
      puff.scale.setScalar(0.45 + (index % 2) * 0.2);
      root.add(puff);
    }
    materials.push(smokeMaterial);

    const sparkMaterial = new THREE.MeshBasicMaterial({
      color: FEL_CORE,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const sparks = new THREE.Group();
    sparks.name = 'warlock-fel-impact-sparks';
    const sparkCount = impact.kind === 'infernal' ? 26 : 9;
    for (let index = 0; index < sparkCount; index++) {
      const spark = new THREE.Mesh(this.sparkGeometry, sparkMaterial);
      const angle = (index / sparkCount) * Math.PI * 2 + hash01(index + impact.z * 3) * 0.18;
      const speed = 0.45 + hash01(index + impact.x * 5) * 0.65;
      spark.userData.velocity = new THREE.Vector3(
        Math.cos(angle) * speed,
        0.65 + hash01(index + 77) * 0.9,
        Math.sin(angle) * speed,
      );
      sparks.add(spark);
    }
    root.add(sparks);
    materials.push(sparkMaterial);

    const light =
      impact.kind === 'infernal' ? new THREE.PointLight(FEL_FLAME, 14, 28, 1.5) : undefined;
    if (light) {
      light.position.y = 0.8;
      root.add(light);
    }

    this.impacts.push({
      root,
      kind: impact.kind,
      age: 0,
      duration: impact.kind === 'infernal' ? 1.55 : 0.72,
      rings,
      smoke: smokeMaterial,
      sparks,
      light,
      powerfulBurst,
      materials,
      geometries: [fissureGeometry],
    });
    this.trimImpactPool();
  }

  private updateImpacts(dt: number, reducedMotion: boolean): void {
    for (let index = this.impacts.length - 1; index >= 0; index--) {
      const impact = this.impacts[index];
      impact.age += dt;
      const progress = Math.min(1, impact.age / impact.duration);
      const powerfulBurst = impact.powerfulBurst;
      if (powerfulBurst) {
        const baseScale = impact.kind === 'infernal' ? 1.8 : 1.25;
        powerfulBurst.scale.setScalar(
          reducedMotion ? baseScale : baseScale * (0.72 + progress * 0.52),
        );
        powerfulBurst.material.opacity = (impact.kind === 'infernal' ? 1 : 0.82) * (1 - progress);
        if (!reducedMotion) powerfulBurst.material.rotation += dt * 0.7;
      }
      for (let ringIndex = 0; ringIndex < impact.rings.length; ringIndex++) {
        const ring = impact.rings[ringIndex];
        ring.mesh.scale.setScalar(
          reducedMotion ? 0.72 + ringIndex * 0.13 : 0.12 + progress * (0.72 + ringIndex * 0.13),
        );
        ring.material.opacity = (0.72 - ringIndex * 0.12) * (1 - progress);
      }
      impact.smoke.opacity = 0.58 * (1 - progress);
      if (impact.light) impact.light.intensity *= Math.max(0, 1 - dt * 5);
      if (!reducedMotion) {
        for (const child of impact.sparks.children) {
          const velocity = child.userData.velocity as THREE.Vector3;
          child.position.addScaledVector(velocity, dt);
          velocity.y -= dt * 1.8;
        }
      }
      if (progress < 1) continue;
      this.disposeImpact(impact);
      this.impacts.splice(index, 1);
    }
  }

  private updateShowers(dt: number, reducedMotion: boolean): void {
    for (let index = this.showers.length - 1; index >= 0; index--) {
      const shower = this.showers[index];
      shower.age += dt;
      const progress = Math.min(1, shower.age / shower.duration);
      while (shower.pending.length > 0 && shower.pending[0].at <= shower.age) {
        const pending = shower.pending.shift();
        if (!pending) break;
        this.addMeteor({
          parent: shower.root,
          name: 'warlock-fel-meteor-fragment',
          kind: 'rain',
          x: pending.x,
          z: pending.z,
          delay: 0,
          fallDuration: pending.fallDuration,
          rockScale: pending.rockScale,
          impactRadius: pending.impactRadius,
          eventRadius: pending.eventRadius,
          sourceId: pending.sourceId,
          seed: pending.seed,
        });
        this.trimMeteorPool();
      }
      if (!shower.boundaryDisposed && progress < 1) {
        shower.boundary.material.opacity = reducedMotion
          ? 0.18
          : 0.12 + Math.sin(progress * Math.PI * 12) * 0.06;
        if (!reducedMotion) shower.boundary.rotation.z += dt * 0.18;
      } else if (!shower.boundaryDisposed) {
        shower.boundary.removeFromParent();
        shower.boundary.material.dispose();
        shower.boundary.geometry.dispose();
        shower.boundaryDisposed = true;
      }
      const hasFragments = shower.root.children.some(
        (child) => child.name === 'warlock-fel-meteor-fragment',
      );
      if (progress < 1 || hasFragments || shower.pending.length > 0) continue;
      this.disposeShower(shower);
      this.showers.splice(index, 1);
    }
  }

  private createDrapedTelegraph(
    name: string,
    x: number,
    z: number,
    radius: number,
    opacity: number,
  ): THREE.LineLoop<THREE.BufferGeometry, THREE.LineBasicMaterial> {
    const points: THREE.Vector3[] = [];
    for (let index = 0; index < 64; index++) {
      const angle = (index / 64) * Math.PI * 2;
      const pointX = x + Math.cos(angle) * radius;
      const pointZ = z + Math.sin(angle) * radius;
      points.push(new THREE.Vector3(pointX, this.heightAt(pointX, pointZ) + 0.09, pointZ));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: FEL_FLAME,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const telegraph = new THREE.LineLoop(geometry, material);
    telegraph.name = name;
    return telegraph;
  }

  private trimMeteorPool(): void {
    while (this.meteors.length > MAX_ACTIVE_METEORS) {
      const rainIndex = this.meteors.findIndex((meteor) => meteor.kind === 'rain');
      if (rainIndex < 0) return;
      const [meteor] = this.meteors.splice(rainIndex, 1);
      meteor.root.removeFromParent();
      disposeMaterials(meteor.materials);
      for (const geometry of meteor.geometries) geometry.dispose();
    }
  }

  private trimImpactPool(): void {
    while (this.impacts.length > MAX_ACTIVE_IMPACTS) {
      const rainIndex = this.impacts.findIndex((impact) => impact.kind === 'rain');
      const index = rainIndex >= 0 ? rainIndex : 0;
      const [impact] = this.impacts.splice(index, 1);
      this.disposeImpact(impact);
    }
  }

  private trimCosmeticShowers(): void {
    let cosmeticCount = this.showers.filter((shower) => shower.cosmeticsEnabled).length;
    for (const shower of this.showers) {
      if (cosmeticCount <= MAX_COSMETIC_SHOWERS) return;
      if (!shower.cosmeticsEnabled) continue;
      this.disposeShowerCosmetics(shower);
      cosmeticCount--;
    }
  }

  private disposeShowerCosmetics(shower: ActiveShower): void {
    for (let index = this.meteors.length - 1; index >= 0; index--) {
      const meteor = this.meteors[index];
      if (meteor.kind !== 'rain' || meteor.root.parent !== shower.root) continue;
      meteor.root.removeFromParent();
      disposeMaterials(meteor.materials);
      for (const geometry of meteor.geometries) geometry.dispose();
      this.meteors.splice(index, 1);
    }
    shower.pending.length = 0;
    shower.cosmeticsEnabled = false;
    shower.root.userData.cosmeticsEnabled = false;
  }

  private disposeShower(shower: ActiveShower): void {
    this.disposeShowerCosmetics(shower);
    shower.root.removeFromParent();
    if (shower.boundaryDisposed) return;
    shower.boundary.removeFromParent();
    shower.boundary.material.dispose();
    shower.boundary.geometry.dispose();
    shower.boundaryDisposed = true;
  }

  private disposeImpact(impact: ActiveImpact): void {
    impact.root.removeFromParent();
    disposeMaterials(impact.materials);
    for (const geometry of impact.geometries) geometry.dispose();
  }
}
