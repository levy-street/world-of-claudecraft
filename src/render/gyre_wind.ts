// The Gyre's wind, drawn as air: translucent ribbons of white and pale blue that sweep up every
// gale lane in long S-curves (the way the wind blows, the way the climb runs) carrying orange
// leaves and white feathers, thin chevrons carved into the road where the wind passes over it,
// and at each launch pocket and wind pad a spiral of thin wisps twisting up out of a swirl of
// mist, so the climb reads from the plain below as a run with the air and each updraft as a door
// off the mountain. Presentation only: the lanes' speed and the launches are the sim's
// (src/sim/quartered_gyre_wind.ts, an aura; src/sim/quartered_gyre_pads.ts), the same on every
// graphics tier.
//
// Built once with the props. The props tree is matrix-static (renderer.ts freezeStaticMatrices),
// so nothing here writes an object transform: the streaming is texture offsets, the swirl is a
// texture rotation, and the leaves and feathers are instance matrices, which are data. The group
// is never hidden (three's frustum cull skips what is off screen and the fog takes the far ones, and
// a hidden group would miss the world-entry compile, which only collects visible objects). Every
// material is named for the fleet's program ledger. Reduced motion holds it all still.

import * as THREE from 'three';
import { hash2 } from '../sim/rng';
import {
  buildLaneRibbons,
  buildLaneStrands,
  buildPocketSpirals,
  buildStrandRibbons,
  buildWindMotes,
  type MotePose,
  motePose,
  padSpots,
  pocketSpots,
  type RibbonGeometry,
  type RibbonOptions,
  WIND_LANES,
} from './gyre_wind_core';
import { applyTextureAnisotropy } from './texture_anisotropy';

export interface GyreWindView {
  group: THREE.Group;
  /** Advance the wind by the frame's seconds. The camera's ground position and the fog's far
   *  distance (yards) let it sleep while the whole peak is out of sight. */
  update(dt: number, reducedMotion: boolean, camX: number, camZ: number, fogFar: number): void;
  /** Free what the view owns outright (geometry, materials, textures). Idempotent. */
  dispose(): void;
}

/** The carved chevrons: 3.4 yards wide on the 7-yard road, a hand over the paving, one
 *  texture repeat (two thin chevrons) every 8 yards of lane. */
const CHEVRONS: RibbonOptions = { width: 3.4, step: 1, lift: 0.14, tile: 8 };
/** Chevron glow scroll, texture repeats a second (a tile is 8 yards). */
const CHEVRON_SPEED = 1.1;
/** The ribbons' streaming, texture repeats a second (a repeat is 5 yards of lane). */
const WISP_SPEED = 1.5;
/** The pocket mist's turn, radians a second. */
const MIST_TURN = 0.4;

/** A one-texel stand-in where there is no DOM (a headless composition of the real Renderer). */
function plainTexture(): THREE.Texture {
  const t = new THREE.DataTexture(new Uint8Array([230, 246, 255, 255]), 1, 1);
  t.needsUpdate = true;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function canvasOf(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D | null] {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return [canvas, canvas.getContext('2d')];
}

function toTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  applyTextureAnisotropy(tex, 'colour');
  return tex;
}

/** Soft edges across, and along it a faint stream with three brighter dashes of different
 *  lengths: a ribbon of air whose bright streaks run along it as the texture scrolls. Wraps
 *  along its length. */
