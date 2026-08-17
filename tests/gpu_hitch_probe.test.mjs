import { afterEach, describe, expect, it } from 'vitest';
import { installGpuHitchProbe } from '../scripts/profiler/gpu_hitch_probe.mjs';

const originalGlobals = new Map();

// The GL enums the upload estimator reads, by their real values: the whole
// point of the overload cases below is that 0x1908 and 0x1401 are NOT a width
// and a height.
const GL = {
  TEXTURE_2D: 0x0de1,
  RGB: 0x1907,
  RGBA: 0x1908,
  U8: 0x1401,
  HALF_FLOAT: 0x140b,
  // UNSIGNED_SHORT_5_6_5: a PACKED type, two bytes for the whole texel.
  U565: 0x8363,
  ETC1: 0x8d64,
};

const view = (bytes) => new Uint8Array(bytes);

function setGlobal(name, value) {
  if (!originalGlobals.has(name)) originalGlobals.set(name, globalThis[name]);
  globalThis[name] = value;
}

function installFakeBrowser({ visibilityState = 'visible' } = {}) {
  class FakeGL {
    linkProgram() {
      return 'linked';
    }

    getParameter() {
      return 4096;
    }

    getProgramParameter() {
      return true;
    }
  }
  class FakeMutationObserver {
    observe() {}
    disconnect() {}
  }
  const curtain = {
    classList: { contains: () => false },
  };
  const listeners = new Map();
  const document = {
    visibilityState,
    querySelector: () => curtain,
    addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: (name) => listeners.delete(name),
  };
  setGlobal('window', globalThis);
  setGlobal('document', document);
  setGlobal('WebGL2RenderingContext', FakeGL);
  setGlobal('MutationObserver', FakeMutationObserver);
  return { FakeGL, document, listeners };
}

afterEach(() => {
  for (const [name, value] of originalGlobals) {
    if (value === undefined) delete globalThis[name];
    else globalThis[name] = value;
  }
  originalGlobals.clear();
  delete globalThis.__wocGpuHitchProbe;
});

