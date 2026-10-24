// GLSL ES 3.00 shaders for the 3D Navier-Stokes and combustion fire simulation
// (fire_simulation.ts), modelled on ocean/ocean_fft_glsl.ts.
//
// The 3D voxel grid (gridXZ * gridY * gridXZ) is stored as a 2D atlas of
// (tilesX * tilesZ) Z-slices. Each simulation step runs four fullscreen passes
// into ping-ponged two-attachment MRT half-float render targets:
//   location 0 (uVelTemp):    (vx, vy, vz, temperature)
//   location 1 (uFuelSmokeP): (fuel, smoke, pressure, vorticityMag)
//
// All math is domain-safe: no pow() calls are used (quartic radiative cooling
// uses explicit t2 * t2 products), and all smoothstep edges are strictly ordered.

export const FIRE_PASS_VERT = /* glsl */ `
precision highp float;
in vec3 position;
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const ATLAS_HELPERS_GLSL = /* glsl */ `
uniform int uGridXZ;
uniform int uGridY;
uniform int uTilesX;
uniform int uTilesZ;

ivec3 atlasToVoxel(ivec2 pix) {
  int vx = pix.x % uGridXZ;
  int vy = pix.y % uGridY;
  int tileX = pix.x / uGridXZ;
  int tileZ = pix.y / uGridY;
  int vz = tileZ * uTilesX + tileX;
  return ivec3(vx, vy, vz);
}

ivec2 voxelToAtlas(ivec3 v) {
  int cx = clamp(v.x, 0, uGridXZ - 1);
  int cy = clamp(v.y, 0, uGridY - 1);
  int cz = clamp(v.z, 0, uGridXZ - 1);
  int tileX = cz % uTilesX;
  int tileZ = cz / uTilesX;
  return ivec2(tileX * uGridXZ + cx, tileZ * uGridY + cy);
}

