import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/render/assets/loader', () => ({
  loadTexture: vi.fn(async () => ({ image: null })),
  releaseTexture: vi.fn(),
}));
vi.mock('../src/render/assets/preload', () => ({
  registerPreload: vi.fn(),
  registerDeferredPreload: vi.fn(),
}));

import { Vfx } from '../src/render/vfx';

interface VfxProbe {
  points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  cloudWarmed: boolean;
  pos: Float32Array;
  vel: Float32Array;
  col: Float32Array;
  size: Float32Array;
  life: Float32Array;
  alphaAttr: Float32Array;
  spriteAttr: Float32Array;
  rotAttr: Float32Array;
  activeSlots: Int32Array;
  activeCount: number;
  head: number;
  drawBuffer: THREE.InterleavedBuffer;
  spriteRadiusSq: Float32Array;
  onContextRestored(): void;
  spawn(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    color: number,
    size: number,
    lifetime: number,
    gravity: number,
    sprite: number,
    rot: number,
  ): void;
}

function installCanvasStub(): void {
  const context = {
    fillStyle: '',
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    createRadialGradient: () => ({ addColorStop: vi.fn() }),
    getImageData: (_x: number, _y: number, width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4),
    }),
  };
  vi.stubGlobal('document', {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => context,
    }),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pooled VFX cloud', () => {
  it('submits and uploads only the live ascending prefix with conservative culling', () => {
    installCanvasStub();
    const scene = new THREE.Scene();
    const vfx = new Vfx(scene, () => null);
    const probe = vfx as unknown as VfxProbe;
    const { points } = probe;
    const geometry = points.geometry;

    expect(geometry.drawRange.count).toBe(0);
    expect(points.visible).toBe(true);
    expect(points.frustumCulled).toBe(false);
    const position = geometry.getAttribute('position') as THREE.InterleavedBufferAttribute;
    expect(position.data.usage).toBe(THREE.DynamicDrawUsage);
    for (const name of ['aColor', 'aSize', 'aAlpha', 'aSprite', 'aRot', 'aRadiusSq']) {
      const attribute = geometry.getAttribute(name);
      expect(attribute, name).toBeInstanceOf(THREE.InterleavedBufferAttribute);
      expect((attribute as THREE.InterleavedBufferAttribute).data, name).toBe(position.data);
    }
    expect(points.material.transparent).toBe(true);
    expect(points.material.depthWrite).toBe(false);
    expect(points.material.blending).toBe(THREE.AdditiveBlending);
    expect(points.renderOrder).toBe(5);
    const atlas = points.material.uniforms.uAtlas.value as THREE.CanvasTexture;
    expect(atlas.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(atlas.minFilter).toBe(THREE.LinearFilter);
    expect(atlas.magFilter).toBe(THREE.LinearFilter);
    expect(atlas.generateMipmaps).toBe(false);

    probe.spriteRadiusSq[0] = 0.125;
    probe.spawn(-1, 0, -10, 0, 0, 0, 0xffffff, 1, 1, 0, 0, 0);
    probe.spawn(0, 0, -10, 0, 0, 0, 0xffffff, 1, 0.05, 0, 0, 0);
    probe.spawn(1, 0, -10, 0, 0, 0, 0xffffff, 1, 1, 0, 0, 0);
    probe.spawn(100, 0, -10, 0, 0, 0, 0xffffff, 1, 1, 0, 0, 0);
    vfx.update(0.1);
    expect([...probe.activeSlots.subarray(0, probe.activeCount)]).toEqual([0, 2, 3]);
    let lifeReads = 0;
    probe.life = new Proxy(probe.life, {
      get(target, property) {
        if (typeof property === 'string' && /^\d+$/.test(property)) lifeReads++;
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    camera.lookAt(0, 0, -10);
    camera.updateMatrixWorld();
    vfx.prepareDraw(camera);
    expect(lifeReads).toBe(probe.activeCount);
    expect(geometry.drawRange.count).toBe(2);
    expect([position.getX(0), position.getX(1)]).toEqual([-1, 1]);
    expect(position.data.updateRanges).toEqual([{ start: 0, count: 22 }]);
    expect((geometry.getAttribute('aColor') as THREE.InterleavedBufferAttribute).getX(0)).toBe(1);
    expect((geometry.getAttribute('aSize') as THREE.InterleavedBufferAttribute).getX(0)).toBe(1);
    expect((geometry.getAttribute('aAlpha') as THREE.InterleavedBufferAttribute).getX(0)).toBe(1);
    expect((geometry.getAttribute('aSprite') as THREE.InterleavedBufferAttribute).getX(0)).toBe(0);
    expect((geometry.getAttribute('aRot') as THREE.InterleavedBufferAttribute).getX(0)).toBe(0);
    expect((geometry.getAttribute('aRadiusSq') as THREE.InterleavedBufferAttribute).getX(0)).toBe(
      0.125,
    );

    const visibleVersion = position.data.version;
    camera.position.set(1_000, 0, 0);
    camera.lookAt(1_000, 0, -10);
    camera.updateMatrixWorld();
    probe.cloudWarmed = true;
    vfx.prepareDraw(camera);
    expect(points.visible).toBe(false);
    expect(geometry.drawRange.count).toBe(0);
    expect(position.data.version).toBe(visibleVersion);

    vfx.clear();
    probe.spawn(6.4, 0, -10, 0, 0, 0, 0xffffff, 2, 1, 0, 0, 0);
    vfx.update(0);
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, -10);
    camera.updateMatrixWorld();
    vfx.prepareDraw(camera);
    expect(geometry.drawRange.count).toBe(1);
    expect(points.visible).toBe(true);

    const historicalSortSphere = geometry.boundingSphere;
    expect(historicalSortSphere?.center.toArray()).toEqual([450, 0, 0]);
    expect(historicalSortSphere?.radius).toBe(2400);
    expect(points.material.vertexShader).toContain(`float idx = floor(aSprite + 0.5);
          vCell = vec2(mod(idx, 4.0), floor(idx / 4.0));
          vRotCs = vec2(cos(aRot), sin(aRot));
          vRadiusSq = aRadiusSq;`);
    expect(points.material.fragmentShader).toContain(`vec2 pc = gl_PointCoord - 0.5;
          if (dot(pc, pc) > vRadiusSq) discard;
          // rotate the point coord around its centre, clamped inside the cell
          pc = vec2(
            pc.x * vRotCs.x - pc.y * vRotCs.y,
            pc.x * vRotCs.y + pc.y * vRotCs.x
          );
          pc = clamp(pc + 0.5, 0.01, 0.99);
          vec2 uv = (vCell + pc) / 4.0;
          uv.y = 1.0 - uv.y; // canvas row 0 is the visual top
          vec3 tex = texture2D(uAtlas, uv).rgb;`);
    expect(points.material.fragmentShader).toContain(
      'if (lum * vAlpha < 0.012) discard;\n          gl_FragColor = vec4(vColor * tex, vAlpha);',
    );
    expect(points.material.fragmentShader.match(/texture2D/g)).toHaveLength(1);
    expect(points.material.fragmentShader).not.toContain('cos(');

    vfx.clear();
    probe.spawn(1_000, 0, -10, 0, 0, 0, 0xffffff, 1, 1, 0, 0, 0);
    const orthographic = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    orthographic.updateMatrixWorld();
    vfx.prepareDraw(orthographic);
    expect(geometry.drawRange.count).toBe(1);
    expect(position.getX(0)).toBe(1_000);
  });

  it('preserves particle evolution, fade, attributes, expiry, and capacity overwrite', () => {
    installCanvasStub();
    const vfx = new Vfx(new THREE.Scene(), () => null);
    const probe = vfx as unknown as VfxProbe;
    const geometry = probe.points.geometry;
    probe.spriteRadiusSq[7] = 0.33;
    probe.spawn(1, 2, 3, 4, 5, 6, 0x804020, 2.5, 1, 2, 7, 0.75);

    vfx.update(0.2);
    expect([...probe.pos.subarray(0, 3)]).toEqual([
      expect.closeTo(1.8, 5),
      expect.closeTo(2.92, 5),
      expect.closeTo(4.2, 5),
    ]);
    expect(probe.vel[1]).toBeCloseTo(4.6);
    expect(probe.life[0]).toBeCloseTo(0.8);
    expect(probe.alphaAttr[0]).toBe(1);

    vfx.update(0.6);
    expect([...probe.pos.subarray(0, 3)]).toEqual([
      expect.closeTo(4.2, 5),
      expect.closeTo(4.96, 5),
      expect.closeTo(7.8, 5),
    ]);
    expect(probe.vel[1]).toBeCloseTo(3.4);
    expect(probe.alphaAttr[0]).toBeCloseTo(0.8);

    const camera = new THREE.OrthographicCamera(-100, 100, 100, -100, 0.1, 100);
    camera.position.z = 20;
    camera.updateMatrixWorld();
    vfx.prepareDraw(camera);
    expect(geometry.drawRange.count).toBe(1);
    const expectedColor = new THREE.Color(0x804020);
    const color = geometry.getAttribute('aColor') as THREE.InterleavedBufferAttribute;
    expect(color.getX(0)).toBeCloseTo(expectedColor.r);
    expect(color.getY(0)).toBeCloseTo(expectedColor.g);
    expect(color.getZ(0)).toBeCloseTo(expectedColor.b);
    expect((geometry.getAttribute('aSize') as THREE.InterleavedBufferAttribute).getX(0)).toBe(2.5);
    expect(
      (geometry.getAttribute('aAlpha') as THREE.InterleavedBufferAttribute).getX(0),
    ).toBeCloseTo(0.8);
    expect((geometry.getAttribute('aSprite') as THREE.InterleavedBufferAttribute).getX(0)).toBe(7);
    expect((geometry.getAttribute('aRot') as THREE.InterleavedBufferAttribute).getX(0)).toBe(0.75);
    expect(
      (geometry.getAttribute('aRadiusSq') as THREE.InterleavedBufferAttribute).getX(0),
    ).toBeCloseTo(0.33);

    vfx.update(0.21);
    vfx.prepareDraw(camera);
    expect(probe.activeCount).toBe(0);
    expect(probe.size[0]).toBe(0);
    expect(geometry.drawRange.count).toBe(0);
    vfx.clear();
    vfx.clear();
    expect(probe.activeCount).toBe(0);

    const capacityVfx = new Vfx(new THREE.Scene(), () => null);
    const capacityProbe = capacityVfx as unknown as VfxProbe;
    for (let i = 0; i <= 4_096; i++) {
      capacityProbe.spawn(i, 0, -10, 0, 0, 0, 0xffffff, 1, 1, 0, 0, 0);
    }
    capacityVfx.prepareDraw(camera);
    const capacityPosition = capacityProbe.points.geometry.getAttribute(
      'position',
    ) as THREE.InterleavedBufferAttribute;
    expect(capacityProbe.activeCount).toBe(4_096);
    expect(capacityProbe.points.geometry.drawRange.count).toBe(4_096);
    expect(capacityPosition.getX(0)).toBe(4_096);
    expect(capacityPosition.getX(1)).toBe(1);
    expect(capacityPosition.getX(4_095)).toBe(4_095);

    capacityProbe.life[0] = 0.05;
    capacityVfx.update(0.1);
    expect(capacityProbe.activeCount).toBe(4_095);
    expect(capacityProbe.activeSlots[0]).toBe(1);

    capacityProbe.head = 0;
    capacityProbe.spawn(8_192, 0, -10, 0, 0, 0, 0xffffff, 1, 1, 0, 0, 0);
    expect(capacityProbe.activeCount).toBe(4_096);
    expect([...capacityProbe.activeSlots.subarray(0, 3)]).toEqual([0, 1, 2]);
    capacityVfx.prepareDraw(camera);
    expect(capacityPosition.getX(0)).toBe(8_192);
    expect(capacityPosition.getX(1)).toBe(1);
  });

  it('keeps settled idle frames upload-free and rearms prewarm after context restore', () => {
    installCanvasStub();
    const vfx = new Vfx(new THREE.Scene(), () => null);
    const probe = vfx as unknown as VfxProbe;
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    camera.updateMatrixWorld();
    const initialVersion = probe.drawBuffer.version;
    const afterRender = probe.points.onAfterRender as unknown as () => void;

    expect(probe.points.visible).toBe(true);
    afterRender();
    expect(probe.cloudWarmed).toBe(true);
    expect(probe.points.visible).toBe(false);
    vfx.prepareDraw(camera);
    expect(probe.drawBuffer.version).toBe(initialVersion);
    expect(probe.drawBuffer.updateRanges).toEqual([]);
    expect(probe.points.visible).toBe(false);

    vfx.onContextRestored();
    expect(probe.cloudWarmed).toBe(false);
    expect(probe.points.visible).toBe(true);
    afterRender();
    expect(probe.cloudWarmed).toBe(true);
    expect(probe.points.visible).toBe(false);
  });

  it('packs particles against the final camera pose for every out-of-band render', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../src/render/renderer.ts', import.meta.url)),
      'utf8',
    );
    // Every prepareDraw that feeds a render must pack against the FINAL camera
    // pose, so each render site is immediately preceded by updateMatrixWorld.
    // Pinned structurally: the previous version anchored on a neighbouring
    // block of unrelated camera-shake code, which drifted and left this test
    // failing for reasons that had nothing to do with the invariant.
    const renderSites = [
      ...source.matchAll(/this\.vfx\.prepareDraw\(this\.camera\);\n\s*if \(this\.post\)/g),
    ];
    expect(renderSites).toHaveLength(2);
    for (const site of renderSites) {
      expect(
        source.slice(0, site.index).trimEnd().endsWith('this.camera.updateMatrixWorld();'),
      ).toBe(true);
    }
    expect(source).toContain(`async captureScreenshot(maxEdge = 1280, quality = 0.7)`);
    expect(source.match(/this\.vfx\.prepareDraw\(this\.camera\);/g)).toHaveLength(3);
    expect(source).toContain(`this.vfx.update(dt);
    this.vfx.prepareDraw(this.camera);
    this.frozenOrbFx.update(dt);`);
    expect(source).toContain(`this.captureGlIdentity();
      this.vfx.onContextRestored();`);
  });
});
