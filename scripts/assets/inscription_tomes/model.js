// Deterministic procedural factory for the Masterwrought inscription tomes
// (silverleaf_primer / goldleaf_folio / sunpetal_grimoire from phase 06, plus
// the phase 09 apex voidbound_grimoire), the first held_offhand item models.
// Authored from the committed item-icon SVG sources, which are this repo's own
// art: reference rights and provenance are already recorded in
// public/ui/items/mapping.json and CREDITS.md. Each variant names its own
// reference path (`reference`), because the apex tome's icon was authored in
// the later phase 09 art batch.
//
// Held-item coordinate frame (the VAR_* variant-pack convention, NOT the
// floor-seated prop convention): the mesh ORIGIN is the grip. The fist wraps
// the book's lower quarter, the closed book stands up out of the hand along
// +Y, the front cover faces +Z, and applyVariantGrip (VAR_BOOK family in
// src/render/characters/assets.ts) adds the small lift, the hand-side flip,
// and the oversize clamp at runtime. Do not recenter and do not floor-seat.
//
// Factory conventions follow the eastbrook mailbox archetype: semantic parts
// merged into exactly two material buckets (TomeOpaque / TomeMetal), flat
// vertex colors, no UVs, no textures, stable mesh names, contract metadata in
// userData.sculptRuntime.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const INSCRIPTION_TOME_STAGES = Object.freeze(['blockout', 'structural', 'final']);

// One contract per shipped GLB; the shared limits keep the family honest.
export const INSCRIPTION_TOME_LIMITS = Object.freeze({
  triangleTarget: 1800,
  triangleCeiling: 2200,
  byteCeiling: 48 * 1024,
});