vec4 sampleVolumeTrilinear(sampler2D tex, vec3 vox) {
  vec3 clamped = clamp(vox, vec3(0.0), vec3(float(uGridXZ - 1), float(uGridY - 1), float(uGridXZ - 1)));
  vec3 baseF = floor(clamped);
  vec3 f = clamped - baseF;
  ivec3 b = ivec3(baseF);
  ivec3 b1 = min(b + ivec3(1), ivec3(uGridXZ - 1, uGridY - 1, uGridXZ - 1));

  vec4 c000 = texelFetch(tex, voxelToAtlas(ivec3(b.x,  b.y,  b.z)),  0);
  vec4 c100 = texelFetch(tex, voxelToAtlas(ivec3(b1.x, b.y,  b.z)),  0);
  vec4 c010 = texelFetch(tex, voxelToAtlas(ivec3(b.x,  b1.y, b.z)),  0);
  vec4 c110 = texelFetch(tex, voxelToAtlas(ivec3(b1.x, b1.y, b.z)),  0);
  vec4 c001 = texelFetch(tex, voxelToAtlas(ivec3(b.x,  b.y,  b1.z)), 0);
  vec4 c101 = texelFetch(tex, voxelToAtlas(ivec3(b1.x, b.y,  b1.z)), 0);
  vec4 c011 = texelFetch(tex, voxelToAtlas(ivec3(b.x,  b1.y, b1.z)), 0);
  vec4 c111 = texelFetch(tex, voxelToAtlas(ivec3(b1.x, b1.y, b1.z)), 0);

  vec4 c00 = mix(c000, c100, f.x);
  vec4 c10 = mix(c010, c110, f.x);
  vec4 c01 = mix(c001, c101, f.x);
  vec4 c11 = mix(c011, c111, f.x);
  vec4 c0 = mix(c00, c10, f.y);
  vec4 c1 = mix(c01, c11, f.y);
  return mix(c0, c1, f.z);
}
`;

/**
 * Pass 1: Semi-Lagrangian 3D advection, hearth fuel injection, combustion
 * reaction, quartic radiative cooling, thermal buoyancy and vorticity
 * confinement.
 */
export const FIRE_ADVECT_COMBUST_FRAG = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2D;
${ATLAS_HELPERS_GLSL}
uniform sampler2D uVelTemp;
uniform sampler2D uFuelSmokeP;
uniform float uDt;
uniform float uTime;
uniform float uDraftPulse;
layout(location = 0) out vec4 outVelTemp;
layout(location = 1) out vec4 outFuelSmokeP;

float hash31(vec3 p) {
  vec3 q = fract(p * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yxz + 33.33);
  return fract((q.x + q.y) * q.z);
}

void main() {
  ivec2 pix = ivec2(gl_FragCoord.xy);
  ivec3 v = atlasToVoxel(pix);
  vec3 gridMax = vec3(float(uGridXZ), float(uGridY), float(uGridXZ));
  vec3 uvw = (vec3(v) + 0.5) / gridMax;
  vec2 centeredXZ = uvw.xz * 2.0 - 1.0;
  float r = length(centeredXZ);

  vec4 curVT = texelFetch(uVelTemp, pix, 0);
  vec4 curFSP = texelFetch(uFuelSmokeP, pix, 0);

  // Backtrace in voxel units along the 3D velocity field.
  vec3 voxScale = vec3(float(uGridXZ) * 0.42, float(uGridY) * 0.42, float(uGridXZ) * 0.42);
  vec3 backVox = vec3(v) - curVT.xyz * (uDt * voxScale);
  vec4 advVT = sampleVolumeTrilinear(uVelTemp, backVox);
  vec4 advFSP = sampleVolumeTrilinear(uFuelSmokeP, backVox);

  vec3 vel = advVT.xyz * 0.985;
  float temp = max(0.0, advVT.w);
  float fuel = max(0.0, advFSP.x);
  float smoke = max(0.0, advFSP.y);
  float pressure = advFSP.z * 0.84;

  // Multi-log ember bed at the hearth base: three asymmetric fuel lobes +
  // turbulent draft pockets so rising tongues separate and dance naturally.
  float baseMask = (1.0 - smoothstep(0.03, 0.24, uvw.y)) * (1.0 - smoothstep(0.22, 0.64, r));
  float angle = atan(centeredXZ.y, centeredXZ.x + 1e-5);
  float lobes = 0.68
    + 0.22 * sin(angle * 3.0 + uTime * 2.4)
    + 0.16 * cos(angle * 2.0 - uTime * 3.7 + r * 5.0)
    + 0.14 * sin(centeredXZ.x * 6.5 + uTime * 4.9) * cos(centeredXZ.y * 6.5 - uTime * 4.3);
  float n3 = hash31(vec3(v) + vec3(floor(uTime * 19.0), uTime * 7.3, 1.0));
  float sourceStrength = max(0.0, baseMask * lobes * uDraftPulse * (0.82 + 0.36 * n3));

  fuel = min(1.35, max(fuel, sourceStrength * 1.15));
  temp = max(temp, sourceStrength * 1.08);

  // Chimney draw: cool air pulls inward at the base and swirls upward.
  vec2 inward = -centeredXZ / max(r, 0.12);
  float pinch = (1.0 - smoothstep(0.0, 0.48, uvw.y)) * smoothstep(0.08, 0.55, r);
  vel.xz += inward * (pinch * 1.55 * uDt);
  vec2 tangent = vec2(-centeredXZ.y, centeredXZ.x) / max(r, 0.15);
  float swirlSign = sin(uTime * 1.7 + uvw.y * 5.2);
  vel.xz += tangent * (swirlSign * (1.0 - smoothstep(0.0, 0.75, r)) * 1.15 * uDt);

  // Combustion reaction: fuel burns into heat, bounded by quartic radiative cooling.
  float burn = min(fuel, fuel * 3.8 * uDt);
  fuel = max(0.0, fuel - burn);
  float rawTemp = temp + burn * 1.48;
  float t2 = rawTemp * rawTemp;
  float cooling = 1.12 * rawTemp + 0.38 * t2 * t2;
  temp = max(0.0, rawTemp - cooling * uDt);

  // Light smoke wisps form in the cooling upper flame band and fade at the top.
  float coolBand = smoothstep(0.28, 0.68, uvw.y) * (1.0 - smoothstep(0.84, 0.98, uvw.y));
  float smokeBorn = (burn * 0.45 + rawTemp * coolBand * 0.28 * uDt) * 0.32;
  smoke = clamp(smoke * exp(-1.65 * uDt) + smokeBorn, 0.0, 1.0);

  // Thermal buoyancy lifts hot gas strongly; cooling smoke drags slightly.
  vel.y += (temp * 4.35 - smoke * 0.42) * uDt;

  // 3D vorticity confinement: sample neighbour velocities to reinforce rolling
  // Kelvin-Helmholtz curls along the flame sheet edges.
  vec3 vL = texelFetch(uVelTemp, voxelToAtlas(v - ivec3(1, 0, 0)), 0).xyz;
  vec3 vR = texelFetch(uVelTemp, voxelToAtlas(v + ivec3(1, 0, 0)), 0).xyz;
  vec3 vD = texelFetch(uVelTemp, voxelToAtlas(v - ivec3(0, 1, 0)), 0).xyz;
  vec3 vU = texelFetch(uVelTemp, voxelToAtlas(v + ivec3(0, 1, 0)), 0).xyz;
  vec3 vB = texelFetch(uVelTemp, voxelToAtlas(v - ivec3(0, 0, 1)), 0).xyz;
  vec3 vF = texelFetch(uVelTemp, voxelToAtlas(v + ivec3(0, 0, 1)), 0).xyz;
  vec3 curl = 0.5 * vec3(
    (vU.z - vD.z) - (vF.y - vB.y),
    (vF.x - vB.x) - (vR.z - vL.z),
    (vR.y - vL.y) - (vU.x - vD.x)
  );
  float curlMag = length(curl);
  float cL = texelFetch(uFuelSmokeP, voxelToAtlas(v - ivec3(1, 0, 0)), 0).w;
  float cR = texelFetch(uFuelSmokeP, voxelToAtlas(v + ivec3(1, 0, 0)), 0).w;
  float cD = texelFetch(uFuelSmokeP, voxelToAtlas(v - ivec3(0, 1, 0)), 0).w;
  float cU = texelFetch(uFuelSmokeP, voxelToAtlas(v + ivec3(0, 1, 0)), 0).w;
  float cB = texelFetch(uFuelSmokeP, voxelToAtlas(v - ivec3(0, 0, 1)), 0).w;
  float cF = texelFetch(uFuelSmokeP, voxelToAtlas(v + ivec3(0, 0, 1)), 0).w;
  vec3 eta = 0.5 * vec3(cR - cL, cU - cD, cF - cB);
  vec3 etaNorm = eta * inversesqrt(max(dot(eta, eta), 1e-5));
  vec3 vortForce = cross(etaNorm, curl) * 2.25;
  vel += vortForce * uDt;

  // Soft cylindrical wall and top outflow damping so the volume never hits a box wall.
  float wallFade = (1.0 - smoothstep(0.76, 0.98, r)) * (1.0 - smoothstep(0.88, 0.99, uvw.y));
  temp *= wallFade;
  fuel *= wallFade;
  smoke *= wallFade;
  vel *= mix(0.65, 1.0, wallFade);

  outVelTemp = vec4(clamp(vel, vec3(-4.0), vec3(4.0)), min(temp, 1.8));
  outFuelSmokeP = vec4(fuel, smoke, pressure, curlMag);
}
`;

