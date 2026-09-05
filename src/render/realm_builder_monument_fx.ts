// The Realm Builder monument's living half: the honouree's name projected in
// gold off each honour plate, and the four lantern flames' glow and embers.
//
// NO PER-FRAME CPU in the effects. Every motion here is
// derived in a shader from the renderer's shared `uTime`, exactly the way
// battleground_lantern_fx.ts drives the Thornhollow lanterns: the update()
// below writes ONE uniform (reduced motion) and touches nothing else, so a
// crowded town square pays nothing for the square's centrepiece.
//
// The statue's own geometry is here too, in buildRealmBuilderMonumentBody. It
// is the ONE Eastbrook civic prop that does not join the town's merged
// vertex-colour micro-batch: its baked albedo carries the carving that makes it
// a statue rather than a shape, and a merged batch cannot hold a texture. Three
// draws for the body (surface, gold tools, flame cores), plus the effects
// below.
//
// i18n: the projection carries the honouree's NAME and nothing else. That is a
// deliberate scope choice, not an oversight. Names are world data and splice
// verbatim (the player-name rule), so the panel needs no re-bake on a language
// switch; every word of chrome ("Realm Builder of the Month", the roll, the
// month) lives in the inspect card, which localizes properly.

import * as THREE from 'three';
import { currentRealmBuilder } from '../sim/content/realm_builders';
import { EASTBROOK_LAYOUT } from '../sim/eastbrook_layout';
import { displayRealmBuilderName } from '../ui/realm_builder_name';
import { loadTexture } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { GFX, gfxTierAtLeast, sharedUniforms } from './gfx';
import {
  emberMetrics,
  hologramMetrics,
  hologramPanelCenter,
  MONUMENT_EMBER_SEED_STRIDE,
  MONUMENT_EMBERS,
  MONUMENT_IMPOSTOR_ATLAS,
  MONUMENT_LANTERNS,
  MONUMENT_PLATE_BACK,
  MONUMENT_PLATE_FRONT,
  type MonumentPlacement,
  monumentDirectionWorld,
  monumentEmberSeeds,
  monumentImpostorCell,
  monumentImpostorSize,
  monumentImpostorUvOffset,
  monumentLodPlan,
  monumentPlateYaw,
  monumentPointWorld,
  monumentScale,
} from './realm_builder_monument_fx_core';

const GROUP_NAME = 'eastbrookRealmBuilderMonumentFx';
const NAME_CANVAS_WIDTH = 1024;
const NAME_CANVAS_HEIGHT = 320;
const NAME_FONT_STACK = '"Cinzel", "Palatino Linotype", Palatino, Georgia, serif';
/** The GLB material on the four flame cores, which must not cast shadow. */
const FLAME_MATERIAL_NAME = 'MonumentFlame';
/** The GLB material on the hammer head and the tablet. */
const TOOLS_MATERIAL_NAME = 'MonumentTools';
const TOOL_PULSE_CACHE_KEY = 'realm-builder-tool-pulse-v1';
const TOOL_GOLD = 0xffc04a;
const SPARKLE_GOLD = 0xfff0b8;
/** Glints per tool mesh. Small: these are highlights, not a firework. */
const SPARKLES_PER_TOOL = 22;
export const MONUMENT_IMPOSTOR_URL = '/textures/props/eastbrook_realm_builder_impostor.webp';

let impostorTexture: THREE.Texture | null = null;
if (typeof window !== 'undefined') {
  registerDeferredPreload(() =>
    loadTexture(MONUMENT_IMPOSTOR_URL).then((texture) => {
      impostorTexture = texture;
    }),
  );
}

/** Test-only: the preload lane this module registers (tests/render_asset_preload),
 *  and a seam to stand the atlas in without running the real preload. */
export const realmBuilderMonumentPreloadInternalsForTest = {
  impostorUrl: MONUMENT_IMPOSTOR_URL,
  setImpostorTexture(texture: THREE.Texture | null): () => void {
    const previous = impostorTexture;
    impostorTexture = texture;
    return () => {
      impostorTexture = previous;
    };
  },
};
const HOLOGRAM_GOLD = 0xffcc5e;
const HOLOGRAM_RIM = 0xfff0c4;
/** The cylinder's own axis, the vector every beam is swung off. */
const BEAM_AXIS = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------------------
// The projected name.
// ---------------------------------------------------------------------------

/**
 * The honouree's name as a white alpha mask. White on purpose: the shader owns
 * every colour so the gold, the rim and the flicker stay in one place, and a
 * long name shrinks to fit rather than clipping at the panel edge.
 */