export const INSCRIPTION_TOME_VARIANTS = Object.freeze({
  tome_silverleaf: Object.freeze({
    id: 'masterwrought-tome-silverleaf',
    itemId: 'silverleaf_primer',
    rootName: 'InscriptionTomeSilverleaf',
    outputName: 'tome_silverleaf.glb',
    reference: 'docs/achievements/masterwrought-phase06-art/silverleaf_primer.svg',
    // Sheenleaf Primer: uncommon leathern primer. Green leather, cream pages,
    // a silvered sheenleaf laid on the cover, one plain strap.
    width: 0.3,
    height: 0.4,
    thickness: 0.095,
    palette: Object.freeze({
      cover: 0x3c6238,
      coverDeep: 0x22391f,
      coverLight: 0x5a8552,
      pages: 0xe8dcae,
      pagesDeep: 0xcbb98a,
      strap: 0x2c4527,
      accent: 0xc2cfc9,
      accentLight: 0xf2f7f2,
      metal: 0x8fa29a,
      metalLight: 0xb9c6c0,
    }),
    corners: false,
    ribbon: null,
    emblem: 'leaf',
  }),
  tome_goldleaf: Object.freeze({
    id: 'masterwrought-tome-goldleaf',
    itemId: 'goldleaf_folio',
    rootName: 'InscriptionTomeGoldleaf',
    outputName: 'tome_goldleaf.glb',
    reference: 'docs/achievements/masterwrought-phase06-art/goldleaf_folio.svg',
    // Goldleaf Folio: uncommon gilt folio. Brown leather, gilt frame and
    // corner caps, a gilt diamond, a hanging gilt bookmark ribbon.
    width: 0.315,
    height: 0.43,
    thickness: 0.105,
    palette: Object.freeze({
      cover: 0x63401f,
      coverDeep: 0x3a2411,
      coverLight: 0x8a5c30,
      pages: 0xe8dcae,
      pagesDeep: 0xcbb98a,
      strap: 0x4a2f16,
      accent: 0xd9a840,
      accentLight: 0xffe08a,
      metal: 0xb8892f,
      metalLight: 0xf7d879,
    }),
    corners: true,
    ribbon: 0xd9a840,
    emblem: 'frame',
  }),
  tome_sunpetal: Object.freeze({
    id: 'masterwrought-tome-sunpetal',
    itemId: 'sunpetal_grimoire',
    rootName: 'InscriptionTomeSunpetal',
    outputName: 'tome_sunpetal.glb',
    reference: 'docs/achievements/masterwrought-phase06-art/sunpetal_grimoire.svg',
    // Sunpetal Grimoire: the rare rung. Deep blue leather, steel fittings,
    // a radiant gold sun boss with an amber core, an amber bookmark ribbon.
    width: 0.335,
    height: 0.46,
    thickness: 0.12,
    palette: Object.freeze({
      cover: 0x28406e,
      coverDeep: 0x14213c,
      coverLight: 0x3d5f9e,
      pages: 0xe6dcb2,
      pagesDeep: 0x9c8a5e,
      strap: 0x1a2c50,
      accent: 0xf2b64a,
      accentLight: 0xffd75e,
      metal: 0x9fadbe,
      metalLight: 0xdfe6ee,
    }),
    corners: true,
    ribbon: 0xf2b64a,
    emblem: 'sun',
  }),
  tome_voidbound: Object.freeze({
    id: 'masterwrought-tome-voidbound',
    itemId: 'voidbound_grimoire',
    rootName: 'InscriptionTomeVoidbound',
    outputName: 'tome_voidbound.glb',
    reference: 'docs/achievements/masterwrought-phase09-art/voidbound_grimoire.svg',
    // Voidbound Grimoire: the phase 09 apex rung, the largest of the family.
    // Near-black violet leather, aged parchment, void-metal corner caps and a
    // fore-edge clasp, and a rune ring closing on an event-horizon core. No
    // bookmark ribbon: the icon shows the clasp holding it shut instead.
    width: 0.35,
    height: 0.48,
    thickness: 0.13,
    palette: Object.freeze({
      cover: 0x2e2a3c,
      coverDeep: 0x100d18,
      coverLight: 0x453f5c,
      pages: 0xcdbfa4,
      pagesDeep: 0xa08e70,
      strap: 0x1b1826,
      accent: 0x9c5cf0,
      accentLight: 0xc9b2f8,
      metal: 0x4c4370,
      metalLight: 0x8f86b8,
    }),
    corners: true,
    ribbon: null,
    emblem: 'void',
  }),
});

export const INSCRIPTION_TOME_KEYS = Object.freeze(Object.keys(INSCRIPTION_TOME_VARIANTS));

// The book's bottom edge sits this far below the grip origin, so the fist
// wraps the lower quarter instead of the exact edge.
const BOTTOM_Y = -0.1;

const MATERIAL_DEFINITIONS = Object.freeze({
  opaque: Object.freeze({ name: 'TomeOpaque', metalness: 0.03, roughness: 0.85 }),
  metal: Object.freeze({ name: 'TomeMetal', metalness: 0.6, roughness: 0.4 }),
});

function matrixFor(position, rotation = [0, 0, 0], scale = [1, 1, 1]) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
    new THREE.Vector3(...scale),
  );
}

