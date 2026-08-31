// Rickshaw Mount: procedurally authored throne-cart, with real procedural PBR
// surface maps (surface_maps.mjs) and its two wheels split into their own
// animatable nodes.
// See docs/design/rickshaw_mount/{reference-metadata,object-sculpt-spec}.json for
// the reference admission and the component/material/budget contract this factory
// implements. Ships NO animation clips: the wheels are rolled per-frame by
// rickshaw_mount.ts's spinMountWheels (see the note above WHEEL_NODES for why authored
// clips were abandoned), and the body's motion is mount_visuals.ts's procedural
// bob, so the entry stays rigged:false like stalkglider_snail. The puller's own
// gait comes from its separate character rig (src/render/rickshaw_mount.ts).
//
// This is a full replacement of the v1 open-frame-cart shape (unadorned bench +
// running gear, no canopy) with a throne-style seat built from a new user-supplied
// concept sheet: riveted bronze-on-wood construction, a tufted cushion, a hanging
// emissive lantern, and a banner. Two things the concept art showed that were
// deliberately NOT built: (1) the chain harness wrapping the puller (cut by the
// user: real chain-link geometry is a meaningful triangle/complexity cost for a
// detail that reads as background texture at mount scale, not an identity
// feature); (2) the art's own invented skeleton pose/geometry, since the mount
// still composes skel_rickshaw_puller (skeleton_minion_free.glb) at runtime
// (src/render/rickshaw_mount.ts) in its own idle pose, not the art's hunched one.
// The shaft/cross-brace grip position (SHAFT_TIP_Y/Z/SIDE_X) is therefore
// unchanged from v1: it was measured against that same rig and did not move.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
// Reused directly from the tank mount's look-dev pass (scripts/assets/
// terrorspark_groundshaker/surface_shading.mjs), not copied or moved: the
// baked macro shading (cavity occlusion, ground contact, grime, dust, edge
// wear, seams, mottle) is pure geometry-driven arithmetic with zero tank-
// specific logic, so it applies to any hard-surface prop, not just armor
// plate. Importing across asset folders instead of extracting to a shared
// location on purpose: that file is a pinned source-fingerprint input for
// the tank's own export (source_fingerprint.mjs), so moving it would force
// an unrelated tank re-export just to build the rickshaw's textures.
import {
  boxProjectUvInto,
  buildOccluderIndex,
  shadeSurfaceInto,
} from '../terrorspark_groundshaker/surface_shading.mjs';

// See the RICKSHAW_SCALE comment history in git blame: every sibling mount's
// seat height runs 2.05-3.35 world units, so the whole cart is authored at a
// small human-friendly local scale, then uniformly post-scaled once, rather
// than reworking every literal by hand.
export const RICKSHAW_SCALE = 2.0;

// Measured from the shipped GLB (npx gltf-transform inspect) after every
// geometry change, not hand derived: a stale value here silently desyncs from
// characters/manifest.ts's mount_rickshaw_mount.height field, which the
// runtime uses to auto-rescale the whole model back to a declared height (see
// that file's comment for the v1 incident this caused).
// 2026-08-09: all three were stale. They still described the pre-X-centering,
// pre-shaft-lengthening export (symmetric +-1.136 X, depth 3.105 = the old
// SHAFT_TIP_Z 0.743). Confirmed by inspecting the STAGED blob, which still
// carries those exact numbers, against a fresh export of current source. The
// arched seat-back added the same day is NOT the cause: it only adds geometry
// at local Y 1.75-1.90, well inside the model's own ~2.39 local top, and adds
// no X or Z extent at all. Re-measured: 2.297 / 4.779 / 3.419.
export const RICKSHAW_NATIVE_BOUNDS = Object.freeze({
  width: 2.297,
  // The lantern arm's top is the model's highest point, so any change to that
  // joint lands here: 4.779 flush, 4.799 while the post briefly overran it,
  // back to 4.779 now the post is buried. Re-measured after each export.
  height: 4.779,
  // 3.419 -> 3.614 when the harness collar landed: it wraps the puller at the
  // shaft tips, which is the model's furthest-forward geometry, so it sets the
  // depth now. Height and width are untouched by it.
  depth: 3.614,
});

export const RICKSHAW_SOCKET_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'rider',
    nodeName: 'Socket_Rider',
    // Raised from v1's 0.97 to sit on top of the new seat cushion (top surface
    // local Y ~1.09, see addCushions) rather than the bare wood seat-box top.
    // 2026-08-09: Z nudged -0.15 -> -0.11 (0.08 world forward) after a live
    // look caught the rider's back clipping through the seat back. The back
    // cushion's bronze frame reaches local Z -0.305, so at -0.15 a warrior's
    // torso had only ~0.05-0.08 local of clearance behind him -- inside what a
    // seated idle's own sway can cover. Forward is free: the seat cushion runs
    // to Z 0.06 and the armrest bars to 0.16, so at -0.11 he is still well
    // inside both and nothing new is in his way.
    position: Object.freeze([0, 1.12, -0.11]),
    purpose: 'mounted player seat, on top of the tufted seat cushion',
  }),
  Object.freeze({
    id: 'puller',
    nodeName: 'Socket_Puller',
    position: Object.freeze([0, 0, 0.55]),
    purpose:
      "authoring-time reference point only, not the runtime placement (see src/render/rickshaw_mount.ts's RICKSHAW_PULLER_OFFSET_Z/Y, independently tuned after a live look); attach point for skel_rickshaw_puller (skeleton_minion_free.glb, reused, not hand-built). The shaft handle cross-brace is positioned to match the measured handslot.l/r bone position of the puller's own idle pose (see SHAFT_TIP_Y/Z), not an independent guess. Unchanged from v1: the rig did not change.",
  }),
]);

// Sampled from the concept sheet's own color-palette swatch row (pixel colors
// read directly from the reference crop, not eyeballed). The hardware moved
// from v1's neutral-gray "iron" family to a warm bronze/brass family to
// match what the reference actually shows (banker_chest's bronze family,
// scripts/assets/banker_chest/model.js, was the calibration precedent).
// 2026-08-08: wood/cushion/banner used to share one flat-tinted "CartWood"
// bucket (fabric, leather and wood all have a similar non-metal PBR
// response, so one material sufficed while everything was solid vertex
// color). Split into their own wood/leather/fabric buckets
// (RICKSHAW_MATERIAL_CONTRACT below) once each got its own procedural
// texture family (scripts/assets/rickshaw_mount/surface_maps.mjs): three
// materials sharing texture would have wallpapered leather-grain onto wood
// or vice versa.
const PALETTE = {
  woodDark: 0x2a1a10,
  wood: 0x3d271a,
  woodEdge: 0x5a3d28,
  bronzeDark: 0x4a3320,
  bronze: 0x8a6a35,
  bronzeEdge: 0xb8956a,
  // Boosted from 0x6b2430: that value read as a dark red-brown blob barely
  // distinct from the wood at a normal camera distance. This is a genuinely
  // saturated crimson so the cushion reads as "a colored cushion" on sight,
  // not just a darker patch of the same wood family.
  // Puller's harness collar + the stubs that meet it. Deliberately a darker,
  // less saturated brown than the wood family so it reads as worn strap rather
  // than another cart plank, and dark enough that the leather bucket's TUFTED
  // generator (authored for the seat cushion's diamond quilting) stops reading
  // as quilting at strap scale.
  harness: 0x5a3a1f,
  // 2026-08-09: crimson -> rich purple on request. The boost note above still
  // applies and is the reason this is a SATURATED purple rather than a muted
  // one, but the old failure was hue, not value: a dark red next to brown wood
  // is nearly the same hue and lost all separation. Purple stays distinct from
  // the wood family even at this value, and it is in the concept's own palette
  // row (the puller's helmet is the same family).
  cushion: 0x5b2f7a,
  cushionDark: 0x3c1e52,
  cushionStud: 0x1b0f28,
  // Lifted from 0x1f3324, which was so dark it read as black rather than
  // green once the banner moved to the back panel and had to carry the crest.
  bannerField: 0x2f5b3a,
  bannerTrim: 0xd9cdb0,
  // Grey stone tower sigil, per the concept sheet's crest-banner detail crop.
  crest: 0xa2a49d,
  lanternGlass: 0xd9e08a,
};

