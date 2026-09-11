// The Deepglass stadium: the arena the bell hangs inside.
//
// The bell alone was a glass ball on a stone plaza in the dark. This is the
// building around it, a Final Fantasy cathedral-arena, all pale stone, gold
// leaf and caught light, scaled to make a 76-yard sphere look like the small
// bright thing at the middle of something enormous.
//
// Built the way vale_cup_stadium.ts builds the Sowfield: structural masonry
// bakes a per-vertex colour into ONE merged vertex-coloured mesh (the whole
// bowl, every pylon and every arch is a couple of draw calls), while the parts
// that have to glow or move, crystal, banners, the crown ring, get their own
// small materials. Every radius is derived from the layout module's
// DEEPGLASS_RADIUS, so the building can never drift away from the ball physics.
//
// Silhouette, from the middle out:
//
//   the bell (r 38) · concourse (r 46) · the bowl, six tiers rising away from
//   the glass (r 52 → 88, y 1 → 27) · sixteen buttress pylons leaning inward
//   and climbing to y 74 · flying arches springing off them toward the bell's
//   equator but never touching it · a crown ring floating over the crown.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  DEEPGLASS_CENTER,
  DEEPGLASS_RADIUS,
  DG_BOWL_GAP,
  DG_BOWL_INNER_R,
  DG_BOWL_OUTER_R,
  DG_BOWL_TIERS,
  DG_BOWL_TOP_Y,
  DG_CAUSEWAY_HALF_W,
  DG_CAUSEWAY_Z_FAR,
  DG_CAUSEWAY_Z_NEAR,
} from '../sim/deepglass/layout';
import { loadTexture } from './assets/loader';
import { GFX } from './gfx';

// ---------------------------------------------------------------------------
// Palette. Pale limestone and gold against the cold cyan the bell already
// throws, the FF trick is that the architecture is nearly white, so all the
// colour in frame comes from light.
// ---------------------------------------------------------------------------
const STONE_PALE = 0xe8e2d4;
const STONE = 0xcfc7b6;
const STONE_SHADE = 0xa9a091;
const STONE_DEEP = 0x7d7669;
/** The causeway's road: dark cobbles, tinted down to the slate it crosses. A
 *  pale tiled strip across a dark caldera read as a runway, not a road. */
const CAUSEWAY_DARK = 0x78726a;
const GOLD = 0xd9ab54;
const GOLD_DARK = 0x9c7734;
const SEAT_A = 0x2f6f86;
const SEAT_B = 0x27596c;
const CRYSTAL = 0x8fe6ff;
const BANNER_A = 0xffa53a; // amber, team A
const BANNER_B = 0x49d6ff; // cyan, team B

// ---------------------------------------------------------------------------
// Dimensions. All in yards, all hung off the bell so the building scales with
// it if the arena is ever resized.
// ---------------------------------------------------------------------------
/** Ground level of the arena floor (the world's flat slate). */
const FLOOR_Y = 0;
// The bowl's radii, tiers, entrance gap and causeway all live in layout.ts now
// (the world stands blockers on the same numbers). Local aliases keep the
// build code readable.
const BOWL_INNER_R = DG_BOWL_INNER_R;
const BOWL_OUTER_R = DG_BOWL_OUTER_R;
const BOWL_TIERS = DG_BOWL_TIERS;
const BOWL_TOP_Y = DG_BOWL_TOP_Y;
/** Buttress pylons: how many, and how high they climb. */
const PYLON_COUNT = 16;
const PYLON_TOP_Y = 74;
/** Where a pylon stands, and how far its head leans in over the bell. */
const PYLON_BASE_R = BOWL_OUTER_R - 3;
const PYLON_HEAD_R = DEEPGLASS_RADIUS + 9;
/** The crown ring floating above the bell. */
const CROWN_Y = DEEPGLASS_CENTER.y + DEEPGLASS_RADIUS + 17;
const CROWN_R = DEEPGLASS_RADIUS * 0.62;
/** The processional causeway in from the arrival point (world.ts DG_ARRIVAL). */
const CAUSEWAY_HALF_W = DG_CAUSEWAY_HALF_W;
/**
 * The north entrance, radians of the bowl left open for the causeway.
 *
 * Without it the arrival point sits INSIDE the seating: the bowl's inner lip is
 * at r 52 and a player boots in at r 58, which put them in the middle of a
 * tier with a riser wall filling the screen. Wide enough here to clear the
 * causeway's colonnade with room either side.
 */
