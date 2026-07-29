import * as THREE from 'three';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { expect, test } from 'vitest';
import { OutputGradePass } from '../../src/render/output_grade_pass';

const LegacyGradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    varying vec2 vUv;
    const vec3 LIFT = vec3(0.012, 0.010, 0.018);
    const vec3 GAIN = vec3(1.05, 1.02, 0.98);
    const vec3 GAMMA = vec3(0.96);
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      c = pow(max(vec3(0.0), c * GAIN + LIFT), GAMMA);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, 1.12);
      vec2 d = vUv - 0.5;
      c *= 1.0 - 0.20 * smoothstep(0.60, 0.95, dot(d, d) * 2.2);
      c +=
        (fract(sin(dot(vUv * 731.7 + uTime, vec2(12.9898, 78.233))) * 43758.5) - 0.5) *
        0.012;
      gl_FragColor = vec4(c, 1.0);
    }
  `,
};

test('fused output and grade is visually equivalent to the legacy two-pass chain', () => {
  const width = 96;
  const height = 64;
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setSize(width, height, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const sourceData = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      sourceData[i] = (x / (width - 1)) * 5;
      sourceData[i + 1] = (y / (height - 1)) * 3;
      sourceData[i + 2] = ((x * 17 + y * 31) % 97) / 24;
      sourceData[i + 3] = 1;
    }
  }
  const sourceTexture = new THREE.DataTexture(
    sourceData,
    width,
    height,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  sourceTexture.minFilter = THREE.NearestFilter;
  sourceTexture.magFilter = THREE.NearestFilter;
  sourceTexture.needsUpdate = true;
  const source = { texture: sourceTexture } as unknown as THREE.WebGLRenderTarget;
  const legacyIntermediate = new THREE.WebGLRenderTarget(width, height, {
    type: THREE.HalfFloatType,
    depthBuffer: false,
    stencilBuffer: false,
  });
  const legacyFinal = new THREE.WebGLRenderTarget(width, height, {
    depthBuffer: false,
    stencilBuffer: false,
  });
  const fusedFinal = legacyFinal.clone();

  const output = new OutputPass();
  const grade = new ShaderPass(LegacyGradeShader);
  grade.uniforms.uTime.value = 2.25;
  const fused = new OutputGradePass({ value: 2.25 });
  output.render(renderer, legacyIntermediate, source, 0, false);
  grade.render(renderer, legacyFinal, legacyIntermediate, 0, false);
  fused.render(renderer, fusedFinal, source);

  const legacyPixels = new Uint8Array(width * height * 4);
  const fusedPixels = new Uint8Array(width * height * 4);
  renderer.readRenderTargetPixels(legacyFinal, 0, 0, width, height, legacyPixels);
  renderer.readRenderTargetPixels(fusedFinal, 0, 0, width, height, fusedPixels);

  let squaredError = 0;
  let maxChannelDelta = 0;
  let changedChannels = 0;
  for (let i = 0; i < legacyPixels.length; i++) {
    const delta = Math.abs(legacyPixels[i] - fusedPixels[i]);
    squaredError += delta * delta;
    maxChannelDelta = Math.max(maxChannelDelta, delta);
    if (delta > 0) changedChannels++;
  }
  const rmse = Math.sqrt(squaredError / legacyPixels.length);
  console.info({ maxChannelDelta, rmse, changedChannels, channels: legacyPixels.length });
  expect(maxChannelDelta).toBeLessThanOrEqual(2);
  expect(rmse).toBeLessThanOrEqual(0.5);

  output.dispose();
  grade.dispose();
  fused.dispose();
  sourceTexture.dispose();
  legacyIntermediate.dispose();
  legacyFinal.dispose();
  fusedFinal.dispose();
  renderer.dispose();
});

test('a synchronous capture works with preserveDrawingBuffer disabled', async () => {
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, preserveDrawingBuffer: false });
  renderer.setSize(8, 8, false);
  renderer.setClearColor(0xf04020, 1);
  renderer.clear();

  const image = new Image();
  image.src = canvas.toDataURL('image/png');
  await image.decode();
  const capture = document.createElement('canvas');
  capture.width = 8;
  capture.height = 8;
  const context = capture.getContext('2d');
  expect(context).not.toBeNull();
  context?.drawImage(image, 0, 0);
  const pixel = context?.getImageData(4, 4, 1, 1).data;
  expect(pixel?.[0]).toBeGreaterThan(200);
  expect(pixel?.[1]).toBeGreaterThan(20);
  expect(pixel?.[3]).toBe(255);
  renderer.dispose();
});