/**
 * Pass 2: 3D velocity divergence for the incompressible pressure solve.
 */
export const FIRE_DIVERGENCE_FRAG = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2D;
${ATLAS_HELPERS_GLSL}
uniform sampler2D uVelTemp;
uniform sampler2D uFuelSmokeP;
layout(location = 0) out vec4 outVelTemp;
layout(location = 1) out vec4 outFuelSmokeP;

void main() {
  ivec2 pix = ivec2(gl_FragCoord.xy);
  ivec3 v = atlasToVoxel(pix);
  vec4 vt = texelFetch(uVelTemp, pix, 0);
  vec4 fsp = texelFetch(uFuelSmokeP, pix, 0);

  vec3 vL = texelFetch(uVelTemp, voxelToAtlas(v - ivec3(1, 0, 0)), 0).xyz;
  vec3 vR = texelFetch(uVelTemp, voxelToAtlas(v + ivec3(1, 0, 0)), 0).xyz;
  vec3 vD = v.y > 0 ? texelFetch(uVelTemp, voxelToAtlas(v - ivec3(0, 1, 0)), 0).xyz : vec3(0.0);
  vec3 vU = texelFetch(uVelTemp, voxelToAtlas(v + ivec3(0, 1, 0)), 0).xyz;
  vec3 vB = texelFetch(uVelTemp, voxelToAtlas(v - ivec3(0, 0, 1)), 0).xyz;
  vec3 vF = texelFetch(uVelTemp, voxelToAtlas(v + ivec3(0, 0, 1)), 0).xyz;

  float div = 0.5 * ((vR.x - vL.x) + (vU.y - vD.y) + (vF.z - vB.z));
  outVelTemp = vt;
  // Store divergence in .w during the Jacobi loop; .z holds the warm-started pressure.
  outFuelSmokeP = vec4(fsp.x, fsp.y, fsp.z, div);
}
`;

/**
 * Pass 3: One 3D Poisson pressure Jacobi relaxation iteration.
 */
export const FIRE_JACOBI_FRAG = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2D;
${ATLAS_HELPERS_GLSL}
uniform sampler2D uVelTemp;
uniform sampler2D uFuelSmokeP;
layout(location = 0) out vec4 outVelTemp;
layout(location = 1) out vec4 outFuelSmokeP;

void main() {
  ivec2 pix = ivec2(gl_FragCoord.xy);
  ivec3 v = atlasToVoxel(pix);
  vec4 vt = texelFetch(uVelTemp, pix, 0);
  vec4 fsp = texelFetch(uFuelSmokeP, pix, 0);

  float pL = texelFetch(uFuelSmokeP, voxelToAtlas(v - ivec3(1, 0, 0)), 0).z;
  float pR = texelFetch(uFuelSmokeP, voxelToAtlas(v + ivec3(1, 0, 0)), 0).z;
  float pD = texelFetch(uFuelSmokeP, voxelToAtlas(v - ivec3(0, 1, 0)), 0).z;
  // Open pressure boundary at the top of the plume so rising hot gas vents freely.
  float pU = v.y < uGridY - 1 ? texelFetch(uFuelSmokeP, voxelToAtlas(v + ivec3(0, 1, 0)), 0).z : 0.0;
  float pB = texelFetch(uFuelSmokeP, voxelToAtlas(v - ivec3(0, 0, 1)), 0).z;
  float pF = texelFetch(uFuelSmokeP, voxelToAtlas(v + ivec3(0, 0, 1)), 0).z;

  float div = fsp.w;
  float nextP = (pL + pR + pD + pU + pB + pF - div) * (1.0 / 6.0);
  outVelTemp = vt;
  outFuelSmokeP = vec4(fsp.x, fsp.y, nextP, div);
}
`;