const BOWL_GAP = DG_BOWL_GAP;
/** The terrace rail. MUST match world.ts DG_PARAPET_R, that module owns the
 *  blockers, this one owns the stone you can see. */
const PARAPET_R = 99;

export interface DeepglassStadiumView {
  group: THREE.Group;
  /** Point lights the renderer adds to its own budget. */
  lights: THREE.PointLight[];
  update(dt: number): void;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Geometry helpers, the vale_cup_stadium bag pattern.
// ---------------------------------------------------------------------------

interface Bag {
  geos: THREE.BufferGeometry[];
}

function tint(geo: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const c = new THREE.Color(hex);
  const count = geo.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

// ---------------------------------------------------------------------------
// World-space UVs for the textured bags. The stadium's stone used to be flat
// vertex colour only; the deck/wall/cobble bags carry a tiling PBR map now
// (public/textures/deepglass), and since every part is merged into a couple of
// big meshes the UVs must be derived from WORLD position, a per-part 0..1
// island would tile at a different density on every ring.
// ---------------------------------------------------------------------------

/** Floors: project straight down. One texture repeat per `s` yards. */
function planarUV(geo: THREE.BufferGeometry, s: number): void {
  const pos = geo.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) / s;
    uv[i * 2 + 1] = pos.getZ(i) / s;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/**
 * Ring walls: unroll around the bowl's axis, u along the arc, v up. The angle
 * is measured FROM NORTH and wrapped to [0, 2pi) so the branch cut falls
 * inside the entrance gap, measured anywhere else it crosses geometry and one
 * column of triangles smears the whole texture across itself.
 */
function cylUV(geo: THREE.BufferGeometry, s: number): void {
  const cx = DEEPGLASS_CENTER.x;
  const cz = DEEPGLASS_CENTER.z;
  const pos = geo.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) - cx;
    const z = pos.getZ(i) - cz;
    const r = Math.hypot(x, z);
    let th = Math.atan2(x, z); // 0 at north, the entrance
    if (th < 0) th += Math.PI * 2;
    uv[i * 2] = (th * r) / s;
    uv[i * 2 + 1] = pos.getY(i) / s;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/** Boxes (the entrance cheek walls, the causeway deck): project along each
 *  vertex's dominant normal axis, so tops read like floors and faces like
 *  walls without a seam hunt. */
function boxUV(geo: THREE.BufferGeometry, s: number): void {
  const pos = geo.getAttribute('position');
  const nrm = geo.getAttribute('normal');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nrm.getX(i));
    const ny = Math.abs(nrm.getY(i));
    const nz = Math.abs(nrm.getZ(i));
    let u: number;
    let v: number;
    if (ny >= nx && ny >= nz) {
      u = pos.getX(i);
      v = pos.getZ(i);
    } else if (nx >= nz) {
      u = pos.getZ(i);
      v = pos.getY(i);
    } else {
      u = pos.getX(i);
      v = pos.getY(i);
    }
    uv[i * 2] = u / s;
    uv[i * 2 + 1] = v / s;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

function addBox(
  bag: Bag,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  rotY: number,
  hex: number,
  rotX = 0,
  rotZ = 0,
): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  if (rotX !== 0) geo.rotateX(rotX);
  if (rotZ !== 0) geo.rotateZ(rotZ);
  if (rotY !== 0) geo.rotateY(rotY);
  geo.translate(x, y, z);
  bag.geos.push(tint(geo, hex));
  return geo;
}

function addCyl(
  bag: Bag,
  rTop: number,
  rBot: number,
  h: number,
  seg: number,
  x: number,
  y: number,
  z: number,
  hex: number,
  rotX = 0,
  rotZ = 0,
): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(rTop, rBot, h, seg);
  if (rotX !== 0) geo.rotateX(rotX);
  if (rotZ !== 0) geo.rotateZ(rotZ);
  geo.translate(x, y, z);
  bag.geos.push(tint(geo, hex));
  return geo;
}

/**
 * A flat annulus (a ring of floor), which is most of what a seating bowl is.
 *
 * `gap` cuts an opening centred on NORTH (+z) for the causeway to run through,
 * which is what stops the arrival point being walled inside the seating. Note
 * RingGeometry measures theta from +x turning toward -z once it is laid flat,
 * so north sits at -pi/2, the cylinder convention below is a different one,
 * which is exactly the trap this comment exists to mark.
 */