// Color is deliberately NOT filled in here anymore: it used to be a flat
// per-part tint, which is what made every panel read as a solid painted
// block. shadeAllParts() (below, run once after every add* call has fired)
// bakes the real cavity/contact/grime/wear/seam/mottle pass into COLOR_0
// instead, using `tint` as this part's base color. Splitting the tint fill
// from the shading requires knowing about every OTHER part first (cavity
// occlusion needs the whole scene's geometry), so it can't happen per-call.
function prepareGeometry(source, matrix = null) {
  const geometry = source.index ? source.toNonIndexed() : source.clone();
  geometry.deleteAttribute('uv');
  geometry.deleteAttribute('uv1');
  if (matrix) geometry.applyMatrix4(matrix);
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  return geometry;
}

function matrixFor(position, rotation = [0, 0, 0], scale = [1, 1, 1]) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
    new THREE.Vector3(...scale),
  );
}

function addGeometry(bucket, geometry, color, options = {}) {
  const position = options.position ?? [0, 0, 0];
  const rotation = options.rotation ?? [0, 0, 0];
  const scale = options.scale ?? [1, 1, 1];
  bucket.push({
    geometry: prepareGeometry(geometry, matrixFor(position, rotation, scale)),
    tint: new THREE.Color(color),
    variation: options.variation ?? 0.02,
  });
}

// Runs once after every add* call has populated `buckets`, before the
// per-material merge. Two passes over the same flat part list because the
// occluder index (pass 1) needs every part's bounding box before ANY part
// can be shaded (pass 2): a part shades darker where it sits in another
// part's crevice, so the index has to see the whole scene first.
//
// Positions feed shadeSurfaceInto pre-multiplied by RICKSHAW_SCALE, not at
// this file's own small local-authoring scale: every height/distance
// constant it tunes against (contact zone, grime reach, dust band, cavity
// sample radii) is calibrated in real world yards against the tank mount's
// own already-world-scale geometry. Feeding it this file's local units
// (roughly half scale) would land the ground-contact band, the dust
// threshold, and the cavity sample radius all wrong relative to the actual
// shipped geometry. Only a scratch copy is scaled; the real position
// attribute committed to the GLB is untouched.
// Buckets that are NOT their own material. The two wheels live in their own
// buckets purely so they can be split into separately animatable nodes; they
// are still bronze, and the contract lookup below is keyed by material, so
// without this map they would silently fall through MATERIAL_BY_NAME, get no
// uv attribute, and ship untextured.
const BUCKET_MATERIAL = Object.freeze({ wheelL: 'bronze', wheelR: 'bronze' });

function shadeAllParts(buckets) {
  const parts = [];
  for (const key of Object.keys(buckets)) {
    const materialKey = BUCKET_MATERIAL[key] ?? key;
    for (const part of buckets[key]) parts.push({ ...part, materialKey });
  }

  const boxes = parts.map((part, ownerId) => {
    part.geometry.computeBoundingBox();
    const { min, max } = part.geometry.boundingBox;
    return {
      ownerId,
      min: [min.x * RICKSHAW_SCALE, min.y * RICKSHAW_SCALE, min.z * RICKSHAW_SCALE],
      max: [max.x * RICKSHAW_SCALE, max.y * RICKSHAW_SCALE, max.z * RICKSHAW_SCALE],
    };
  });
  const occluders = buildOccluderIndex(boxes);

  parts.forEach((part, ownerId) => {
    const positions = part.geometry.getAttribute('position').array;
    const normals = part.geometry.getAttribute('normal').array;
    const scaledPositions = new Float32Array(positions.length);
    for (let i = 0; i < positions.length; i++) scaledPositions[i] = positions[i] * RICKSHAW_SCALE;
    const colorOut = new Float32Array(positions.length);
    shadeSurfaceInto(scaledPositions, normals, colorOut, {
      tint: [part.tint.r, part.tint.g, part.tint.b],
      occluders,
      ownerId,
      variation: part.variation,
      seed: ownerId * 97 + 13,
    });
    part.geometry.setAttribute('color', new THREE.BufferAttribute(colorOut, 3));

    // lanternGlow has no material-contract entry (see makeMaterials): it
    // stays untextured, so it gets no uv attribute, matching the deleted
    // uv/uv1 attributes prepareGeometry already strips off every source
    // primitive.
    const contract = MATERIAL_BY_NAME.get(part.materialKey);
    if (contract) {
      const uv = new Float32Array((positions.length / 3) * 2);
      // boxProjectUvInto also wants world-scale positions, same reasoning as
      // shadeSurfaceInto above: uvScale is authored in repeats-per-yard.
      boxProjectUvInto(scaledPositions, normals, uv, contract.uvScale);
      part.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    }
  });

  for (const key of Object.keys(buckets)) {
    buckets[key] = buckets[key].map((part) => part.geometry);
  }
}

function addBox(bucket, size, position, color, rotation = [0, 0, 0]) {
  addGeometry(bucket, new THREE.BoxGeometry(...size), color, { position, rotation });
}

function addRoundedBox(bucket, size, position, color, radius, rotation = [0, 0, 0]) {
  addGeometry(bucket, new RoundedBoxGeometry(size[0], size[1], size[2], 1, radius), color, {
    position,
    rotation,
  });
}

// Cylinder axis defaults to X (a wheel-hub / shaft-pole orientation); pass
// rotation:[0,0,0] explicitly for a Y-axis (upright) cylinder.
function addCylinder(bucket, radiusTop, radiusBottom, length, position, color, options = {}) {
  const geometry = new THREE.CylinderGeometry(
    radiusTop,
    radiusBottom,
    length,
    options.radialSegments ?? 10,
    1,
    options.openEnded ?? false,
  );
  addGeometry(bucket, geometry, color, {
    position,
    rotation: options.rotation ?? [0, 0, Math.PI / 2],
    scale: options.scale,
  });
}

// A domed rivet stud, flattened along `flattenAxis` so it reads as pressed
// into the panel it sits on rather than a floating ball. Same technique as
// scripts/assets/banker_chest/model.js's rivetPoints loop (OctahedronGeometry,
// scale ~0.55 on the panel-normal axis).
function addRivet(bucket, position, color, flattenAxis = 'z') {
  const scale = flattenAxis === 'x' ? [0.55, 1, 1] : [1, 1, 0.55];
  addGeometry(bucket, new THREE.OctahedronGeometry(0.024, 0), color, { position, scale });
}

// A rectangular panel whose top edge is a shallow arch instead of a flat cut:
// straight sides up to the shoulders, then a single quadratic curve to an apex
// `archRise` above them. Returned centered on its own rectangular body (NOT on
// the arch), so an existing addBox call can be swapped for this one without
// moving the panel: the arch is added ON TOP of the old flat top edge rather
// than carved out of it, which keeps every sibling measurement anchored to the
// old top (cushion, bronze frame, rivet rows, wing caps) valid unchanged.
//
// A quadratic Bezier's midpoint sits at 0.25*p0 + 0.5*control + 0.25*p2, so a
// control point at 2*archRise above the shoulders lands the apex at exactly
// archRise -- worth stating because the obvious guess (control AT the apex
// height) produces an arch only half as tall as asked for.
function makeArchedPanel(width, height, depth, archRise, curveSegments = 8) {
  const w = width / 2;
  const h = height / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-w, -h);
  shape.lineTo(w, -h);
  shape.lineTo(w, h);
  shape.quadraticCurveTo(0, h + archRise * 2, -w, h);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments,
    steps: 1,
  });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

