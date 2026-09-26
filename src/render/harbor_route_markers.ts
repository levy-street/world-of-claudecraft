// Harbor route markers on screen: the one Blender-authored signpost
// (public/models/props/harbor_route_marker.glb, scripts/assets/harbor_route_marker/)
// stood at every ferry berth the sim lists (sim/content/harbor_route_markers.ts),
// turned so its arrow points at the boarding point (sim/harbor_route_markers.ts),
// with the destination's localized name painted on BOTH faces of the board.
//
// Which parts a graphics tier keeps is the pure core's call
// (harbor_route_marker_core.ts): the post, the arrow board, the anchor roundel
// and the destination name on every tier; the metal trim from medium, the
// lantern, chain and rope from high. The tier is the static effects tier
// (GFX.effectsTier: the preset, lowered by the Advanced Effects-quality
// setting), never the frame-rate governor, and a graphics-profile change
// rebuilds the props (the resetter below).
//
// Text: each destination is a canvas painted once (the plate's cream paint and
// the name, fitted to the plate) and shared by every marker that reads it, on a
// plane cut to the painted panel's outline. The back face is the same plane
// turned half a turn, never a mirrored one, so the name reads the right way
// round from either side. A language switch (woc:languagechange) or the web
// font arriving repaints the canvases in place: a texture upload, never a
// material or program change.
//
// GPU work: the markers are built into the props root at world build (props.ts),
// so the world-entry compile links them with the rest of the props, and their
// distinct (geometry, material) programs join the props material prewarm
// (harborRouteMarkerPrewarmParts) so a marker first seen after the curtain links
// nothing in a live frame. Nothing here runs per frame.

import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  HARBOR_ROUTE_MARKERS,
  type HarborRouteMarkerDef,
} from '../sim/content/harbor_route_markers';
import { harborRouteMarkerYaw } from '../sim/harbor_route_markers';
import { groundHeight } from '../sim/world';
import { loadGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { harborDestinationLabel } from './entity_labels';
import { GFX, surfaceMat } from './gfx';
import {
  type HarborRouteMarkerPlate,
  harborRouteMarkerParts,
  harborRouteMarkerPlateFan,
  harborRouteMarkerTextFaces,
} from './harbor_route_marker_core';
import {
  addToBucket,
  mergeVertexColourBuckets,
  vertexColourMaterialConverter,
  vertexColourMeshGeometry,
} from './vertex_colour_glb_parts';

const MARKER_URL = '/models/props/harbor_route_marker.glb';
/** The plate canvas: wide like the painted panel (about 3 to 1). */
const PLATE_CANVAS_W = 1024;
const PLATE_CANVAS_H = 340;
const PLATE_FONT_STACK = '"Cinzel", "Palatino Linotype", Palatino, Georgia, serif';
const PLATE_PAINT_TOP = '#f1e5c3';
const PLATE_PAINT_BOTTOM = '#e4d3a6';
const PLATE_INK = '#2b1d12';
/** The plate's fallback when the GLB anchor carries no extras (never in a
 *  shipped build: tests/harbor_route_marker_asset.test.ts pins them). */
const FALLBACK_PLATE: HarborRouteMarkerPlate = {
  width: 2.66,
  height: 0.88,
  corner: 0.07,
  faceOffset: 0.126,
  textWidth: 0.9,
  textHeight: 0.62,
};

let loaded: GLTF | null = null;
let loadTask: Promise<void> | null = null;

export function prepareHarborRouteMarkerAssets(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (loadTask) return loadTask;
  loadTask = loadGltf(MARKER_URL)
    .then((gltf) => {
      loaded = gltf;
      loadTask = null;
    })
    .catch((err) => {
      loadTask = null;
      throw err;
    });
  return loadTask;
}

if (typeof window !== 'undefined') registerDeferredPreload(prepareHarborRouteMarkerAssets);

interface MarkerPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

interface MarkerTemplate {
  /** The kept parts merged into one geometry per material, in the sign's frame. */
  parts: MarkerPart[];
  /** The destination plate: its centre in the sign's frame, size, and geometry. */
  anchor: THREE.Vector3;
  plate: HarborRouteMarkerPlate;
  plateGeometry: THREE.BufferGeometry;
}

/** Templates by `effectsTier|standard`: a preset change converts anew. */
const templates = new Map<string, MarkerTemplate>();
let lastTemplate: MarkerTemplate | null = null;
const materials = vertexColourMaterialConverter();

/** Drop the prepared templates (graphics-profile rebuilds convert materials
 *  anew; the parsed source and the painted plates survive). Registered in
 *  assets/graphics_profile.ts. */
export function resetHarborRouteMarkerCaches(): void {
  templates.clear();
  materials.clear();
  lastTemplate = null;
}

function plateFromExtras(extras: unknown): HarborRouteMarkerPlate {
  const e = (extras ?? {}) as Partial<HarborRouteMarkerPlate>;
  const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return {
    width: num(e.width, FALLBACK_PLATE.width),
    height: num(e.height, FALLBACK_PLATE.height),
    corner: num(e.corner, FALLBACK_PLATE.corner),
    faceOffset: num(e.faceOffset, FALLBACK_PLATE.faceOffset),
    textWidth: num(e.textWidth, FALLBACK_PLATE.textWidth),
    textHeight: num(e.textHeight, FALLBACK_PLATE.textHeight),
  };
}

function plateGeometry(plate: HarborRouteMarkerPlate): THREE.BufferGeometry {
  const fan = harborRouteMarkerPlateFan(plate);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(fan.positions, 3));
  geo.setAttribute(
    'normal',
    new THREE.Float32BufferAttribute(
      fan.positions.map((_, i) => (i % 3 === 2 ? 1 : 0)),
      3,
    ),
  );
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(fan.uvs, 2));
  geo.setIndex(fan.indices);
  geo.computeBoundingSphere();
  return geo;
}

