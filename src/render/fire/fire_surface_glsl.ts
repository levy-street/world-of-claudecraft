// Volumetric ray-marching shader for 3D fluid fire (fire_material.ts),
// modelled on ocean/ocean_surface_glsl.ts.
//
// Traces each view ray through the normalized unit cylinder enclosing the fire
// plume, samples the shared 3D GPU Navier-Stokes simulation (rotated and
// mirrored per fire from its world coordinates so neighbouring campfires never
// look cloned), advects fine sub-grid cellular flame tongues along the
// simulated 3D velocity field, maps temperature through the physical blackbody
// ramp, shades light self-shadowing smoke wisps near the upper tips, and
// applies screen-space heat shimmer where OpaqueSceneCapture is active.
//
// Every polynomial and smoothstep is domain-safe: zero pow() calls are used,
// and all literal smoothstep edges are strictly ordered.

import { SCENE_SAMPLE_GLSL } from '../scene_sampling';

export interface FireSurfaceShaderOptions {
  /** Number of ray-march steps along the cylinder segment. */
  marchSteps: number;
  /** Compile in the screen-space heat-shimmer refraction pass (High+ tiers). */
  shimmer: boolean;
  /** Dev-only (?firedebug=1) term inspection switch. */
  debugTerms?: boolean;
}

const f = (n: number): string => (Number.isInteger(n) ? `${n}.0` : String(n));

export const FIRE_HULL_RADIUS = 0.68;
export const FIRE_HULL_HEIGHT = 1.55;

export function fireSurfaceVertex(): string {
  return /* glsl */ `
varying vec3 vNormPos;
varying vec3 vNormCam;
varying vec3 vFireWorldOrigin;
varying float vViewZ;
varying float vCenterViewZ;

void main() {
  // Map local hull coordinates into normalized cylinder space:
  // x, z in [-1, 1], y in [0, 1].
  vec3 invHull = vec3(${f(1 / FIRE_HULL_RADIUS)}, ${f(1 / FIRE_HULL_HEIGHT)}, ${f(1 / FIRE_HULL_RADIUS)});
  vNormPos = position * invHull;

  // Recover the camera position in local space from modelViewMatrix (which
  // Three.js composes in float64 on the CPU, avoiding large-coordinate float32
  // cancellation in distant dungeon instances).
  mat3 mvRotScale = mat3(modelViewMatrix);
  vec3 mvTrans = modelViewMatrix[3].xyz;
  vec3 c0 = mvRotScale[0];
  vec3 c1 = mvRotScale[1];
  vec3 c2 = mvRotScale[2];
  vec3 localCam = vec3(
    -dot(c0, mvTrans) / max(dot(c0, c0), 1e-6),
    -dot(c1, mvTrans) / max(dot(c1, c1), 1e-6),
    -dot(c2, mvTrans) / max(dot(c2, c2), 1e-6)
  );
  vNormCam = localCam * invHull;
  vFireWorldOrigin = modelMatrix[3].xyz;

  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vViewZ = -mvPosition.z;

  vec4 centerView = modelViewMatrix * vec4(0.0, position.y, 0.0, 1.0);
  vCenterViewZ = -centerView.z;

  // Keep screen-space XYW identical while testing hardware depth at a flat plane
  // at the outer edge of the stone ring (+0.95yd) so perimeter meadow grass
  // blades never slice dark vertical lines through the flame.
  vec4 clipPos = projectionMatrix * mvPosition;
  vec4 depthView = centerView;
  depthView.z = min(-0.15, depthView.z + 0.95);
  vec4 depthClip = projectionMatrix * depthView;
  clipPos.z = (depthClip.z / max(depthClip.w, 1e-4)) * clipPos.w;
  gl_Position = clipPos;
}
`;
}

