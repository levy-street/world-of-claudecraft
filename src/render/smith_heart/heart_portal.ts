// The Smith's Heart's portals (heart_portal_core.ts plans them):
//   - on the Seal Dais: the opening's one-shot burst (the tines' arcs, the
//     flash pillar, the shockwave racing out across the chasm to the Ring)
//     and then the living portal (the floor vortex in the four colours, the
//     funnel of light standing over it, the motes riding up it, the tines'
//     arcs feeding it);
//   - in the Heart: the return portal on the Arrival Terrace (a smaller
//     vortex and funnel, always open: the Heart is only ever reached through
//     the open seal);
//   - the hop: an arrival burst at the landing (a column, a floor ring and
//     the four colours whirling up round the arrival) and a brief white-gold
//     wash over the view.
// Every material here is built with the interior (the compile gate links it,
// hidden or not) and belongs to this slot; the frame driver writes uniforms
// only while a value moves. The vortex, funnel and bursts draw on every tier;
// the motes thin on the low tier (cosmetic).

import * as THREE from 'three';
import {
  HEART_RETURN_PORTAL,
  HEART_SEAL,
  HEART_TERRACE,
  RING_SPIRE_BEARINGS,
  SEAL_DAIS,
} from '../../sim/content/smith_heart_layout';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { markSharedGeometry } from '../shared_resource';
import {
  heartBeamMaterial,
  heartFunnelMaterial,
  heartMoteGeometry,
  heartMoteMaterial,
  heartRingMaterial,
  heartVortexMaterial,
} from './heart_fx_materials';
import {
  HEART_PORTAL_RING_REACH,
  HEART_PORTAL_SIZE,
  HEART_PORTAL_SKY_BEAM,
  HEART_RETURN_SIZE,
  type HeartHopStage,
  type HeartPortalStage,
  heartHopSpot,
  heartPortalMoteCount,
} from './heart_portal_core';

const WHITE_GOLD = 0xfff0d0;
/** Where the spires' crystal tips stand (bearing, radius, height over the
 *  dais): each leans 3.2 yd in over its 16 (the Ring kit's Kit_SealSpire). */
const TINE_TIPS = RING_SPIRE_BEARINGS.map((deg) => {
  const a = (deg * Math.PI) / 180;
  return { x: Math.sin(a) * 12.3, z: Math.cos(a) * 12.3, y: 16 };
});
/** Where the arcs meet over the seal (height over the dais). */
const ARC_EYE_Y = 9;

let discGeometry: THREE.BufferGeometry | null = null;

function disc(): THREE.BufferGeometry {
  discGeometry ??= markSharedGeometry(new THREE.CircleGeometry(1, 96).rotateX(-Math.PI / 2));
  return discGeometry;
}

/** An open sleeve, its uv.y running foot (0) to top (1). */
function sleeve(foot: number, top: number, height: number, radial = 28): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(top, foot, height, radial, 6, true).translate(0, height / 2, 0);
}

/** A flat disc of radius `r` on the floor ladder's order `order`. */
function floorDisc(material: THREE.Material, r: number, order: number): THREE.Mesh {
  const m = new THREE.Mesh(disc(), material);
  m.scale.set(r, 1, r);
  m.renderOrder = order;
  return m;
}

/** A beam from `a` to `b` on a unit sleeve (uv.y 0 at `a`). */
function beamBetween(
  a: THREE.Vector3,
  b: THREE.Vector3,
  radius: number,
  material: THREE.Material,
): THREE.Mesh {
  const len = a.distanceTo(b);
  const g = sleeve(radius, radius * 0.6, len, 10);
  const m = new THREE.Mesh(g, material);
  m.position.copy(a);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}

interface Rig {
  vortex: THREE.ShaderMaterial;
  funnel: THREE.ShaderMaterial;
  motes: THREE.ShaderMaterial;
}