// A hanging banner with a swallowtail hem: rectangular, with a notch cut up
// between two tails at the bottom. The notch is what makes a flat slab read as
// heraldic CLOTH instead of a painted board -- there is no cloth simulation
// anywhere in this pipeline, so the silhouette has to do that work alone.
// Lies in the XY plane facing +Z, same convention as banker_chest's makeShield.
function makeDrape(width, height, depth, tailRise) {
  const w = width / 2;
  const h = height / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-w, h);
  shape.lineTo(w, h);
  shape.lineTo(w, -h);
  shape.lineTo(0, -h + tailRise);
  shape.lineTo(-w, -h);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: 1,
    steps: 1,
  });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

// The crest's crenellated tower, as GEOMETRY rather than artwork: this pipeline
// is vertex-color plus procedural TILING maps, so there is no decal path and
// the fabric generator makes weave, not sigils. A stepped outline costs ~40
// triangles and reads cleanly at mount scale. Same layered-slab technique the
// banner's own trim/field pair already uses.
function makeTower(depth) {
  const shape = new THREE.Shape();
  const base = -0.12;
  const merlonTop = 0.12;
  const wallTop = 0.06;
  shape.moveTo(-0.075, base);
  shape.lineTo(0.075, base);
  // right merlon, gap, middle merlon, gap, left merlon
  shape.lineTo(0.075, merlonTop);
  shape.lineTo(0.035, merlonTop);
  shape.lineTo(0.035, wallTop);
  shape.lineTo(0.02, wallTop);
  shape.lineTo(0.02, merlonTop);
  shape.lineTo(-0.02, merlonTop);
  shape.lineTo(-0.02, wallTop);
  shape.lineTo(-0.035, wallTop);
  shape.lineTo(-0.035, merlonTop);
  shape.lineTo(-0.075, merlonTop);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: 1,
    steps: 1,
  });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

// One entry per texture-mapped bucket (lanternGlow is a fifth material but
// stays untextured, see makeMaterials). `surface` names which procedural map
// family (scripts/assets/rickshaw_mount/surface_maps.mjs) this bucket
// samples once the exporter attaches maps; `uvScale` is that family's
// world-space repeat rate, reusing the tank's own UV_SCALE where a bucket
// reuses the tank's generator (bronze -> metal, fabric -> fabric) and a
// value in the same spirit for the two new families (wood needs to be
// coarse enough that a board reads as a board, not a speckle; leather's
// tuft grid needs at least one full diamond visible on the actual cushion
// footprint, which is well under a yard across). Base `color` is left white:
// every part already carries its own distinct vertex tint (wood vs
// woodDark vs woodEdge, etc.), so a tinted material base would double-tint
// on top of that instead of just supplying roughness/metalness/texture.
export const RICKSHAW_MATERIAL_CONTRACT = Object.freeze([
  Object.freeze({ name: 'wood', surface: 'wood', roughness: 0.72, metalness: 0.03, uvScale: 2.6 }),
  Object.freeze({
    name: 'bronze',
    surface: 'bronze',
    roughness: 0.42,
    metalness: 0.68,
    uvScale: 2.6,
  }),
  Object.freeze({
    name: 'leather',
    surface: 'leather',
    roughness: 0.68,
    metalness: 0.0,
    uvScale: 3.2,
  }),
  Object.freeze({
    name: 'fabric',
    surface: 'fabric',
    roughness: 0.82,
    metalness: 0.0,
    uvScale: 4.5,
  }),
]);

const MATERIAL_BY_NAME = new Map(RICKSHAW_MATERIAL_CONTRACT.map((entry) => [entry.name, entry]));

function makeMaterials() {
  const materials = {};
  for (const contract of RICKSHAW_MATERIAL_CONTRACT) {
    materials[contract.name] = new THREE.MeshStandardMaterial({
      name: contract.name,
      color: 0xffffff,
      vertexColors: true,
      metalness: contract.metalness,
      roughness: contract.roughness,
    });
  }
  // Solid emissive, no dynamic light: this mount can be ridden by many
  // players onscreen at once (src/render/CLAUDE.md performance discipline
  // rules out a per-instance point light), so the glow is authored the way
  // src/render/streetlamp_emissive.ts's LAMP_GLASS/LAMP_SOURCE materials
  // are: a flat emissive color/intensity high enough to clear the post
  // composer's bloom threshold (that module's comment documents ~1.1-2.3
  // authored*gain luma as the calibrated "glows without washing to white"
  // range) with no runtime scaling needed since this prop is always lit.
  // Untextured on purpose: it's a small, uniform, always-emissive surface,
  // there's nothing for grain/wear detail to read against.
  materials.lanternGlow = new THREE.MeshStandardMaterial({
    name: 'LanternGlow',
    color: 0xffffff,
    vertexColors: true,
    metalness: 0.0,
    roughness: 0.3,
    emissive: new THREE.Color(PALETTE.lanternGlass),
    emissiveIntensity: 3.2,
  });
  return materials;
}

const WHEEL_RADIUS = 0.52;
const WHEEL_X = 0.42;
// Pulled back under the seat rather than under the footboard, so the wheel's
// FRONT edge (WHEEL_Z + WHEEL_RADIUS = 0.32) sits well behind where the
// puller's pelvis anchors (0.62): the two systems must not overlap in Z.
const WHEEL_Z = -0.2;
const SPOKE_COUNT = 12;
const RIM_RIVET_COUNT = 16;

// The wheel's parts are authored at their FINAL world positions, same as every
// other part in this file, so shadeAllParts still sees true world coordinates
// for its occluder index and ground-contact darkening -- which matters more for
// the wheels than for anything else, since they are the parts nearest the
// ground. They are only re-expressed as node-local at mesh-assembly time
// (addWheelNode), after all shading is done.
function addWheel(bucket, sideX) {
  const buckets = { bronze: bucket };
  const hubDepth = 0.09;
  const center = [sideX, WHEEL_RADIUS, WHEEL_Z];
  // Heavy banded rim: a much thicker main band than v1's plain 0.02-radius
  // torus (reference: detail_wheel crop shows a substantial metal band
  // wrapping the whole rim, not a thin wire edge), plus a slightly larger,
  // thinner trim ring riding just outside it for the layered-band read.
  addGeometry(buckets.bronze, new THREE.TorusGeometry(WHEEL_RADIUS, 0.05, 6, 24), PALETTE.bronze, {
    position: center,
    rotation: [0, Math.PI / 2, 0],
  });
  addGeometry(
    buckets.bronze,
    new THREE.TorusGeometry(WHEEL_RADIUS + 0.045, 0.022, 4, 24),
    PALETTE.bronzeEdge,
    { position: center, rotation: [0, Math.PI / 2, 0] },
  );
  addCylinder(buckets.bronze, 0.09, 0.09, hubDepth, center, PALETTE.bronzeDark, {
    radialSegments: 10,
  });
  addCylinder(
    buckets.bronze,
    0.05,
    0.05,
    hubDepth + 0.02,
    [sideX + (sideX > 0 ? 0.011 : -0.011), WHEEL_RADIUS, WHEEL_Z],
    PALETTE.bronzeEdge,
    { radialSegments: 8 },
  );
  // Each spoke is a box centered at its own MIDPOINT radius (not the hub), so
  // it spans exactly hub-to-near-rim in its own direction: centering at the
  // hub only reaches half the intended radius and makes opposite angles trace
  // the same line (the v1 bug, fixed once and kept fixed here).
  const spokeLength = WHEEL_RADIUS * 0.92;
  const spokeMidRadius = spokeLength / 2;
  for (let i = 0; i < SPOKE_COUNT; i++) {
    const angle = (i / SPOKE_COUNT) * Math.PI * 2;
    const position = [
      sideX,
      WHEEL_RADIUS + spokeMidRadius * Math.cos(angle),
      WHEEL_Z + spokeMidRadius * Math.sin(angle),
    ];
    addBox(
      buckets.bronze,
      [0.028, spokeLength, 0.028],
      position,
      i % 2 === 0 ? PALETTE.bronze : PALETTE.bronzeEdge,
      [angle, 0, 0],
    );
  }
  // Rivet studs around the rim face, matching the reference's banded-and-
  // riveted wheel read.
  for (let i = 0; i < RIM_RIVET_COUNT; i++) {
    const angle = ((i + 0.5) / RIM_RIVET_COUNT) * Math.PI * 2;
    const position = [
      sideX + (sideX > 0 ? 0.026 : -0.026),
      WHEEL_RADIUS + WHEEL_RADIUS * Math.cos(angle),
      WHEEL_Z + WHEEL_RADIUS * Math.sin(angle),
    ];
    addRivet(buckets.bronze, position, PALETTE.bronzeEdge, 'x');
  }
}