function buildTemplate(gltf: GLTF, keep: readonly string[]): MarkerTemplate {
  // loader cache results are immutable: read a clone
  const root = gltf.scene.clone(true);
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert();
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  for (const name of keep) {
    const part = root.getObjectByName(name);
    if (!part) continue;
    part.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      const frame = new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld);
      addToBucket(
        buckets,
        materials.convert(mesh.material as THREE.Material),
        vertexColourMeshGeometry(mesh, frame),
      );
    });
  }
  const parts: MarkerPart[] = mergeVertexColourBuckets(buckets);
  const anchorNode = root.getObjectByName('DestinationTextAnchor');
  const anchor = new THREE.Vector3();
  if (anchorNode) anchor.setFromMatrixPosition(anchorNode.matrixWorld).applyMatrix4(inverse);
  const plate = plateFromExtras(anchorNode?.userData.destinationText);
  return { parts, anchor, plate, plateGeometry: plateGeometry(plate) };
}

function templateFor(): MarkerTemplate {
  const key = `${GFX.effectsTier}|${GFX.standardMaterials ? 's' : 'l'}`;
  let template = templates.get(key);
  if (!template) {
    if (!loaded) throw new Error(`harbor route marker model was not preloaded: ${MARKER_URL}`);
    template = buildTemplate(loaded, harborRouteMarkerParts(GFX.effectsTier));
    templates.set(key, template);
  }
  lastTemplate = template;
  return template;
}

// ---------------------------------------------------------------------------
// The painted destination plates, one per distinct destination.
// ---------------------------------------------------------------------------

interface PaintedPlate {
  dest: HarborRouteMarkerDef['destination'];
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  plate: HarborRouteMarkerPlate;
}

const plates = new Map<string, PaintedPlate>();
let repaintHooked = false;

function destKey(dest: HarborRouteMarkerDef['destination']): string {
  return dest.kind === 'zone' ? `zone:${dest.zone}` : dest.mark;
}