/** A vortex, a funnel and its motes at (x, y, z). */
function portalRig(
  group: THREE.Group,
  name: string,
  at: { x: number; y: number; z: number },
  size: { vortexR: number; funnelHeight: number; funnelFoot: number; funnelTop: number },
  moteCount: number,
): Rig {
  const vortex = heartVortexMaterial(`smithHeartVortex:${name}`);
  const floor = floorDisc(vortex, size.vortexR, floorVfxRenderOrder('ground', 6));
  floor.position.set(at.x, at.y + 0.09, at.z);
  floor.name = `portalVortex:${name}`;
  group.add(floor);
  const funnel = heartFunnelMaterial(`smithHeartFunnel:${name}`);
  const sleeveMesh = new THREE.Mesh(
    sleeve(size.funnelFoot, size.funnelTop, size.funnelHeight),
    funnel,
  );
  sleeveMesh.position.set(at.x, at.y, at.z);
  sleeveMesh.name = `portalFunnel:${name}`;
  group.add(sleeveMesh);
  const motes = heartMoteMaterial(`smithHeartPortalMotes:${name}`, {
    radius: size.funnelTop,
    height: size.funnelHeight * 1.15,
    size: 0.9,
    spin: 1.4,
  });
  const points = new THREE.Points(heartMoteGeometry(moteCount), motes);
  points.position.set(at.x, at.y, at.z);
  points.name = `portalMotes:${name}`;
  group.add(points);
  return { vortex, funnel, motes };
}

interface HopRig {
  column: THREE.ShaderMaterial;
  ring: THREE.ShaderMaterial;
  /** The four colours' swirl round the arrival (phase 2F). */
  swirl: THREE.ShaderMaterial;
  meshes: THREE.Object3D[];
}

function hopRig(group: THREE.Group, side: 'heart' | 'ring', y: number): HopRig {
  const at = heartHopSpot(side);
  const column = heartBeamMaterial(WHITE_GOLD, `smithHeartHopColumn:${side}`);
  const c = new THREE.Mesh(sleeve(3, 1.2, 34, 20), column);
  c.position.set(at.x, y, at.z);
  c.name = `hopColumn:${side}`;
  const ring = heartRingMaterial(`smithHeartHopRing:${side}`);
  const r = floorDisc(ring, 16, floorVfxRenderOrder('ground', 7));
  r.position.set(at.x, y + 0.11, at.z);
  r.name = `hopRing:${side}`;
  // The four colours whirling up round whoever arrives (a short wide
  // sleeve, fading with the column).
  const swirl = heartFunnelMaterial(`smithHeartHopSwirl:${side}`);
  const w = new THREE.Mesh(sleeve(2.4, 7, 16, 32), swirl);
  w.position.set(at.x, y, at.z);
  w.name = `hopSwirl:${side}`;
  group.add(c, r, w);
  c.visible = false;
  r.visible = false;
  w.visible = false;
  return { column, ring, swirl, meshes: [c, r, w] };
}

export interface HeartPortals {
  group: THREE.Group;
  /** Advance to the seal portal's opening stage and the hop's burst. */
  update(portal: HeartPortalStage, hop: HeartHopStage, hopSide: 'heart' | 'ring' | null): void;
  /** Place the view wash at the camera (instance-local) at `k` (0 to 1). */
  wash(k: number, camera: { x: number; y: number; z: number }): void;
}