function nameTexture(name: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = NAME_CANVAS_WIDTH;
  canvas.height = NAME_CANVAS_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Realm Builder name texture has no 2D context');
  ctx.clearRect(0, 0, NAME_CANVAS_WIDTH, NAME_CANVAS_HEIGHT);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  let size = 160;
  const maxWidth = NAME_CANVAS_WIDTH * 0.9;
  do {
    ctx.font = `700 ${size}px ${NAME_FONT_STACK}`;
    if (ctx.measureText(name).width <= maxWidth) break;
    size -= 6;
  } while (size > 40);
  // A soft bloom baked into the mask: the additive pass alone gives hard,
  // aliased letter edges at the distance a player reads this from.
  ctx.shadowColor = '#ffffff';
  ctx.shadowBlur = 26;
  ctx.fillText(name, NAME_CANVAS_WIDTH / 2, NAME_CANVAS_HEIGHT / 2, maxWidth);
  ctx.shadowBlur = 0;
  ctx.fillText(name, NAME_CANVAS_WIDTH / 2, NAME_CANVAS_HEIGHT / 2, maxWidth);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.anisotropy = 4;
  return texture;
}

const NAME_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uReducedMotion;
  varying vec2 vUv;
  varying float vRise;
  void main() {
    vUv = uv;
    float motion = 1.0 - uReducedMotion;
    // The panel breathes on the spot. Small: a name that drifts far reads as
    // a loose decal rather than as something the plate is holding up.
    vec3 p = position;
    p.y += sin(uTime * 0.9) * 0.022 * motion;
    // Where a texel sits up the beam, for the materialize sweep below.
    vRise = uv.y;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const NAME_FRAGMENT = /* glsl */ `
  uniform sampler2D uMask;
  uniform vec3 uGold;
  uniform vec3 uRim;
  uniform float uTime;
  uniform float uReducedMotion;
  varying vec2 vUv;
  varying float vRise;
  void main() {
    float mask = texture2D(uMask, vUv).a;
    if (mask < 0.004) discard;
    float motion = 1.0 - uReducedMotion;

    // Scanlines: the one cue that says "projected" rather than "painted on a
    // floating card". Tied to world-ish panel space, not screen space, so they
    // do not crawl when the camera moves.
    float lines = 0.86 + 0.14 * sin((vUv.y * 46.0) - uTime * 2.2 * motion);

    // A slow bright sweep climbing the panel, the projector re-drawing itself.
    float sweepAt = fract(uTime * 0.19);
    float sweep = smoothstep(0.16, 0.0, abs(vRise - sweepAt)) * motion;

    // Two rates again, so the flicker never settles into a countable loop.
    float flicker = 1.0
      + (sin(uTime * 5.7) * 0.05 + sin(uTime * 11.3) * 0.03) * motion;

    vec3 tint = mix(uGold, uRim, clamp(sweep * 1.4 + mask * 0.25, 0.0, 1.0));
    float alpha = mask * lines * flicker * (0.85 + sweep * 0.9);
    gl_FragColor = vec4(tint * (1.0 + sweep * 1.1), clamp(alpha, 0.0, 1.0));
  }
`;

// ---------------------------------------------------------------------------
// The projector beam: an open cone from the plate up to the name.
// ---------------------------------------------------------------------------

const BEAM_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uReducedMotion;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const BEAM_FRAGMENT = /* glsl */ `
  uniform vec3 uGold;
  uniform float uTime;
  uniform float uReducedMotion;
  varying vec2 vUv;
  void main() {
    float motion = 1.0 - uReducedMotion;
    // Brightest at the plate, gone by the time it reaches the name: a shaft of
    // light has no visible end, it just stops being dense enough to see.
    float fall = pow(1.0 - clamp(vUv.y, 0.0, 1.0), 1.7);
    // Fade the silhouette edges so the cone never shows a hard rim.
    float edge = sin(vUv.x * 3.14159265);
    float ripple = 0.78 + 0.22 * sin(vUv.y * 24.0 - uTime * 3.1 * motion);
    float alpha = fall * edge * ripple * 0.30;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(uGold, alpha);
  }
`;

// ---------------------------------------------------------------------------
// Lantern halo + embers.
// ---------------------------------------------------------------------------

const HALO_VERTEX = /* glsl */ `
  const float TAU = 6.28318530718;
  attribute vec2 aCorner;
  attribute float aPhase;
  uniform float uTime;
  uniform float uReducedMotion;
  uniform float uRadius;
  varying vec2 vCorner;
  varying float vPulse;
  void main() {
    vCorner = aCorner;
    float motion = 1.0 - uReducedMotion;
    // The same two rates the merged batch's flame flutter uses, so the halo
    // brightens on the beat its flame does instead of fighting it.
    vPulse = 1.0
      + (sin(uTime * 3.1 + aPhase * 3.0) * 0.16
       + sin(uTime * 7.3 + aPhase * 5.0) * 0.07) * motion;
    // Screen-aligned: a halo is glare, and glare has no facing.
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    mv.xy += aCorner * uRadius * vPulse;
    gl_Position = projectionMatrix * mv;
  }
`;

const HALO_FRAGMENT = /* glsl */ `
  uniform vec3 uCore;
  uniform vec3 uEdge;
  varying vec2 vCorner;
  varying float vPulse;
  void main() {
    float d = length(vCorner);
    if (d > 1.0) discard;
    float core = smoothstep(1.0, 0.0, d);
    float a = pow(max(core, 0.0), 2.4) * 0.72 * vPulse;
    gl_FragColor = vec4(mix(uEdge, uCore, pow(max(core, 0.0), 3.0)), a);
  }
`;

const EMBER_VERTEX = /* glsl */ `
  const float TAU = 6.28318530718;
  attribute vec4 aSeed;
  uniform float uTime;
  uniform float uReducedMotion;
  uniform float uRise;
  uniform float uRadius;
  uniform float uSize;
  uniform float uCycle;
  varying float vAlpha;
  void main() {
    float motion = 1.0 - uReducedMotion;
    float rate = 0.6 + 0.8 * aSeed.w;
    float life = fract(aSeed.z + uTime * rate * motion / uCycle);
    // Slowing as it cools, and wandering wider as it slows: an ember off a
    // wick, the opposite of the flame's taper below it.
    float climb = pow(max(life, 0.0), 0.72);
    float ang = aSeed.x * TAU + sin(uTime * 1.3 * motion + aSeed.z * TAU) * 0.9;
    float r = uRadius * (0.2 + 0.8 * aSeed.y) * (0.35 + 0.9 * climb);
    vec3 p = position + vec3(cos(ang) * r, climb * uRise, sin(ang) * r);
    vAlpha = smoothstep(0.0, 0.1, life) * (1.0 - smoothstep(0.3, 1.0, life));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = (uSize / max(-mv.z, 1.0)) * (0.4 + 0.6 * (1.0 - climb));
    gl_Position = projectionMatrix * mv;
  }
`;

const EMBER_FRAGMENT = /* glsl */ `
  uniform vec3 uCore;
  uniform vec3 uEdge;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    float core = smoothstep(0.5, 0.05, d);
    float a = core * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(mix(uEdge, uCore, pow(max(core, 0.0), 2.2)), a);
  }
`;

/**
 * The statue itself: the shipped GLB cloned with its OWN materials, scaled to
 * the layout's nativeDimensions and seated on the ground at its own point.
 *
 * `source` is the raw loaded scene from the town's template cache, which is a
 * shared immutable resource: clone before touching anything. The clone shares
 * its textures with the cache entry, which is exactly why eastbrook_town.ts
 * never releases this asset's GLB.
 */
export function buildRealmBuilderMonumentBody(
  source: THREE.Object3D,
  placement: MonumentPlacement,
): RealmBuilderMonumentBody {
  const group = new THREE.Group();
  group.name = `${GROUP_NAME}Body`;
  const body = source.clone(true);
  const scale = monumentScale(placement);
  body.scale.set(scale.x, scale.y, scale.z);
  body.rotation.y = placement.rotation;
  body.position.set(placement.x, placement.groundY, placement.z);
  const reducedMotion = { value: 0 };
  const tools: THREE.Mesh[] = [];
  body.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    const sourceName = materials[0]?.name;
    child.material = Array.isArray(child.material)
      ? materials.map(monumentMaterial)
      : monumentMaterial(materials[0]);
    // The flame cores are light, not matter: a lit ember casting a hard shadow
    // across the plinth is the tell that gives a fake glow away.
    const lit = sourceName === FLAME_MATERIAL_NAME;
    child.castShadow = !lit;
    child.receiveShadow = !lit;
    if (sourceName === TOOLS_MATERIAL_NAME) {
      const toolMaterials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of toolMaterials) decorateToolPulse(material, reducedMotion);
      tools.push(child);
    }
  });
  group.add(body);
  body.updateMatrixWorld(true);
  const sparkle = buildToolSparkle(tools, reducedMotion);
  if (sparkle) group.add(sparkle);
  const impostor = buildImpostor(placement);
  if (impostor) group.add(impostor.mesh);
  return {
    group,
    reducedMotion,
    setLod(distance: number, cameraX: number, cameraZ: number): void {
      const plan = monumentLodPlan(distance);
      // With no atlas there is nothing to swap TO, so the statue stays. Hiding
      // it anyway would leave a hole where the town's centrepiece stands, and
      // drawing a prop you meant to cheapen is a far better failure than
      // deleting it.
      const showBody = plan.body || impostor === null;
      body.visible = showBody;
      if (sparkle) sparkle.visible = showBody && plan.effects;
      if (!impostor) return;
      impostor.mesh.visible = plan.impostor;
      if (!plan.impostor) return;
      const cell = monumentImpostorCell(cameraX, cameraZ, placement);
      if (cell === impostor.cell) return;
      impostor.cell = cell;
      const offset = monumentImpostorUvOffset(cell);
      impostor.uvOffset.value.set(offset.u, offset.v);
    },
  };
}