// Wheel node names are the contract rickshaw_mount.ts's spinMountWheels looks these up
// by. Rename one here and the wheels silently stop turning, since that lookup
// caches its own failure.
const WHEEL_NODES = Object.freeze([
  Object.freeze({ bucket: 'wheelL', name: 'Wheel_L', sideX: -WHEEL_X }),
  Object.freeze({ bucket: 'wheelR', name: 'Wheel_R', sideX: WHEEL_X }),
]);

function addRunningGear(buckets) {
  for (const wheel of WHEEL_NODES) addWheel(buckets[wheel.bucket], wheel.sideX);
  // Axle bar joining the two hubs, passing behind the seat.
  addCylinder(
    buckets.bronze,
    0.035,
    0.035,
    WHEEL_X * 2 - 0.16,
    [0, WHEEL_RADIUS, WHEEL_Z],
    PALETTE.bronze,
    { radialSegments: 8 },
  );
}

// Seat box top surface is local Y 0.95; every seat-relative measurement below
// (seat-back, wings, cushions, armrests, rivets) is anchored off that and off
// WHEEL_Z, unchanged from v1.
const SEAT_TOP_Y = 0.95;

function addThroneBody(buckets) {
  // Bench seat box, centered over the wheel axle like a real rickshaw's
  // passenger compartment. Unchanged footprint from v1.
  addBox(buckets.wood, [0.68, 0.4, 0.55], [0, 0.75, WHEEL_Z], PALETTE.wood);

  // Seat-back: taller than v1 (top raised from local Y 1.36 to 1.75) so the
  // throne read has somewhere to put a crest and wings; a flat single-plane
  // back the height of a bench back reads as neither throne nor wheelchair,
  // it just reads as a bench.
  const backZ = WHEEL_Z - 0.25;
  // 2026-08-09: the top edge was a flat box cut at local Y 1.75, which -- with
  // two big wheels either side and no canopy -- read as a wheelchair rather
  // than a throne. Arched instead. The reference sheet's own back IS square,
  // so this is a deliberate departure from it, made on a direct call.
  //
  // The arch is added ABOVE the old flat top (shoulders stay at 1.75, apex
  // rises to 1.90) rather than curving down from it. Two reasons, both
  // load-bearing: the back cushion (square, top at 1.675) and its bronze frame
  // would poke through the shoulders of any arch that dropped below 1.675 at
  // the cushion's own half-width, and keeping the shoulders put means the
  // rivet rows, wing caps, and cushion all stay valid without re-measurement.
  // Apex 1.90 is still well under the lantern's own reach (local ~2.43), so
  // RICKSHAW_NATIVE_BOUNDS.height does not move -- verified after export, not
  // assumed, since a stale value there silently desyncs the runtime rescale.
  addGeometry(buckets.wood, makeArchedPanel(0.64, 0.81, 0.08, 0.15), PALETTE.woodDark, {
    position: [0, 1.345, backZ],
  });
  // A bronze "crest cap" cone used to sit here. Removed 2026-08-08: it was
  // never in the reference sheet and isn't a real rickshaw feature, it was
  // invented in an earlier authoring pass to help the seat-back read as a
  // throne. That job is already covered, twice over, by the wings below
  // (their own header comment calls them out as THE feature that reads as
  // throne rather than bench) plus the wings' own finial ornaments, and the
  // crest/heraldry identity is already carried by addBanner(). A live look
  // flagged the cone as reading like a lampshade and clipping into the
  // rider's head; narrowing/repositioning it fixed the clipping but not the
  // real problem, which was that it was redundant clutter with no basis in
  // the reference to begin with. Cut rather than re-tuned a third time.

  // Throne wings: two side panels flanking the upper seat-back. This is the
  // single feature that reads as throne rather than bench: it widens the
  // silhouette above shoulder height.
  //
  // 2026-08-08: these used to carry a +-0.3 rad "flare" rotation meant to
  // angle the front edge OUTWARD (the comment's own stated intent). The sign
  // was actually backwards: rotating the local +Z face by that angle moves
  // it TOWARD center, not away, on both sides. A live look correctly flagged
  // this as pinching the rider rather than framing them. Rather than just
  // fixing the sign, set flat/perpendicular per that feedback: parallel
  // panels read as sturdy armor plate flanking the seat, which fits this
  // riveted-bronze-on-wood furniture better than a flared wingback chair
  // shape would anyway.
  // 2026-08-09: the wings used to be 0.4 deep centered on backZ, which put
  // them 0.16 BEHIND the back panel's own rear face (-0.49) as well as 0.16
  // in front of it. Top-down that made the seat back a literal H -- panel as
  // the crossbar, two thin 0.08-wide legs overhanging at both ends -- and the
  // rear overhang specifically read as wheelchair push handles from behind.
  // Trimmed to sit flush at the rear (depth 0.24 centered at backZ + 0.08 =
  // -0.37, so the rear edge lands exactly on the panel's -0.49) while keeping
  // the forward reach unchanged at -0.25. Plan shape is now a U opening
  // forward: crossbar behind, arms reaching forward to frame the rider, which
  // is what an armchair/throne actually looks like from above.
  const WING_HEIGHT = 0.55;
  const WING_Y = 1.25;
  const WING_DEPTH = 0.24;
  const WING_Z = backZ + 0.08;
  const rotation = [0, 0, 0];
  for (const sideX of [-0.36, 0.36]) {
    addBox(
      buckets.wood,
      [0.08, WING_HEIGHT, WING_DEPTH],
      [sideX, WING_Y, WING_Z],
      PALETTE.woodDark,
      rotation,
    );
    // A bronze finial SPHERE used to cap each wing here. Removed 2026-08-08:
    // a live look flagged it as reading like a ball glued onto a flat panel
    // with nothing visibly supporting it, because nothing about a floating
    // sphere reads as "the top edge of this wing" from any angle where the
    // wing's own thin silhouette is hard to pick out -- the same
    // disconnected-ornament problem the seat-back's cone-shaped crest cap
    // had (see that removal note above), just one level down. Replaced with
    // a bronze cap PLATE sized to the wing's own footprint and given the
    // wing's own rotation, so it reads as a capped/bound edge (matching the
    // "riveted bronze-on-wood construction" language the rest of the frame
    // already carries) rather than an ornament stuck on top.
    const capY = WING_Y + WING_HEIGHT / 2 + 0.015;
    // Depth tracks WING_DEPTH with the same 0.01 proud overhang per end the
    // cap has always had (was 0.42 over a 0.4 wing), so trimming the wing
    // can't leave the cap hanging out past the edge it is supposed to cap.
    addBox(
      buckets.bronze,
      [0.1, 0.03, WING_DEPTH + 0.02],
      [sideX, capY, WING_Z],
      PALETTE.bronzeEdge,
      rotation,
    );
  }

  // Armrests: a support post rising from the seat top to a horizontal bar at
  // hand height, replacing v1's flat rub-rail (which read as a structural
  // rail, not a seat arm).
  for (const sideX of [-0.34, 0.34]) {
    addBox(buckets.bronze, [0.045, 0.2, 0.045], [sideX, 1.05, WHEEL_Z + 0.15], PALETTE.bronze);
    addBox(buckets.bronze, [0.045, 0.045, 0.42], [sideX, 1.15, WHEEL_Z + 0.15], PALETTE.bronzeEdge);
  }

  // Footboard: a flat step just forward of the seat. Kept at v1's measured
  // position (local Y 0.975, Z 0.185): raising Socket_Rider for the new
  // cushion turned out NOT to raise the seated rider's actual foot-bone
  // position (measured live: local Y ~1.05, Z ~0.09-0.19, identical to v1's
  // own measurement before the cushion existed), so v1's footboard height was
  // already correct and did not need to move. Re-measured, not assumed.
  addBox(buckets.wood, [0.5, 0.05, 0.22], [0, 0.975, 0.185], PALETTE.woodEdge);

  // Cross-strut under the seat, tying the two side rails to the axle bar.
  addBox(buckets.bronze, [0.62, 0.05, 0.05], [0, 0.56, WHEEL_Z - 0.13], PALETTE.bronze);

  // Rivet studs along the seat box front face and the seat-back face,
  // matching the reference's riveted-panel-edge language (banker_chest
  // precedent: scripts/assets/banker_chest/model.js's rivetPoints loop).
  const seatFrontZ = WHEEL_Z + 0.276;
  for (const y of [0.6, 0.9]) {
    for (const x of [-0.28, -0.09, 0.09, 0.28]) {
      addRivet(buckets.bronze, [x, y, seatFrontZ], PALETTE.bronzeEdge, 'z');
    }
  }
  const backFrontZ = backZ + 0.041;
  for (const y of [1.0, 1.3, 1.6]) {
    for (const x of [-0.28, 0.28]) {
      addRivet(buckets.bronze, [x, y, backFrontZ], PALETTE.bronzeEdge, 'z');
    }
  }
}