describe('gpu hitch browser probe', () => {
  it('records exact links and all three program-query kinds, then restores methods', () => {
    const { FakeGL } = installFakeBrowser();
    const originalLink = FakeGL.prototype.linkProgram;
    const originalQuery = FakeGL.prototype.getProgramParameter;
    installGpuHitchProbe({ profile: 'shader', captureId: 'test' });
    const gl = new FakeGL();
    const program = {};
    gl.linkProgram(program);
    gl.getProgramParameter(program, 0x91b1);
    gl.getProgramParameter(program, 0x8b86);
    gl.getProgramParameter(program, 0x8b89);
    const snapshot = globalThis.__wocGpuHitchProbe.snapshot();
    expect(snapshot.startedAtPerformanceMs).toEqual(expect.any(Number));
    expect(snapshot.links).toHaveLength(1);
    expect(snapshot.links[0]).toMatchObject({ programId: 1, lane: expect.any(String) });
    expect(snapshot.queries.map((query) => query.kind)).toEqual([
      'completion-status',
      'active-uniforms',
      'active-attributes',
    ]);
    globalThis.__wocGpuHitchProbe.stop('test');
    expect(FakeGL.prototype.linkProgram).toBe(originalLink);
    expect(FakeGL.prototype.getProgramParameter).toBe(originalQuery);
  });

  it('does not install upload wrappers in the shader profile', () => {
    const { FakeGL } = installFakeBrowser();
    FakeGL.prototype.texSubImage2D = () => {};
    const original = FakeGL.prototype.texSubImage2D;
    installGpuHitchProbe({ profile: 'shader' });
    expect(FakeGL.prototype.texSubImage2D).toBe(original);
    globalThis.__wocGpuHitchProbe.stop('test');
  });

  it('is idempotent and preserves an exception from the original query', () => {
    installFakeBrowser();
    class ThrowingGL {
      getParameter() {
        return 4096;
      }

      getProgramParameter() {
        throw new Error('driver query failed');
      }
    }
    setGlobal('WebGL2RenderingContext', ThrowingGL);
    const original = ThrowingGL.prototype.getProgramParameter;
    installGpuHitchProbe({ profile: 'shader' });
    const firstProbe = globalThis.__wocGpuHitchProbe;
    installGpuHitchProbe({ profile: 'full' });
    expect(globalThis.__wocGpuHitchProbe).toBe(firstProbe);
    expect(() => new ThrowingGL().getProgramParameter({}, 0x91b1)).toThrow('driver query failed');
    expect(firstProbe.snapshot().queries[0]).toMatchObject({ kind: 'completion-status' });
    firstProbe.stop('test');
    expect(ThrowingGL.prototype.getProgramParameter).toBe(original);
  });

  it('aggregates upload bytes only in upload-capable profiles', () => {
    const { FakeGL } = installFakeBrowser();
    FakeGL.prototype.texSubImage2D = () => 'uploaded';
    installGpuHitchProbe({ profile: 'upload' });
    // The 9-argument pixel overload: width and height are args[4] and args[5].
    const result = new FakeGL().texSubImage2D(
      GL.TEXTURE_2D,
      0,
      0,
      0,
      2,
      2,
      GL.RGBA,
      GL.U8,
      view(16),
    );
    expect(result).toBe('uploaded');
    expect(globalThis.__wocGpuHitchProbe.snapshot().uploadBuckets).toEqual([
      expect.objectContaining({ count: 1, bytes: 16, unsized: 0 }),
    ]);
    globalThis.__wocGpuHitchProbe.stop('test');
  });

  it('sizes each texture upload from the overload that was actually called', () => {
    const { FakeGL } = installFakeBrowser();
    for (const name of [
      'texImage2D',
      'texSubImage2D',
      'compressedTexImage2D',
      'compressedTexSubImage2D',
    ])
      FakeGL.prototype[name] = () => {};
    installGpuHitchProbe({ profile: 'full' });
    const gl = new FakeGL();

    // The DOM-source overloads three r165 uses for image uploads carry NO
    // dimensions: reading args[3]/args[4] positionally read the RGBA and
    // UNSIGNED_BYTE enums as a 6408 x 5121 texture, about 131 MB per upload.
    gl.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, GL.RGBA, GL.U8, { width: 256, height: 128 });
    // An <img> reports its layout size in width; the upload is the intrinsic one.
    gl.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, GL.RGBA, GL.U8, {
      width: 1,
      height: 1,
      naturalWidth: 64,
      naturalHeight: 32,
    });
    // A VideoFrame states neither: its axes are codedWidth / codedHeight.
    gl.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, GL.RGBA, GL.U8, { codedWidth: 16, codedHeight: 8 });
    // args[3] is yoffset in the 7-argument texSubImage2D source overload.
    gl.texSubImage2D(GL.TEXTURE_2D, 0, 0, 0, GL.RGBA, GL.U8, { width: 8, height: 4 });
    // Sized overloads keep their dimensions, and the type decides the texel.
    // The VIEW is deliberately far larger than the texture: with a view whose
    // length happens to equal the region, the whole width x height x texel
    // computation is indistinguishable from returning the view's own length,
    // and deleting it leaves the suite green.
    gl.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, 4, 2, 0, GL.RGBA, GL.HALF_FLOAT, view(1_024));
    // A packed type carries the WHOLE texel in one unit: 2 bytes here, not 2
    // per component. Multiplying the component count back in is the mistake
    // this table exists to prevent.
    gl.texImage2D(GL.TEXTURE_2D, 0, GL.RGB, 8, 8, 0, GL.RGB, GL.U565, view(4_096));
    // An exotic format/type pair this table does not name: the view's own
    // length is still an exact upper bound, so the upload is sized, not lost.
    gl.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, 2, 2, 0, GL.RGBA, 0x9999, view(48));
    gl.compressedTexImage2D(GL.TEXTURE_2D, 0, GL.ETC1, 64, 64, 0, view(4_096));
    // The compressed sub-image data sits one position further along (args[7]).
    gl.compressedTexSubImage2D(GL.TEXTURE_2D, 0, 0, 0, 32, 32, GL.ETC1, view(1_024));
    // The WebGL2 pixel-unpack-buffer form states an imageSize instead of data.
    gl.compressedTexImage2D(GL.TEXTURE_2D, 0, GL.ETC1, 64, 64, 0, 2_048, 0);

    const [bucket] = globalThis.__wocGpuHitchProbe.snapshot().uploadBuckets;
    expect(bucket.count).toBe(10);
    expect(bucket.unsized).toBe(0);
    expect(bucket.bytes).toBe(
      256 * 128 * 4 +
        64 * 32 * 4 +
        16 * 8 * 4 +
        8 * 4 * 4 +
        4 * 2 * 8 +
        8 * 8 * 2 +
        48 +
        4_096 +
        1_024 +
        2_048,
    );
    globalThis.__wocGpuHitchProbe.stop('test');
  });

  it('counts an upload it cannot size instead of guessing at its bytes', () => {
    const { FakeGL } = installFakeBrowser();
    FakeGL.prototype.texImage2D = () => {};
    FakeGL.prototype.compressedTexImage2D = () => {};
    installGpuHitchProbe({ profile: 'upload' });
    const gl = new FakeGL();
    // A video frame that has not reported a size yet: a byte total is only
    // readable next to how many uploads it could not describe.
    gl.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, GL.RGBA, GL.U8, {});
    // A sized upload whose format/type this table does not name AND which hands
    // in no view at all (an allocation from a pixel-unpack buffer).
    gl.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, 4, 4, 0, GL.RGBA, 0x9999, 0);
    // And a compressed upload with neither data nor a stated size.
    gl.compressedTexImage2D(GL.TEXTURE_2D, 0, GL.ETC1, 8, 8, 0, null);
    expect(globalThis.__wocGpuHitchProbe.snapshot().uploadBuckets).toEqual([
      expect.objectContaining({ count: 3, bytes: 0, unsized: 3 }),
    ]);
    globalThis.__wocGpuHitchProbe.stop('test');
  });

  it('records the value each program query returned', () => {
    installFakeBrowser();
    const returns = new Map([
      [0x91b1, true],
      [0x8b86, 137],
      [0x8b89, 12],
    ]);
    class ValueGL {
      getParameter() {
        return 4096;
      }

      getProgramParameter(_program, pname) {
        return returns.get(pname);
      }
    }
    setGlobal('WebGL2RenderingContext', ValueGL);
    installGpuHitchProbe({ profile: 'shader' });
    const gl = new ValueGL();
    const program = {};
    gl.getProgramParameter(program, 0x91b1);
    gl.getProgramParameter(program, 0x8b86);
    gl.getProgramParameter(program, 0x8b89);
    const queries = globalThis.__wocGpuHitchProbe.snapshot().queries;
    expect(queries.map((query) => [query.kind, query.value])).toEqual([
      ['completion-status', true],
      ['active-uniforms', 137],
      ['active-attributes', 12],
    ]);
    globalThis.__wocGpuHitchProbe.stop('test');
  });

  it('reports a not-ready completion status as false rather than dropping the value', () => {
    installFakeBrowser();
    class PendingGL {
      getParameter() {
        return 4096;
      }

      getProgramParameter() {
        return false;
      }
    }
    setGlobal('WebGL2RenderingContext', PendingGL);
    installGpuHitchProbe({ profile: 'shader' });
    new PendingGL().getProgramParameter({}, 0x91b1);
    expect(globalThis.__wocGpuHitchProbe.snapshot().queries[0]).toMatchObject({
      kind: 'completion-status',
      value: false,
    });
    globalThis.__wocGpuHitchProbe.stop('test');
  });

  it('attributes a linked program to its three identity and never serializes the cache key', async () => {
    const { FakeGL } = installFakeBrowser();
    const glProgram = { handle: 'gl-program' };
    const cacheKey = `custom-hook-source-${'x'.repeat(200)}`;
    setGlobal('__game', {
      renderer: {
        webgl: {
          info: {
            programs: [
              {
                program: glProgram,
                id: 7,
                type: 'MeshStandardMaterial',
                name: 'armor_dye',
                cacheKey,
              },
            ],
          },
        },
      },
    });
    installGpuHitchProbe({ profile: 'shader' });
    new FakeGL().linkProgram(glProgram);
    await Promise.resolve();
    const programs = globalThis.__wocGpuHitchProbe.snapshot().programs;
    expect(programs).toEqual([
      {
        programId: 1,
        threeId: 7,
        materialType: 'MeshStandardMaterial',
        materialName: 'armor_dye',
        cacheKeyHash: expect.stringMatching(/^[0-9a-f]{8}$/),
        cacheKeyLength: cacheKey.length,
        variantDiff: null,
        variantAmbiguous: false,
        resolvedAtMs: expect.any(Number),
      },
    ]);
    expect(JSON.stringify(programs)).not.toContain('custom-hook-source');
    globalThis.__wocGpuHitchProbe.stop('test');
  });

  it('reports only the differing cache-key segment, never the key or the hook source', async () => {
    const { FakeGL } = installFakeBrowser();
    const gl = new FakeGL();
    const hook = `function onBeforeCompile(s){s.vertexShader='SECRET,WITH,COMMAS';}`;
    const first = { handle: 'variant-a' };
    const second = { handle: 'variant-b' };
    const programs = [];
    setGlobal('__game', { renderer: { webgl: { info: { programs } } } });
    installGpuHitchProbe({ profile: 'shader' });

    programs.push({
      program: first,
      id: 1,
      type: 'MeshStandardMaterial',
      name: 'streetlamp',
      cacheKey: `physical,highp,srgb,4,0,2,srgb,${hook}`,
    });
    gl.linkProgram(first);
    await Promise.resolve();
    programs.push({
      program: second,
      id: 2,
      type: 'MeshStandardMaterial',
      name: 'streetlamp',
      cacheKey: `physical,highp,srgb,5,0,2,srgb,${hook}`,
    });
    gl.linkProgram(second);
    await Promise.resolve();

    const snapshot = globalThis.__wocGpuHitchProbe.snapshot();
    expect(snapshot.programs[0].variantDiff).toBeNull();
    expect(snapshot.programs[1].variantDiff).toEqual({
      segmentIndex: 3,
      segmentsBefore: 10,
      segmentsAfter: 10,
      spanBefore: 1,
      spanAfter: 1,
      before: '4',
      after: '5',
    });
    const serialized = JSON.stringify(snapshot.programs);
    expect(serialized).not.toContain('SECRET');
    expect(serialized).not.toContain('onBeforeCompile');
    globalThis.__wocGpuHitchProbe.stop('test');
  });

  it('refuses to call two unrelated materials of one class a variant', async () => {
    // The retention key is the material class plus name, because the link
    // happens with no reachable material instance: two ordinary unnamed
    // MeshStandardMaterials share it. One render condition flipping moves a
    // SINGLE cache-key segment, while two different materials differ across
    // many, so the wide difference is recorded as an ambiguous family key
    // rather than seeded into cacheKeyVariance as a bogus variant group.
    const { FakeGL } = installFakeBrowser();
    const gl = new FakeGL();
    const first = { handle: 'material-a' };
    const second = { handle: 'material-b' };
    const programs = [];
    setGlobal('__game', { renderer: { webgl: { info: { programs } } } });
    installGpuHitchProbe({ profile: 'shader' });

    programs.push({
      program: first,
      id: 1,
      type: 'MeshStandardMaterial',
      name: '',
      cacheKey: 'physical,USE_MAP,1,USE_NORMALMAP,1,highp,4,0,2,srgb',
    });
    gl.linkProgram(first);
    await Promise.resolve();
    programs.push({
      program: second,
      id: 2,
      type: 'MeshStandardMaterial',
      name: '',
      cacheKey: 'physical,USE_INSTANCING,1,USE_SKINNING,1,highp,4,0,2,srgb',
    });
    gl.linkProgram(second);
    await Promise.resolve();

    const snapshot = globalThis.__wocGpuHitchProbe.snapshot();
    expect(snapshot.programs[1].variantDiff).toBeNull();
    expect(snapshot.programs[1].variantAmbiguous).toBe(true);
    globalThis.__wocGpuHitchProbe.stop('test');
  });

  // One segment appearing or disappearing is still ONE condition: three's
  // getProgramCacheKey emits a variable-length `defines` block, so a material
  // gaining a single define makes the key one segment longer. The two spans
  // always differ by exactly that segment-count change, so the rule is "one
  // segment on the shorter side, at most one more on the other", and each half
  // of it gets a case.
  it.each([
    ['a single-segment insertion is a variant', 'p,q,d', 'p,x,y,d', false],
    ['a two-segment insertion is not', 'p,q,d', 'p,x,y,z,d', true],
  ])('%s', async (_name, beforeKey, afterKey, ambiguous) => {
    const { FakeGL } = installFakeBrowser();
    const gl = new FakeGL();
    const first = { handle: 'narrow' };
    const second = { handle: 'wide' };
    const programs = [];
    setGlobal('__game', { renderer: { webgl: { info: { programs } } } });
    installGpuHitchProbe({ profile: 'shader' });

    programs.push({
      program: first,
      id: 1,
      type: 'MeshBasicMaterial',
      name: '',
      cacheKey: beforeKey,
    });
    gl.linkProgram(first);
    await Promise.resolve();
    programs.push({
      program: second,
      id: 2,
      type: 'MeshBasicMaterial',
      name: '',
      cacheKey: afterKey,
    });
    gl.linkProgram(second);
    await Promise.resolve();

    const [, program] = globalThis.__wocGpuHitchProbe.snapshot().programs;
    expect(program.variantAmbiguous).toBe(ambiguous);
    if (ambiguous) expect(program.variantDiff).toBeNull();
    else expect(program.variantDiff).toMatchObject({ spanBefore: 1, spanAfter: 2 });
    globalThis.__wocGpuHitchProbe.stop('test');
  });

  it('replaces an unsafe differing segment with a bounded stand-in', async () => {
    const { FakeGL } = installFakeBrowser();
    const gl = new FakeGL();
    const first = { handle: 'a' };
    const second = { handle: 'b' };
    const programs = [];
    setGlobal('__game', { renderer: { webgl: { info: { programs } } } });
    installGpuHitchProbe({ profile: 'shader' });
    programs.push({ program: first, id: 1, type: 'ShaderMaterial', name: '', cacheKey: 'a;b;c' });
    gl.linkProgram(first);
    await Promise.resolve();
    programs.push({
      program: second,
      id: 2,
      type: 'ShaderMaterial',
      name: '',
      cacheKey: `a;${'Q'.repeat(90)};c`,
    });
    gl.linkProgram(second);
    await Promise.resolve();
    const diff = globalThis.__wocGpuHitchProbe.snapshot().programs[1].variantDiff;
    expect(diff.after).toMatch(/^#[0-9a-f]{8}:\d+$/);
    expect(diff.after.length).toBeLessThanOrEqual(40);
    globalThis.__wocGpuHitchProbe.stop('test');
  });

  it('drops an unresolvable program instead of retrying without bound', async () => {
    const { FakeGL } = installFakeBrowser();
    setGlobal('__game', { renderer: { webgl: { info: { programs: [] } } } });
    installGpuHitchProbe({ profile: 'shader' });
    const gl = new FakeGL();
    gl.linkProgram({});
    for (let pass = 0; pass < 8; pass++) await Promise.resolve();
    expect(globalThis.__wocGpuHitchProbe.snapshot().programs).toEqual([]);
    globalThis.__wocGpuHitchProbe.stop('test');
  });

  it('resolves programs linked long before the renderer became reachable', async () => {
    // The regression the headless smoke caught: main.ts assembles window.__game
    // around the reveal, so every program linked under the curtain saw an
    // unreachable renderer. Spending an attempt on those passes dropped 548 of
    // 600 programs before the renderer ever existed.
    const { FakeGL } = installFakeBrowser();
    installGpuHitchProbe({ profile: 'shader' });
    const gl = new FakeGL();
    const early = { handle: 'linked-under-the-curtain' };
    gl.linkProgram(early);
    for (let pass = 0; pass < 10; pass++) await Promise.resolve();
    expect(globalThis.__wocGpuHitchProbe.snapshot().programs).toEqual([]);

    setGlobal('__game', {
      renderer: {
        webgl: {
          info: {
            programs: [
              { program: early, id: 1, type: 'MeshStandardMaterial', name: '', cacheKey: 'key' },
            ],
          },
        },
      },
    });
    gl.linkProgram({ handle: 'a-later-link' });
    await Promise.resolve();
    expect(globalThis.__wocGpuHitchProbe.snapshot().programs).toMatchObject([
      { programId: 1, threeId: 1, materialType: 'MeshStandardMaterial' },
    ]);
    globalThis.__wocGpuHitchProbe.stop('test');
  });

  it('attaches the renderer hook without waiting for another link', async () => {
    const { FakeGL } = installFakeBrowser();
    const gl = new FakeGL();
    installGpuHitchProbe({ profile: 'shader' });
    gl.linkProgram({});
    const renderBufferDirect = () => {};
    const webgl = { info: { programs: [] }, renderBufferDirect };
    setGlobal('__game', { renderer: { webgl } });
    // No further link: the snapshot flush is what must notice the renderer.
    globalThis.__wocGpuHitchProbe.snapshot();
    expect(webgl.renderBufferDirect).not.toBe(renderBufferDirect);
    globalThis.__wocGpuHitchProbe.stop('test');
    expect(webgl.renderBufferDirect).toBe(renderBufferDirect);
  });

  it('censuses the container a rootIndex indexes, not the last scene drawn', () => {
    // The headless smoke returned an empty census while recording rootIndex 232:
    // the post chain draws its own quad scenes, so the LAST drawn scene is
    // routinely not the world scene, and an index into one array reported
    // against another names the wrong subsystem.
    const { FakeGL } = installFakeBrowser();
    const gl = new FakeGL();
    const worldChild = { type: 'Group', name: 'props', children: [], visible: true };
    const drawn = { type: 'Mesh', parent: worldChild };
    const world = { children: [{ type: 'Group', name: '', children: [] }, worldChild] };
    worldChild.parent = world;
    worldChild.children.push(drawn);
    const webgl = {
      info: { programs: [] },
      renderBufferDirect() {
        gl.linkProgram({});
      },
    };
    setGlobal('__game', { renderer: { webgl } });
    installGpuHitchProbe({ profile: 'shader' });
    gl.linkProgram({});
    webgl.renderBufferDirect(null, world, null, { type: 'MeshStandardMaterial' }, drawn, null);
    // A post-chain quad scene drawn last, carrying no scene-root children.
    webgl.renderBufferDirect(null, { isScene: true }, null, { type: 'ShaderMaterial' }, null, null);

    const snapshot = globalThis.__wocGpuHitchProbe.snapshot();
    expect(snapshot.links[1].draw).toMatchObject({ rootIndex: 1, rootCount: 2 });
    expect(snapshot.sceneRoots).toEqual([
      { index: 0, type: 'Group', name: '', children: 0, visible: false },
      { index: 1, type: 'Group', name: 'props', children: 1, visible: true },
    ]);
    globalThis.__wocGpuHitchProbe.stop('test');
  });

  it('stamps the draw context on a link, marks the shadow pass, and restores the hook', () => {
    const { FakeGL } = installFakeBrowser();
    const gl = new FakeGL();
    const sceneChild = { type: 'Group', name: 'props', children: [{}, {}], visible: true };
    const drawn = { type: 'SkinnedMesh', isSkinnedMesh: true, castShadow: true, parent: null };
    sceneChild.children.push(drawn);
    const scene = { children: [{ type: 'Group', name: '', children: [] }, sceneChild] };
    drawn.parent = sceneChild;
    sceneChild.parent = scene;
    const linkInsideDraw = { handle: 'inside' };
    const renderBufferDirect = () => {
      gl.linkProgram(linkInsideDraw);
    };
    const webgl = { info: { programs: [] }, renderBufferDirect };
    setGlobal('__game', { renderer: { webgl } });
    installGpuHitchProbe({ profile: 'shader' });
    // The first link is what attaches the hook; the renderer is built after
    // the probe installs, so nothing before this point can be stamped.
    gl.linkProgram({ handle: 'before-hook' });
    expect(webgl.renderBufferDirect).not.toBe(renderBufferDirect);

    webgl.renderBufferDirect(
      null,
      scene,
      null,
      { type: 'MeshStandardMaterial', name: 'bark' },
      drawn,
      null,
    );
    webgl.renderBufferDirect(
      null,
      null,
      null,
      { type: 'MeshDepthMaterial', name: '' },
      drawn,
      null,
    );

    const snapshot = globalThis.__wocGpuHitchProbe.snapshot();
    expect(snapshot.links[0].draw).toBeNull();
    expect(snapshot.links[1].draw).toMatchObject({
      materialType: 'MeshStandardMaterial',
      materialName: 'bark',
      objectType: 'SkinnedMesh',
      skinned: true,
      castShadow: true,
      shadowPass: false,
      rootIndex: 1,
      rootCount: 2,
      depth: 2,
    });
    expect(snapshot.links[2].draw).toMatchObject({
      materialType: 'MeshDepthMaterial',
      shadowPass: true,
    });
    expect(snapshot.sceneRoots).toEqual([
      { index: 0, type: 'Group', name: '', children: 0, visible: false },
      { index: 1, type: 'Group', name: 'props', children: 3, visible: true },
    ]);
    globalThis.__wocGpuHitchProbe.stop('test');
    expect(webgl.renderBufferDirect).toBe(renderBufferDirect);
  });

  it('rejects a free-form material name instead of copying it into the artifact', () => {
    const { FakeGL } = installFakeBrowser();
    const gl = new FakeGL();
    const webgl = {
      info: { programs: [] },
      renderBufferDirect() {
        gl.linkProgram({});
      },
    };
    setGlobal('__game', { renderer: { webgl } });
    installGpuHitchProbe({ profile: 'shader' });
    gl.linkProgram({});
    webgl.renderBufferDirect(
      null,
      { children: [] },
      null,
      { type: 'MeshBasicMaterial', name: 'player <Ruby> said "hi"' },
      { type: 'Mesh' },
      null,
    );
    expect(globalThis.__wocGpuHitchProbe.snapshot().links[1].draw).toMatchObject({
      materialType: 'MeshBasicMaterial',
      materialName: '',
    });
    globalThis.__wocGpuHitchProbe.stop('test');
  });

  it('starts visibility evidence at the initial focus handoff but retains later hiding', () => {
    const { document, listeners } = installFakeBrowser();
    installGpuHitchProbe({ profile: 'shader' });
    document.visibilityState = 'hidden';
    listeners.get('visibilitychange')();
    document.visibilityState = 'visible';
    listeners.get('visibilitychange')();
    expect(globalThis.__wocGpuHitchProbe.snapshot().visibilityTransitions).toEqual([
      { atMs: expect.any(Number), state: 'visible' },
    ]);

    document.visibilityState = 'hidden';
    listeners.get('visibilitychange')();
    expect(globalThis.__wocGpuHitchProbe.snapshot().visibilityTransitions.at(-1)).toMatchObject({
      state: 'hidden',
    });
    globalThis.__wocGpuHitchProbe.stop('test');
  });
});