export interface RealmBuilderMonumentBody {
  readonly group: THREE.Group;
  /** Written by the FX update, so body and effects hold still together. */
  readonly reducedMotion: { value: number };
  /**
   * Swap between the real statue and its billboard, and pick the billboard's
   * baked view. Called once a frame from the town view, which already has the
   * camera; allocation-free, and a no-op on the frames where nothing changed.
   */
  setLod(distance: number, cameraX: number, cameraZ: number): void;
}

interface MonumentImpostor {
  readonly mesh: THREE.Mesh;
  readonly uvOffset: { value: THREE.Vector2 };
  cell: number;
}

const IMPOSTOR_VERTEX = /* glsl */ `
  #include <fog_pars_vertex>
  uniform vec2 uCell;
  uniform vec2 uCellSize;
  varying vec2 vUv;
  void main() {
    vUv = uCell + uv * uCellSize;
    // Billboard about the vertical axis ONLY: a statue that tips to face the
    // camera reads as a card the moment you look down at it from a rise.
    vec3 right = vec3(modelViewMatrix[0][0], modelViewMatrix[1][0], modelViewMatrix[2][0]);
    vec3 flat = normalize(vec3(right.x, 0.0, right.z));
    vec3 world = vec3(
      flat.x * position.x,
      position.y,
      flat.z * position.x
    );
    vec4 mvPosition = modelViewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

// The atlas is sRGB-tagged, so the sample is linear like every lit surface,
// and the tail is the one MeshStandardMaterial ends with (tonemapping,
// colorspace, fog): a card that skipped it would stand un-fogged and
// un-toned at the fog wall while every building around it fades, and would
// shift colour against the body on the frame the two swap.
const IMPOSTOR_FRAGMENT = /* glsl */ `
  #include <fog_pars_fragment>
  uniform sampler2D uAtlas;
  varying vec2 vUv;
  void main() {
    vec4 texel = texture2D(uAtlas, vUv);
    // Alpha-TEST, not blend: at this range the billboard has to sort against
    // the town like the solid it stands in for, and a blended quad does not.
    if (texel.a < 0.5) discard;
    gl_FragColor = vec4(texel.rgb, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

/**
 * The billboard that stands in for the statue past MONUMENT_IMPOSTOR_RANGE.
 *
 * Null until its atlas has loaded, and null forever on a host with no preload
 * lane: the caller then simply never swaps, which is the safe way to fail.
 */
function buildImpostor(placement: MonumentPlacement): MonumentImpostor | null {
  if (!impostorTexture) return null;
  const size = monumentImpostorSize(placement);
  const geometry = new THREE.PlaneGeometry(size, size);
  // Seat it so its foot is on the ground, like the statue it replaces.
  geometry.translate(0, size / 2, 0);
  const uvOffset = { value: new THREE.Vector2(0, 0) };
  const material = new THREE.ShaderMaterial({
    vertexShader: IMPOSTOR_VERTEX,
    fragmentShader: IMPOSTOR_FRAGMENT,
    // Scene fog reaches a ShaderMaterial only when asked for, and only through
    // these uniforms (foliage_impostor.ts gets both from MeshStandardMaterial).
    // Cloned rather than merged so uCell stays the caller's own Vector2.
    fog: true,
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uAtlas: { value: impostorTexture },
      uCell: uvOffset,
      uCellSize: {
        value: new THREE.Vector2(
          1 / MONUMENT_IMPOSTOR_ATLAS.columns,
          1 / MONUMENT_IMPOSTOR_ATLAS.rows,
        ),
      },
    },
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `${GROUP_NAME}Impostor`;
  mesh.position.set(placement.x, placement.groundY, placement.z);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.visible = false;
  return { mesh, uvOffset, cell: -1 };
}

/**
 * Make the builder's tools breathe gold WITHOUT touching their albedo.
 *
 * They shipped emissive-gold once and the owner rejected it: a baked emissive
 * strong enough to read drowns the carved stone, and both tools came out as
 * flat yellow slabs. So the surface stays exactly the sculpt's, and this ADDS
 * to `totalEmissiveRadiance` on the shared clock. Two rates again, so the
 * breath never settles into a countable loop, and it never falls to zero: a
 * highlight that blinks fully off reads as a bug rather than as a glow.
 */
function decorateToolPulse<T extends THREE.Material>(
  material: T,
  reducedMotion: { value: number },
): T {
  if (material.userData.realmBuilderToolPulse) return material;
  const previousCompile = material.onBeforeCompile.bind(material);
  const previousCacheKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile(shader, renderer);
    shader.uniforms.uTime = sharedUniforms.uTime;
    shader.uniforms.uToolReducedMotion = reducedMotion;
    shader.uniforms.uToolGold = { value: new THREE.Color(TOOL_GOLD) };
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
uniform float uTime;
uniform float uToolReducedMotion;
uniform vec3 uToolGold;
float toolBreath = 0.55
  + 0.30 * sin(uTime * 1.15)
  + 0.15 * sin(uTime * 2.7);
// Reduced motion holds the glow at its midpoint rather than removing it: the
// gold is what marks these two out, and losing it loses the read.
toolBreath = mix(toolBreath, 0.55, uToolReducedMotion);
totalEmissiveRadiance += uToolGold * toolBreath;`,
    );
  };
  material.customProgramCacheKey = () => `${previousCacheKey()}|${TOOL_PULSE_CACHE_KEY}`;
  material.userData.realmBuilderToolPulse = TOOL_PULSE_CACHE_KEY;
  material.needsUpdate = true;
  return material;
}

const SPARKLE_VERTEX = /* glsl */ `
  const float TAU = 6.28318530718;
  attribute vec3 aSeed;
  uniform float uTime;
  uniform float uToolReducedMotion;
  uniform float uSize;
  varying float vAlpha;
  void main() {
    float motion = 1.0 - uToolReducedMotion;
    // Each glint has its own period and its own place in it, so the set never
    // flashes together. Held dark for most of a cycle: a sparkle is a rare
    // catch of the light, not a steady lamp.
    float period = 1.6 + 2.4 * aSeed.x;
    float phase = fract(aSeed.y + uTime * motion / period);
    float flash = smoothstep(0.86, 1.0, 1.0 - abs(phase - 0.5) * 2.0);
    vAlpha = flash * (0.5 + 0.5 * aSeed.z);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = (uSize / max(-mv.z, 1.0)) * (0.4 + 0.6 * aSeed.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const SPARKLE_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    if (vAlpha < 0.01) discard;
    vec2 d = gl_PointCoord - vec2(0.5);
    // A four-point star rather than a disc: a round dot at this size reads as
    // a dust mote, and the cross is what says "glint".
    float star = max(
      smoothstep(0.5, 0.0, abs(d.x) * 6.0 + abs(d.y)),
      smoothstep(0.5, 0.0, abs(d.y) * 6.0 + abs(d.x))
    );
    float a = star * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

/**
 * Glints scattered over the tools' own surfaces.
 *
 * Sampled from the real geometry rather than thrown around a centroid, so they
 * sit ON the hammer head and the tablet instead of in a cloud near them. World
 * space, because the body is already placed by the time this runs.
 */
function buildToolSparkle(
  tools: readonly THREE.Mesh[],
  reducedMotion: { value: number },
): THREE.Points | null {
  if (tools.length === 0) return null;
  if (!gfxTierAtLeast(GFX.effectsTier, 'medium')) return null;
  const count = tools.length * SPARKLES_PER_TOOL;
  const positions = new Float32Array(count * 3);
  const seeds = monumentEmberSeeds(count);
  const point = new THREE.Vector3();
  let written = 0;
  for (const tool of tools) {
    const position = tool.geometry.getAttribute('position');
    if (!position) continue;
    for (let index = 0; index < SPARKLES_PER_TOOL; index++) {
      // Walk the vertex ring with a stride that is coprime with most counts, so
      // a small sample still spreads over the whole tool instead of clustering
      // on one face.
      const vertex = (index * 7 + 3) % position.count;
      point.fromBufferAttribute(position, vertex).applyMatrix4(tool.matrixWorld);
      positions[written * 3] = point.x;
      positions[written * 3 + 1] = point.y;
      positions[written * 3 + 2] = point.z;
      written++;
    }
  }
  if (written === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions.slice(0, written * 3), 3));
  const seedTriples = new Float32Array(written * 3);
  for (let index = 0; index < written * 3; index++) seedTriples[index] = seeds[index];
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seedTriples, 3));
  geometry.computeBoundingSphere();
  const material = additive(
    new THREE.ShaderMaterial({
      vertexShader: SPARKLE_VERTEX,
      fragmentShader: SPARKLE_FRAGMENT,
      uniforms: {
        uTime: sharedUniforms.uTime,
        uToolReducedMotion: reducedMotion,
        uSize: { value: 320 },
        uColor: { value: new THREE.Color(SPARKLE_GOLD) },
      },
    }),
  );
  const points = new THREE.Points(geometry, material);
  points.name = `${GROUP_NAME}Sparkle`;
  points.renderOrder = 4;
  return points;
}

/**
 * The monument's materials keep their GLB textures, and downgrade on the
 * Lambert tiers exactly as the town's kit buildings do (the Low-tier contract
 * the surface-atlas suite audits): map, colour and emissive carry across.
 */
function monumentMaterial(source: THREE.Material): THREE.Material {
  if (GFX.standardMaterials) return source;
  const from = source as THREE.Material & {
    map?: THREE.Texture | null;
    color?: THREE.Color;
    emissive?: THREE.Color;
    vertexColors?: boolean;
  };
  const lambert = new THREE.MeshLambertMaterial({
    map: from.map ?? null,
    color: from.color?.clone() ?? new THREE.Color(0xffffff),
    vertexColors: from.vertexColors === true,
  });
  if (from.emissive) lambert.emissive = from.emissive.clone();
  lambert.name = source.name;
  return lambert;
}

/**
 * An INVISIBLE cylinder matching the monument's collider, for the entity view
 * to be picked by.
 *
 * The statue's art is drawn by the town's merged micro-batch, so its inspect
 * entity has no body of its own. Without this it fell through renderer.ts's
 * generic ground-object arm, which builds a quest-pickup prop and a loot
 * sparkle: a lumpy placeholder standing inside the plinth, and still nothing
 * you could click the STATUE to reach. Invisible rather than transparent
 * because three's raycaster ignores `visible`, so this costs no draw call and
 * still takes the click (the same trick the character capsule proxy uses).
 */
export function buildRealmBuilderMonumentPickBody(): {
  group: THREE.Group;
  height: number;
} {
  const monument = EASTBROOK_LAYOUT.civic.monument;
  const group = new THREE.Group();
  group.name = `${GROUP_NAME}Pick`;
  const proxy = new THREE.Mesh(
    new THREE.CylinderGeometry(monument.radius, monument.radius, monument.height, 12, 1, true),
    new THREE.MeshBasicMaterial(),
  );
  proxy.position.y = monument.height / 2;
  proxy.visible = false;
  proxy.castShadow = false;
  proxy.receiveShadow = false;
  group.add(proxy);
  return { group, height: monument.height };
}

export interface RealmBuilderMonumentFx {
  readonly group: THREE.Group;
  /** One uniform write plus a distance gate. Called from the town view's own
   *  per-frame update, which already has the camera. */
  update(reducedMotion: boolean, distance?: number): void;
  /**
   * Re-bake the projected name, for a roll that arrived after the town was
   * built: the client fetches it while the world loads, and an operator can
   * name somebody at any point in a live session.
   */
  setHonouree(name: string): void;
  dispose(): void;
}

/**
 * `side` is a real decision, not a default. The beam is an open cone you see
 * the inside of, so it is DoubleSide. A name panel is NOT: front-facing only,
 * or the front plate's text also renders mirrored from behind and crosses the
 * back plate's own (correct) text as you walk around the plinth.
 */
function additive(
  material: THREE.ShaderMaterial,
  side: THREE.Side = THREE.DoubleSide,
): THREE.ShaderMaterial {
  material.transparent = true;
  material.depthWrite = false;
  material.blending = THREE.AdditiveBlending;
  material.side = side;
  material.toneMapped = false;
  return material;
}

/**
 * Build the monument's projections and lantern light.
 *
 * `honoureeName` defaults to the live roll (through the same localizing
 * helper the card uses, so an unclaimed plate reads the same in both), and is
 * a parameter only so a test can drive a long name through the panel's
 * shrink-to-fit path.
 */
export function buildRealmBuilderMonumentFx(
  placement: MonumentPlacement,
  initialHonoureeName: string = displayRealmBuilderName(currentRealmBuilder()),
): RealmBuilderMonumentFx {
  let honoureeName = initialHonoureeName;
  const group = new THREE.Group();
  group.name = GROUP_NAME;
  const reducedMotion = { value: 0 };
  const owned: Array<{ dispose(): void }> = [];
  // The whole effect is cosmetic and the projected name needs a 2D canvas, so
  // a host without a document (the Node-environment town tests, the headless
  // RL env) gets an empty group rather than a throw at world build. The real
  // thing is covered under a DOM environment in
  // tests/realm_builder_monument_fx.test.ts.
  if (typeof document === 'undefined') {
    return {
      group,
      update: () => undefined,
      setHonouree: () => undefined,
      dispose: () => undefined,
    };
  }

  // Every size below scales with the monument (see MONUMENT_HOLOGRAM): the
  // projection is part of its composition, not a fixed-size decal.
  const holo = hologramMetrics(placement);
  const lantern = emberMetrics(placement);

  // ---- the two projected names -------------------------------------------
  // Boxed, because setHonouree swaps it: `owned` disposes whatever is current
  // at teardown, not whichever texture happened to be first.
  const mask = { value: nameTexture(honoureeName) };
  const panelMaterials: THREE.ShaderMaterial[] = [];
  owned.push({ dispose: () => mask.value.dispose() });
  const panelGeometry = new THREE.PlaneGeometry(holo.panelWidth, holo.panelHeight);
  // The panel stands out from the plate as well as above it, so the shaft is
  // longer than the lift and leans: build it at its true length once (both
  // plates use the same standoff and lift) and aim each copy below.
  const beamLength = Math.hypot(holo.standoff, holo.lift);
  const beamGeometry = new THREE.CylinderGeometry(
    holo.beamTopRadius,
    holo.beamBaseRadius,
    beamLength,
    14,
    1,
    true,
  );
  owned.push(panelGeometry, beamGeometry);

  for (const plate of [MONUMENT_PLATE_FRONT, MONUMENT_PLATE_BACK]) {
    const anchor = monumentPointWorld(plate.anchor, placement);
    const normal = monumentDirectionWorld(plate.normal, placement);
    const center = hologramPanelCenter(anchor, normal, holo);
    const yaw = monumentPlateYaw(normal);

    const beamMaterial = additive(
      new THREE.ShaderMaterial({
        vertexShader: BEAM_VERTEX,
        fragmentShader: BEAM_FRAGMENT,
        uniforms: {
          uTime: sharedUniforms.uTime,
          uReducedMotion: reducedMotion,
          uGold: { value: new THREE.Color(HOLOGRAM_GOLD) },
        },
      }),
    );
    const beam = new THREE.Mesh(beamGeometry, beamMaterial);
    beam.name = `${GROUP_NAME}Beam`;
    // Seat at the midpoint, then swing the cylinder's own +Y onto the
    // plate-to-panel axis. Skipping the swing leaves the shaft plumb while the
    // name it feeds stands a third of a yard out in front of it.
    beam.position.set(
      (anchor.x + center.x) / 2,
      (anchor.y + center.y) / 2,
      (anchor.z + center.z) / 2,
    );
    beam.quaternion.setFromUnitVectors(
      BEAM_AXIS,
      new THREE.Vector3(center.x - anchor.x, center.y - anchor.y, center.z - anchor.z).normalize(),
    );
    beam.renderOrder = 3;
    owned.push(beamMaterial);
    group.add(beam);

    const panelMaterial = additive(
      new THREE.ShaderMaterial({
        vertexShader: NAME_VERTEX,
        fragmentShader: NAME_FRAGMENT,
        uniforms: {
          uTime: sharedUniforms.uTime,
          uReducedMotion: reducedMotion,
          uMask: { value: mask.value },
          uGold: { value: new THREE.Color(HOLOGRAM_GOLD) },
          uRim: { value: new THREE.Color(HOLOGRAM_RIM) },
        },
      }),
      THREE.FrontSide,
    );
    panelMaterials.push(panelMaterial);
    const panel = new THREE.Mesh(panelGeometry, panelMaterial);
    panel.name = `${GROUP_NAME}Name`;
    panel.position.set(center.x, center.y, center.z);
    panel.rotation.y = yaw;
    panel.renderOrder = 4;
    owned.push(panelMaterial);
    group.add(panel);
  }

  // ---- lantern halos ------------------------------------------------------
  const lanternWorld = MONUMENT_LANTERNS.map((local) => monumentPointWorld(local, placement));
  const haloCount = lanternWorld.length * 4;
  const haloPositions = new Float32Array(haloCount * 3);
  const haloCorners = new Float32Array(haloCount * 2);
  const haloPhases = new Float32Array(haloCount);
  const haloIndices: number[] = [];
  const CORNERS = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const;
  for (let lantern = 0; lantern < lanternWorld.length; lantern++) {
    const at = lanternWorld[lantern];
    // The same phase the merged batch's flame shader derives, so halo and
    // flame pulse together: the bearing of this lantern about the monument.
    const phase = Math.atan2(at.z - placement.z, at.x - placement.x);
    for (let corner = 0; corner < 4; corner++) {
      const vertex = lantern * 4 + corner;
      haloPositions[vertex * 3] = at.x;
      haloPositions[vertex * 3 + 1] = at.y;
      haloPositions[vertex * 3 + 2] = at.z;
      haloCorners[vertex * 2] = CORNERS[corner][0];
      haloCorners[vertex * 2 + 1] = CORNERS[corner][1];
      haloPhases[vertex] = phase;
    }
    const base = lantern * 4;
    haloIndices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const haloGeometry = new THREE.BufferGeometry();
  haloGeometry.setAttribute('position', new THREE.BufferAttribute(haloPositions, 3));
  haloGeometry.setAttribute('aCorner', new THREE.BufferAttribute(haloCorners, 2));
  haloGeometry.setAttribute('aPhase', new THREE.BufferAttribute(haloPhases, 1));
  haloGeometry.setIndex(haloIndices);
  haloGeometry.computeBoundingSphere();
  const haloMaterial = additive(
    new THREE.ShaderMaterial({
      vertexShader: HALO_VERTEX,
      fragmentShader: HALO_FRAGMENT,
      uniforms: {
        uTime: sharedUniforms.uTime,
        uReducedMotion: reducedMotion,
        uRadius: { value: lantern.haloRadius },
        uCore: { value: new THREE.Color(MONUMENT_EMBERS.colorCore) },
        uEdge: { value: new THREE.Color(MONUMENT_EMBERS.colorEdge) },
      },
    }),
  );
  const halos = new THREE.Mesh(haloGeometry, haloMaterial);
  halos.name = `${GROUP_NAME}Halos`;
  halos.renderOrder = 3;
  owned.push(haloGeometry, haloMaterial);
  group.add(halos);

  // ---- embers (cosmetic only: the low tier does not pay for them) ---------
  // Cosmetic only, so it rides the STATIC effects tier (the preset's own
  // sub-knob), never the live FPS governor: a tier knob may shed richness, but
  // the frame rate must not decide what a player sees.
  if (gfxTierAtLeast(GFX.effectsTier, 'medium')) {
    const count = lanternWorld.length * MONUMENT_EMBERS.perLantern;
    const emberPositions = new Float32Array(count * 3);
    // Seeded across ALL FOUR lanterns rather than per lantern: one shared block
    // would give every lantern the same phases and the ring would strobe.
    const seeds = monumentEmberSeeds(count);
    for (let lantern = 0; lantern < lanternWorld.length; lantern++) {
      const at = lanternWorld[lantern];
      for (let mote = 0; mote < MONUMENT_EMBERS.perLantern; mote++) {
        const offset = (lantern * MONUMENT_EMBERS.perLantern + mote) * 3;
        emberPositions[offset] = at.x;
        emberPositions[offset + 1] = at.y;
        emberPositions[offset + 2] = at.z;
      }
    }
    const emberGeometry = new THREE.BufferGeometry();
    emberGeometry.setAttribute('position', new THREE.BufferAttribute(emberPositions, 3));
    emberGeometry.setAttribute(
      'aSeed',
      new THREE.BufferAttribute(seeds, MONUMENT_EMBER_SEED_STRIDE),
    );
    // The shader lifts motes above their lantern, so widen the sphere the
    // renderer culls against rather than leaving it fitted to the bare points.
    emberGeometry.computeBoundingSphere();
    if (emberGeometry.boundingSphere) {
      emberGeometry.boundingSphere.radius += lantern.rise + lantern.radius;
    }
    const emberMaterial = additive(
      new THREE.ShaderMaterial({
        vertexShader: EMBER_VERTEX,
        fragmentShader: EMBER_FRAGMENT,
        uniforms: {
          uTime: sharedUniforms.uTime,
          uReducedMotion: reducedMotion,
          uRise: { value: lantern.rise },
          uRadius: { value: lantern.radius },
          uSize: { value: MONUMENT_EMBERS.size },
          uCycle: { value: MONUMENT_EMBERS.cycleSec },
          uCore: { value: new THREE.Color(MONUMENT_EMBERS.colorCore) },
          uEdge: { value: new THREE.Color(MONUMENT_EMBERS.colorEdge) },
        },
      }),
    );
    const embers = new THREE.Points(emberGeometry, emberMaterial);
    embers.name = `${GROUP_NAME}Embers`;
    embers.renderOrder = 3;
    owned.push(emberGeometry, emberMaterial);
    group.add(embers);
  }

  return {
    group,
    setHonouree(name: string): void {
      if (name === honoureeName || name.trim().length === 0) return;
      honoureeName = name;
      // Re-bake rather than re-place: the name IS a texture, and an operator
      // naming somebody mid-session has to reach a plaque that was built
      // before they did. Both panels share the one mask, so both follow.
      const next = nameTexture(name);
      for (const material of panelMaterials) material.uniforms.uMask.value = next;
      const previous = mask.value;
      mask.value = next;
      previous.dispose();
    },
    update(motionReduced: boolean, distance = 0): void {
      reducedMotion.value = motionReduced ? 1 : 0;
      // Projections, halos and embers are the fill-rate half of this monument
      // and the first half to stop reading, so they are the first to go.
      group.visible = monumentLodPlan(distance).effects;
    },
    dispose(): void {
      for (const resource of owned) resource.dispose();
      group.clear();
    },
  };
}

/** Test-only handles for the contract test. */
export const realmBuilderMonumentFxInternalsForTest = {
  groupName: GROUP_NAME,
  nameTexture,
};