function addCushions(buckets) {
  // Seat cushion: proud of the wood box top, pillowy (RoundedBoxGeometry, not
  // a hard-edged box) rather than a flat painted-on cushion shape. Widened
  // against the seat box's own 0.68/0.55 footprint (was 0.62/0.5, a strip
  // down the middle that left visible wood margins) so the cushion reads as
  // the dominant surface a rider would actually sit on.
  addRoundedBox(
    buckets.leather,
    [0.64, 0.14, 0.52],
    [0, SEAT_TOP_Y + 0.07, WHEEL_Z],
    PALETTE.cushion,
    0.05,
  );
  // Seat-back cushion, proud of the seat-back's front face. Widened against
  // the 0.64/0.81 back panel (was 0.5/0.7) for the same reason: this is the
  // panel a player looks straight at from behind, so it needs to read as an
  // upholstered throne back on sight, not wood with a colored insert.
  const backZ = WHEEL_Z - 0.25;
  const backCushionZ = backZ + 0.04 + 0.045;
  const backCushionW = 0.58;
  const backCushionH = 0.75;
  addRoundedBox(
    buckets.leather,
    [backCushionW, backCushionH, 0.09],
    [0, 1.3, backCushionZ],
    PALETTE.cushion,
    0.045,
  );

  // Bronze frame around the back cushion's own edge, proud of the cushion
  // face by a hair to avoid z-fighting: this is what reads it as an
  // upholstered, FRAMED panel (furniture) rather than a colored slab glued
  // to the wood. Bars overlap at the corners so the frame reads continuous.
  const frameZ = backCushionZ + 0.05;
  const frameHalfW = backCushionW / 2 + 0.015;
  const frameHalfH = backCushionH / 2 + 0.015;
  for (const y of [1.3 - frameHalfH, 1.3 + frameHalfH]) {
    addBox(buckets.bronze, [frameHalfW * 2 + 0.04, 0.03, 0.02], [0, y, frameZ], PALETTE.bronzeEdge);
  }
  for (const x of [-frameHalfW, frameHalfW]) {
    addBox(
      buckets.bronze,
      [0.03, frameHalfH * 2 + 0.04, 0.02],
      [x, 1.3, frameZ],
      PALETTE.bronzeEdge,
    );
  }

  // Button studs suggesting diamond tufting (a grid of small dark studs
  // pressed into the cushion faces), not an authored UV quilting pattern
  // (this pipeline is vertex-color only). Spread to match the wider cushions.
  const backStudZ = backCushionZ + 0.046;
  for (const y of [1.0, 1.3, 1.6]) {
    for (const x of [-0.17, 0.17]) {
      addRivet(buckets.leather, [x, y, backStudZ], PALETTE.cushionStud, 'z');
    }
  }
  const seatStudY = SEAT_TOP_Y + 0.14 + 0.005;
  for (const x of [-0.17, 0.17]) {
    for (const z of [WHEEL_Z - 0.15, WHEEL_Z + 0.15]) {
      addRivet(buckets.leather, [x, seatStudY, z], PALETTE.cushionStud, 'y');
    }
  }
}

// Crest banner hung down the BACK of the seat.
//
// 2026-08-09: this used to be a small pennant on the LEFT flank at local
// [-0.36, 0.85], for an asymmetric silhouette against the lantern. It was
// never visible: the seat box's side face is at X -0.34 and the wheel's rim
// reaches X -0.37, so the pennant lived inside a 0.03 gap and was occluded by
// the wheel from every angle that could otherwise have seen it. It was paying
// real triangles for nothing. Moved to the rear face, which also fixes the
// actual complaint that sent us here -- an empty flat back reading as a
// wheelchair rather than a throne.
//
// Hung from just under the arch and down the back only, deliberately not over
// the top and down the front: the front is where the tufted cushion and its
// bronze frame live, and draping over them would bury the work that already
// reads well. Three layered slabs, back to front as seen from behind: cream
// trim, green field, grey tower.
function addBanner(buckets) {
  // Panel rear face is backZ - 0.04; each layer sits proud of the last so the
  // stack reads as trim behind field behind sigil from the rear camera.
  const panelRearZ = WHEEL_Z - 0.25 - 0.04;
  // 2026-08-09: dropped 0.06 and the relief flattened. The three layers used to
  // carry different slab depths (0.014/0.014/0.012) at uneven 0.007-0.010
  // spacings, which stacked to ~0.032 local of total relief -- read as three
  // boards screwed on top of each other rather than one embossed banner. All
  // three now share one thickness at one even spacing, just enough to keep the
  // layers ordered without z-fighting.
  const centerY = 1.325;
  const LAYER_DEPTH = 0.012;
  const LAYER_STEP = 0.003;
  // Widths are bounded by the ARCH, not the panel: at the trim's own half-width
  // of 0.25 the arch has already fallen to Y 1.808, so the corners have to stay
  // under that or they poke through the crown.
  addGeometry(buckets.fabric, makeDrape(0.5, 0.8, LAYER_DEPTH, 0.135), PALETTE.bannerTrim, {
    position: [0, centerY, panelRearZ - LAYER_STEP],
  });
  addGeometry(buckets.fabric, makeDrape(0.46, 0.78, LAYER_DEPTH, 0.13), PALETTE.bannerField, {
    position: [0, centerY, panelRearZ - LAYER_STEP * 2],
  });
  addGeometry(buckets.fabric, makeTower(LAYER_DEPTH), PALETTE.crest, {
    position: [0, centerY + 0.035, panelRearZ - LAYER_STEP * 3],
  });
}

