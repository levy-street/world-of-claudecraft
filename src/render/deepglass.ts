// The Deepglass: render dressing for the deepball bell (docs/prd/deepglass.md).
//
// Modelled on vale_cup_stadium.ts / impact_site.ts: built once in the renderer
// ctor, distance-culled by update(), every position read from the ONE layout
// module (src/sim/deepglass/layout.ts) that the ball physics and the flight
// clamp also read, so what you see is exactly what the ball banks off.
//
// The water is deliberately CLEAR (PRD section 6). A 76-yard arena is
// unplayable through murk: a player must read the far ring, a teammate's run
// and a 55 yd/s shot across the whole bell. The underwater cue therefore comes
// from a fresnel rim on the glass, a faint volume tint, drifting motes and
// caustic banding, never from extinction.
import * as THREE from 'three';
import {
  DEEPGLASS_CENTER,
  DEEPGLASS_CRADLE_R,
  DEEPGLASS_RADIUS,
  DG_BOOST_PADS,
  DG_GOAL_HOUSING_OFFSET,
  DG_HOLE_R,
  DG_POCKET_DEPTH,
  DG_POWERUP_SITES,
  DG_RING_EAST_X,
  DG_RING_OFFSET,
  DG_RING_RADIUS,
  DG_RING_WEST_X,
  ringCentreFor,
} from '../sim/deepglass/layout';
import { deepglassLastBeam, deepglassMatch } from '../sim/deepglass/match';
import { loadTexture } from './assets/loader';
import { buildDeepglassKit, type DeepglassKitState, GATE_SURROUND_SCALE } from './deepglass_kit';

export const DEEPGLASS_SITE = {
  x: DEEPGLASS_CENTER.x,
  z: DEEPGLASS_CENTER.z,
  cullRadius: 420,
} as const;

// Palette. Lambert-safe mid values that read without PBR, matching the
// Sowfield's stone/brass vocabulary so the two grounds look related.
const STONE = 0xa8a29a;
const STONE_DARK = 0x7d786f;
const WATER_TINT = 0x5fd0e8;
/** The two team colours. Exported because the goal celebration
 *  (deepglass_goal_wave.ts) paints the whole building in the scoring side's
 *  colour and must not carry its own copy of the palette. */
export const DG_TINT_A = 0xffa53a; // amber
export const DG_TINT_B = 0x49d6ff; // cyan
const RING_WEST = DG_TINT_A; // team A's goal, at the west end
const RING_EAST = DG_TINT_B; // team B's goal, at the east end
const PAD_GLOW = 0x8effc8;
/** The two prizes, told apart by colour alone at bell range: ice and fire. */
const POWERUP_FREEZE = 0x8ee8ff;
const POWERUP_OVERBURN = 0xff9de2;
/** The goal gate's mouth: radius and how far IN FRONT of the scoring plane it
 *  sits. Both mirror the authored model (scripts/assets/deepglass), the halo
 *  has to land on the funnel's lip, not float near it. */
const GATE_MOUTH_R = 19.5;
const GATE_MOUTH_INSET = 4.2;
/** How long a fired beam stays on screen. */
const BEAM_SECS = 0.3;
const BEAM_UP = new THREE.Vector3(0, 1, 0);
const BEAM_DIR = new THREE.Vector3();