function preparedGeometry(source, color, transform) {
  const geometry = source.index ? source.toNonIndexed() : source.clone();
  geometry.deleteAttribute('uv');
  geometry.deleteAttribute('uv1');
  if (transform) geometry.applyMatrix4(transform);
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  const tint = new THREE.Color(color);
  const colors = new Float32Array(geometry.getAttribute('position').count * 3);
  for (let index = 0; index < colors.length; index += 3) {
    colors[index] = tint.r;
    colors[index + 1] = tint.g;
    colors[index + 2] = tint.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function addGeometry(buckets, bucket, geometry, color, options = {}) {
  buckets[bucket].push(
    preparedGeometry(
      geometry,
      color,
      matrixFor(options.position ?? [0, 0, 0], options.rotation, options.scale),
    ),
  );
}

function addBox(buckets, bucket, size, position, color, rotation = [0, 0, 0]) {
  addGeometry(buckets, bucket, new THREE.BoxGeometry(...size), color, { position, rotation });
}

function addRoundedBox(buckets, bucket, size, position, color, radius) {
  addGeometry(
    buckets,
    bucket,
    new RoundedBoxGeometry(size[0], size[1], size[2], 1, radius),
    color,
    {
      position,
    },
  );
}

function addDisc(buckets, bucket, radius, thickness, position, color, segments = 12) {
  addGeometry(
    buckets,
    bucket,
    new THREE.CylinderGeometry(radius, radius, thickness, segments, 1, false),
    color,
    { position, rotation: [Math.PI / 2, 0, 0] },
  );
}

function addOctahedron(buckets, bucket, radius, position, color, scale = [1, 1, 1]) {
  addGeometry(buckets, bucket, new THREE.OctahedronGeometry(radius, 0), color, {
    position,
    scale,
  });
}

// The cover leaf both leaf-named tomes wear (silvered on sheenleaf, gilt on
// goldleaf): a pointed-oval blade from an elongated flattened octahedron, a
// raised midrib, two angled side veins, and a short stem below the blade.
function addLeaf(buckets, variant, centerY, emblemZ) {
  const { palette } = variant;
  addOctahedron(
    buckets,
    'metal',
    0.062,
    [0, centerY + 0.018, emblemZ + 0.006],
    palette.accent,
    [0.58, 1.35, 0.14],
  );
  addBox(
    buckets,
    'metal',
    [0.007, 0.15, 0.005],
    [0, centerY + 0.015, emblemZ + 0.011],
    palette.accentLight,
  );
  for (const sy of [-1, 1]) {
    addBox(
      buckets,
      'metal',
      [0.005, 0.052, 0.004],
      [sy * 0.018, centerY + 0.02 + sy * 0.014, emblemZ + 0.011],
      palette.accentLight,
      [0, 0, sy * 0.9],
    );
  }
  addBox(
    buckets,
    'metal',
    [0.008, 0.05, 0.005],
    [-0.012, centerY - 0.085, emblemZ + 0.006],
    palette.metal,
    [0, 0, 0.35],
  );
}

// The void sigil the apex tome wears: a segmented rune ring, six orbiting
// tick marks, three inward-spiralling arms, and an event-horizon core with a
// single bright highlight. Built from the same box/disc/octahedron vocabulary
// as the leaf and the sun boss, so the family stays one merge of two buckets.
function addVoidSigil(buckets, variant, centerY, emblemZ) {
  const { palette } = variant;
  const ringRadius = 0.078;
  for (let segment = 0; segment < 12; segment++) {
    const angle = (segment / 12) * Math.PI * 2;
    addBox(
      buckets,
      'metal',
      [0.034, 0.012, 0.008],
      [Math.sin(angle) * ringRadius, centerY + Math.cos(angle) * ringRadius, emblemZ + 0.004],
      segment % 2 === 0 ? palette.metalLight : palette.metal,
      [0, 0, -angle],
    );
  }
  // Rune ticks standing just outside the ring, the icon's orbiting marks.
  for (let tick = 0; tick < 6; tick++) {
    const angle = (tick / 6) * Math.PI * 2 + Math.PI / 12;
    addBox(
      buckets,
      'metal',
      [0.006, 0.018, 0.005],
      [Math.sin(angle) * 0.1, centerY + Math.cos(angle) * 0.1, emblemZ + 0.003],
      palette.accent,
      [0, 0, -angle],
    );
  }
  // Three arms spiralling in toward the core, each canted off the radius.
  for (let arm = 0; arm < 3; arm++) {
    const angle = (arm / 3) * Math.PI * 2;
    addBox(
      buckets,
      'metal',
      [0.05, 0.009, 0.006],
      [Math.sin(angle) * 0.046, centerY + Math.cos(angle) * 0.046, emblemZ + 0.006],
      palette.accentLight,
      [0, 0, -angle + 0.6],
    );
  }
  // The event horizon: a near-black disc with one bright catch light.
  addDisc(buckets, 'metal', 0.03, 0.012, [0, centerY, emblemZ + 0.006], palette.coverDeep);
  addOctahedron(
    buckets,
    'metal',
    0.014,
    [-0.007, centerY + 0.008, emblemZ + 0.014],
    palette.accentLight,
    [1, 1, 0.5],
  );
  // The void-metal clasp reaching in from the fore edge, with its own dark
  // boss: the icon's fitting, and the reason this tome carries no ribbon.
  addBox(
    buckets,
    'metal',
    [0.07, 0.042, 0.008],
    [variant.width / 2 - 0.045, centerY, emblemZ + 0.003],
    palette.metal,
  );
  addOctahedron(
    buckets,
    'metal',
    0.014,
    [variant.width / 2 - 0.045, centerY, emblemZ + 0.01],
    palette.coverDeep,
    [1, 1, 0.5],
  );
}

// The shared closed-book body: page block, two covers, spine bulge, ridge
// bands, and a fore-edge strap. Emblems and fittings differ per variant.
function buildParts(buckets, variant, stage) {
  const { width, height, thickness, palette } = variant;
  const centerY = BOTTOM_Y + height / 2;
  const coverT = 0.02;
  const frontZ = thickness / 2 - coverT / 2;

  // Page block, shifted a touch toward the fore-edge so paper shows on
  // three edges while the spine side stays leather.
  addBox(
    buckets,
    'opaque',
    [width - 0.026, height - 0.022, thickness - coverT * 2 + 0.002],
    [0.008, centerY, 0],
    palette.pages,
  );
  // A slightly darker inner page wedge at the fore-edge, the icon's
  // two-tone paper read.
  addBox(
    buckets,
    'opaque',
    [0.012, height - 0.05, thickness - coverT * 2 - 0.012],
    [width / 2 - 0.016, centerY, 0],
    palette.pagesDeep,
  );

  // Front and back covers.
  addRoundedBox(
    buckets,
    'opaque',
    [width, height, coverT],
    [0, centerY, frontZ],
    palette.cover,
    0.007,
  );
  addRoundedBox(
    buckets,
    'opaque',
    [width, height, coverT],
    [0, centerY, -frontZ],
    palette.coverDeep,
    0.007,
  );

  if (stage === 'blockout') return;

  // Spine bulge: a vertical cylinder flattened along X, proud of the -X edge.
  addGeometry(
    buckets,
    'opaque',
    new THREE.CylinderGeometry(thickness / 2 + 0.004, thickness / 2 + 0.004, height, 12, 1, false),
    palette.coverDeep,
    { position: [-width / 2 + 0.002, centerY, 0], scale: [0.55, 1, 1] },
  );
  // Three raised ridge bands across the spine, the classic tome read.
  for (const offset of [-0.3, 0, 0.3]) {
    addBox(
      buckets,
      'opaque',
      [0.045, 0.014, thickness + 0.014],
      [-width / 2 + 0.004, centerY + offset * (height / 2), 0],
      palette.coverLight,
    );
  }

  // Fore-edge strap keeping the book shut, with a small metal keeper plate.
  addBox(
    buckets,
    'opaque',
    [0.05, 0.036, thickness + 0.016],
    [width / 2 - 0.012, centerY, 0],
    palette.strap,
  );
  addBox(
    buckets,
    'metal',
    [0.024, 0.024, 0.008],
    [width / 2 - 0.012, centerY, frontZ + coverT / 2 + 0.003],
    palette.metalLight,
  );

  if (stage === 'structural') return;

  const emblemZ = frontZ + coverT / 2;
  if (variant.corners) {
    // Metal corner caps on the front cover.
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        addBox(
          buckets,
          'metal',
          [0.052, 0.052, 0.008],
          [sx * (width / 2 - 0.03), centerY + sy * (height / 2 - 0.03), emblemZ + 0.002],
          palette.metal,
        );
      }
    }
  }

  if (variant.emblem === 'leaf') {
    addLeaf(buckets, variant, centerY, emblemZ);
  } else if (variant.emblem === 'frame') {
    // The gilt frame: four border rails around the cover's gold leaf.
    const inset = 0.036;
    const railW = 0.012;
    const innerW = width - inset * 2;
    const innerH = height - inset * 2;
    for (const sy of [-1, 1]) {
      addBox(
        buckets,
        'metal',
        [innerW, railW, 0.006],
        [0, centerY + sy * (innerH / 2), emblemZ + 0.004],
        palette.accent,
      );
    }
    for (const sx of [-1, 1]) {
      addBox(
        buckets,
        'metal',
        [railW, innerH, 0.006],
        [sx * (innerW / 2), centerY, emblemZ + 0.004],
        palette.accent,
      );
    }
    addLeaf(buckets, variant, centerY, emblemZ);
  } else if (variant.emblem === 'sun') {
    // The radiant sun boss: gold disc, eight petals, an amber core gem.
    addDisc(buckets, 'metal', 0.055, 0.01, [0, centerY, emblemZ + 0.005], palette.accent);
    for (let petal = 0; petal < 8; petal++) {
      const angle = (petal / 8) * Math.PI * 2;
      addBox(
        buckets,
        'metal',
        [0.02, 0.052, 0.007],
        [Math.sin(angle) * 0.082, centerY + Math.cos(angle) * 0.082, emblemZ + 0.004],
        petal % 2 === 0 ? palette.accentLight : palette.accent,
        [0, 0, -angle],
      );
    }
    addOctahedron(
      buckets,
      'metal',
      0.026,
      [0, centerY, emblemZ + 0.012],
      palette.accentLight,
      [1, 1, 0.55],
    );
    // Steel clasp hinges at the spine side, the icon's fitting read.
    for (const sy of [-1, 1]) {
      addBox(
        buckets,
        'metal',
        [0.03, 0.05, 0.008],
        [-width / 2 + 0.03, centerY + sy * (height / 2 - 0.06), emblemZ + 0.002],
        palette.metal,
      );
    }
  } else if (variant.emblem === 'void') {
    addVoidSigil(buckets, variant, centerY, emblemZ);
  }

  if (variant.ribbon !== null) {
    // Bookmark ribbon hanging below the bottom page edge.
    addBox(
      buckets,
      'opaque',
      [0.026, 0.075, 0.006],
      [0.045, BOTTOM_Y - 0.028, 0.01],
      variant.ribbon,
      [0, 0, 0.12],
    );
  }
}

