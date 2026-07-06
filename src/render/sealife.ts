import * as THREE from 'three';
import { MIRROR_LAYOUT } from '../sim/content/mirror_world';
import { zoneBiomeAt } from '../sim/world';

// Ambient spirits for the Mirror World — RENDER-ONLY decoration, no sim/IWorld
// state. Glowing orbs drift through the darkness outside the dome glass:
// unhurried wisps circling the city at different heights, each pulsing softly
// as it goes. Same contract as birds/motes/critters: a fixed pool,
// deterministic placement (mulberry32 off the world seed — the render
// convention forbids Math.random), hidden outside the mirror biome.

const SPIRIT_COUNT = 14;
const VISIBLE_RANGE = 320; // hide the whole group when the player is far away

export interface SealifeView {
  group: THREE.Group;
  update(px: number, pz: number, dt: number): void;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Spirit {
  core: THREE.Mesh;
  halo: THREE.Mesh;
  pathR: number;
  height: number; // base drift height above the void floor
  speed: number; // radians/second along the circle
  angle: number;
  bobPhase: number;
  pulsePhase: number;
}

export function buildSealife(seed: number): SealifeView {
  const group = new THREE.Group();
  group.visible = false;
  const rng = mulberry32((seed ^ 0x5ea11fe) >>> 0);
  const L = MIRROR_LAYOUT;

  // Two spirit hues: pale indigo wisps and colder white-blue ones. Additive
  // halos read as glow against the black plain without any light cost.
  const coreGeo = new THREE.IcosahedronGeometry(0.5, 1);
  const haloGeo = new THREE.SphereGeometry(1.0, 12, 10);
  const coreMats = [
    new THREE.MeshStandardMaterial({
      color: 0xcfd4ff,
      roughness: 0.4,
      emissive: 0x8f96e8,
      emissiveIntensity: 1.6,
    }),
    new THREE.MeshStandardMaterial({
      color: 0xd8f0f2,
      roughness: 0.4,
      emissive: 0x7fc4d0,
      emissiveIntensity: 1.4,
    }),
  ];
  const haloMats = coreMats.map(
    (m) =>
      new THREE.MeshBasicMaterial({
        color: m.emissive,
        transparent: true,
        opacity: 0.22,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
  );

  const spirits: Spirit[] = [];
  for (let i = 0; i < SPIRIT_COUNT; i++) {
    const kind = rng() < 0.65 ? 0 : 1;
    const core = new THREE.Mesh(coreGeo, coreMats[kind]);
    const halo = new THREE.Mesh(haloGeo, haloMats[kind]);
    const s = 0.7 + rng() * 0.9;
    core.scale.setScalar(s);
    halo.scale.setScalar(s * 2.1);
    group.add(core);
    group.add(halo);
    spirits.push({
      core,
      halo,
      pathR: L.lake.r + 6 + rng() * 40,
      height: 3 + rng() * 16, // some skim the murk, some ride high past the glass
      speed: (0.03 + rng() * 0.06) * (rng() < 0.5 ? 1 : -1),
      angle: rng() * Math.PI * 2,
      bobPhase: rng() * Math.PI * 2,
      pulsePhase: rng() * Math.PI * 2,
    });
  }

  function update(px: number, pz: number, dt: number): void {
    const near =
      zoneBiomeAt(pz) === 'mirror' && Math.hypot(px - L.lake.x, pz - L.lake.z) < VISIBLE_RANGE;
    group.visible = near;
    if (!near) return;
    for (const s of spirits) {
      s.angle += s.speed * dt;
      s.bobPhase += dt * 0.5;
      s.pulsePhase += dt * 1.7;
      const x = L.lake.x + Math.sin(s.angle) * s.pathR;
      const z = L.lake.z + Math.cos(s.angle) * s.pathR;
      const y = 2 + s.height + Math.sin(s.bobPhase) * 1.6;
      s.core.position.set(x, y, z);
      s.halo.position.set(x, y, z);
      // a slow breathing glow; the halo swells against the core's pulse
      const pulse = 0.85 + Math.sin(s.pulsePhase) * 0.15;
      s.halo.scale.setScalar(s.core.scale.x * 2.1 * pulse);
    }
  }

  return { group, update };
}
