import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  buildSpriteCloudGeometry,
  buildSpriteCloudInterleavedBuffer,
  buildSpriteCloudInterleavedGeometry,
  buildSpriteCloudMaterial,
  buildSpriteCloudObject,
  SPRITE_QUAD_CORNER_ATTRIBUTE,
  SPRITE_QUAD_RANGE_UNIFORM,
  setSpriteCloudCount,
  spriteCloudCount,
  spriteCloudFragmentShader,
  spriteCloudVertexShader,
  spriteQuadPointRange,
  spriteQuadsEnabled,
  syncSpriteQuadPointRange,
} from '../src/render/sprite_quad_cloud';
import { POINT_SIZE_RANGE_FALLBACK, SPRITE_QUAD_INDEX } from '../src/render/sprite_quad_core';

const shader = {
  vertexHeader: 'attribute float aSize;\nuniform float uScale;\nvarying float vFade;',
  vertexBody:
    '  vFade = 1.0;\n  vec4 mv = modelViewMatrix * vec4(position, 1.0);\n' +
    '  float pointSize = aSize * uScale / max(0.15, -mv.z);',
  fragmentShader:
    'uniform sampler2D uMap;\nvarying float vFade;\nvoid main() {\n' +
    '  gl_FragColor = texture2D(uMap, SPRITE_COORD) * vFade;\n}',
};

const options = {
  ...shader,
  uniforms: { uScale: { value: 600 }, uMap: { value: null } },
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
};

describe('sprite cloud shader composition', () => {
  it('defaults to the quad arm outside a browser (no location to carry the flag)', () => {
    expect(spriteQuadsEnabled()).toBe(true);
  });

  it('the point arm writes the formula to gl_PointSize and reads gl_PointCoord', () => {
    const vertex = spriteCloudVertexShader(shader, false);
    expect(vertex).toContain('gl_PointSize = pointSize;');
    expect(vertex).toContain('gl_Position = projectionMatrix * mv;');
    expect(vertex).not.toContain(SPRITE_QUAD_CORNER_ATTRIBUTE);
    expect(vertex).not.toContain(SPRITE_QUAD_RANGE_UNIFORM);
    const fragment = spriteCloudFragmentShader(shader, false);
    expect(fragment).toContain('#define SPRITE_COORD gl_PointCoord');
    expect(fragment).toContain('texture2D(uMap, SPRITE_COORD)');
  });

  it('the quad arm keeps the body, clamps to the driver range and bills the quad in view space', () => {
    const vertex = spriteCloudVertexShader(shader, true);
    expect(vertex).toContain(shader.vertexBody);
    expect(vertex).not.toContain('gl_PointSize');
    expect(vertex).toContain(`attribute vec2 ${SPRITE_QUAD_CORNER_ATTRIBUTE};`);
    expect(vertex).toContain(`uniform vec2 ${SPRITE_QUAD_RANGE_UNIFORM};`);
    // the core's arithmetic, literally: clamp, then px * depth / (2 * uScale)
    expect(vertex).toContain(
      `float spritePx = clamp(pointSize, ${SPRITE_QUAD_RANGE_UNIFORM}.x, ${SPRITE_QUAD_RANGE_UNIFORM}.y);`,
    );
    expect(vertex).toContain('float halfExtent = spritePx * (-mv.z) / (2.0 * uScale);');
    expect(vertex).toContain(`mv.xy += ${SPRITE_QUAD_CORNER_ATTRIBUTE} * halfExtent;`);
    // t grows downward, like gl_PointCoord
    expect(vertex).toContain(
      `vSpriteCoord = vec2(0.5 + 0.5 * ${SPRITE_QUAD_CORNER_ATTRIBUTE}.x, 0.5 - 0.5 * ${SPRITE_QUAD_CORNER_ATTRIBUTE}.y);`,
    );
    expect(vertex).toContain('gl_Position = projectionMatrix * mv;');
    const fragment = spriteCloudFragmentShader(shader, true);
    expect(fragment).toContain('varying vec2 vSpriteCoord;');
    expect(fragment).toContain('#define SPRITE_COORD vSpriteCoord');
    expect(fragment).toContain(shader.fragmentShader);
  });

  it('refuses a header without the uScale uniform the conversion divides by', () => {
    expect(() =>
      spriteCloudVertexShader({ ...shader, vertexHeader: 'attribute float aSize;' }, true),
    ).toThrow(/uScale/);
  });
});