function addRing(
  bag: Bag,
  inner: number,
  outer: number,
  y: number,
  hex: number,
  seg = 72,
  gap = 0,
): THREE.BufferGeometry {
  const geo = new THREE.RingGeometry(
    inner,
    outer,
    seg,
    1,
    -Math.PI / 2 + gap / 2,
    Math.PI * 2 - gap,
  );
  geo.rotateX(-Math.PI / 2);
  geo.translate(DEEPGLASS_CENTER.x, y, DEEPGLASS_CENTER.z);
  bag.geos.push(tint(geo, hex));
  return geo;
}

/** An open cylinder wall segment, a tier's riser, or the bowl's outer skin.
 *  CylinderGeometry measures theta from +z, so a north gap starts at gap/2. */
function addWall(
  bag: Bag,
  radius: number,
  h: number,
  y: number,
  hex: number,
  seg = 72,
  gap = 0,
): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(
    radius,
    radius,
    h,
    seg,
    1,
    true,
    gap / 2,
    Math.PI * 2 - gap,
  );
  geo.translate(DEEPGLASS_CENTER.x, y + h / 2, DEEPGLASS_CENTER.z);
  bag.geos.push(tint(geo, hex));
  return geo;
}

/**
 * One arc of a torus, positioned and aimed, the flying buttresses and the
 * concourse arcade both want this and nothing else in the codebase makes one.
 */
function addArc(
  bag: Bag,
  radius: number,
  tube: number,
  arc: number,
  x: number,
  y: number,
  z: number,
  rotY: number,
  rotZ: number,
  hex: number,
): void {
  const geo = new THREE.TorusGeometry(radius, tube, 6, 20, arc);
  geo.rotateZ(rotZ);
  geo.rotateY(rotY);
  geo.translate(x, y, z);
  bag.geos.push(tint(geo, hex));
}

function masonryMaterial(): THREE.Material {
  return GFX.standardMaterials
    ? new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.82,
        metalness: 0.06,
        flatShading: true,
        side: THREE.DoubleSide,
      })
    : new THREE.MeshLambertMaterial({
        vertexColors: true,
        flatShading: true,
        side: THREE.DoubleSide,
      });
}

/**
 * Masonry with a tiling PBR set over the vertex tint (the hand-painted terrain
 * pack in public/textures/deepglass). The map multiplies the existing per-part
 * tints, so the pale decks stay pale and the shaded courses stay shaded, the
 * texture adds the joints and weathering the flat colour never had. Maps
 * arrive async; until they land the material renders exactly as before.
 */
function texturedMasonry(colorFile: string, normalFile: string, gain: number): THREE.Material {
  const mat = masonryMaterial();
  void loadTexture(`/textures/deepglass/${colorFile}`, { srgb: true, repeat: true }).then((tex) => {
    tex.anisotropy = 4;
    const std = mat as THREE.MeshStandardMaterial;
    std.map = tex;
    // The arena runs a deliberately dim dusk key (world.ts lighting), tuned
    // when these surfaces were bare near-white vertex colour. A mid-tone
    // albedo map under the same tint reads close to black there, so each map
    // arrives with a measured gain, the same move deepglass_kit.ts makes
    // (KIT_ALBEDO_GAIN) rather than re-lighting the whole world. Per-set
    // values because the pack's sets differ a stop and a half in mean level.
    std.color.setRGB(gain, gain, gain);
    mat.needsUpdate = true;
  });
  // The normal map only exists on the standard-material tier: Lambert has no
  // normal-map slot, and that tier rebuilt the material anyway.
  if (GFX.standardMaterials) {
    void loadTexture(`/textures/deepglass/${normalFile}`, { repeat: true }).then((tex) => {
      const std = mat as THREE.MeshStandardMaterial;
      std.normalMap = tex;
      std.normalScale.set(0.7, 0.7);
      mat.needsUpdate = true;
    });
  }
  return mat;
}