function wispTexture(): THREE.Texture {
  if (typeof document === 'undefined') return plainTexture();
  const w = 64;
  const h = 256;
  const [canvas, g] = canvasOf(w, h);
  if (g) {
    const img = g.createImageData(w, h);
    const dashes = [
      { c: 0.12, half: 0.1 },
      { c: 0.46, half: 0.16 },
      { c: 0.82, half: 0.07 },
    ];
    for (let y = 0; y < h; y++) {
      const v = y / h;
      let dash = 0;
      for (const d of dashes) {
        let dv = Math.abs(v - d.c);
        dv = Math.min(dv, 1 - dv);
        const t = Math.max(0, 1 - dv / d.half);
        dash = Math.max(dash, t * t * (3 - 2 * t));
      }
      for (let x = 0; x < w; x++) {
        const u = (x + 0.5) / w;
        const across = Math.sin(Math.PI * u) ** 1.8;
        const a = across * (0.2 + 0.8 * dash);
        const i = (y * w + x) * 4;
        img.data[i] = 235;
        img.data[i + 1] = 248;
        img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(255 * a);
      }
    }
    g.putImageData(img, 0, 0);
  }
  const tex = toTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Two thin chevrons pointing up the canvas (toward +v), carved lines with a faint cold glow,
 *  fading toward the sides. */
function chevronTexture(): THREE.Texture {
  if (typeof document === 'undefined') return plainTexture();
  const w = 128;
  const h = 256;
  const [canvas, g] = canvasOf(w, h);
  if (g) {
    g.clearRect(0, 0, w, h);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.shadowColor = 'rgba(140, 225, 255, 0.9)';
    g.shadowBlur = 9;
    for (const apexY of [70, 198]) {
      g.strokeStyle = 'rgba(205, 240, 255, 0.9)';
      g.lineWidth = 4.5;
      g.beginPath();
      g.moveTo(w * 0.14, apexY + 40);
      g.lineTo(w * 0.5, apexY);
      g.lineTo(w * 0.86, apexY + 40);
      g.stroke();
    }
    g.shadowBlur = 0;
    g.globalCompositeOperation = 'destination-in';
    const fade = g.createLinearGradient(0, 0, w, 0);
    fade.addColorStop(0, 'rgba(0,0,0,0)');
    fade.addColorStop(0.2, 'rgba(0,0,0,1)');
    fade.addColorStop(0.8, 'rgba(0,0,0,1)');
    fade.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = fade;
    g.fillRect(0, 0, w, h);
  }
  const tex = toTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** A maple-ish leaf in autumn orange with darker veins, on transparent. */
function leafTexture(): THREE.Texture {
  if (typeof document === 'undefined') return plainTexture();
  const s = 64;
  const [canvas, g] = canvasOf(s, s);
  if (g) {
    g.clearRect(0, 0, s, s);
    const cx = s / 2;
    const cy = s * 0.46;
    g.beginPath();
    const n = 90;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      // five lobes, longest toward the tip (up the canvas), pinched to a stem at the bottom
      const lobe = 0.58 + 0.42 * Math.abs(Math.cos(2.5 * a));
      const r = s * 0.42 * lobe * (a > Math.PI * 0.75 && a < Math.PI * 1.25 ? 0.35 : 1);
      const x = cx + Math.sin(a) * r;
      const y = cy - Math.cos(a) * r;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
    const fill = g.createLinearGradient(0, 0, 0, s);
    fill.addColorStop(0, '#f08a2e');
    fill.addColorStop(1, '#b9461a');
    g.fillStyle = fill;
    g.fill();
    g.strokeStyle = 'rgba(110, 40, 10, 0.75)';
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(cx, s * 0.92);
    g.lineTo(cx, s * 0.12);
    for (const a of [-0.9, 0.9]) {
      g.moveTo(cx, s * 0.55);
      g.lineTo(cx + Math.sin(a) * s * 0.34, s * 0.55 - Math.cos(a) * s * 0.34);
    }
    g.stroke();
  }
  return toTexture(canvas);
}

/** A white feather, quill up the middle, on transparent. */
function featherTexture(): THREE.Texture {
  if (typeof document === 'undefined') return plainTexture();
  const w = 32;
  const h = 96;
  const [canvas, g] = canvasOf(w, h);
  if (g) {
    g.clearRect(0, 0, w, h);
    g.beginPath();
    g.moveTo(w / 2, 2);
    g.bezierCurveTo(w * 1.05, h * 0.22, w * 0.95, h * 0.72, w / 2, h * 0.94);
    g.bezierCurveTo(w * 0.05, h * 0.72, -w * 0.05, h * 0.22, w / 2, 2);
    const fill = g.createLinearGradient(0, 0, w, 0);
    fill.addColorStop(0, '#dfe9f4');
    fill.addColorStop(0.5, '#ffffff');
    fill.addColorStop(1, '#d7e3f0');
    g.fillStyle = fill;
    g.fill();
    g.strokeStyle = 'rgba(150, 168, 190, 0.8)';
    g.lineWidth = 1.3;
    g.beginPath();
    g.moveTo(w / 2, h * 0.98);
    g.lineTo(w / 2, 4);
    g.stroke();
    g.lineWidth = 0.7;
    g.strokeStyle = 'rgba(170, 186, 206, 0.6)';
    for (let k = 1; k < 9; k++) {
      const y = (k / 9) * h * 0.85 + 6;
      g.beginPath();
      g.moveTo(w / 2, y);
      g.lineTo(w * 0.12, y - 7);
      g.moveTo(w / 2, y);
      g.lineTo(w * 0.88, y - 7);
      g.stroke();
    }
  }
  return toTexture(canvas);
}

/** A round bank of soft cloud, thickest in the middle and gone at the rim. */
function mistTexture(): THREE.Texture {
  if (typeof document === 'undefined') return plainTexture();
  const s = 128;
  const [canvas, g] = canvasOf(s, s);
  if (g) {
    g.clearRect(0, 0, s, s);
    for (let i = 0; i < 42; i++) {
      const a = hash2(i, 1, 0x3157) * Math.PI * 2;
      const d = Math.sqrt(hash2(i, 2, 0x3157)) * s * 0.34;
      const x = s / 2 + Math.cos(a) * d;
      const y = s / 2 + Math.sin(a) * d;
      const r = s * (0.1 + hash2(i, 3, 0x3157) * 0.14);
      const blob = g.createRadialGradient(x, y, 0, x, y, r);
      blob.addColorStop(0, 'rgba(255, 255, 255, 0.34)');
      blob.addColorStop(1, 'rgba(255, 255, 255, 0)');
      g.fillStyle = blob;
      g.fillRect(0, 0, s, s);
    }
    g.globalCompositeOperation = 'destination-in';
    const rim = g.createRadialGradient(s / 2, s / 2, s * 0.12, s / 2, s / 2, s / 2);
    rim.addColorStop(0, 'rgba(0,0,0,1)');
    rim.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rim;
    g.fillRect(0, 0, s, s);
  }
  const tex = toTexture(canvas);
  tex.center.set(0.5, 0.5);
  return tex;
}

function ribbonMesh(geo: RibbonGeometry, mat: THREE.Material, name: string): THREE.Mesh {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(geo.positions, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(geo.uvs, 2));
  g.setIndex(new THREE.BufferAttribute(geo.indices, 1));
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = name;
  return mesh;
}

/** Build the wind: `ground` reads the world's finished terrain height. */
export function createGyreWindView(ground: (x: number, z: number) => number): GyreWindView {
  const group = new THREE.Group();
  group.name = 'gyre-wind';

  // ---- the carved chevrons -------------------------------------------------------------------
  const chevrons = chevronTexture();
  const chevMat = new THREE.MeshBasicMaterial({
    name: 'gyre-wind:chevrons',
    map: chevrons,
    color: 0xbfeaff,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const chev = ribbonMesh(
    buildLaneRibbons(WIND_LANES, ground, CHEVRONS),
    chevMat,
    'gyre-wind-chevrons',
  );
  chev.renderOrder = 2;
  group.add(chev);

  // ---- the ribbons of air: along the lanes, and spiralling up out of the pockets ---------------
  const wisps = wispTexture();
  const wispMat = new THREE.MeshBasicMaterial({
    name: 'gyre-wind:wisps',
    map: wisps,
    color: 0xdff2ff,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const strands = buildLaneStrands(WIND_LANES, ground);
  const lanes = ribbonMesh(buildStrandRibbons(strands), wispMat, 'gyre-wind-lanes');
  lanes.renderOrder = 3;
  group.add(lanes);
  // the pockets' updrafts, and the two wind pads' (upright, on the ground at each pad)
  const spots = [...pocketSpots(), ...padSpots(ground)];
  const spirals = ribbonMesh(buildPocketSpirals(spots), wispMat, 'gyre-wind-spirals');
  spirals.renderOrder = 3;
  group.add(spirals);

  // ---- the swirl of mist each updraft stands in ------------------------------------------------
  const mist = mistTexture();
  const mistMat = new THREE.MeshBasicMaterial({
    name: 'gyre-wind:mist',
    map: mist,
    color: 0xf2f8ff,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const mistGeo = new THREE.CircleGeometry(2.9, 28);
  mistGeo.rotateX(-Math.PI / 2);
  for (const spot of spots) {
    const m = new THREE.Mesh(mistGeo, mistMat);
    m.name = 'gyre-wind-mist';
    m.position.set(spot.x, spot.y + 0.14, spot.z);
    m.renderOrder = 3;
    group.add(m);
  }

  // ---- the leaves and feathers the wind carries -------------------------------------------------
  const motes = buildWindMotes(strands);
  const leaves = motes.filter((m) => m.kind === 'leaf');
  const feathers = motes.filter((m) => m.kind === 'feather');
  const planeGeo = new THREE.PlaneGeometry(1, 1);
  const featherGeo = new THREE.PlaneGeometry(0.34, 1);
  // unlit, so a leaf stays orange and a feather white at dusk (fog still takes the far ones)
  const moteMat = (map: THREE.Texture, name: string) =>
    new THREE.MeshBasicMaterial({
      name,
      map,
      transparent: true,
      alphaTest: 0.35,
      side: THREE.DoubleSide,
    });
  const leafTex = leafTexture();
  const featherTex = featherTexture();
  const leafMat = moteMat(leafTex, 'gyre-wind:leaves');
  const featherMat = moteMat(featherTex, 'gyre-wind:feathers');
  const leafMesh = new THREE.InstancedMesh(planeGeo, leafMat, leaves.length);
  const featherMesh = new THREE.InstancedMesh(featherGeo, featherMat, feathers.length);
  // one static sphere round the whole climb (the strands and the most a mote drifts off them), so
  // the instanced meshes cull like any other and are not drawn while the peak is off screen
  const reach = new THREE.Box3();
  const corner = new THREE.Vector3();
  for (const st of strands) {
    for (let k = 0; k < st.pts.length; k += 3) {
      reach.expandByPoint(corner.set(st.pts[k], st.pts[k + 1], st.pts[k + 2]));
    }
  }
  reach.expandByScalar(1.5);
  const sphere = reach.getBoundingSphere(new THREE.Sphere());
  for (const [mesh, name] of [
    [leafMesh, 'gyre-wind-leaves'],
    [featherMesh, 'gyre-wind-feathers'],
  ] as const) {
    mesh.name = name;
    mesh.boundingSphere = sphere.clone();
    group.add(mesh);
  }

  const pose: MotePose = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const scale = new THREE.Vector3();
  const mat = new THREE.Matrix4();
  const place = (mesh: THREE.InstancedMesh, list: typeof motes, t: number) => {
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      motePose(m, strands[m.strand], t, pose);
      pos.set(pose.x, pose.y, pose.z);
      euler.set(pose.rx, pose.ry, pose.rz);
      quat.setFromEuler(euler);
      scale.set(m.size, m.size, m.size);
      mat.compose(pos, quat, scale);
      mesh.setMatrixAt(i, mat);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };
  place(leafMesh, leaves, 0);
  place(featherMesh, feathers, 0);

  let time = 0;
  let disposed = false;
  return {
    group,
    update(dt, reducedMotion, camX, camZ, fogFar) {
      if (reducedMotion) return;
      // asleep while the whole peak lies beyond the fog: none of it can be seen
      if (Math.hypot(camX - sphere.center.x, camZ - sphere.center.z) > fogFar + sphere.radius)
        return;
      time += dt;
      wisps.offset.y = (wisps.offset.y - WISP_SPEED * dt) % 1;
      chevrons.offset.y = (chevrons.offset.y - CHEVRON_SPEED * dt) % 1;
      mist.rotation = (mist.rotation + MIST_TURN * dt) % (Math.PI * 2);
      place(leafMesh, leaves, time);
      place(featherMesh, feathers, time);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const g of [
        chev.geometry,
        lanes.geometry,
        spirals.geometry,
        mistGeo,
        planeGeo,
        featherGeo,
      ]) {
        g.dispose();
      }
      for (const m of [chevMat, wispMat, mistMat, leafMat, featherMat]) m.dispose();
      for (const t of [chevrons, wisps, mist, leafTex, featherTex]) t.dispose();
      leafMesh.dispose();
      featherMesh.dispose();
    },
  };
}
