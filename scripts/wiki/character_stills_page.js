// Browser-side helper for scripts/wiki/render_character_stills.mjs. Imported THROUGH Vite
// into the live offline client after the world has entered, so it shares the game's own
// module instances and warm asset caches (the WOC entry preload: base, head core and
// animation library). Each still is a body built by the game's own factory,
// createCharacterVisual, from a stand-in entity shaped like the one the world builds, so
// an NPC wears its authored look (npc_looks.ts: face, hair, body size, class kit with the
// head bare, held props) exactly as in the world.
//
// The still itself matches the creature stills (scripts/wiki/stills_render_entry.js): its
// own transparent 512 px canvas, the Guide turntable's light rig, fov 40, framed by the
// posed skin-aware bounding sphere with a little headroom, a three-quarter yaw.
import * as THREE from 'three';
import { skinAwareBounds } from '../../src/guide/viewer/model.ts';
import { createCharacterVisual, visualAssetsResident } from '../../src/render/characters/index.ts';
import { VISUALS, visualKeyFor } from '../../src/render/characters/manifest.ts';
import { npcLookFor } from '../../src/render/characters/npc_looks.ts';
import { isQuestCaravanEntity } from '../../src/render/quest_entity_presentation.ts';
import { caravanDriverLookId } from '../../src/render/world_quest_caravan_driver.ts';
import { buildMovingWorldQuestFreightWagon } from '../../src/render/world_quest_freight_visual.ts';
import { BUILTIN_WORLD, MOBS, NPCS } from '../../src/sim/data.ts';

const SIZE = 512;
const STILL_YAW = -0.6; // the creature stills' three-quarter yaw
const POSE_TIME = 0.6; // seconds into the idle, so the rig leaves its bind pose
const ANIM = {
  speed: 0,
  moving: false,
  running: false,
  airborne: false,
  backwards: false,
  dead: false,
  casting: false,
  swimming: false,
  submerged: false,
  swimPitch: 0,
  wading: false,
  sitting: false,
};

const renderer = new THREE.WebGLRenderer({
  canvas: document.createElement('canvas'),
  alpha: true,
  antialias: true,
  preserveDrawingBuffer: true,
});
renderer.setPixelRatio(1);
renderer.setSize(SIZE, SIZE, false);
renderer.setClearAlpha(0);
renderer.outputColorSpace = THREE.SRGBColorSpace;

function makeLights() {
  const g = new THREE.Group();
  g.add(new THREE.HemisphereLight(0xffffff, 0x3a3a44, 1.5));
  const key = new THREE.DirectionalLight(0xfff4e0, 1.7);
  key.position.set(3, 6, 4);
  g.add(key);
  const rim = new THREE.DirectionalLight(0xbfd4ff, 0.8);
  rim.position.set(-4, 3, -4);
  g.add(rim);
  return g;
}

function frameCamera(camera, radius, center) {
  const fov = (camera.fov * Math.PI) / 180;
  const dist = (radius / Math.sin(fov / 2)) * 1.15;
  camera.position.set(center.x, center.y, center.z + dist);
  camera.lookAt(center);
  camera.near = Math.max(0.01, dist / 50);
  camera.far = dist * 12;
  camera.updateProjectionMatrix();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

function standIn(kind, templateId, color) {
  return {
    kind,
    templateId,
    color,
    skin: 0,
    mainhandItemId: null,
    offhandItemId: null,
    auras: [],
  };
}

const characterKey = (key) => {
  const def = VISUALS[key];
  return Boolean(def && (def.wocCharacter || key.startsWith('player_') || key.startsWith('npc_')));
};

/** Every NPC and character-bodied mob the wiki could show, as { id, kind, templateId, color, key }. */
export function characterTargets() {
  const out = [];
  const npcs = new Map();
  for (const [id, n] of Object.entries(NPCS)) npcs.set(id, n);
  for (const [id, n] of Object.entries(BUILTIN_WORLD.npcs ?? {}))
    if (!npcs.has(id)) npcs.set(id, n);
  for (const [id, n] of npcs) {
    const key = visualKeyFor(standIn('npc', id, n.color ?? 0xffffff));
    if (characterKey(key))
      out.push({ id: `npc/${id}`, kind: 'npc', templateId: id, color: n.color ?? 0xffffff, key });
  }
  for (const [id, m] of Object.entries(MOBS)) {
    const e = standIn('mob', id, m.color ?? 0xffffff);
    const key = visualKeyFor(e);
    // A quest caravan is drawn in the world as its wagon (horses, cargo, the seated
    // driver: quest_entity_presentation.ts), never as the class body its key names.
    const caravan = isQuestCaravanEntity(e);
    if (caravan || characterKey(key))
      out.push({
        id: `mob/${id}`,
        kind: 'mob',
        templateId: id,
        color: m.color ?? 0xffffff,
        key,
        caravan,
      });
  }
  return out;
}

/** A quest caravan as the world draws it: the game's own moving freight wagon (wagon,
 *  two horses idling, cargo, and the caravan's driver seated on the deck). Its GLBs load
 *  through the deferred preload, so the build is retried until they are resident; the
 *  driver's head pieces are warmed first with a whole-head build of the driver's look, so
 *  the seated driver is never a bare-head stand-in. */
async function renderCaravanStill(t) {
  const driverLook = caravanDriverLookId(t.templateId);
  if (npcLookFor(driverLook)) {
    const warm = createCharacterVisual(standIn('npc', driverLook, t.color));
    if (warm) {
      try {
        warm.setWocBareHeadStandIn(false);
        const until = performance.now() + 30_000;
        while (!warm.bodyShown && performance.now() < until) {
          warm.update(0, ANIM, true);
          await nextFrame();
        }
      } finally {
        warm.dispose();
      }
    }
  }
  const until = performance.now() + 60_000;
  let wagon = buildMovingWorldQuestFreightWagon(t.templateId);
  while (!wagon) {
    if (performance.now() > until) throw new Error('freight wagon assets never loaded');
    await sleep(250);
    wagon = buildMovingWorldQuestFreightWagon(t.templateId);
  }
  try {
    const driver = wagon.group.getObjectByName(`${t.templateId}-driver`) ?? null;
    // Let the driver settle into the seat, the horses into their idle, and any head piece
    // still linking join, over a couple of seconds of real frames.
    const settleUntil = performance.now() + 2000;
    while (performance.now() < settleUntil) {
      wagon.update(1 / 30, false, true);
      await nextFrame();
    }
    const scene = new THREE.Scene();
    scene.add(makeLights());
    const pivot = new THREE.Group();
    // The wagon runs along +z with the horses in front: this yaw shows the team's
    // front three-quarter and the driver on the deck.
    pivot.rotation.y = -0.85;
    pivot.add(wagon.group);
    wagon.group.traverse((o) => {
      if (o.isMesh) o.frustumCulled = false;
    });
    scene.add(pivot);
    scene.updateMatrixWorld(true);
    const bounds = skinAwareBounds(wagon.group);
    const center = bounds.getCenter(new THREE.Vector3());
    const radius = bounds.getBoundingSphere(new THREE.Sphere()).radius || 1;
    center.y += radius * 0.08;
    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);
    // A little above the deck, so the seated driver reads over the horses.
    frameCamera(camera, radius, center);
    camera.position.y += radius * 0.6;
    camera.lookAt(center);
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL('image/png');
    pivot.remove(wagon.group);
    scene.clear();
    return { url, driver: Boolean(driver) };
  } finally {
    wagon.dispose();
  }
}