// Mounted on the RIGHT side, opposite the banner. A 2-segment bent bracket
// arm (post up, then out-and-forward) rising from the right throne wing,
// ending in a small hex lantern cage with an emissive glass core. No
// procedural chain: the reference's bracket-to-lantern link is a single small
// hanging ring here, not the cut chain-harness detail.
//
// Re-measured 2026-08-08: the original hook reached all the way to local
// Z 0.0 (roughly level with the seat front), only ~0.37 units above and
// ~0.19 units in front of the rider's own measured head position (local
// ~[0, 1.43, -0.19]), close enough that from a side/three-quarter camera
// the cage visually overlapped the rider's head ("looks like a cymbal
// clipping through the head"). The arm now stays closer to the wing (hook Z
// -0.3 instead of 0.0, well behind the head instead of roughly level with
// it) and reaches higher (hook Y 2.35 instead of 2.05), for real clearance
// on both axes instead of a near-miss.
// 2026-08-08: redesigned the whole bracket-to-cage connection. The old
// design brought the arm in on a DIAGONAL final approach (rising and moving
// forward at once) ending at a small hanging ring floating 0.1 units above
// the cage's own top surface, with nothing visibly bridging that gap. A live
// look called this out directly: it reads as the arm being bolted to the
// SIDE of the cage, which no one would actually build, and correctly pointed
// out that a real lantern hangs from a suspension at its top (or sits on a
// bracket at its bottom), never its side. Two changes: the arm's final
// approach is now purely VERTICAL, straight down onto the cage's own
// vertical centerline, so it unambiguously reads as top-mounted from any
// angle; and the connection is a flush bronze cap plate (same fix pattern as
// the throne wings' bronze caps above) rather than a small ring floating
// over a gap, since a moving cart is a bad place for an actually-swinging
// chain-hung lantern anyway. A rigid bracket mount is the realistic choice
// for a lamp that has to survive rickshaw potholes, not just the cleaner one
// to build.
function addLantern(buckets) {
  const sideX = 0.36;
  const backZ = WHEEL_Z - 0.25;
  const armY = 2.3;
  // The cage hangs straight down from the out bar's end: same Z as the post,
  // so the arm is a single up-then-out bracket. See the note where the old
  // forward segment used to be.
  const hookZ = backZ;

  // 2026-08-09, all three arm joints: every segment used to stop at the NEXT
  // segment's centerline rather than passing through its far face, so each
  // corner showed a 0.0225 step (exactly half a bar) where one member's face
  // stuck out past the other's. A live look flagged all three independently.
  // First fix ran each member 0.01 PAST the other's far face, which traded the
  // step for a visible tail at all three corners on a live look. Corrected to
  // the opposite rule: a terminating member now stops JOINT_BURY *short* of
  // the through member's far face, so its end cap is buried inside solid
  // geometry. Buried beats flush and beats proud -- flush makes the two faces
  // coplanar and z-fights, proud leaves the tail. The leftover void is at most
  // a JOINT_BURY-square notch tucked in the corner, 0.004 world units, well
  // under anything visible at mount scale.
  const BAR = 0.045;
  const BAR_HALF = BAR / 2;
  const JOINT_BURY = 0.002;

  // Vertical post rising from the wing top, ending just inside the
  // horizontal-out bar's own top face rather than poking through it.
  const postTop = armY + BAR_HALF - JOINT_BURY;
  const postBottom = 1.55;
  addBox(
    buckets.bronze,
    [BAR, postTop - postBottom, BAR],
    [sideX, (postTop + postBottom) / 2, backZ],
    PALETTE.bronze,
  );

  // Horizontal-out segment (BoxGeometry's own X length needs no rotation).
  // Reaches to just inside the forward segment's outer face, so the corner
  // cube is filled by both members instead of this one stopping at the
  // forward segment's centerline and leaving the outer half hollow.
  const outTipX = 0.55;
  const outEndX = outTipX + BAR_HALF - JOINT_BURY;
  addBox(
    buckets.bronze,
    [outEndX - sideX, BAR, BAR],
    [(sideX + outEndX) / 2, armY, backZ],
    PALETTE.bronze,
  );

  // 2026-08-09: a third, horizontal-FORWARD segment used to run from here to
  // hookZ -0.3 before the drop, making the arm turn twice (up, out, forward,
  // down). A live look called the three-angle path unnatural, and it was: no
  // bracket needs two turns to reach a point it can reach with one. Deleted,
  // and hookZ now simply equals backZ so the cage hangs directly under the
  // out bar's own end.
  //
  // The forward run existed for head clearance, and removing it IMPROVES that
  // rather than costing it: the rider's head measures local ~[0, 1.43, -0.19]
  // and the cage moves from Z -0.3 to -0.45, further BEHIND him, not closer.
  // (That segment was also the one carrying the inside-out negative-depth bug
  // fixed earlier the same day; it is gone with it.)

  // Vertical drop straight down onto the cage's own centerline, ending flush
  // against the cage's OWN top cap (defined right below, at cageY + 0.085,
  // half-thickness 0.01): this is the segment that actually reads as
  // "mounted from above" instead of "speared in from the side," and it
  // terminates at real geometry instead of floating over a gap.
  //
  // 2026-08-09: this segment read as a different material from the rest of the
  // arm on a live look. It was tinted PALETTE.bronzeEdge while the post, the
  // out bar and the forward bar are all PALETTE.bronze -- the buckets share
  // one material and one texture, so the whole difference was the per-part
  // vertex tint the shading multiplies against. bronzeEdge is the right choice
  // for genuine edge/trim pieces (cage caps, wing caps, frame bars); this is a
  // structural run of the same arm and should match it. Its bottom also ended
  // exactly ON the cage cap's outer face, coplanar; buried by JOINT_BURY now
  // like every other joint.
  const cageY = armY - 0.155;
  const dropBottom = cageY + 0.095 - JOINT_BURY;
  addBox(
    buckets.bronze,
    [BAR, armY - dropBottom, BAR],
    [outTipX, (armY + dropBottom) / 2, hookZ],
    PALETTE.bronze,
  );

  // Cage: 6 corner posts plus top/bottom hex caps around an emissive glass
  // core. Hex tube (openEnded cylinder) as the frame shell reads as a lantern
  // cage silhouette without modelling individual mullions.
  //
  // 2026-08-08: a live look, zoomed in close, caught the corner posts'
  // rounded ends poking past the top/bottom caps -- each post's outer edge
  // (cageRadius + its own 0.012 radius = 0.102) reached past the caps' own
  // 0.1 radius, so a sliver of every post cleared the cap's rim instead of
  // burying inside it. Caps widened to 0.13, comfortably past 0.102 with
  // real margin, and the posts shortened slightly (0.16 -> 0.15) for the
  // same reason from the vertical side. Separately: the glass core sat at
  // 0.075 radius against the posts' own 0.09 centerline (0.078 at their
  // inner edge), leaving a visible dark gap between "the glass" and "the
  // bars" that made the glow read as a dim rod deep inside the cage rather
  // than panes filling it. Widened to 0.086 (just inside the posts) and
  // raised to 0.15 tall (matching the posts) so it reads as glass actually
  // filling each gap between the bars, not a candle glimpsed through them.
  const hook = [outTipX, armY, hookZ];
  const cageRadius = 0.09;
  // 0.15 left the posts' and glass's ends exactly tangent to the caps' inner
  // faces (both at cageY +- 0.075), coplanar surfaces that z-fight. 0.17 buries
  // both ends 0.01 into each cap while still stopping 0.01 short of the caps'
  // outer faces, so nothing pokes through -- the same joint-overrun rule the
  // arm segments above now follow.
  const postHeight = 0.17;
  const capRadius = 0.13;
  // 2026-08-09: a BRONZE hex tube shell used to sit here at cageRadius (0.09),
  // described as reading "as a lantern cage silhouette without modelling
  // individual mullions". It was an opaque wall, and the emissive glass core
  // below sits at 0.086 -- entirely INSIDE it, at every angle (hex apothem
  // 0.0745 vs the shell's 0.0779, hex vertex 0.086 vs the shell's 0.09). So
  // the glow was fully occluded by its own cage and could never be seen, which
  // is why the lantern never lit at night while the skeletons' eyes did: the
  // eyes and this glass share the exact same 'Glow'-named emissive path, and
  // nothing was wrong with the material. Removed rather than re-tuned: the six
  // corner posts below plus the two caps already ARE the cage, and with the
  // shell gone the glass fills the gaps between them, which is both what a
  // lantern actually looks like and what the reference sheet shows.
  addCylinder(
    buckets.bronze,
    capRadius,
    capRadius,
    0.02,
    [outTipX, cageY + 0.085, hook[2]],
    PALETTE.bronzeEdge,
    { rotation: [0, 0, 0], radialSegments: 6 },
  );
  addCylinder(
    buckets.bronze,
    capRadius,
    capRadius,
    0.02,
    [outTipX, cageY - 0.085, hook[2]],
    PALETTE.bronzeEdge,
    { rotation: [0, 0, 0], radialSegments: 6 },
  );
  // Shallow hex roof over the top cap, tapering up until it vanishes inside
  // the vertical drop bar. Without it the cage reads as a plain cylinder with
  // a lid; a roof is what makes a lantern look like a lantern. Deliberately
  // NOT pointy -- it stops as soon as it is narrow enough to be swallowed by
  // the bar (top radius 0.018 against the bar's own 0.0225 half-width), so it
  // reads as the roof running into its own mount rather than a spike stuck on
  // top. Base buried JOINT_BURY into the cap for the usual reason.
  const roofBottom = cageY + 0.095 - JOINT_BURY;
  const roofTop = armY - 0.015; // still inside the drop bar, which ends at armY
  addCylinder(
    buckets.bronze,
    0.018,
    capRadius,
    roofTop - roofBottom,
    [outTipX, (roofBottom + roofTop) / 2, hook[2]],
    PALETTE.bronzeEdge,
    { rotation: [0, 0, 0], radialSegments: 6 },
  );
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    addCylinder(
      buckets.bronze,
      0.012,
      0.012,
      postHeight,
      [outTipX + cageRadius * Math.cos(a), cageY, hook[2] + cageRadius * Math.sin(a)],
      PALETTE.bronzeEdge,
      { rotation: [0, 0, 0], radialSegments: 6 },
    );
  }
  addCylinder(
    buckets.lanternGlow,
    0.086,
    0.086,
    postHeight,
    [outTipX, cageY, hook[2]],
    PALETTE.lanternGlass,
    { rotation: [0, 0, 0], radialSegments: 6 },
  );
}