export interface DeepglassView {
  group: THREE.Group;
  /** Pulsing ring/pad lights, owned by the renderer's point-light budget. */
  lights: THREE.PointLight[];
  update(px: number, pz: number, dt: number): void;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Shaders. Each keeps its OWN uTime uniform updated by update(), so the module
// is self-contained and never races the renderer's shared uniform block.
// ---------------------------------------------------------------------------

/** The glass bell: near-invisible face, bright fresnel rim, with the two goal
 *  HOLES cut through it on the ±x axis (layout.ts DG_HOLE_R), each wearing a
 *  pulsing team-tinted rim so the goal mouths read from anywhere in the bell. */
function glassMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uTint: { value: new THREE.Color(WATER_TINT) },
      uCenter: {
        value: new THREE.Vector3(DEEPGLASS_CENTER.x, DEEPGLASS_CENTER.y, DEEPGLASS_CENTER.z),
      },
      uHoleR: { value: DG_HOLE_R },
      uHolePlane: { value: DG_RING_OFFSET },
      uTintWest: { value: new THREE.Color(DG_TINT_A) },
      uTintEast: { value: new THREE.Color(DG_TINT_B) },
    },
    vertexShader: `
      varying vec3 vNormalW;
      varying vec3 vViewW;
      varying vec3 vPosW;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vPosW = wp.xyz;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vViewW = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uTint;
      uniform vec3 uCenter;
      uniform float uHoleR;
      uniform float uHolePlane;
      uniform vec3 uTintWest;
      uniform vec3 uTintEast;
      varying vec3 vNormalW;
      varying vec3 vViewW;
      varying vec3 vPosW;
      void main() {
        // The goal holes: nothing is drawn inside a hole's cylinder, so the
        // glass genuinely opens onto the housing outside.
        vec3 rel = vPosW - uCenter;
        float axisDist = length(rel.yz);
        bool nearPole = abs(rel.x) > uHolePlane - 0.05;
        if (nearPole && axisDist < uHoleR) discard;
        float f = 1.0 - abs(dot(normalize(vNormalW), normalize(vViewW)));
        // Rim only: the face of the glass stays essentially clear so the play
        // inside is never obscured.
        float rim = pow(clamp(f, 0.0, 1.0), 3.0);
        // A slow shimmer band travelling around the bell reads as a curved
        // water surface catching the light.
        float band = 0.04 * sin(vNormalW.y * 14.0 + uTime * 0.6);
        float a = clamp(rim * 0.85 + 0.045 + band, 0.0, 0.85);
        vec3 c = uTint * (0.55 + rim * 0.9);
        // The hole rims burn in the defending side's colour, breathing so a
        // goal mouth is findable across 99 yards of water.
        if (nearPole) {
          float glow = smoothstep(uHoleR + 2.6, uHoleR + 0.1, axisDist);
          vec3 goalTint = rel.x > 0.0 ? uTintEast : uTintWest;
          float pulse = 0.75 + 0.25 * sin(uTime * 2.4);
          c += goalTint * glow * pulse * 1.1;
          a = clamp(a + glow * 0.55 * pulse, 0.0, 1.0);
        }
        gl_FragColor = vec4(c, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}

/** The water volume: a whisper of tint plus slow caustic banding. Extinction
 *  across the full 76 yd stays under ~20% (PRD section 6). */
function waterMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uTint: { value: new THREE.Color(WATER_TINT) },
      uCenter: {
        value: new THREE.Vector3(DEEPGLASS_CENTER.x, DEEPGLASS_CENTER.y, DEEPGLASS_CENTER.z),
      },
      uHoleR: { value: DG_HOLE_R },
      uHolePlane: { value: DG_RING_OFFSET },
    },
    vertexShader: `
      varying vec3 vPosW;
      varying vec3 vNormalW;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vPosW = wp.xyz;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uTint;
      uniform vec3 uCenter;
      uniform float uHoleR;
      uniform float uHolePlane;
      varying vec3 vPosW;
      varying vec3 vNormalW;
      void main() {
        // Open over the goal holes, matching the glass shell exactly.
        vec3 rel = vPosW - uCenter;
        if (abs(rel.x) > uHolePlane - 0.6 && length(rel.yz) < uHoleR) discard;
        // Caustic banding: two crossing slow waves, very low contrast.
        float c = sin(vPosW.x * 0.09 + uTime * 0.35)
                * sin(vPosW.z * 0.11 - uTime * 0.27)
                * sin(vPosW.y * 0.07 + uTime * 0.19);
        float a = 0.055 + 0.035 * c;
        gl_FragColor = vec4(uTint, clamp(a, 0.0, 0.14));
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
  });
}