describe('sprite cloud material', () => {
  it('passes the blend and depth flags through on both arms', () => {
    for (const quads of [false, true]) {
      const material = buildSpriteCloudMaterial(options, quads);
      expect(material.transparent).toBe(true);
      expect(material.depthWrite).toBe(false);
      expect(material.depthTest).toBe(true);
      expect(material.blending).toBe(THREE.AdditiveBlending);
      expect(material.uniforms.uScale.value).toBe(600);
    }
  });

  it('forwards every other ShaderMaterial parameter on both arms', () => {
    for (const quads of [false, true]) {
      const material = buildSpriteCloudMaterial(
        { ...options, side: THREE.DoubleSide, alphaTest: 0.25, toneMapped: false },
        quads,
      );
      expect(material.side).toBe(THREE.DoubleSide);
      expect(material.alphaTest).toBe(0.25);
      expect(material.toneMapped).toBe(false);
      expect(material.uniforms.uMap).toBe(options.uniforms.uMap);
    }
  });

  it('only the quad arm carries the shared point range uniform, by reference', () => {
    expect(buildSpriteCloudMaterial(options, false).uniforms[SPRITE_QUAD_RANGE_UNIFORM]).toBe(
      undefined,
    );
    const quad = buildSpriteCloudMaterial(options, true);
    expect(quad.uniforms[SPRITE_QUAD_RANGE_UNIFORM]).toBe(spriteQuadPointRange);
    // the host's uniform record is not mutated
    expect(SPRITE_QUAD_RANGE_UNIFORM in options.uniforms).toBe(false);
  });

  it('syncs the range from the live context and ignores a nonsense answer', () => {
    const original = spriteQuadPointRange.value.clone();
    try {
      const gl = (answer: unknown) =>
        ({
          ALIASED_POINT_SIZE_RANGE: 0x846d,
          getParameter: () => answer,
        }) as unknown as WebGL2RenderingContext;
      syncSpriteQuadPointRange(gl(new Float32Array([1, 2047])));
      expect(spriteQuadPointRange.value.toArray()).toEqual([1, 2047]);
      syncSpriteQuadPointRange(gl(null));
      expect(spriteQuadPointRange.value.toArray()).toEqual([1, 2047]);
      syncSpriteQuadPointRange(gl(new Float32Array([5, 2])));
      expect(spriteQuadPointRange.value.toArray()).toEqual([1, 2047]);
      syncSpriteQuadPointRange(gl(new Float32Array([1, 1024])));
      expect(spriteQuadPointRange.value.toArray()).toEqual([1, 1024]);
    } finally {
      spriteQuadPointRange.value.copy(original);
    }
    expect(spriteQuadPointRange.value.toArray()).toEqual([
      POINT_SIZE_RANGE_FALLBACK.min,
      POINT_SIZE_RANGE_FALLBACK.max,
    ]);
  });
});