// Shaft base sits at the axle line, like a real rickshaw's shafts. The tip
// position is the puller's own idle-pose handslot.l/r bone position, measured
// live in the client. Re-measured 2026-08-08 against player_warrior (the
// knight standing in for the still-broken skeleton rig, see
// rickshaw_mount.ts): its idle-pose hands rest lower (world Y ~2.05 vs the
// skeleton's ~2.27) and noticeably closer together (world X spread ~0.88 vs
// ~1.5) than the skeleton's did, and the old cross-brace sat close enough to
// the puller's own root (1.15 world units out vs the puller standing 1.1 out)
// that there was barely any visible reach between puller and cart at all,
// which is the "too close" a live look flagged. Fixed together with
// RICKSHAW_PULLER_OFFSET_Z in rickshaw_mount.ts (standing the puller 0.3
// world units further out) so the shaft has real length to it; these values
// are measured against that NEW offset, not the old 1.1.
//
// 2026-08-08: with the real skel_minion puller now live (and the X-centering
// bug fixed, see the root-position comment near the bottom of this file), a
// live look flagged the poles as still too short and the puller still
// standing too close to the rider. SHAFT_TIP_Z extended 0.743 -> 0.943 (+0.2
// local, +0.4 world) and RICKSHAW_PULLER_OFFSET_Z moved the matching +0.4
// world units (1.4 -> 1.8) in the same change, so the puller's hands keep
// tracking the cross-brace grip point instead of drifting from it.
// 2026-08-09: now that the puller has a real gait (renderer.ts feeds him the
// rider's own locomotion state instead of a fixed idle), a live look asked to
// attach the grip to his belt rather than his hands, since hand position
// swings a lot during a walk cycle and hips barely move. Measured live: his
// hip bone sits at world offset [0, ~0.46-0.51, 1.8] from the cart origin
// across a walk cycle (barely any Y/Z range) -- SHAFT_TIP_Y/Z moved from
// [0.274, 0.943] (world [0.548, 1.886], the old hand-height target) to
// [0.242, 0.9] (world [0.485, 1.8]) to match. SHAFT_SIDE_X unchanged: his
// hip-bone X is 0 (dead center), but the belt sits at his body's actual
// width, not the centerline, and the existing side spread already reads
// close ("mere pixels" of gap at the worst point of the gait per that live
// look), so it stays put rather than guessing a new number without a real
// body-width measurement to move it against.
// 2026-08-09, measured properly at last (tmp/measure_belt.mjs: 120 samples per
// clip through the real runtime transform chain, no browser). Two things the
// earlier "measured live" pass got wrong, both because it only sampled a WALK:
//
//  - Travel. Hips run 0.4454-0.5572 world across Idle + Walking_A + Running_A,
//    a 0.112 envelope -- Running_A alone is 0.103, nearly double the walk's
//    0.055. X travel, Z travel and yaw range are all exactly ZERO in those
//    clips, so this is a pure one-axis problem.
//  - Width. SHAFT_SIDE_X was left at 0.219 (world +-0.438) on an eyeballed
//    "mere pixels of gap" read. His waist half-width is 0.256 world, so the
//    shaft tips missed his body by 0.182 PER SIDE and the old full-width
//    cross-brace ran clean through his pelvis and out the other side.
//
// The belt band is 0.089 tall, from -0.029 to +0.060 relative to the hips
// bone. Against 0.112 of travel that means NO fixed height stays inside it:
// the lowest the band's top ever reaches (0.5053) is below the highest its
// bottom ever reaches (0.5279), so the always-inside window is empty. Hence
// the collar below rather than a small ring -- it is oversized along the axis
// of travel, so the overlap is guaranteed by construction instead of tuned.
// SHAFT_TIP_Y is the midpoint of that window: 0.517 world.
const SHAFT_BASE_Z = WHEEL_Z;
const SHAFT_TIP_Y = 0.2585;
const SHAFT_TIP_Z = 0.9;
const SHAFT_SIDE_X = 0.219;
// Waist, measured in the Idle pose from hips-dominant verts within +-0.04 of
// the hips bone (a +-0.06 band starts catching thigh tops and reports the
// waist half again as deep; +-0.02 and +-0.04 agree, so the number is stable):
// half-width 0.256 world, half-depth 0.224 world, centered on Z 1.799 ~= the
// shaft tips' own 1.8. Local = world / RICKSHAW_SCALE.
const WAIST_HALF_X = 0.1279;
const WAIST_HALF_Z = 0.1121;
// Proud of the body by 0.008 local (0.016 world) so the collar reads as worn
// OVER him with a clear margin, rather than grazing the skin and shimmering.
const COLLAR_MARGIN = 0.008;
const COLLAR_HEIGHT = 0.045;

function addShafts(buckets) {
  for (const sideX of [-SHAFT_SIDE_X, SHAFT_SIDE_X]) {
    const base = [sideX, 0.55, SHAFT_BASE_Z];
    const tip = [sideX, SHAFT_TIP_Y, SHAFT_TIP_Z];
    const dy = tip[1] - base[1];
    const dz = tip[2] - base[2];
    const length = Math.hypot(dy, dz);
    const angle = -Math.atan2(dy, dz);
    const mid = [sideX, (base[1] + tip[1]) / 2, (base[2] + tip[2]) / 2];
    addBox(buckets.bronze, [0.045, 0.045, length], mid, PALETTE.bronze, [angle, 0, 0]);
  }
  // The full-width cross-brace that used to sit here spanned +-0.249 local
  // (+-0.498 world) against a 0.256 world waist half-width, so it entered one
  // side of the puller's pelvis and came out the other -- a spit through his
  // belly, which is what reads as "the bars intersect his waist". Replaced by
  // two stubs that stop INSIDE the harness collar, so the bar visibly
  // terminates at the harness instead of skewering him.
  const collarX = WAIST_HALF_X + COLLAR_MARGIN;
  const stubInnerX = collarX - 0.036; // buried well inside the collar wall
  for (const side of [-1, 1]) {
    const inner = side * stubInnerX;
    const outer = side * SHAFT_SIDE_X;
    addBox(
      buckets.bronze,
      [Math.abs(outer - inner), 0.045, 0.045],
      [(inner + outer) / 2, SHAFT_TIP_Y, SHAFT_TIP_Z],
      PALETTE.bronze,
    );
  }

  // Harness collar: a leather band wrapping the puller's waist, sized from his
  // measured waist plus COLLAR_MARGIN and given COLLAR_HEIGHT so it still
  // overlaps his belt at both extremes of the gait (checked against the
  // envelope: 0.034 world of margin spare at the top AND the bottom). Open
  // ended on purpose -- a capped cylinder's end discs would slice straight
  // through his hips. Elliptical via scale, since he is wider than he is deep.
  addCylinder(
    buckets.leather,
    collarX,
    collarX,
    COLLAR_HEIGHT,
    [0, SHAFT_TIP_Y, SHAFT_TIP_Z],
    PALETTE.harness,
    {
      rotation: [0, 0, 0],
      radialSegments: 12,
      openEnded: true,
      scale: [1, 1, (WAIST_HALF_Z + COLLAR_MARGIN) / collarX],
    },
  );
}