/** A magic goal ring: rotating rune segments over a pulsing core. */
function ringMaterial(color: number, spin: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(color) },
      uSpin: { value: spin },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uSpin;
      uniform vec3 uColor;
      varying vec2 vUv;
      void main() {
        // vUv.x runs around the ring: carve it into travelling rune segments.
        float travel = vUv.x * 24.0 + uTime * uSpin;
        float seg = smoothstep(0.35, 0.5, abs(fract(travel) - 0.5));
        float pulse = 0.72 + 0.28 * sin(uTime * 2.1);
        vec3 c = uColor * (0.85 + 0.9 * seg) * pulse;
        gl_FragColor = vec4(c, 0.55 + 0.45 * seg);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

/** The scoring plane inside a ring: a slow swirl you can see the far side
 *  through, so a keeper is never blind behind their own goal. */
function portalMaterial(color: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(color) },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv - 0.5;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uColor;
      varying vec2 vUv;
      void main() {
        float r = length(vUv) * 2.0;
        float ang = atan(vUv.y, vUv.x);
        float swirl = sin(ang * 3.0 + uTime * 0.9 - r * 6.0);
        float edge = smoothstep(1.0, 0.55, r);
        float a = edge * (0.10 + 0.10 * swirl);
        gl_FragColor = vec4(uColor, clamp(a, 0.0, 0.30));
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

/** The goal burst: one expanding shell that flashes and fades. A score is the
 *  whole point of the mode and it was previously indistinguishable from the
 *  ball drifting behind the net. */
function burstMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uAge: { value: 1 }, uColor: { value: new THREE.Color(0xffffff) } },
    vertexShader: `
      varying vec3 vN;
      void main() {
        vN = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uAge;
      uniform vec3 uColor;
      varying vec3 vN;
      void main() {
        // Hollow: bright at the silhouette, clear through the middle, so the
        // shell reads as a shockwave rather than a balloon over the play.
        float rim = pow(1.0 - clamp(abs(vN.z), 0.0, 1.0), 2.0);
        float fade = clamp(1.0 - uAge, 0.0, 1.0);
        gl_FragColor = vec4(uColor, rim * fade * 0.85);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

/** The bloom around a waiting prize: bright at the silhouette, clear through
 *  the middle so the station's cage stays readable behind it. */
function orbGlowMaterial(color: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(color) },
    },
    vertexShader: `
      varying vec3 vNormalW;
      varying vec3 vViewW;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vViewW = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uColor;
      varying vec3 vNormalW;
      varying vec3 vViewW;
      void main() {
        float f = 1.0 - abs(dot(normalize(vNormalW), normalize(vViewW)));
        float rim = pow(clamp(f, 0.0, 1.0), 2.2);
        float pulse = 0.72 + 0.28 * sin(uTime * 2.6);
        gl_FragColor = vec4(uColor * (0.6 + rim), rim * 0.75 * pulse);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

/** Drifting motes: the current bands made visible, and the cheapest possible
 *  "you are underwater" cue. */
function moteMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      uniform float uTime;
      attribute float aPhase;
      varying float vFade;
      void main() {
        vec3 p = position;
        // Slow tangential drift around the bell's axis, matching the sim's
        // current bands closely enough to read as the same water.
        float a = uTime * 0.06 + aPhase;
        float c = cos(a), s = sin(a);
        p = vec3(p.x * c - p.z * s, p.y + sin(uTime * 0.3 + aPhase) * 0.8, p.x * s + p.z * c);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vFade = 0.35 + 0.65 * abs(sin(uTime * 0.5 + aPhase * 3.0));
        // Clamped hard: unclamped perspective sizing turns a mote a few yards
        // from the camera into a screen-filling disc, and inside the bell the
        // camera is ALWAYS a few yards from motes. The cap is what keeps the
        // water reading as clear (PRD section 6) instead of as a bubble bath.
        gl_PointSize = clamp(2.2 * (60.0 / -mv.z), 1.0, 4.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      varying float vFade;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        if (dot(d, d) > 0.25) discard;
        gl_FragColor = vec4(0.72, 0.93, 1.0, 0.24 * vFade);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

// ---------------------------------------------------------------------------

function stoneMesh(geo: THREE.BufferGeometry, color: number, rough = 0.85): THREE.Mesh {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.05 });
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = false;
  m.receiveShadow = true;
  return m;
}

/** The stone cradle's GROUND: a base ring and a plaza disc. The sixteen
 *  buttresses that stand on it are authored models now and come in through
 *  deepglass_kit.ts, this is only the flatwork they sit on. */
function buildCradle(): THREE.Group {
  const g = new THREE.Group();

  // Base ring the buttresses stand inside.
  const base = stoneMesh(
    new THREE.CylinderGeometry(
      DEEPGLASS_CRADLE_R + 2.2,
      DEEPGLASS_CRADLE_R + 3.2,
      1.6,
      64,
      1,
      true,
    ),
    STONE_DARK,
  );
  base.position.y = 0.8;
  g.add(base);

  // A plaza disc so the bell reads as built, not dropped. Dressed in the same
  // hand-painted cobble set as the stadium's entrance apron (the terrain
  // texture pack in public/textures/deepglass), with UVs projected straight
  // down in local space so the tiling density is uniform across the disc.
  const plazaGeo = new THREE.CylinderGeometry(44, 44, 0.4, 72);
  {
    const pos = plazaGeo.getAttribute('position');
    const uv = new Float32Array(pos.count * 2);
    const COBBLE_S = 4.5;
    for (let i = 0; i < pos.count; i++) {
      uv[i * 2] = pos.getX(i) / COBBLE_S;
      uv[i * 2 + 1] = pos.getZ(i) / COBBLE_S;
    }
    plazaGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }
  const plaza = stoneMesh(plazaGeo, STONE);
  {
    const mat = plaza.material as THREE.MeshStandardMaterial;
    void loadTexture('/textures/deepglass/plaza_cobble_color.jpg', {
      srgb: true,
      repeat: true,
    }).then((tex) => {
      tex.anisotropy = 4;
      mat.map = tex;
      // Same albedo gain as the stadium's textured masonry: the dusk key was
      // tuned against bare pale stone, and a mid-tone map goes muddy under it.
      mat.color.setRGB(1.45, 1.45, 1.45);
      mat.needsUpdate = true;
    });
    void loadTexture('/textures/deepglass/plaza_cobble_normal.jpg', { repeat: true }).then(
      (tex) => {
        mat.normalMap = tex;
        mat.normalScale.set(0.7, 0.7);
        mat.needsUpdate = true;
      },
    );
  }
  plaza.position.y = 0.2;
  g.add(plaza);

  // A ring of sockets the pylons seat into, so the plaza reads as built FOR
  // them rather than as a disc they happen to stand on.
  const socketGeo = new THREE.CylinderGeometry(1.85, 2.05, 0.34, 16);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const socket = stoneMesh(socketGeo, STONE_DARK, 0.9);
    socket.position.set(Math.cos(a) * DEEPGLASS_CRADLE_R, 0.42, Math.sin(a) * DEEPGLASS_CRADLE_R);
    g.add(socket);
  }
  g.position.set(DEEPGLASS_CENTER.x, 0, DEEPGLASS_CENTER.z);
  return g;
}

export function buildDeepglass(): DeepglassView {
  const group = new THREE.Group();
  group.name = 'deepglass';
  const lights: THREE.PointLight[] = [];
  const timed: THREE.ShaderMaterial[] = [];

  // ---- the bell ------------------------------------------------------------
  const glass = new THREE.Mesh(new THREE.SphereGeometry(DEEPGLASS_RADIUS, 64, 48), glassMaterial());
  glass.position.set(DEEPGLASS_CENTER.x, DEEPGLASS_CENTER.y, DEEPGLASS_CENTER.z);
  glass.renderOrder = 12;
  timed.push(glass.material as THREE.ShaderMaterial);
  group.add(glass);

  // A brass cage on the inside of the glass: latitude rings and meridians.
  // From OUTSIDE the bell reads fine on its fresnel rim alone, but from INSIDE
  //, where the whole match is played, the rim faces away and the volume is a
  // featureless wash with no way to judge distance to the wall. The cage is the
  // spatial reference, and it doubles as the structure that plausibly holds
  // seventy-six yards of water up.
  const cage = new THREE.Group();
  const cageMat = new THREE.LineBasicMaterial({
    color: 0x8fd8ea,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
  });
  const CAGE_R = DEEPGLASS_RADIUS - 0.35;
  // Built as SEGMENTS rather than closed lines so the brass can break around
  // the two goal holes: a strut drawn across an open goal mouth reads as bars
  // over the goal. Local coordinates, the cage is centred on the bell.
  const cageSegs: number[] = [];
  const overHole = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    const mz = (az + bz) / 2;
    return Math.abs(mx) > DG_RING_OFFSET - 2.5 && Math.hypot(my, mz) < DG_HOLE_R + 0.9;
  };
  const addCagePolyline = (pts: THREE.Vector3[]): void => {
    for (let k = 0; k + 1 < pts.length; k++) {
      const a = pts[k];
      const b = pts[k + 1];
      if (overHole(a.x, a.y, a.z, b.x, b.y, b.z)) continue;
      cageSegs.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  };
  for (let i = 1; i < 7; i++) {
    // Latitude rings, skipping the poles where meridians already converge.
    const lat = (i / 7) * Math.PI;
    const r = Math.sin(lat) * CAGE_R;
    const y = Math.cos(lat) * CAGE_R;
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 64; k++) {
      const a = (k / 64) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
    }
    addCagePolyline(pts);
  }
  for (let m = 0; m < 12; m++) {
    const lon = (m / 12) * Math.PI * 2;
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 48; k++) {
      const lat = (k / 48) * Math.PI;
      const r = Math.sin(lat) * CAGE_R;
      pts.push(new THREE.Vector3(Math.cos(lon) * r, Math.cos(lat) * CAGE_R, Math.sin(lon) * r));
    }
    addCagePolyline(pts);
  }
  const cageGeo = new THREE.BufferGeometry();
  cageGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cageSegs), 3));
  cage.add(new THREE.LineSegments(cageGeo, cageMat));
  cage.position.copy(glass.position);
  cage.renderOrder = 11;
  group.add(cage);

  const water = new THREE.Mesh(
    new THREE.SphereGeometry(DEEPGLASS_RADIUS - 0.5, 48, 36),
    waterMaterial(),
  );
  water.position.copy(glass.position);
  water.renderOrder = 10;
  timed.push(water.material as THREE.ShaderMaterial);
  group.add(water);

  // ---- magic goal rings ----------------------------------------------------
  for (const [x, color, spin] of [
    [DG_RING_WEST_X, RING_WEST, 1.6],
    [DG_RING_EAST_X, RING_EAST, -1.6],
  ] as const) {
    const ringSide = Math.sign(x - DEEPGLASS_CENTER.x) || 1;
    // The drawn ring and its halo hang at the POCKET SEAT, the plane of the
    // gate model's spoked backstop wheel, so ring and model read as ONE
    // assembly from every angle. They used to hang at the hole rim, 5+ yards
    // shy of the wheel, and any off-axis view split the two centres apart
    // ("the goal doesn't line up with the model"). From down the pitch the
    // centre is unchanged: both planes share the goal axis.
    const ringX = DEEPGLASS_CENTER.x + ringSide * (DEEPGLASS_RADIUS + DG_POCKET_DEPTH);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(DG_RING_RADIUS, 0.55, 16, 72),
      ringMaterial(color, spin),
    );
    ring.position.set(ringX, DEEPGLASS_CENTER.y, DEEPGLASS_CENTER.z);
    ring.rotation.y = Math.PI / 2; // torus normal +Z -> +X, facing down the pitch
    ring.renderOrder = 14;
    timed.push(ring.material as THREE.ShaderMaterial);
    group.add(ring);

    // A wider, fainter halo so the ring is findable from the far end.
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(DG_RING_RADIUS + 0.9, 0.18, 8, 64),
      ringMaterial(color, spin * -0.5),
    );
    halo.position.copy(ring.position);
    halo.rotation.y = Math.PI / 2;
    halo.renderOrder = 14;
    timed.push(halo.material as THREE.ShaderMaterial);
    group.add(halo);

    // The swirling membrane stays AT the hole: it is the hole's own face, the
    // thing a shooter aims through, and the glass rim glow wraps it there.
    const portal = new THREE.Mesh(
      new THREE.CircleGeometry(DG_RING_RADIUS, 48),
      portalMaterial(color),
    );
    portal.position.set(x, DEEPGLASS_CENTER.y, DEEPGLASS_CENTER.z);
    portal.rotation.y = Math.PI / 2;
    portal.renderOrder = 13;
    timed.push(portal.material as THREE.ShaderMaterial);
    group.add(portal);

    // The brass funnel that wraps the goal from OUTSIDE the glass is an
    // authored model (deepglass_kit.ts, rooted at DG_GOAL_HOUSING_OFFSET).
    // What stays here is the magic on it: a rune halo at the funnel's lip,
    // which is the part of a goal you can pick out from the far end of the
    // bell.
    const side = Math.sign(x - DEEPGLASS_CENTER.x) || 1;
    const lipX =
      DEEPGLASS_CENTER.x + side * (DG_GOAL_HOUSING_OFFSET - GATE_MOUTH_INSET * GATE_SURROUND_SCALE);
    const mouth = new THREE.Mesh(
      new THREE.TorusGeometry(GATE_MOUTH_R * GATE_SURROUND_SCALE, 0.42, 8, 72),
      ringMaterial(color, spin * 0.35),
    );
    mouth.position.set(lipX, DEEPGLASS_CENTER.y, DEEPGLASS_CENTER.z);
    mouth.rotation.y = Math.PI / 2;
    mouth.renderOrder = 13;
    timed.push(mouth.material as THREE.ShaderMaterial);
    group.add(mouth);

    // No square frame around the mouth: the goal already reads as a goal from
    // the ring, the funnel and the glowing hole rim, and a box of bars over an
    // open mouth read as a cage rather than as a target.

    const light = new THREE.PointLight(color, 1.5, 60, 2);
    light.position.set(ringX, DEEPGLASS_CENTER.y, DEEPGLASS_CENTER.z);
    // Every light here rides the renderer's fireLights budget, whose flicker
    // pass drives intensity at userData.baseIntensity (defaulting to a
    // campfire's 11 when unset, which overdrove the whole arena a full stop
    // and lit the goal burst white at rest). Authored intensity IS the base.
    light.userData.baseIntensity = 1.5;
    lights.push(light);
  }

  // ---- boost pads ----------------------------------------------------------
  const padMat = new THREE.MeshBasicMaterial({
    color: PAD_GLOW,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  // Big vents are visibly bigger: with the pads now the ONLY real source of
  // boost, "which one is that from here" is a decision you make at range. The
  // glow is the FLAME in the authored housing's throat, so it is sized to sit
  // inside the cowl rather than swallow it.
  const padGeo = new THREE.IcosahedronGeometry(0.52, 1);
  const bigPadGeo = new THREE.IcosahedronGeometry(0.92, 1);
  const pads: THREE.Mesh[] = [];
  for (const p of DG_BOOST_PADS) {
    const pad = new THREE.Mesh(p.big ? bigPadGeo : padGeo, padMat);
    pad.position.set(p.x, p.y, p.z);
    pad.renderOrder = 13;
    pads.push(pad);
    group.add(pad);
  }

  // ---- powerup orbs --------------------------------------------------------
  // Two prizes on the bell's vertical axis, each a caged core: an inner solid
  // and an additive shell, so a taken orb can vanish outright and an available
  // one reads as a THING rather than another glow.
  const powerupOrbs: THREE.Group[] = [];
  const powerupOrbLights: THREE.PointLight[] = [];
  const orbCoreGeo = new THREE.IcosahedronGeometry(0.92, 1);
  const orbShellGeo = new THREE.SphereGeometry(1.34, 24, 16);
  for (const site of DG_POWERUP_SITES) {
    const tint = site.kind === 'zap' ? POWERUP_FREEZE : POWERUP_OVERBURN;
    const orb = new THREE.Group();
    const core = new THREE.Mesh(
      orbCoreGeo,
      new THREE.MeshBasicMaterial({ color: tint, transparent: true, opacity: 0.9 }),
    );
    // A soft fresnel bloom instead of the old wireframe cage: the station's
    // gimbals ARE the cage now, and two sets of wire read as noise.
    const shell = new THREE.Mesh(orbShellGeo, orbGlowMaterial(tint));
    timed.push(shell.material as THREE.ShaderMaterial);
    core.renderOrder = 13;
    shell.renderOrder = 13;
    orb.add(core, shell);
    orb.position.set(site.x, site.y, site.z);
    powerupOrbs.push(orb);
    group.add(orb);
    const orbLight = new THREE.PointLight(tint, 2.6, 26, 2);
    orbLight.position.copy(orb.position);
    orbLight.userData.baseIntensity = 2.6;
    lights.push(orbLight);
    // Held by direct reference for the cooldown dimming below. The old
    // arithmetic (`lights.length - powerupOrbs.length + i`) was written before
    // the goal burst light joined the END of this array, so it silently landed
    // on orb1 and the BURST light, one orb never dimmed, and every powerup
    // edge toggled the celebration light instead.
    powerupOrbLights.push(orbLight);
  }

  // ---- the Tidewarden's beam ----------------------------------------------
  // One reusable segment: a unit cylinder along +Y, scaled and aimed at the
  // shot it is drawing. Additive and short-lived, the point is a snap of light
  // between two bodies, not a laser you can study.
  const beamMat = new THREE.MeshBasicMaterial({
    color: POWERUP_FREEZE,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1, 8, 1, true), beamMat);
  beam.name = 'deepglass-beam';
  beam.visible = false;
  beam.renderOrder = 15;
  group.add(beam);
  let beamAge = BEAM_SECS;
  let beamTick = -1;

  // ---- drifting motes ------------------------------------------------------
  const MOTES = 620;
  const pos = new Float32Array(MOTES * 3);
  const phase = new Float32Array(MOTES);
  // Deterministic scatter: a cheap hash walk, no Math.random (the module must
  // never introduce a nondeterministic visual that a screenshot test trips on).
  let h = 1337;
  const rnd = (): number => {
    h = (h * 1103515245 + 12345) & 0x7fffffff;
    return h / 0x7fffffff;
  };
  for (let i = 0; i < MOTES; i++) {
    // Uniform-ish inside the sphere.
    const u = rnd() * 2 - 1;
    const t = rnd() * Math.PI * 2;
    const r = (DEEPGLASS_RADIUS - 2) * Math.cbrt(rnd());
    const s = Math.sqrt(1 - u * u);
    pos[i * 3] = r * s * Math.cos(t);
    pos[i * 3 + 1] = r * u;
    pos[i * 3 + 2] = r * s * Math.sin(t);
    phase[i] = rnd() * Math.PI * 2;
  }
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  moteGeo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  const motes = new THREE.Points(moteGeo, moteMaterial());
  motes.position.copy(glass.position);
  motes.renderOrder = 11;
  motes.frustumCulled = false;
  timed.push(motes.material as THREE.ShaderMaterial);
  group.add(motes);

  // ---- goal burst ----------------------------------------------------------
  const burst = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), burstMaterial());
  burst.visible = false;
  burst.renderOrder = 15;
  group.add(burst);
  // The light stays visible at intensity 0 between goals, deliberately: three
  // counts a light into numPointLights iff `visible`, the count is in every lit
  // material's program cache key, and toggling it with the celebration relinked
  // the whole scene's programs on the exact frame the goal landed.
  const burstLight = new THREE.PointLight(0xffffff, 0, 70, 2);
  // Resting base 0: without it the budget's flicker pass drove this at a
  // campfire's default 11, a white lamp hanging in the bell between goals.
  // The celebration's own intensity writes land after the flicker each frame.
  burstLight.userData.baseIntensity = 0;
  // It teleports to the ring that conceded on every goal, so the budget must
  // refresh its position rather than trust the build-time cache.
  burstLight.userData.budgetDynamic = true;
  lights.push(burstLight);

  // ---- the cradle ----------------------------------------------------------
  group.add(buildCradle());

  // ---- the authored art kit ------------------------------------------------
  // Pylons, goal funnels, powerup stations and vent housings. Loads async and
  // fills in behind the shaders above; nothing here blocks world entry.
  const kit = buildDeepglassKit();
  group.add(kit.group);
  const kitState: DeepglassKitState = { padCooldown: [], powerupCooldown: [], flare: null };

  let time = 0;
  // Goal-burst state: the celebration is edge-triggered off the match phase, so
  // the render never has to be told about a goal.
  let burstAge = 99;
  let lastPhase = '';
  const BURST_SECS = 1.4;
  const BURST_R = 16;
  return {
    group,
    lights,
    update(px, pz, dt) {
      const dx = px - DEEPGLASS_SITE.x;
      const dz = pz - DEEPGLASS_SITE.z;
      const visible = dx * dx + dz * dz < DEEPGLASS_SITE.cullRadius ** 2;
      group.visible = visible;
      // The lights are deliberately NOT toggled with the group: they ride the
      // renderer's fireLights budget, which keeps a CONSTANT number of point
      // lights visible precisely so numPointLights (a program cache key) never
      // changes. This loop used to overwrite the budget's pin every frame,       // running after budgetFireLights in the frame, and each flip relinked
      // every lit material in view. Out of range they contribute intensity 0.
      if (!visible) return;
      time += dt;
      for (const m of timed) m.uniforms.uTime.value = time;

      // Fire on the transition INTO the goal phase, at the ring that conceded.
      const match = deepglassMatch();
      const phase = match?.phase ?? '';
      if (phase === 'goal' && lastPhase !== 'goal' && match?.lastGoalBy) {
        // 'A' scored in the EAST ring, which is team B's; ringCentreFor takes
        // the side that DEFENDS it.
        const conceded = ringCentreFor(match.lastGoalBy === 'A' ? 'B' : 'A');
        burst.position.set(conceded.x, conceded.y, conceded.z);
        burstLight.position.copy(burst.position);
        const tint = match.lastGoalBy === 'A' ? RING_WEST : RING_EAST;
        (burst.material as THREE.ShaderMaterial).uniforms.uColor.value.setHex(tint);
        burstLight.color.setHex(tint);
        burstAge = 0;
      }
      lastPhase = phase;

      if (burstAge < BURST_SECS) {
        burstAge += dt;
        const t = Math.min(1, burstAge / BURST_SECS);
        burst.visible = true;
        // Fast out, slow stop: the shell should snap open, not inflate.
        burst.scale.setScalar(1 + BURST_R * (1 - (1 - t) ** 3));
        (burst.material as THREE.ShaderMaterial).uniforms.uAge.value = t;
        burstLight.intensity = 9 * (1 - t) ** 2;
      } else if (burst.visible) {
        burst.visible = false;
        burstLight.intensity = 0;
      }
      // Pads breathe so an available pad reads at distance, and a TAKEN one is
      // gone until it relights: boost is a resource on the map now, so where it
      // is and is not has to be legible from across the bell.
      const b = 0.42 + 0.28 * Math.sin(time * 2.4);
      padMat.opacity = b;
      for (let i = 0; i < pads.length; i++) {
        const cooling = (match?.padCooldown[i] ?? 0) > 0;
        pads[i].visible = !cooling;
        const s = 1 + 0.12 * Math.sin(time * 2.4 + i * 0.7);
        pads[i].scale.setScalar(s);
      }

      // Powerup orbs: present or absent, turning and bobbing while they wait.
      for (let i = 0; i < powerupOrbs.length; i++) {
        const cooling = (match?.powerupCooldown[i] ?? 0) > 0;
        const orb = powerupOrbs[i];
        orb.visible = !cooling;
        const site = DG_POWERUP_SITES[i];
        // A taken orb's light goes dark through its BASE, never through
        // `.visible`: the budget's flicker pass reads baseIntensity every
        // frame, and a visibility toggle here changed numPointLights, the
        // program-cache key, which relinked every lit material in view on
        // the exact frame a powerup was taken or respawned (a measured
        // one-second freeze at gfx=high).
        powerupOrbLights[i].userData.baseIntensity = cooling ? 0 : 2.6;
        if (!orb.visible) continue;
        orb.rotation.y += dt * 0.9;
        orb.rotation.x += dt * 0.35;
        // Shallower bob than before: the orb now floats INSIDE the station's
        // gimbal cage, and the old 0.7 yd swing walked it out through the rings.
        orb.position.y = site.y + Math.sin(time * 1.3 + i * 2) * 0.34;
      }

      // Feed the authored kit: it owns the pylons, gates, stations and vent
      // housings, and animates them off the same match state read above.
      kitState.padCooldown = match?.padCooldown ?? [];
      kitState.powerupCooldown = match?.powerupCooldown ?? [];
      kitState.flare =
        burstAge < BURST_SECS && match?.lastGoalBy
          ? {
              conceded: match.lastGoalBy === 'A' ? 'B' : 'A',
              t: Math.min(1, burstAge / BURST_SECS),
            }
          : null;
      kit.update(dt, time, kitState);

      // The beam: fired by the sim, drawn here for a beat and then gone.
      const shot = deepglassLastBeam();
      if (shot && shot.tick !== beamTick) {
        beamTick = shot.tick;
        beamAge = 0;
        const dx = shot.to.x - shot.from.x;
        const dy = shot.to.y - shot.from.y;
        const dz = shot.to.z - shot.from.z;
        const len = Math.hypot(dx, dy, dz) || 1;
        beam.position.set(
          (shot.from.x + shot.to.x) / 2,
          (shot.from.y + shot.to.y) / 2,
          (shot.from.z + shot.to.z) / 2,
        );
        BEAM_DIR.set(dx / len, dy / len, dz / len);
        beam.quaternion.setFromUnitVectors(BEAM_UP, BEAM_DIR);
        // A hit beam is fatter and reaches only as far as the body it stopped
        // against; a miss is a thin line out to full range.
        beam.scale.set(shot.hit ? 1.8 : 0.8, len, shot.hit ? 1.8 : 0.8);
      }
      if (beamAge < BEAM_SECS) {
        beamAge += dt;
        const t = Math.min(1, beamAge / BEAM_SECS);
        beam.visible = true;
        beamMat.opacity = (1 - t) ** 2 * 0.95;
      } else if (beam.visible) {
        beam.visible = false;
      }
    },
    dispose() {
      kit.dispose();
      group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) for (const m of mat) m.dispose();
        else mat?.dispose();
      });
    },
  };
}