describe('static sprite cloud geometry', () => {
  const attributes = {
    position: new Float32Array(9),
    aSize: new Float32Array([1, 2, 3]),
  };
  const itemSizes = { position: 3 };

  it('the point arm is a plain geometry with plain attributes', () => {
    const geometry = buildSpriteCloudGeometry(attributes, itemSizes, false);
    expect(geometry).not.toBeInstanceOf(THREE.InstancedBufferGeometry);
    expect(geometry.getAttribute('position')).toBeInstanceOf(THREE.BufferAttribute);
    expect((geometry.getAttribute('aSize') as THREE.BufferAttribute).array).toBe(attributes.aSize);
    expect(geometry.index).toBeNull();
    expect(
      buildSpriteCloudObject(geometry, buildSpriteCloudMaterial(options, false)),
    ).toBeInstanceOf(THREE.Points);
  });

  it('refuses attribute arrays that disagree on the particle count', () => {
    for (const quads of [false, true]) {
      expect(() =>
        buildSpriteCloudGeometry(
          { position: new Float32Array(9), aSize: new Float32Array(4) },
          itemSizes,
          quads,
        ),
      ).toThrow(/aSize: 4 particles, expected 3/);
      expect(() =>
        buildSpriteCloudGeometry({ position: new Float32Array(8) }, itemSizes, quads),
      ).toThrow(/position: 8 floats is not a multiple of 3/);
    }
  });

  it('never picks, never casts and carries the VFX-node tag on both arms', () => {
    for (const quads of [false, true]) {
      const object = buildSpriteCloudObject(
        buildSpriteCloudGeometry(attributes, itemSizes, quads),
        buildSpriteCloudMaterial(options, quads),
      );
      expect(object.castShadow).toBe(false);
      expect(object.receiveShadow).toBe(false);
      expect(object.userData.weaponVfxMesh).toBe(true);
      const hits: THREE.Intersection[] = [];
      const ray = new THREE.Raycaster(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1));
      ray.params.Points = { threshold: 100 };
      ray.intersectObject(object, false, hits);
      expect(hits).toEqual([]);
    }
  });

  it('the quad arm instances every particle attribute over one indexed quad', () => {
    const geometry = buildSpriteCloudGeometry(
      attributes,
      itemSizes,
      true,
    ) as THREE.InstancedBufferGeometry;
    expect(geometry).toBeInstanceOf(THREE.InstancedBufferGeometry);
    expect(geometry.getAttribute('position')).toBeInstanceOf(THREE.InstancedBufferAttribute);
    expect(geometry.getAttribute('aSize')).toBeInstanceOf(THREE.InstancedBufferAttribute);
    expect((geometry.getAttribute('aSize') as THREE.BufferAttribute).array).toBe(attributes.aSize);
    const corner = geometry.getAttribute(SPRITE_QUAD_CORNER_ATTRIBUTE) as THREE.BufferAttribute;
    expect(corner).toBeInstanceOf(THREE.BufferAttribute);
    expect(corner).not.toBeInstanceOf(THREE.InstancedBufferAttribute);
    expect(corner.itemSize).toBe(2);
    expect(corner.count).toBe(4);
    expect([...(geometry.index as THREE.BufferAttribute).array]).toEqual([...SPRITE_QUAD_INDEX]);
    expect(geometry.instanceCount).toBe(3);
    const object = buildSpriteCloudObject(geometry, buildSpriteCloudMaterial(options, true));
    expect(object).toBeInstanceOf(THREE.Mesh);
    expect(object.frustumCulled).toBe(false);
  });
});

describe('interleaved sprite cloud geometry', () => {
  const stride = 4;
  const layout = [
    { name: 'position', itemSize: 3, offset: 0 },
    { name: 'aSize', itemSize: 1, offset: 3 },
  ];

  it('the point arm counts through the draw range', () => {
    const data = new Float32Array(stride * 8);
    const buffer = buildSpriteCloudInterleavedBuffer(data, stride, false);
    expect(buffer).not.toBeInstanceOf(THREE.InstancedInterleavedBuffer);
    expect(buffer.usage).toBe(THREE.DynamicDrawUsage);
    const geometry = buildSpriteCloudInterleavedGeometry(buffer, layout, false);
    expect(spriteCloudCount(geometry)).toBe(0);
    setSpriteCloudCount(geometry, 5);
    expect(geometry.drawRange).toEqual({ start: 0, count: 5 });
    expect(spriteCloudCount(geometry)).toBe(5);
  });

  it('the quad arm counts through the instance count over the same buffer', () => {
    const data = new Float32Array(stride * 8);
    const buffer = buildSpriteCloudInterleavedBuffer(data, stride, true);
    expect(buffer).toBeInstanceOf(THREE.InstancedInterleavedBuffer);
    expect((buffer as THREE.InstancedInterleavedBuffer).meshPerAttribute).toBe(1);
    expect(buffer.array).toBe(data);
    expect(buffer.usage).toBe(THREE.DynamicDrawUsage);
    const geometry = buildSpriteCloudInterleavedGeometry(buffer, layout, true);
    expect(geometry).toBeInstanceOf(THREE.InstancedBufferGeometry);
    expect(spriteCloudCount(geometry)).toBe(0);
    const size = geometry.getAttribute('aSize') as THREE.InterleavedBufferAttribute;
    expect(size.data).toBe(buffer);
    expect(size.offset).toBe(3);
    expect(geometry.getAttribute(SPRITE_QUAD_CORNER_ATTRIBUTE)).toBeDefined();
    setSpriteCloudCount(geometry, 5);
    expect((geometry as THREE.InstancedBufferGeometry).instanceCount).toBe(5);
    expect(spriteCloudCount(geometry)).toBe(5);
    // the vertex draw range is untouched: the quad's six indices stay reachable
    expect(geometry.drawRange.count).toBe(Number.POSITIVE_INFINITY);
    // and the prefix upload idiom is the same buffer API
    buffer.clearUpdateRanges();
    buffer.addUpdateRange(0, 5 * stride);
    expect(buffer.updateRanges).toEqual([{ start: 0, count: 20 }]);
  });
});