/** The tide-glass the whole building is lit by: unlit, additive, bloom does it. */
function crystalMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(CRYSTAL) },
    },
    vertexShader: `
      varying vec3 vLocal;
      void main() {
        vLocal = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uColor;
      varying vec3 vLocal;
      void main() {
        // Slow breathing plus a travelling band, so a hundred crystals in one
        // merged mesh are never all bright at the same instant.
        float pulse = 0.62 + 0.38 * sin(uTime * 1.1 + vLocal.y * 0.35);
        gl_FragColor = vec4(uColor * (0.7 + pulse), 0.55 + 0.35 * pulse);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

/** Hanging banners: a vertical ripple that reads as heavy cloth at distance. */
function bannerMaterial(color: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(color) },
    },
    vertexShader: `
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec3 p = position;
        // Anchored at the top (uv.y = 1), loosest at the hem.
        float slack = 1.0 - uv.y;
        p.z += sin(uTime * 1.6 + p.y * 0.5 + p.x * 0.8) * 0.55 * slack;
        p.x += cos(uTime * 1.2 + p.y * 0.4) * 0.18 * slack;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      varying vec2 vUv;
      void main() {
        // A pale chevron down the middle: readable heraldry at stadium range.
        float band = smoothstep(0.36, 0.4, abs(vUv.x - 0.5));
        float hem = smoothstep(0.0, 0.06, vUv.y);
        vec3 c = mix(vec3(0.96, 0.93, 0.85), uColor, band);
        gl_FragColor = vec4(c * (0.55 + 0.45 * vUv.y), hem);
      }
    `,
    transparent: true,
    side: THREE.DoubleSide,
  });
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export function buildDeepglassStadium(): DeepglassStadiumView {
  const group = new THREE.Group();
  group.name = 'deepglass-stadium';
  const lights: THREE.PointLight[] = [];
  const stone: Bag = { geos: [] };
  const gold: Bag = { geos: [] };
  const crystal: Bag = { geos: [] };
  // The textured bags (see texturedMasonry): pale floor tiles for everything
  // walked on, stone brick for the risers and the outer skin, cobbles for the
  // entrance apron. Pylons, arches, seats and trim stay pure vertex colour,   // the texture pass is for the big readable surfaces, not the jewellery.
  const deck: Bag = { geos: [] };
  const wall: Bag = { geos: [] };
  const cobble: Bag = { geos: [] };
  /** One texture repeat per this many yards, per bag. */
  const DECK_TEX_S = 5;
  const WALL_TEX_S = 6;
  const COBBLE_TEX_S = 4.5;

  const cx = DEEPGLASS_CENTER.x;
  const cz = DEEPGLASS_CENTER.z;

  // ---- the concourse -------------------------------------------------------
  // A broad pale apron between the cradle and the bowl's first tier, with a
  // gold inlay ring: the thing that makes the plaza read as a floor of a
  // building rather than the ground the bell happens to sit on.
  planarUV(
    addRing(deck, DEEPGLASS_RADIUS + 4, BOWL_INNER_R, FLOOR_Y + 0.06, STONE_PALE),
    DECK_TEX_S,
  );
  addRing(gold, BOWL_INNER_R - 2.6, BOWL_INNER_R - 1.6, FLOOR_Y + 0.09, GOLD);
  addRing(gold, DEEPGLASS_RADIUS + 5.4, DEEPGLASS_RADIUS + 6.2, FLOOR_Y + 0.09, GOLD_DARK);

  // ---- the bowl ------------------------------------------------------------
  // Six tiers stepping UP and AWAY from the glass, so every seat looks down
  // into the bell. Each tier is a riser wall, a deck, and a band of seats.
  const tierStepR = (BOWL_OUTER_R - BOWL_INNER_R) / BOWL_TIERS;
  const tierStepY = BOWL_TOP_Y / BOWL_TIERS;
  for (let t = 0; t < BOWL_TIERS; t++) {
    const rIn = BOWL_INNER_R + t * tierStepR;
    const rOut = rIn + tierStepR;
    const yTop = FLOOR_Y + (t + 1) * tierStepY;
    // Riser: the vertical face holding this tier up.
    cylUV(
      addWall(
        wall,
        rIn,
        tierStepY,
        FLOOR_Y + t * tierStepY,
        t % 2 === 0 ? STONE : STONE_SHADE,
        72,
        BOWL_GAP,
      ),
      WALL_TEX_S,
    );
    // Deck.
    planarUV(addRing(deck, rIn, rOut, yTop, STONE_PALE, 72, BOWL_GAP), DECK_TEX_S);
    // Seats: two banked rows per tier, alternating the two house colours.
    for (let s = 0; s < 2; s++) {
      const r = rIn + tierStepR * (0.34 + s * 0.36);
      addWall(stone, r, 0.85, yTop + 0.05, s === 0 ? SEAT_A : SEAT_B, 64, BOWL_GAP);
      addRing(stone, r, r + tierStepR * 0.3, yTop + 0.9, s === 0 ? SEAT_B : SEAT_A, 64, BOWL_GAP);
    }
    // A gold nosing on every third tier keeps the bowl from reading as steps.
    if (t % 3 === 2) addRing(gold, rOut - 0.8, rOut, yTop + 0.02, GOLD, 72, BOWL_GAP);
  }
  // The bowl's outer skin, a dark plinth course grounding it against the
  // terrace, and a heavy cornice along its rim.
  cylUV(
    addWall(wall, BOWL_OUTER_R, BOWL_TOP_Y + 2.5, FLOOR_Y - 1, STONE_SHADE, 72, BOWL_GAP),
    WALL_TEX_S,
  );
  cylUV(addWall(wall, BOWL_OUTER_R + 0.7, 2.2, FLOOR_Y - 1, STONE_DEEP, 72, BOWL_GAP), WALL_TEX_S);
  addRing(stone, BOWL_OUTER_R - 0.5, BOWL_OUTER_R + 2.4, FLOOR_Y + 1.2, STONE_DEEP, 72, BOWL_GAP);
  // The cornice and its gold edge carry the entrance gap too. They used to be
  // full circles, which left a ribbon of rim floating unsupported across the
  // open north cut, the most visible of the entrance "gaps".
  addRing(
    stone,
    BOWL_OUTER_R - 1.6,
    BOWL_OUTER_R + 1.8,
    FLOOR_Y + BOWL_TOP_Y + 1.5,
    STONE_PALE,
    72,
    BOWL_GAP,
  );
  addRing(
    gold,
    BOWL_OUTER_R + 1.0,
    BOWL_OUTER_R + 1.8,
    FLOOR_Y + BOWL_TOP_Y + 1.56,
    GOLD_DARK,
    72,
    BOWL_GAP,
  );

  // ---- the entrance cut ----------------------------------------------------
  // The bowl is a ring with a slice missing, and a merged cylinder/ring bag
  // has no cross-section faces: the cut used to read as a hollow doll's house
  //, open tier profiles, the backs of the far seats, daylight under the
  // decks. Each side of the north gap gets a CHEEK: a stepped stack of solid
  // masonry closing the profile, rising with the tiers to a full-height pier
  // where it meets the outer skin, the way a real stadium ends a stand at a
  // vomitorium. The world stands a matching collider wall on each cheek.
  {
    const tierStepR2 = (BOWL_OUTER_R - BOWL_INNER_R) / BOWL_TIERS;
    const tierStepY2 = BOWL_TOP_Y / BOWL_TIERS;
    const CHEEK_T = 1.2; // wall thickness
    for (const side of [-1, 1]) {
      // Cylinder convention: north is 0, the gap spans -gap/2..gap/2, but the
      // pylon/cos-sin convention used for placing boxes has north at pi/2.
      const aCut = Math.PI / 2 + side * (BOWL_GAP / 2);
      const ca = Math.cos(aCut);
      const sa = Math.sin(aCut);
      // Push the cheek INTO the bowl body so it sits flush with the cut faces
      // rather than jutting into the entrance. Tangential direction of
      // increasing angle is (-sin, cos); the bowl body lies at greater angles
      // on the +side and lesser on the -side.
      const tx = -sa * side * (CHEEK_T / 2);
      const tz = ca * side * (CHEEK_T / 2);
      for (let t = 0; t < BOWL_TIERS; t++) {
        const rIn = BOWL_INNER_R + t * tierStepR2;
        const last = t === BOWL_TIERS - 1;
        // Each step caps its own tier (deck + seat backs); the last one runs
        // out to the plinth and rises to the cornice as the entrance pier.
        const rOut = last ? BOWL_OUTER_R + 0.7 : rIn + tierStepR2;
        const h = last ? BOWL_TOP_Y + 2.6 : (t + 1) * tierStepY2 + 0.95;
        const rMid = (rIn + rOut) / 2;
        const geo = addBox(
          wall,
          rOut - rIn,
          h,
          CHEEK_T,
          cx + ca * rMid + tx,
          FLOOR_Y + h / 2,
          cz + sa * rMid + tz,
          -aCut,
          t % 2 === 0 ? STONE : STONE_SHADE,
        );
        boxUV(geo, WALL_TEX_S);
        // A gold nosing along each step's top edge, so the stair-step profile
        // reads as authored trim rather than raw cut masonry.
        addBox(
          gold,
          rOut - rIn,
          0.35,
          CHEEK_T + 0.25,
          cx + ca * rMid + tx,
          FLOOR_Y + h + 0.12,
          cz + sa * rMid + tz,
          -aCut,
          last ? GOLD : GOLD_DARK,
        );
      }
    }

    // The apron: pave the wedge of terrace the gap opens onto, from the
    // concourse out past the outer skin, so the entrance floor is authored
    // stone rather than a slice of raw meadow between two cut walls.
    const apron = new THREE.RingGeometry(
      BOWL_INNER_R - 0.6,
      BOWL_OUTER_R + 2.6,
      18,
      1,
      -Math.PI / 2 - BOWL_GAP / 2,
      BOWL_GAP,
    );
    apron.rotateX(-Math.PI / 2);
    apron.translate(cx, FLOOR_Y + 0.07, cz);
    tint(apron, STONE);
    planarUV(apron, COBBLE_TEX_S);
    cobble.geos.push(apron);
  }

  // ---- the buttress pylons -------------------------------------------------
  // Sixteen towers standing on the bowl rim, tapering as they climb and leaning
  // IN over the water. They are the silhouette: from outside the arena you read
  // a ring of white spires holding a lit sphere.
  for (let i = 0; i < PYLON_COUNT; i++) {
    const a = (i / PYLON_COUNT) * Math.PI * 2;
    // Leave the north entrance clear. Here x = cos(a) and z = sin(a), so due
    // north is a = pi/2, a third convention, and the reason every angle in
    // this file says which one it means.
    if (Math.abs(angleDelta(a, Math.PI / 2)) < BOWL_GAP) continue;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const bx = cx + ca * PYLON_BASE_R;
    const bz = cz + sa * PYLON_BASE_R;
    const hx = cx + ca * PYLON_HEAD_R;
    const hz = cz + sa * PYLON_HEAD_R;
    const baseY = FLOOR_Y + BOWL_TOP_Y;

    // The shaft: a lean cylinder from the rim to its head, built as a segmented
    // stack so it can taper and curve inward rather than being one straight bar.
    const SEGS = 7;
    for (let s = 0; s < SEGS; s++) {
      const t0 = s / SEGS;
      const t1 = (s + 1) / SEGS;
      // Ease the lean so the tower rises steeply then curls over the bell.
      const e0 = t0 * t0;
      const e1 = t1 * t1;
      const x0 = bx + (hx - bx) * e0;
      const z0 = bz + (hz - bz) * e0;
      const x1 = bx + (hx - bx) * e1;
      const z1 = bz + (hz - bz) * e1;
      const y0 = baseY + (PYLON_TOP_Y - baseY) * t0;
      const y1 = baseY + (PYLON_TOP_Y - baseY) * t1;
      const dx = x1 - x0;
      const dy = y1 - y0;
      const dz = z1 - z0;
      const len = Math.hypot(dx, dy, dz);
      const rTop = 1.5 * (1 - t1) + 0.5;
      const rBot = 1.5 * (1 - t0) + 0.5;
      const geo = new THREE.CylinderGeometry(rTop, rBot, len, 8);
      // Aim the segment along its own span.
      const q = new THREE.Quaternion().setFromUnitVectors(UP, SCRATCH.set(dx, dy, dz).normalize());
      geo.applyQuaternion(q);
      geo.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      stone.geos.push(tint(geo, s % 2 === 0 ? STONE_PALE : STONE));
    }

    // A flared foot on the rim, and a gold collar where it leaves the bowl.
    addCyl(stone, 2.4, 4.2, 4, 8, bx, baseY + 2, bz, STONE_SHADE);
    addCyl(gold, 2.0, 2.0, 0.6, 8, bx, baseY + 4.4, bz, GOLD);

    // The head: a crystal lantern in a gold cage, at the tip of the lean.
    addCyl(gold, 1.5, 0.9, 1.2, 8, hx, PYLON_TOP_Y + 0.6, hz, GOLD);
    const shard = new THREE.OctahedronGeometry(2.1, 0);
    shard.scale(1, 1.6, 1);
    shard.translate(hx, PYLON_TOP_Y + 3.2, hz);
    crystal.geos.push(shard);

    // Every fourth pylon carries a light, alternating house colours. Sixteen
    // dynamic lights would re-link every lit material in the scene; four reads
    // exactly the same from the floor.
    if (i % 4 === 0) {
      const light = new THREE.PointLight(i % 8 === 0 ? BANNER_B : BANNER_A, 3.4, 90, 2);
      light.position.set(hx, PYLON_TOP_Y + 3.2, hz);
      // The budget's flicker pass drives fireLights at userData.baseIntensity,
      // defaulting to a campfire's 11 when unset, a full stop over the
      // authored level. The authored intensity is the base.
      light.userData.baseIntensity = 3.4;
      lights.push(light);
    }

    // ---- flying arches ----------------------------------------------------
    // Springing off the shaft toward the bell's equator and stopping short of
    // the glass. They carry nothing; they are the reason the building looks
    // like it is holding something up.
    const springY = baseY + (PYLON_TOP_Y - baseY) * 0.45;
    const springR = PYLON_BASE_R + (PYLON_HEAD_R - PYLON_BASE_R) * 0.2;
    const reach = springR - (DEEPGLASS_RADIUS + 3.5);
    addArc(
      stone,
      reach / 2,
      0.55,
      Math.PI,
      cx + ca * (springR - reach / 2),
      springY,
      cz + sa * (springR - reach / 2),
      -a,
      0,
      STONE_PALE,
    );

    // ---- banners ----------------------------------------------------------
    // Hung between every pair of pylons rather than on them, so the ring reads
    // as one continuous frieze from inside the bowl.
  }

  // ---- the terrace rail ----------------------------------------------------
  // The visible half of the parapet whose blockers live in the world module,   // the terrace ends in a fifty-five yard drop, and an unmarked killer edge is
  // not scenery, it is a bug you walk into. Kept low and open (posts under a
  // coping rail) so it guards without walling the view of the caldera in.
  {
    const POSTS = 96;
    for (let i = 0; i < POSTS; i++) {
      const a = (i / POSTS) * Math.PI * 2;
      addCyl(
        stone,
        0.28,
        0.34,
        1.5,
        6,
        cx + Math.cos(a) * PARAPET_R,
        FLOOR_Y + 0.75,
        cz + Math.sin(a) * PARAPET_R,
        STONE_PALE,
      );
    }
    addWall(stone, PARAPET_R, 0.42, FLOOR_Y + 1.5, STONE_PALE, 96);
    addWall(stone, PARAPET_R, 0.3, FLOOR_Y - 0.2, STONE_SHADE, 96);
  }

  // ---- the crown ring ------------------------------------------------------
  // A gold band floating over the bell, unsupported. Pure FF: the impossible
  // object that tells you the place is holy rather than merely large.
  {
    const geo = new THREE.TorusGeometry(CROWN_R, 1.1, 8, 64);
    geo.rotateX(Math.PI / 2);
    geo.translate(cx, CROWN_Y, cz);
    gold.geos.push(tint(geo, GOLD));
    const inner = new THREE.TorusGeometry(CROWN_R * 0.62, 0.5, 6, 48);
    inner.rotateX(Math.PI / 2);
    inner.translate(cx, CROWN_Y + 2.4, cz);
    gold.geos.push(tint(inner, GOLD_DARK));
    // Crystal teeth hanging under the band, pointing down at the crown.
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const shard = new THREE.OctahedronGeometry(1.0, 0);
      shard.scale(1, 2.2, 1);
      shard.translate(cx + Math.cos(a) * CROWN_R, CROWN_Y - 2.2, cz + Math.sin(a) * CROWN_R);
      crystal.geos.push(shard);
    }
    const crownLight = new THREE.PointLight(CRYSTAL, 4.5, 120, 2);
    crownLight.position.set(cx, CROWN_Y - 4, cz);
    crownLight.userData.baseIntensity = 4.5;
    lights.push(crownLight);
  }

  // ---- the causeway --------------------------------------------------------
  // The processional in from the arrival point: a raised DARK cobbled road with
  // gold kerbs and a colonnade, cutting through the bowl's north face. It rides
  // the cobble bag rather than the pale deck tiles: the plaza's pale floor
  // belongs to the building, but this road crosses the dark caldera slate and
  // has to read as part of that ground, not a strip of lit tiles laid over it.
  {
    const zFar = DG_CAUSEWAY_Z_FAR;
    const zNear = DG_CAUSEWAY_Z_NEAR;
    const len = zFar - zNear;
    const midZ = cz + (zNear + zFar) / 2;
    boxUV(
      addBox(cobble, CAUSEWAY_HALF_W * 2, 0.5, len, cx, FLOOR_Y + 0.3, midZ, 0, CAUSEWAY_DARK),
      COBBLE_TEX_S,
    );
    for (const side of [-1, 1]) {
      addBox(gold, 0.6, 0.7, len, cx + side * CAUSEWAY_HALF_W, FLOOR_Y + 0.7, midZ, 0, GOLD_DARK);
      // The colonnade itself is no longer drawn here: the pillars are placed
      // GLBs (world.ts colonnadePlacements, the Blender-authored fluted column
      // in /models/props/deepglass_pillar.glb) at the same seats and heights
      // the old eight-sided cylinders stood at, so the collider spheres in
      // world.ts stadiumColliderVolumes still match them.
    }
  }

  // ---- assemble ------------------------------------------------------------
  const masonry = masonryMaterial();
  const stoneMesh = new THREE.Mesh(mergeGeometries(stone.geos, false), masonry);
  stoneMesh.name = 'deepglass-stadium-stone';
  group.add(stoneMesh);

  const goldMesh = new THREE.Mesh(mergeGeometries(gold.geos, false), masonry);
  goldMesh.name = 'deepglass-stadium-gold';
  group.add(goldMesh);

  // The textured courses: floor tiles, wall brick, entrance cobbles, three
  // sets from the hand-painted terrain pack, world-space UVs, vertex tints
  // preserved underneath (texturedMasonry).
  const deckMat = texturedMasonry('deck_tiles_color.jpg', 'deck_tiles_normal.jpg', 2.2);
  const deckMesh = new THREE.Mesh(mergeGeometries(deck.geos, false), deckMat);
  deckMesh.name = 'deepglass-stadium-deck';
  group.add(deckMesh);

  const wallMat = texturedMasonry('wall_brick_color.jpg', 'wall_brick_normal.jpg', 1.9);
  const wallMesh = new THREE.Mesh(mergeGeometries(wall.geos, false), wallMat);
  wallMesh.name = 'deepglass-stadium-wall';
  group.add(wallMesh);

  const cobbleMat = texturedMasonry('plaza_cobble_color.jpg', 'plaza_cobble_normal.jpg', 1.7);
  const cobbleMesh = new THREE.Mesh(mergeGeometries(cobble.geos, false), cobbleMat);
  cobbleMesh.name = 'deepglass-stadium-cobble';
  group.add(cobbleMesh);

  const crystalMat = crystalMaterial();
  const crystalMesh = new THREE.Mesh(mergeGeometries(crystal.geos, false), crystalMat);
  crystalMesh.name = 'deepglass-stadium-crystal';
  crystalMesh.renderOrder = 12;
  group.add(crystalMesh);

  // Banners hung between the pylons. Their own mesh per house colour, because
  // the ripple is a vertex shader and the two colours share nothing else.
  const bannerMats: THREE.ShaderMaterial[] = [];
  for (const [house, color] of [BANNER_A, BANNER_B].entries()) {
    const geos: THREE.BufferGeometry[] = [];
    for (let i = house; i < PYLON_COUNT; i += 2) {
      const a = ((i + 0.5) / PYLON_COUNT) * Math.PI * 2;
      if (Math.abs(angleDelta(a, Math.PI / 2)) < BOWL_GAP) continue;
      const r = PYLON_BASE_R - 1.5;
      const geo = new THREE.PlaneGeometry(7, 17, 3, 8);
      geo.rotateY(-a + Math.PI / 2);
      geo.translate(cx + Math.cos(a) * r, FLOOR_Y + BOWL_TOP_Y + 10, cz + Math.sin(a) * r);
      geos.push(geo);
    }
    const mat = bannerMaterial(color);
    bannerMats.push(mat);
    const mesh = new THREE.Mesh(mergeGeometries(geos, false), mat);
    mesh.name = `deepglass-stadium-banner-${house}`;
    group.add(mesh);
  }

  let time = 0;
  return {
    group,
    lights,
    update(dt: number): void {
      time += dt;
      crystalMat.uniforms.uTime.value = time;
      for (const m of bannerMats) m.uniforms.uTime.value = time;
    },
    dispose(): void {
      group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
      });
      masonry.dispose();
      deckMat.dispose();
      wallMat.dispose();
      cobbleMat.dispose();
      crystalMat.dispose();
      for (const m of bannerMats) m.dispose();
    },
  };
}

const UP = new THREE.Vector3(0, 1, 0);
const SCRATCH = new THREE.Vector3();

/** Shortest signed angle from `b` to `a`, radians. */
function angleDelta(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