function paintPlate(p: PaintedPlate): void {
  const ctx = p.canvas.getContext('2d');
  if (!ctx) return;
  const w = p.canvas.width;
  const h = p.canvas.height;
  const paint = ctx.createLinearGradient(0, 0, 0, h);
  paint.addColorStop(0, PLATE_PAINT_TOP);
  paint.addColorStop(1, PLATE_PAINT_BOTTOM);
  ctx.fillStyle = paint;
  ctx.fillRect(0, 0, w, h);
  // a thin painted keyline inside the edge, the sign-writer's frame
  ctx.strokeStyle = 'rgba(92, 62, 34, 0.45)';
  ctx.lineWidth = 6;
  ctx.strokeRect(22, 22, w - 44, h - 44);
  const label = harborDestinationLabel(p.dest);
  if (!label) {
    // a destination content has retired: a blank plate, and a note for whoever
    // edits the markers (content/harbor_route_markers.ts)
    console.warn(`harbor route marker: no label for ${destKey(p.dest)}`);
    p.texture.needsUpdate = true;
    return;
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const maxW = w * p.plate.textWidth;
  let size = Math.round(h * p.plate.textHeight);
  // shrink until the (localized) name fits the plate, never clipped
  do {
    ctx.font = `700 ${size}px ${PLATE_FONT_STACK}`;
    if (ctx.measureText(label).width <= maxW) break;
    size -= 4;
  } while (size > 28);
  // a pale lift under the ink, so the letters read painted rather than printed
  ctx.fillStyle = 'rgba(255, 250, 232, 0.7)';
  ctx.fillText(label, w / 2 + 2, h / 2 + 3, maxW);
  ctx.fillStyle = PLATE_INK;
  ctx.fillText(label, w / 2, h / 2, maxW);
  p.texture.needsUpdate = true;
}

function repaintAll(): void {
  for (const p of plates.values()) paintPlate(p);
}

function hookRepaint(): void {
  if (repaintHooked || typeof document === 'undefined') return;
  repaintHooked = true;
  document.addEventListener('woc:languagechange', repaintAll);
  // the plate font is a web font: repaint once it has arrived, whether it was
  // already loading at the first paint (ready) or starts loading later
  // (loadingdone, the nameplate canvas's idiom)
  document.fonts?.ready.then(repaintAll).catch(() => undefined);
  document.fonts?.addEventListener?.('loadingdone', repaintAll);
}

function plateFor(
  dest: HarborRouteMarkerDef['destination'],
  plate: HarborRouteMarkerPlate,
): PaintedPlate {
  const key = destKey(dest);
  let p = plates.get(key);
  if (!p) {
    const canvas = document.createElement('canvas');
    canvas.width = PLATE_CANVAS_W;
    canvas.height = PLATE_CANVAS_H;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.anisotropy = 4;
    p = { dest, canvas, texture, plate };
    plates.set(key, p);
    paintPlate(p);
  }
  hookRepaint();
  return p;
}

/** The plate material at the live tier (surfaceMat dedupes by texture, and
 *  its cache is reset with the graphics profile). */
function plateMaterial(p: PaintedPlate): THREE.Material {
  return surfaceMat({ color: 0xffffff, map: p.texture, roughness: 0.9 });
}

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

/** One marker: the kept parts, the two text planes, stood and turned. */
export function buildHarborRouteMarker(def: HarborRouteMarkerDef, seed: number): THREE.Group {
  const template = templateFor();
  const group = new THREE.Group();
  group.name = `harborRouteMarker:${def.berth}`;
  for (const part of template.parts) {
    const mesh = new THREE.Mesh(part.geometry, part.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  const material = plateMaterial(plateFor(def.destination, template.plate));
  for (const face of harborRouteMarkerTextFaces(template.plate)) {
    const text = new THREE.Mesh(template.plateGeometry, material);
    text.name = 'DestinationText';
    text.position.set(template.anchor.x, template.anchor.y, face.z);
    text.rotation.y = face.yaw;
    text.receiveShadow = true;
    group.add(text);
  }
  group.position.set(def.x, groundHeight(def.x, def.z, seed), def.z);
  group.rotation.y = harborRouteMarkerYaw(def);
  group.userData.assetUrl = MARKER_URL;
  group.userData.berth = def.berth;
  return group;
}

/** Every berth's marker, built once into the props root (built-in world only). */
export function buildHarborRouteMarkers(seed: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'harborRouteMarkers';
  if (!loaded) {
    console.warn(`harbor route markers skipped: ${MARKER_URL} was not preloaded`);
    return group;
  }
  for (const def of HARBOR_ROUTE_MARKERS) group.add(buildHarborRouteMarker(def, seed));
  return group;
}

/** The markers' distinct (geometry, material) programs at the live tier, for
 *  the props material prewarm (props.ts). Empty until buildProps has placed
 *  the markers. */
export function harborRouteMarkerPrewarmParts(): readonly MarkerPart[] {
  if (!lastTemplate) return [];
  const out: MarkerPart[] = [...lastTemplate.parts];
  const plate = plates.values().next().value;
  if (plate) out.push({ geometry: lastTemplate.plateGeometry, material: plateMaterial(plate) });
  return out;
}

export const harborRouteMarkerInternalsForTest = {
  assetUrl: MARKER_URL,
  destinationLabel: harborDestinationLabel,
  /** Hand a parsed GLB to the preload slot (Node tests have no fetch path). */
  setLoadedGltfForTest(gltf: GLTF | null): void {
    loaded = gltf;
    resetHarborRouteMarkerCaches();
  },
  /** Repaint every plate (what a language switch or the web font does). */
  repaintAll,
  /** Forget the painted plates (their canvases belong to one test's document). */
  clearPlatesForTest(): void {
    plates.clear();
  },
};