export function createInscriptionTome(variantKey, stage = 'final') {
  const variant = INSCRIPTION_TOME_VARIANTS[variantKey];
  if (!variant) throw new Error(`unknown tome variant: ${variantKey}`);
  if (!INSCRIPTION_TOME_STAGES.includes(stage)) throw new Error(`unknown stage: ${stage}`);
  const buckets = { opaque: [], metal: [] };
  buildParts(buckets, variant, stage);
  const root = new THREE.Group();
  root.name = variant.rootName;
  for (const [bucket, definition] of Object.entries(MATERIAL_DEFINITIONS)) {
    const parts = buckets[bucket];
    if (parts.length === 0) continue;
    const merged = mergeGeometries(parts, false);
    for (const part of parts) part.dispose();
    const material = new THREE.MeshStandardMaterial({
      name: definition.name,
      vertexColors: true,
      metalness: definition.metalness,
      roughness: definition.roughness,
    });
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = `${variant.rootName}_${definition.name}`;
    root.add(mesh);
  }
  root.userData.sculptRuntime = {
    assetId: variant.id,
    itemId: variant.itemId,
    stage,
    coordinateFrame: { front: '+Z', up: '+Y', origin: 'grip' },
    interaction: { interactive: false, authority: 'held-item-attachment' },
    collider: { shippingCollisionMesh: false },
  };
  return root;
}