/**
 * Pass 4: Subtract the 3D pressure gradient from the velocity field and restore
 * the vorticity magnitude in .w for the next frame's confinement pass.
 */
export const FIRE_PROJECT_FRAG = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2D;
${ATLAS_HELPERS_GLSL}
uniform sampler2D uVelTemp;
uniform sampler2D uFuelSmokeP;
layout(location = 0) out vec4 outVelTemp;
layout(location = 1) out vec4 outFuelSmokeP;

void main() {
  ivec2 pix = ivec2(gl_FragCoord.xy);
  ivec3 v = atlasToVoxel(pix);
  vec4 vt = texelFetch(uVelTemp, pix, 0);
  vec4 fsp = texelFetch(uFuelSmokeP, pix, 0);

  float pL = texelFetch(uFuelSmokeP, voxelToAtlas(v - ivec3(1, 0, 0)), 0).z;
  float pR = texelFetch(uFuelSmokeP, voxelToAtlas(v + ivec3(1, 0, 0)), 0).z;
  float pD = texelFetch(uFuelSmokeP, voxelToAtlas(v - ivec3(0, 1, 0)), 0).z;
  float pU = v.y < uGridY - 1 ? texelFetch(uFuelSmokeP, voxelToAtlas(v + ivec3(0, 1, 0)), 0).z : 0.0;
  float pB = texelFetch(uFuelSmokeP, voxelToAtlas(v - ivec3(0, 0, 1)), 0).z;
  float pF = texelFetch(uFuelSmokeP, voxelToAtlas(v + ivec3(0, 0, 1)), 0).z;

  vec3 gradP = 0.5 * vec3(pR - pL, pU - pD, pF - pB);
  vec3 vel = vt.xyz - gradP;
  if (v.y == 0) vel.y = max(0.0, vel.y);

  // Recompute curl magnitude after projection so next step's confinement reads it.
  vec3 vL = texelFetch(uVelTemp, voxelToAtlas(v - ivec3(1, 0, 0)), 0).xyz;
  vec3 vR = texelFetch(uVelTemp, voxelToAtlas(v + ivec3(1, 0, 0)), 0).xyz;
  vec3 vD = texelFetch(uVelTemp, voxelToAtlas(v - ivec3(0, 1, 0)), 0).xyz;
  vec3 vU = texelFetch(uVelTemp, voxelToAtlas(v + ivec3(0, 1, 0)), 0).xyz;
  vec3 vB = texelFetch(uVelTemp, voxelToAtlas(v - ivec3(0, 0, 1)), 0).xyz;
  vec3 vF = texelFetch(uVelTemp, voxelToAtlas(v + ivec3(0, 0, 1)), 0).xyz;
  vec3 curl = 0.5 * vec3(
    (vU.z - vD.z) - (vF.y - vB.y),
    (vF.x - vB.x) - (vR.z - vL.z),
    (vR.y - vL.y) - (vU.x - vD.x)
  );

  outVelTemp = vec4(clamp(vel, vec3(-4.0), vec3(4.0)), vt.w);
  outFuelSmokeP = vec4(fsp.x, fsp.y, fsp.z, length(curl));
}
`;