/** Build, settle and render one body; resolves a PNG data URL plus what it drew. */
export async function renderCharacterStill(t) {
  if (t.caravan) return renderCaravanStill(t);
  // The body's own files (a mob on a lazy class rig): ask, then wait until resident.
  const until = performance.now() + 45_000;
  while (!visualAssetsResident(t.key, true)) {
    if (performance.now() > until) throw new Error(`assets for ${t.key} never became resident`);
    await sleep(200);
  }
  const visual = createCharacterVisual(standIn(t.kind, t.templateId, t.color));
  if (!visual) throw new Error(`createCharacterVisual returned null (${t.key})`);
  try {
    // A still draws a head only WHOLE (as the previews and portraits do): no bare head
    // standing in for a hairstyle or beard still on the wire, and the pieces drawn one by
    // one rather than through the crowd merge.
    visual.setWocBareHeadStandIn(false);
    visual.setWocDrawMerge(false);
    visual.setWocArmorDetail?.('full');
    // Drive the body until its head is whole and shown, then a little longer so streamed
    // armor sets attach; give up after a while rather than ship a half-dressed body.
    const headUntil = performance.now() + 30_000;
    let shownAt = null;
    for (;;) {
      visual.update(0, ANIM, true);
      if (visual.bodyShown) shownAt ??= performance.now();
      if (shownAt !== null && performance.now() - shownAt > 1500) break;
      if (performance.now() > headUntil) throw new Error(`body never shown whole (${t.key})`);
      await nextFrame();
    }
    const drawn = visual.wocHeadDrawnLook;
    const look = visual.wocHeadLook;

    const scene = new THREE.Scene();
    scene.add(makeLights());
    const pivot = new THREE.Group();
    pivot.rotation.y = STILL_YAW;
    pivot.add(visual.root);
    visual.root.position.set(0, 0, 0);
    visual.root.rotation.set(0, 0, 0);
    visual.root.traverse((o) => {
      if (o.isMesh) o.frustumCulled = false;
    });
    scene.add(pivot);
    // Advance the idle a fixed amount in small steps (deterministic framing).
    for (let i = 0; i < 6; i++) visual.update(POSE_TIME / 6, ANIM, true);
    scene.updateMatrixWorld(true);
    const bounds = skinAwareBounds(visual.root);
    if (bounds.isEmpty()) throw new Error('empty bounds');
    // Held props and rigid attachments (a staff, a halo, a lantern) can reach past the
    // skinned body; take the plain world box of the visible rigid meshes too, so the frame
    // never clips them.
    visual.root.traverse((o) => {
      if (!o.isMesh || o.isSkinnedMesh || !o.visible || !o.geometry) return;
      let shown = true;
      for (let p = o; p; p = p.parent) if (!p.visible) shown = false;
      if (!shown) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      bounds.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
    });
    const center = bounds.getCenter(new THREE.Vector3());
    const radius = bounds.getBoundingSphere(new THREE.Sphere()).radius || 1;
    center.y += radius * 0.08;
    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);
    frameCamera(camera, radius, center);
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL('image/png');
    pivot.remove(visual.root);
    scene.clear();
    return {
      url,
      drawn: drawn ? JSON.stringify(drawn) : null,
      look: look ? JSON.stringify(look) : null,
    };
  } finally {
    visual.dispose();
  }
}