/** Every portal piece of one slot (instance-local). */
export function buildHeartPortals(
  lowGfx: boolean,
  ground: (x: number, z: number) => number,
): HeartPortals {
  const group = new THREE.Group();
  group.name = 'smithHeartPortals';
  const y = SEAL_DAIS.h;
  const seal = { x: HEART_SEAL.x, y, z: HEART_SEAL.z };
  const moteCount = heartPortalMoteCount(lowGfx);

  // ---- the Ring's portal ------------------------------------------------------------
  const live = portalRig(group, 'seal', seal, HEART_PORTAL_SIZE, moteCount);
  const liveMeshes = group.children.slice();
  for (const m of liveMeshes) m.visible = false;

  // The tines' arcs: from each tip to the eye over the seal.
  const arcMat = heartBeamMaterial(WHITE_GOLD, 'smithHeartTineArc', -1.6);
  const eye = new THREE.Vector3(seal.x, y + ARC_EYE_Y, seal.z);
  const arcs = TINE_TIPS.map((t) => {
    const m = beamBetween(
      new THREE.Vector3(seal.x + t.x, y + t.y, seal.z + t.z),
      eye,
      0.35,
      arcMat,
    );
    m.name = 'tineArc';
    m.visible = false;
    group.add(m);
    return m;
  });

  // The opening: the flash pillar and the shockwave (inner on the dais, outer
  // at the Ring's level, racing across the chasm).
  const flashMat = heartBeamMaterial(WHITE_GOLD, 'smithHeartPortalFlash');
  const flash = new THREE.Mesh(sleeve(9, 3, 110, 32), flashMat);
  flash.position.set(seal.x, y, seal.z);
  flash.name = 'portalFlash';
  flash.visible = false;
  // The bloom round it: a wide, short sleeve of the four colours' heat.
  const bloomMat = heartFunnelMaterial('smithHeartPortalBloom');
  const bloom = new THREE.Mesh(sleeve(17, 24, 46, 40), bloomMat);
  bloom.position.set(seal.x, y, seal.z);
  bloom.name = 'portalBloom';
  bloom.visible = false;
  // The beam to the sky (phase 2F): a white-gold shaft standing up out of
  // the seal past the storm, blinding through the burst, then a thin living
  // beam over the open portal for good (it marks the way from the whole
  // main map).
  const skyMat = heartBeamMaterial(WHITE_GOLD, 'smithHeartPortalSkyBeam', 2.2);
  const skyBeam = new THREE.Mesh(sleeve(2.6, 1.3, HEART_PORTAL_SKY_BEAM, 18), skyMat);
  skyBeam.position.set(seal.x, y, seal.z);
  skyBeam.name = 'portalSkyBeam';
  skyBeam.visible = false;
  group.add(flash, bloom, skyBeam);
  const innerRingMat = heartRingMaterial('smithHeartPortalRingInner');
  const innerRing = floorDisc(innerRingMat, SEAL_DAIS.r, floorVfxRenderOrder('ground', 7));
  innerRing.position.set(seal.x, y + 0.12, seal.z);
  innerRing.visible = false;
  const outerRingMat = heartRingMaterial('smithHeartPortalRingOuter');
  const outerRing = floorDisc(
    outerRingMat,
    HEART_PORTAL_RING_REACH,
    floorVfxRenderOrder('ground', 7),
  );
  outerRing.position.set(seal.x, 0.14, seal.z);
  outerRing.visible = false;
  group.add(innerRing, outerRing);
  // The wall of light riding the wave across the Ring (a short sleeve
  // scaled to the wave's reach).
  const curtainMat = heartFunnelMaterial('smithHeartPortalCurtain');
  const curtain = new THREE.Mesh(sleeve(1, 1, 1, 64), curtainMat);
  curtain.position.set(seal.x, -1.5, seal.z);
  curtain.name = 'portalCurtain';
  curtain.visible = false;
  group.add(curtain);
  // The living portal's outer sleeve: a slower, wider turn of the four
  // colours round the funnel (it gives the open portal its volume).
  const outerMat = heartFunnelMaterial('smithHeartPortalOuterFunnel');
  const outerFunnel = new THREE.Mesh(sleeve(7.5, 15, 36, 40), outerMat);
  outerFunnel.position.set(seal.x, y, seal.z);
  outerFunnel.name = 'portalOuterFunnel';
  outerFunnel.visible = false;
  outerFunnel.rotation.y = Math.PI / 4;
  group.add(outerFunnel);

  // ---- the Heart's return portal (always open) ---------------------------------------
  const retY = ground(HEART_RETURN_PORTAL.x, HEART_RETURN_PORTAL.z);
  const ret = portalRig(
    group,
    'return',
    { x: HEART_RETURN_PORTAL.x, y: retY, z: HEART_RETURN_PORTAL.z },
    HEART_RETURN_SIZE,
    Math.round(moteCount / 3),
  );
  ret.vortex.uniforms.uK.value = 1;
  ret.vortex.uniforms.uSpin.value = -1.2;
  ret.funnel.uniforms.uK.value = 0.85;
  ret.motes.uniforms.uK.value = 1;

  // ---- the hop ----------------------------------------------------------------------
  const hops = {
    heart: hopRig(group, 'heart', HEART_TERRACE.h),
    ring: hopRig(group, 'ring', y),
  };
  const washMat = new THREE.MeshBasicMaterial({
    name: 'smithHeartHopWash',
    color: WHITE_GOLD,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    side: THREE.BackSide,
    fog: false,
  });
  const wash = new THREE.Mesh(new THREE.SphereGeometry(2.5, 16, 12), washMat);
  wash.name = 'hopWash';
  wash.visible = false;
  wash.frustumCulled = false;
  group.add(wash);

  let lastSwirl = -1;
  let lastSky = -1;
  let lastFlash = -1;
  let lastRing = -1;
  let lastCharge = -1;
  let lastHop = -1;
  return {
    group,
    update(portal, hop, hopSide) {
      // The living portal grows out of the parted seal.
      const swirl = Math.round(portal.swirl * 100) / 100;
      if (swirl !== lastSwirl) {
        lastSwirl = swirl;
        for (const m of liveMeshes) m.visible = swirl > 0;
        live.vortex.uniforms.uK.value = swirl;
        live.funnel.uniforms.uK.value = swirl;
        live.motes.uniforms.uK.value = swirl;
        outerFunnel.visible = swirl > 0;
        outerMat.uniforms.uK.value = swirl * 0.45;
      }
      // The tines' arcs: blazing through the charge, then a steady feed.
      const charge = Math.round(Math.max(portal.charge, swirl * 0.35) * 100) / 100;
      if (charge !== lastCharge) {
        lastCharge = charge;
        for (const a of arcs) a.visible = charge > 0;
        arcMat.uniforms.uK.value = charge * 2.2;
      }
      const f = Math.round(portal.flash * 100) / 100;
      if (f !== lastFlash || swirl !== lastSky) {
        lastFlash = f;
        lastSky = swirl;
        flash.visible = f > 0;
        flashMat.uniforms.uK.value = f * 4;
        bloom.visible = f > 0;
        bloomMat.uniforms.uK.value = f * 1.6;
        // The sky beam: the burst's flash, then a steady thin shaft.
        const sky = Math.max(f * 5, swirl * 0.55);
        skyBeam.visible = sky > 0;
        skyMat.uniforms.uK.value = sky;
        skyBeam.scale.set(1 + f * 2.2, 1, 1 + f * 2.2);
      }
      const ring = Math.round(portal.ring * 400) / 400;
      if (ring !== lastRing) {
        lastRing = ring;
        const reach = ring * HEART_PORTAL_RING_REACH;
        const k = ring > 0 ? 3.6 : 0;
        innerRing.visible = ring > 0 && reach < SEAL_DAIS.r + 2;
        innerRingMat.uniforms.uR.value = reach / SEAL_DAIS.r;
        innerRingMat.uniforms.uK.value = k;
        outerRing.visible = ring > 0 && reach > SEAL_DAIS.r - 2;
        outerRingMat.uniforms.uR.value = ring;
        outerRingMat.uniforms.uK.value = k;
        // The wall of light rides the wave out past the dais, fading.
        curtain.visible = ring > 0 && reach > SEAL_DAIS.r;
        curtain.scale.set(reach, 6 * (1 - ring * 0.5), reach);
        curtainMat.uniforms.uK.value = ring > 0 ? 1.4 * (1 - ring) : 0;
      }
      // The hop's arrival burst.
      const h = Math.round(hop.column * 100) / 100 + Math.round(hop.ring * 100) / 1000;
      if (h !== lastHop) {
        lastHop = h;
        for (const side of ['heart', 'ring'] as const) {
          const rig = hops[side];
          const on = hopSide === side && (hop.column > 0 || hop.ring > 0);
          for (const m of rig.meshes) m.visible = on;
          rig.column.uniforms.uK.value = on ? hop.column * 2.6 : 0;
          rig.ring.uniforms.uR.value = on ? hop.ring : 0;
          rig.ring.uniforms.uK.value = on ? (1 - hop.ring) * 2.2 : 0;
          rig.swirl.uniforms.uK.value = on ? hop.column * 2.4 : 0;
        }
      }
    },
    wash(k, camera) {
      wash.visible = k > 0.01;
      if (!wash.visible) return;
      wash.position.set(camera.x, camera.y, camera.z);
      washMat.opacity = Math.min(0.6, k * 0.6);
    },
  };
}