// NO wheel clips, deliberately -- the renderer spins these nodes procedurally
// instead (src/render/rickshaw_mount.ts, spinMountWheels). Two authored attempts failed, both
// for the same underlying reason, and the notes are here so nobody rebuilds
// them:
//
//  1. Clips with an Idle that pinned the wheels to identity. Stopping
//     crossfades Run out and Idle in, so the wheel quaternion interpolated
//     from wherever the gait left it back to zero along the shortest arc: up
//     to half a turn of visible BACKWARDS spin on every stop.
//  2. Clips with a track-less Idle, to stop anything binding the wheel. A
//     clip with no channels is invalid glTF so the exporter drops it, and
//     visual.ts's fadeTo opens with `if (!next) return` -- with no Idle action
//     to fade TO, the Run action is never stopped and the wheels spin forever.
//
// Putting a real Idle back would just restore failure 1, because the mixer
// fills any weight deficit from an action's ORIGINAL cached value: as Run
// fades out the wheel is dragged back toward its bind rotation regardless of
// what Idle does. A crossfade cannot express "hold exactly where you are."
//
// Procedural rotation can, and is the honest model anyway: wheel angle is a
// pure function of ground speed, so it tracks input exactly and stops dead the
// frame speed hits zero. The wheels stay their own NODES for that renderer to
// drive -- that part of the restructure was still needed.

// A wheel becomes its own node so the renderer can rotate it: you cannot
// rotate a sub-region of a merged mesh, which is exactly why the wheels had to
// leave the shared bronze bucket. The geometry is authored in world space and
// re-expressed as node-local here (translate by -center, then position the node
// at center), so the visible result is identical until a clip touches it.
function addWheelNode(root, bucket, material, name, center) {
  const geometry = mergeGeometries(bucket, false);
  if (!geometry) return null;
  geometry.translate(-center[0], -center[1], -center[2]);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.fromArray(center);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  root.add(mesh);
  return mesh;
}

function addSemanticMesh(root, bucket, material, name) {
  const geometry = mergeGeometries(bucket, false);
  if (!geometry) return;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  root.add(mesh);
}

export function createRickshawMount({ sourceFingerprint = null } = {}) {
  const root = new THREE.Group();
  root.name = 'RickshawMount';
  root.userData = {
    assetId: 'rickshaw-mount',
    assetType: 'rideable-mount',
    sourceFingerprint,
    frontAxis: [0, 0, 1],
    nativeBounds: RICKSHAW_NATIVE_BOUNDS,
    // No clips: the wheels spin procedurally from the renderer (see the note
    // above WHEEL_NODES), and the body's motion is mount_visuals.ts's procedural
    // bob, which is applied to the rider and the puller too and so must not be
    // baked here.
    clips: [],
  };

  const buckets = {
    wood: [],
    bronze: [],
    leather: [],
    fabric: [],
    lanternGlow: [],
    wheelL: [],
    wheelR: [],
  };
  const materials = makeMaterials();

  addRunningGear(buckets);
  addThroneBody(buckets);
  addCushions(buckets);
  addBanner(buckets);
  addLantern(buckets);
  addShafts(buckets);

  shadeAllParts(buckets);

  const meshDefs = [
    ['wood', 'RickshawWood'],
    ['bronze', 'RickshawBronze'],
    ['leather', 'RickshawLeather'],
    ['fabric', 'RickshawFabric'],
    ['lanternGlow', 'RickshawLanternGlow'],
  ];
  for (const [key, name] of meshDefs) {
    addSemanticMesh(root, buckets[key], materials[key], name);
  }
  for (const wheel of WHEEL_NODES) {
    addWheelNode(root, buckets[wheel.bucket], materials.bronze, wheel.name, [
      wheel.sideX,
      WHEEL_RADIUS,
      WHEEL_Z,
    ]);
  }

  const riderSocket = new THREE.Object3D();
  riderSocket.name = RICKSHAW_SOCKET_DEFINITIONS[0].nodeName;
  riderSocket.position.fromArray(RICKSHAW_SOCKET_DEFINITIONS[0].position);
  riderSocket.userData = {
    socketType: 'rider-seat',
    purpose: RICKSHAW_SOCKET_DEFINITIONS[0].purpose,
  };
  root.add(riderSocket);

  const pullerSocket = new THREE.Object3D();
  pullerSocket.name = RICKSHAW_SOCKET_DEFINITIONS[1].nodeName;
  pullerSocket.position.fromArray(RICKSHAW_SOCKET_DEFINITIONS[1].position);
  pullerSocket.userData = {
    socketType: 'attached-character',
    purpose: RICKSHAW_SOCKET_DEFINITIONS[1].purpose,
  };
  root.add(pullerSocket);

  root.traverse((object) => {
    if (object.isMesh) object.frustumCulled = true;
  });
  // Scale BEFORE computing the floor-seat/center bounds, so Box3 reads the
  // true scaled world extents: position is a parent-space translation, not
  // itself affected by the object's own scale, so floor-seating computed
  // against the unscaled bounds would leave the model floating or sunk once
  // RICKSHAW_SCALE is applied afterward.
  root.scale.setScalar(RICKSHAW_SCALE);
  root.updateMatrixWorld(true);

  // X is deliberately NOT centered on the bounding box: every structural
  // piece (wheels at +-WHEEL_X, shafts at +-SHAFT_SIDE_X, seat/wings/
  // armrests/cushion) is authored symmetric about local X=0 already, and the
  // rider socket, puller socket, and the shaft cross-brace grip point are all
  // calibrated against that same X=0 centerline. The lantern (right side
  // only) and banner (left side only, different size) are an intentional
  // asymmetric silhouette (see addLantern/addBanner), so bounds.getCenter().x
  // is skewed off 0 by whichever one reaches further out -- centering X on
  // that pulled the WHOLE cart (shafts included) sideways relative to the
  // puller rig, which attaches at a fixed, unshifted world offset
  // (RICKSHAW_PULLER_OFFSET_Z in rickshaw_mount.ts) and never saw this
  // shift: the puller stayed put while the shaft bars slid out from under his
  // hands. Confirmed live (2026-08-08): the shaft/cross-brace band measured
  // -0.66 to +0.33 relative to the puller's true center before this fix,
  // now 0.
  //
  // 2026-08-09: Z had exactly the same bug, left behind when X was fixed.
  // Centering on bounds.getCenter().z made every authored Z coordinate mean
  // something different from what it says, by an offset that MOVED whenever
  // any geometry changed. Measured: authored Z ran -1.574..2.040, center
  // 0.2331, so the shaft tips authored at world 1.8 actually shipped at
  // 1.5669 while RICKSHAW_PULLER_OFFSET_Z put the puller's hips at a fixed
  // 1.8 -- the bars fell 0.2331 short of his waist. It was 0.1355 short even
  // before the harness collar existed; adding the collar extended the model
  // forward, moved the center, and grew the error until it was obvious.
  // Pinned to the authored 0 for the same reason X is, so SHAFT_TIP_Z * 2
  // and RICKSHAW_PULLER_OFFSET_Z finally denote the same world Z, and a
  // future geometry change cannot silently slide the cart out from under the
  // puller again. Y still floor-seats: that one is a real invariant (wheels
  // on the ground), not a centering convenience.
  const bounds = new THREE.Box3().setFromObject(root);
  root.position.set(0, -bounds.min.y, 0);
  root.updateMatrixWorld(true);
  return root;
}