export function fireSurfaceFragment(opts: FireSurfaceShaderOptions): string {
  const steps = Math.max(8, Math.round(opts.marchSteps));
  const invSteps = f(1 / steps);
  return /* glsl */ `
uniform sampler2D uFireVelTemp;
uniform sampler2D uFireFuelSmoke;
uniform vec4 uFireGrid;       // x: gridXZ, y: gridY, z: tilesX, w: tilesZ
uniform vec4 uFireAtlasMeta;  // x: 1/atlasW, y: 1/atlasH, z: simReady, w: shimmerStrength
uniform float uTime;
uniform vec3 uFireCoreColor;
uniform vec3 uFireMidColor;
uniform vec3 uFireTipColor;
uniform vec3 uFireSmokeColor;
uniform vec4 uFireParams;     // x: smokeDensity, y: swirl, z: draft, w: intensity
${opts.debugTerms ? 'uniform float uFireDebugTerm;' : ''}
${SCENE_SAMPLE_GLSL}

varying vec3 vNormPos;
varying vec3 vNormCam;
varying vec3 vFireWorldOrigin;
varying float vViewZ;
varying float vCenterViewZ;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

// Smooth 3D value noise for sub-grid flame tongue crispness.
float noise3(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(
      mix(hash13(i + vec3(0.0, 0.0, 0.0)), hash13(i + vec3(1.0, 0.0, 0.0)), f.x),
      mix(hash13(i + vec3(0.0, 1.0, 0.0)), hash13(i + vec3(1.0, 1.0, 0.0)), f.x),
      f.y
    ),
    mix(
      mix(hash13(i + vec3(0.0, 0.0, 1.0)), hash13(i + vec3(1.0, 0.0, 1.0)), f.x),
      mix(hash13(i + vec3(0.0, 1.0, 1.0)), hash13(i + vec3(1.0, 1.0, 1.0)), f.x),
      f.y
    ),
    f.z
  );
}

// Two-octave ridged cellular flame turbulence (domain-safe, no pow).
float flameTurbulence(vec3 p) {
  float n0 = noise3(p);
  float n1 = noise3(p * 2.15 + vec3(13.7, -7.3, 5.1));
  float billow = 1.0 - abs(n0 * 2.0 - 1.0);
  float detail = 1.0 - abs(n1 * 2.0 - 1.0);
  return billow * 0.68 + detail * 0.32;
}

vec2 sliceUv(vec2 uvwXY, float sliceZ) {
  float gx = uFireGrid.x;
  float gy = uFireGrid.y;
  float tx = uFireGrid.z;
  float cz = clamp(floor(sliceZ), 0.0, gx - 1.0);
  float tileX = mod(cz, tx);
  float tileZ = floor(cz / tx);
  // Clamp half a texel inside each Z-tile so linear filtering never bleeds across tiles.
  vec2 localPx = clamp(uvwXY * vec2(gx, gy), vec2(0.5), vec2(gx - 0.5, gy - 0.5));
  vec2 atlasPx = vec2(tileX * gx, tileZ * gy) + localPx;
  return atlasPx * uFireAtlasMeta.xy;
}

void sampleFireAtlas(vec3 uvw, out vec4 velTemp, out vec4 fuelSmoke) {
  vec3 c = clamp(uvw, vec3(0.0), vec3(1.0));
  float zScaled = c.z * (uFireGrid.x - 1.0);
  float z0 = floor(zScaled);
  float z1 = min(z0 + 1.0, uFireGrid.x - 1.0);
  float fz = zScaled - z0;
  vec2 uv0 = sliceUv(c.xy, z0);
  vec2 uv1 = sliceUv(c.xy, z1);
  velTemp = mix(texture2D(uFireVelTemp, uv0), texture2D(uFireVelTemp, uv1), fz);
  fuelSmoke = mix(texture2D(uFireFuelSmoke, uv0), texture2D(uFireFuelSmoke, uv1), fz);
}

// Evaluates a smooth C1 quartic bell profile across a flame tongue
// (zero slope at the spine and zero slope at the outer boundary, avoiding flat
// yellow plateaus or hard outer edges).
float tongueProfile(float sOffset, float rad) {
  float xp = clamp(sOffset / max(rad, 0.012), -1.0, 1.0);
  float q = 1.0 - xp * xp;
  return q * q;
}

// Continuous, glowing volumetric blackbody colour ramp calibrated for
// OutputGradePass ACESFilmicToneMapping (/ 0.6 pre-exposure + sRGB + grade):
//   - Outer feathered rim & upper wispy spire: warm fiery red-orange (no dark border)
//   - Mid envelope, rolling C-curl & internal troughs: vivid, saturated campfire orange
//   - Inner licking tongues: rich golden-yellow
//   - Concentrated hot heart above the logs: incandescent warm cream-yellow
vec3 fireBlackbody(float temp, float coreWeight) {
  float t = max(0.0, temp);

  vec3 outerRedOrange = vec3(0.68, 0.024, 0.001);
  vec3 midAmberOrange = vec3(1.22, 0.095, 0.002);
  vec3 brightGold     = vec3(1.96, 0.40,  0.012);
  vec3 hotCreamYellow = vec3(2.70, 0.98,  0.090);

  float wOrange = smoothstep(0.03, 0.22, t);
  float wGold   = smoothstep(0.22, 0.58, coreWeight) * smoothstep(0.34, 0.64, t);
  float wCream  = smoothstep(0.56, 0.86, coreWeight) * smoothstep(0.56, 0.84, t);

  vec3 col = mix(outerRedOrange, midAmberOrange, wOrange);
  col = mix(col, brightGold, wGold);
  col = mix(col, hotCreamYellow, wCream);

  return col * uFireParams.w;
}

void main() {
  vec3 ro = vNormCam;
  vec3 diff = vNormPos - vNormCam;
  float distToSurface = max(length(diff), 1e-5);
  vec3 rd = diff / distToSurface;

  // Ray-cylinder intersection in normalized space: x^2 + z^2 <= 1, y in [0, 1].
  float a = dot(rd.xz, rd.xz);
  float b = dot(ro.xz, rd.xz);
  float c = dot(ro.xz, ro.xz) - 1.0;
  float disc = max(0.0, b * b - a * c);
  float sqrtDisc = sqrt(disc);
  float invA = 1.0 / max(a, 1e-5);
  float tCyl0 = (-b - sqrtDisc) * invA;
  float tCyl1 = (-b + sqrtDisc) * invA;

  float safeRdY = abs(rd.y) < 1e-5 ? (rd.y < 0.0 ? -1e-5 : 1e-5) : rd.y;
  float invY = 1.0 / safeRdY;
  float tY0 = (0.0 - ro.y) * invY;
  float tY1 = (1.0 - ro.y) * invY;
  float tSlabMin = min(tY0, tY1);
  float tSlabMax = max(tY0, tY1);

  float tEnter = max(0.0, max(tCyl0, tSlabMin));
  float tExit = min(tCyl1, tSlabMax);

  float segLen = tExit - tEnter;
  if (segLen <= 0.005) discard;

  // Height where the view ray crosses the vertical center plane of the campfire.
  float tMid = clamp(-b * invA, tEnter, tExit);
  float hMid = clamp(ro.y + rd.y * tMid, 0.0, 1.0);

  // Per-fire decorrelation from world position: azimuthal rotation, mirror and clock offset.
  float fireHash = hash12(floor(vFireWorldOrigin.xz * 10.0));
  float fireAngle = fireHash * 6.2831853;
  float cosA = cos(fireAngle);
  float sinA = sin(fireAngle);
  float mirrorX = fireHash > 0.5 ? 1.0 : -1.0;
  float fireTime = uTime * uFireParams.z + fireHash * 37.0;

  // Orthonormal horizontal basis in rotated fire space: rRdXZ points along the
  // view ray, rPerpXZ points across the screen perpendicular to the view ray.
  vec2 rawRdXZ = normalize(rd.xz + vec2(1e-5, 0.0));
  vec2 rRdXZ = vec2(
    (rawRdXZ.x * cosA - rawRdXZ.y * sinA) * mirrorX,
    rawRdXZ.x * sinA + rawRdXZ.y * cosA
  );
  vec2 rPerpXZ = vec2(-rRdXZ.y, rRdXZ.x);

  float stepLen = segLen * ${invSteps};
  float t = tEnter + 0.5 * stepLen;

  float rayMass = 0.0;
  float rayTempSum = 0.0;
  float rayCoreSum = 0.0;
  float opticalDepth = 0.0;
  vec3 smokeLight = vec3(0.0);
  float smokeTrans = 1.0;
  vec3 sparkLight = vec3(0.0);
  vec2 shimmerGrad = vec2(0.0);
  float maxTempSeen = 0.0;
  float maxCoreSeen = 0.0;
  float maxFuelSeen = 0.0;
  float maxSmokeSeen = 0.0;
  float maxVelSeen = 0.0;

  for (int i = 0; i < ${steps}; i++) {
    vec3 p = ro + rd * t;
    float h = clamp(p.y, 0.0, 1.0);

    // Rotate and mirror in XZ so every campfire shows a unique 3D cross-section.
    vec2 rxz = vec2(
      (p.x * cosA - p.z * sinA) * mirrorX,
      p.x * sinA + p.z * cosA
    );

    if (dot(rxz, rxz) < 1.0) {
      vec3 uvw = vec3(rxz.x * 0.5 + 0.5, h, rxz.y * 0.5 + 0.5);
      vec4 velTemp = vec4(0.0);
      vec4 fuelSmoke = vec4(0.0);
      if (uFireAtlasMeta.z > 0.5) {
        sampleFireAtlas(uvw, velTemp, fuelSmoke);
      }

      vec3 simVel = velTemp.xyz;

      // Multi-octave 3D turbulence advected upward along the simulated velocity field.
      float hs = clamp(mix(hMid, h, 0.16), 0.0, 1.0);
      vec3 advCoord = vec3(rxz * 1.50, hs * 1.85 - fireTime * 4.5) - simVel * 0.20;
      float nA = noise3(advCoord);
      float nB = noise3(advCoord * 2.25 + vec3(5.7, -fireTime * 3.5, -3.9));
      float nC = noise3(vec3(rxz * 3.8, hs * 1.40 - fireTime * 6.8) + vec3(-2.3, 4.1, 7.9));
      float fbm = nA * 0.54 + nB * 0.31 + nC * 0.15;
      float billow = (1.0 - abs(nA * 2.0 - 1.0)) * 0.62 + (1.0 - abs(nB * 2.0 - 1.0)) * 0.38;

      // Screen-perpendicular (s) and ray-parallel (zRay) coordinates warped in 3D
      // by turbulent eddies and the GPU fluid velocity field.
      vec2 warpXZ = (vec2(nA, nB) - 0.5) * (0.075 + 0.095 * smoothstep(0.14, 0.78, hs));
      vec2 pXZ = rxz - simVel.xz * (0.038 * smoothstep(0.04, 0.80, hs)) + warpXZ;
      float s = dot(pXZ, rPerpXZ);
      float zRay = dot(pXZ, rRdXZ);
      float sRaw = dot(rxz, rPerpXZ);
      float zRaw = dot(rxz, rRdXZ);

      // 3D volumetric depth envelope along the view ray.
      float zNorm = clamp(zRay / 0.58, -1.0, 1.0);
      float depthEnv = 1.0 - zNorm * zNorm;

      // Soft bottom contour that sits wide across the logs and arches over the
      // two front 3D wooden logs (at sRaw ~ -0.15 and +0.14) while licking down
      // into the central gap and around the outer log ends.
      float sNormFloor = clamp(sRaw / 0.58, -1.0, 1.0);
      float logArchL = exp(-((sRaw + 0.15) * (sRaw + 0.15)) / 0.0034);
      float logArchR = exp(-((sRaw - 0.14) * (sRaw - 0.14)) / 0.0034);
      float bottomScallop = 0.018 * (nA - 0.5)
        + 0.014 * cos(sRaw * 18.0 + fireTime * 3.2)
        + 0.044 * (logArchL + logArchR);
      float hsFloor = max(0.003, 0.005 + 0.014 * sNormFloor * sNormFloor + bottomScallop);
      float bottomCup = smoothstep(hsFloor, hsFloor + 0.028, hs);

      // 1. Unified asymmetric 3D plume envelope with:
      //    - S-curving central column & tall wispy upper spire (hs = 0.0 .. 0.95)
      //    - Broad log-hugging base lobes on both sides (hs = 0.02 .. 0.25)
      //    - Prominent mid-height hooked C-curl overhang on +curlSide (hs = 0.32 .. 0.58)
      //    - Rounded shoulder billow/lick on -curlSide (hs = 0.24 .. 0.46)
      float curlSide = mirrorX;
      float swayEnv = smoothstep(0.04, 0.48, hs) + 0.55 * smoothstep(0.45, 0.92, hs);
      float upperShift = -curlSide * 0.085 * smoothstep(0.48, 0.70, hs);
      float sMain = (0.095 * sin(hs * 5.2 - fireTime * 5.8)
        + 0.038 * cos(hs * 8.8 - fireTime * 9.2 + 1.1)) * swayEnv + upperShift;
      float mainMaxH = 0.94 + 0.035 * sin(fireTime * 4.7);

      // Central stem half-width (scaled for the quartic bell profile where the
      // visible outer edge sits at ~0.75 * rad).
      float stemWaist = mix(0.31, 0.21, smoothstep(0.08, 0.50, hs));
      float stemRad = mix(stemWaist, 0.028, smoothstep(0.50, mainMaxH, hs))
        * (0.88 + 0.24 * fbm);

      float sRel = s - sMain;
      float sSide = sRel * curlSide;
      float sFromMain = max(0.0, sSide);
      float sOppMain = max(0.0, -sSide);

      // +curlSide: wide base log-lick (hs ~ 0.09) with upward-curling outer tip
      // + mid-height hooked C-curl (hs ~ 0.47).
      float hsBaseR = hs - 0.080 * smoothstep(0.22, 0.48, sFromMain)
        + 0.018 * smoothstep(0.05, 0.18, sFromMain);
      float rBaseDiff = hsBaseR - (0.095 + 0.014 * sin(fireTime * 5.1));
      float rBaseLobe = 0.33 * exp(-(rBaseDiff * rBaseDiff) / 0.0068);

      float c1CenterH = 0.47 + 0.022 * sin(fireTime * 4.2 + 0.7);
      float hookBend = 0.130 * smoothstep(0.29, 0.46, sFromMain)
        - 0.052 * smoothstep(0.06, 0.26, sFromMain);
      float rCurlDiff = (hs + hookBend) - c1CenterH;
      float rCurlLobe = 0.39 * exp(-(rCurlDiff * rCurlDiff) / 0.0072)
        * (0.90 + 0.22 * billow);

      float wRight = stemRad + rBaseLobe + rCurlLobe;

      // -curlSide: wide base log-lick (hs ~ 0.085) + lower-mid shoulder billow (hs ~ 0.34).
      float hsBaseL = hs - 0.062 * smoothstep(0.18, 0.44, sOppMain);
      float lBaseDiff = hsBaseL - (0.086 + 0.014 * cos(fireTime * 4.8));
      float lBaseLobe = 0.30 * exp(-(lBaseDiff * lBaseDiff) / 0.0058);

      float c2CenterH = 0.34 + 0.022 * cos(fireTime * 4.6 + 2.1);
      float hsShoulder = hs - 0.048 * smoothstep(0.18, 0.34, sOppMain);
      float lShoulderDiff = hsShoulder - c2CenterH;
      float lShoulderLobe = 0.22 * exp(-(lShoulderDiff * lShoulderDiff) / 0.0058)
        * (0.90 + 0.20 * fbm);

      float wLeft = stemRad + lBaseLobe + lShoulderLobe;

      float activeRad = sSide >= 0.0 ? wRight : wLeft;
      float rawPlume = tongueProfile(sRel, activeRad)
        * bottomCup
        * (1.0 - smoothstep(mainMaxH - 0.09, mainMaxH, hs));

      // Concave under-scoop bay tucked inside the hanging outer hook tip on +curlSide
      // (sSide in 0.16 .. 0.34, hs in 0.29 .. 0.44), leaving the outer hook tip
      // at sSide = 0.35 .. 0.47 hanging down cleanly over the bay:
      vec2 scoopVec = vec2((sSide - 0.25) / 0.088, (hs - 0.365) / 0.072);
      float underScoop = max(0.0, 1.0 - dot(scoopVec, scoopVec)) * step(0.0, sSide);
      // Gentle neck indentation above the +curlSide outer base log-lick (sSide ~ 0.33, hs ~ 0.225):
      vec2 baseNotchVec = vec2((sSide - 0.33) / 0.070, (hs - 0.225) / 0.050);
      float baseNotchR = max(0.0, 1.0 - dot(baseNotchVec, baseNotchVec)) * step(0.0, sSide);
      // Smaller concave notch above the -curlSide shoulder tip (sSide in -0.32 .. -0.18, hs ~ 0.44):
      vec2 oppNotchVec = vec2((-sSide - 0.24) / 0.085, (hs - 0.44) / 0.065);
      float oppNotch = max(0.0, 1.0 - dot(oppNotchVec, oppNotchVec)) * step(0.0, -sSide);

      rawPlume = max(0.0, rawPlume - underScoop * 0.78 - baseNotchR * 0.22 - oppNotch * 0.45);

      // Vertically-streaked wispy erosion on the upper spire (hs > 0.54) so the
      // tall top tail breaks into soft, translucent fiery wisps and streaks.
      float upperStreak = mix(1.0, smoothstep(0.16, 0.70, nC * 0.58 + billow * 0.42), smoothstep(0.54, 0.85, hs));
      rawPlume *= upperStreak;

      float billowMod = 0.82 + 0.34 * (billow * 0.62 + fbm * 0.38);
      float plumeShape = rawPlume * depthEnv * billowMod;

      // 2. Vertical temperature cooling & sculpted golden/cream inner tongues:
      // The outer half of the C-curl, the flanks, the upper spire (hs > 0.54), and
      // the turbulent channels between tongues glow in vivid campfire orange, while
      // sculpted golden-yellow tongues and an incandescent cream-yellow lower heart
      // lick upward from the logs.
      float heightTempEnv = mix(1.10, 0.38, smoothstep(0.46, 0.88, hs));
      float tongueRibs = 0.50 + 0.50 * cos(sRel * 20.0 + 1.8 * (nA - 0.5));
      float coreRight = stemRad * 0.76 + rBaseLobe * 0.58 + rCurlLobe * 0.56;
      float coreLeft  = stemRad * 0.74 + lBaseLobe * 0.58 + lShoulderLobe * 0.48;
      float coreBaseRad = sSide >= 0.0 ? coreRight : coreLeft;

      float coreTopH = 0.45 + 0.13 * tongueRibs * (1.0 - smoothstep(0.08, 0.28, abs(sRel)));
      float coreHeightEnv = smoothstep(hsFloor + 0.008, hsFloor + 0.038, hs)
        * (1.0 - smoothstep(coreTopH - 0.08, coreTopH + 0.08, hs));
      float coreRadial = tongueProfile(sRel, coreBaseRad * (0.82 + 0.24 * tongueRibs));

      float heartRibs = 0.50 + 0.50 * cos(sRel * 24.0 - 1.5 * (nB - 0.5));
      float baseHeart = tongueProfile(sRel, coreBaseRad * (0.78 + 0.22 * heartRibs))
        * smoothstep(hsFloor + 0.006, hsFloor + 0.030, hs)
        * (1.0 - smoothstep(0.18 + 0.08 * heartRibs, 0.35 + 0.06 * heartRibs, hs));

      float coreMask = clamp(
        max(coreRadial * coreHeightEnv * (0.72 + 0.34 * tongueRibs), baseHeart * 1.12)
          * (0.80 + 0.30 * billow),
        0.0,
        1.0
      );

      float simBoost = uFireAtlasMeta.z * velTemp.w * 0.12 * fbm;
      float localTemp = plumeShape * heightTempEnv * (0.94 + 0.26 * coreMask) + simBoost * plumeShape;

      // Accumulate C1 moment-weighted temperature and core weight along the ray.
      float d = max(0.0, localTemp);
      float w = d * d * stepLen;
      rayMass += w;
      rayTempSum += w * d;
      rayCoreSum += w * coreMask;
      opticalDepth += d * stepLen * 5.2;

      // 6. Rising glowing orange-gold ember sparks around the flanks (h = 0.18 .. 0.88):
      vec3 sparkCell = vec3(rxz * 11.5, h * 9.0 - fireTime * 3.6) - simVel * 0.35;
      vec3 sparkId = floor(sparkCell);
      vec3 sparkF = fract(sparkCell) - 0.5;
      float sparkSeed = hash13(sparkId);
      if (sparkSeed > 0.968) {
        vec2 jitter = vec2(fract(sparkSeed * 43.7), fract(sparkSeed * 91.3)) - 0.5;
        float sparkDist = length(sparkF - vec3(jitter * 0.45, 0.0));
        float sparkGlow = (1.0 - smoothstep(0.04, 0.22, sparkDist))
          * smoothstep(0.14, 0.28, h)
          * (1.0 - smoothstep(0.72, 0.92, h))
          * smoothstep(0.14, 0.32, abs(sRaw));
        sparkLight += vec3(2.40, 0.65, 0.04) * sparkGlow * stepLen * 4.5;
      }

      // 7. Soft, warm-lit smoke puffs drifting off the upper spire (h = 0.60 .. 0.99):
      float upperZone = smoothstep(0.58, 0.78, h) * (1.0 - smoothstep(0.88, 0.99, h));
      float wispMask = smoothstep(0.46, 0.80, fbm) * (1.0 - smoothstep(0.0, 0.34, abs(s - sMain)));
      float smokeDens = max(fuelSmoke.y * 0.24, wispMask * upperZone * 0.85) * uFireParams.x;
      float stepSmokeAlpha = 1.0 - exp(-smokeDens * 1.4 * stepLen);
      vec3 smokeLit = mix(uFireSmokeColor, vec3(0.58, 0.22, 0.06), 1.0 - smoothstep(0.58, 0.90, h));
      smokeLight += smokeTrans * smokeLit * stepSmokeAlpha;
      smokeTrans *= (1.0 - stepSmokeAlpha);

      maxTempSeen = max(maxTempSeen, d);
      maxCoreSeen = max(maxCoreSeen, coreMask);
      maxFuelSeen = max(maxFuelSeen, max(fuelSmoke.x, coreMask));
      maxSmokeSeen = max(maxSmokeSeen, smokeDens);
      maxVelSeen = max(maxVelSeen, length(simVel));

      // Thermal gradient for upper-plume heat shimmer.
      float shimmerBand = smoothstep(0.45, 0.82, h) * (1.0 - smoothstep(0.82, 1.0, h));
      shimmerGrad += vec2(nA - 0.5, nB - 0.5) * (d * shimmerBand * stepLen);
    }
    t += stepLen;
  }

  float invMass = 1.0 / (rayMass + 0.00010);
  float avgTemp = rayTempSum * invMass;
  float avgCore = clamp(rayCoreSum * invMass, 0.0, 1.0);
  // Blend peak and moment-averaged temperature so the thick center glows hot
  // cream-yellow while the outer fringe and wispy upper spire cool smoothly.
  float rayTemp = mix(avgTemp, maxTempSeen, 0.62);
  float rayCore = mix(avgCore, maxCoreSeen, 0.58);

  // Soft volumetric Beer-Lambert opacity: reaches solid 1.0 in the vivid orange/gold
  // core and spire spine (preventing green background grass bleed-through) while
  // feathering smoothly across the red-orange outer fringe, over the timber logs,
  // and at the wispy upper tips.
  float beerAlpha = clamp(1.0 - exp(-opticalDepth * 5.2), 0.0, 1.0);
  float upperWispFade = 1.0 - 0.25 * smoothstep(0.82, 0.96, hMid);
  float flameAlpha = clamp(smoothstep(0.015, 0.18, rayTemp) * beerAlpha * upperWispFade, 0.0, 1.0);
  // Extra emissive glow at soft translucent edges so the outer orange-red fringe
  // blooms warmly over the logs and stones instead of darkening.
  float edgeGlow = flameAlpha * (1.0 + 0.42 * (1.0 - flameAlpha));
  vec3 flameColour = fireBlackbody(rayTemp, rayCore) * edgeGlow;

  float smokeAlpha = (1.0 - smokeTrans) * (1.0 - flameAlpha);
  vec3 accumLight = flameColour + sparkLight + smokeLight * (1.0 - flameAlpha);
  float sparkAlpha = clamp(length(sparkLight) * 0.25, 0.0, 0.85);
  float alpha = clamp(max(flameAlpha + smokeAlpha, sparkAlpha), 0.0, 1.0);
  float transmittance = 1.0 - alpha;

${
  opts.shimmer
    ? /* glsl */ `
  // Subtle heat-haze distortion in the clear hot air pocket above the flame tongues,
  // masked out over opaque flame sheets so background grass never ghosts into the fire.
  if (uSceneReady > 0.5 && uFireAtlasMeta.w > 0.0) {
    vec2 refractOffset = shimmerGrad * (uFireAtlasMeta.w * 22.0);
    float airMask = 1.0 - smoothstep(0.02, 0.22, alpha);
    float shimmerMix = clamp(length(shimmerGrad) * 1.8, 0.0, 0.28) * airMask;
    if (shimmerMix > 0.002) {
      vec3 refracted = sceneRefract(vec3(0.0), refractOffset, vViewZ, 1.0);
      accumLight += refracted * shimmerMix;
      alpha = clamp(alpha + shimmerMix, 0.0, 1.0);
    }
  }
`
    : ''
}

${
  opts.debugTerms
    ? /* glsl */ `
  if (uFireDebugTerm > 0.5) {
    if (uFireDebugTerm < 1.5) {
      gl_FragColor = vec4(fireBlackbody(maxTempSeen, 0.5), 1.0);
      return;
    }
    if (uFireDebugTerm < 2.5) {
      gl_FragColor = vec4(vec3(maxFuelSeen, maxFuelSeen * 0.4, 0.0), 1.0);
      return;
    }
    if (uFireDebugTerm < 3.5) {
      gl_FragColor = vec4(vec3(maxSmokeSeen * 3.0), 1.0);
      return;
    }
    gl_FragColor = vec4(vec3(maxVelSeen * 0.5, maxTempSeen * 0.5, 1.0 - transmittance), 1.0);
    return;
  }
`
    : ''
}

  if (alpha < 0.003 && dot(accumLight, accumLight) < 1e-5) discard;
  gl_FragColor = vec4(accumLight, alpha);
}
`;
}
