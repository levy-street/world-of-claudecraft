import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getBounds, NodeIO, Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS, type EmissiveStrength } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';
import { frostIcePreloadInternalsForTest } from '../src/render/frost_ice_fields';
import { streetlampPreloadInternalsForTest } from '../src/render/streetlamp_assets';
import {
  streetlampEmissiveInternalsForTest,
  streetlampEmissiveRole,
} from '../src/render/streetlamp_emissive';

const ROOT = path.join(__dirname, '..');
const CREDITS = readFileSync(path.join(ROOT, 'CREDITS.md'), 'utf8');
const SHIPPING_EXTENSIONS = [
  'EXT_meshopt_compression',
  'KHR_mesh_quantization',
  'KHR_texture_basisu',
] as const;

const ACCEPTED_ASSETS = [
  {
    name: 'frostveil_ice_spire',
    height: 3.2,
    sha256: '607eaf953ec4454d0317ec0c0b490a2ba9096da4fc74d9e86caaa408ef05c5f4',
    materials: 1,
    glass: false,
    socket: false,
    flame: false,
  },
  {
    name: 'streetlamp_amberfall_crystal',
    height: 5.5,
    sha256: '0bc09ff610e99db7df715dbf5101e8517fd7e8d0278e2372755475be797c446f',
    materials: 3,
    glass: true,
    socket: true,
    flame: false,
  },
  {
    name: 'streetlamp_drakelands_brazier',
    height: 5.5,
    sha256: '9fe8cf7385bc3c794cbaf109b01a864392592e7c371d020c3114d14b070a654c',
    materials: 2,
    glass: false,
    socket: true,
    flame: true,
  },
  {
    name: 'streetlamp_eastbrook_civic',
    height: 5.5,
    sha256: '3b5160907428faeae3ad8379a8f325337ffd9c8c1f208a8598f6982bf20415e0',
    materials: 3,
    glass: true,
    socket: true,
    flame: true,
  },
  {
    name: 'streetlamp_evergarden_flower',
    height: 5.5,
    sha256: '84a3827897d07736c75e74e1392aa02c1af79c49466bf71a8f8c795fbac100a9',
    materials: 3,
    glass: true,
    socket: true,
    flame: false,
  },
  {
    name: 'streetlamp_farshore_coral',
    height: 5.5,
    sha256: '0033541a6120a4da5b17362f0dc37dfabdd6a8b7d1e20e3c2dd7f0cd67f79c11',
    materials: 3,
    glass: true,
    socket: true,
    flame: false,
  },
  {
    name: 'streetlamp_frostveil_icicle',
    height: 5.5,
    sha256: '85ac6e8f01443791b6ad253b0bae5bf810f1ce3340c4df43e8fcb01f07d041a0',
    materials: 3,
    glass: true,
    socket: true,
    flame: false,
  },
  {
    name: 'streetlamp_galecrest_mast',
    height: 5.5,
    sha256: '463796a266ae7a3e1992e02ea0de0a88db301b5c737c9606b20ef76d0c3b639f',
    materials: 3,
    glass: true,
    socket: true,
    flame: true,
  },
  {
    name: 'streetlamp_mirefen_witchflame',
    height: 5.5,
    sha256: 'bfb8da17a055a0b9cc6f53db6850b1ff41d378ac18467fd22afe71350fca769a',
    materials: 3,
    glass: true,
    socket: true,
    flame: true,
  },
  {
    name: 'streetlamp_nightbloom_moonflower',
    height: 5.5,
    sha256: '8e71c9717f93d0ff4a6e9ce9502741d9ca4c324a1f58a42984c926586481ef89',
    materials: 3,
    glass: true,
    socket: true,
    flame: false,
  },
  {
    name: 'streetlamp_palmreach_totem',
    height: 5.5,
    sha256: 'a9555fe643d670e19b89c2036d678549c85a1859b6bacb7aa7d59e26252843ec',
    materials: 2,
    glass: false,
    socket: true,
    flame: true,
  },
  {
    name: 'streetlamp_thornpeak_beacon',
    height: 5.5,
    sha256: '2ee14635a078fa2cb10a8bd181877e63ec979797a51d81889b3dc1397de057a3',
    materials: 3,
    glass: true,
    socket: true,
    flame: true,
  },
  {
    name: 'streetlamp_veiled_crystal',
    height: 5.5,
    sha256: 'e54add53c52729a6219a2882c21ce02ea0c3d9cacb9948a4ab7c789e692bbb32',
    materials: 3,
    glass: true,
    socket: true,
    flame: false,
  },
  {
    name: 'streetlamp_willowfen_reed',
    height: 5.5,
    sha256: '2ade5a40188423148f7c6c96da94a32919494c269c98f625dbe80c5f98f2a97c',
    materials: 3,
    glass: true,
    socket: true,
    flame: true,
  },
  {
    name: 'streetlamp_wraithwood_ghost',
    height: 5.5,
    sha256: 'd6cf06f1a113d167a5a6fe6a37ccd089732be1c051ac49b67191ac1afb1b4c30',
    materials: 3,
    glass: true,
    socket: true,
    flame: false,
  },
] as const;

interface GlbJson {
  extensions?: Record<string, unknown>;
  extensionsUsed?: string[];
  extensionsRequired?: string[];
  images?: Array<{ mimeType?: string }>;
  animations?: unknown[];
  skins?: unknown[];
  cameras?: unknown[];
}

function glbJson(bytes: Buffer): GlbJson {
  expect(bytes.toString('utf8', 0, 4)).toBe('glTF');
  const jsonLength = bytes.readUInt32LE(12);
  return JSON.parse(
    bytes
      .toString('utf8', 20, 20 + jsonLength)
      .replace(/\0+$/, '')
      .trimEnd(),
  ) as GlbJson;
}

describe('accepted Tripo streetlamp and Frostveil ice asset wave', () => {
  it('keeps the runtime preload catalog exhaustive and tier independent', () => {
    const runtimeUrls = [
      ...Object.values(streetlampPreloadInternalsForTest.assetDefs).map((def) => def.url),
      frostIcePreloadInternalsForTest.assetUrl,
    ].sort();
    expect(runtimeUrls).toHaveLength(15);
    expect(new Set(runtimeUrls)).toHaveLength(15);
    expect(runtimeUrls).toEqual(
      ACCEPTED_ASSETS.map(({ name }) => `/models/props/${name}.glb`).sort(),
    );
  });

  it('keeps every lamp burning the same warm light, tinted but never off-hue', () => {
    // The whole road network should read as one kind of night. A biome tints
    // its own fixture, but only as a lean off Eastbrook's amber: without this
    // the palette silently drifts back to saturated per-biome colours and a
    // witchflame road stops matching a civic one.
    // Compared on the raw sRGB bytes the palette is authored in. THREE.Color
    // would convert them into the linear working space and the numbers below
    // would no longer be the ones a reader can check against the hex.
    const channels = (hex: number): [number, number, number] => [
      ((hex >> 16) & 255) / 255,
      ((hex >> 8) & 255) / 255,
      (hex & 255) / 255,
    ];
    const hue = ([r, g, b]: readonly [number, number, number]): number => {
      const max = Math.max(r, g, b);
      const delta = max - Math.min(r, g, b);
      if (delta < 1e-6) return 0;
      const raw =
        max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
      return (((raw * 60) % 360) + 360) % 360;
    };

    const defs = streetlampPreloadInternalsForTest.assetDefs;
    const warmHue = hue(channels(defs.eastbrook_civic.lightColor));

    for (const [style, def] of Object.entries(defs)) {
      const light = channels(def.lightColor);
      const drift = Math.abs(hue(light) - warmHue);
      expect(
        Math.min(drift, 360 - drift),
        `${style} hue drift from the warm key`,
      ).toBeLessThanOrEqual(18);
      expect(light[0], `${style} stays red-dominant`).toBeGreaterThan(light[2]);
      expect(Math.max(...light), `${style} reads as a bright light`).toBeGreaterThan(0.8);

      // The field colour drives the ground light and must agree with the
      // fixture's own colour, or a lamp lights the road a different colour
      // than it visibly burns.
      const [r, g, b] = def.fieldColor;
      expect(r, `${style} field red`).toBeCloseTo(light[0], 1);
      expect(g, `${style} field green`).toBeCloseTo(light[1], 1);
      expect(b, `${style} field blue`).toBeCloseTo(light[2], 1);
    }
  });

  it('drives every authored emitter to the calibrated side of the bloom knee', async () => {
    // The lantern has to read as the thing lighting the road, which means the
    // emitter must CLEAR the bloom high-pass while its pane stays under it (a
    // blooming pane washes the housing out). Both sides are gain times the
    // AUTHORED luma, so a gain retune and a repalette can each break it; this
    // checks the product on the shipped bytes rather than either number alone.
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    // post.ts's own threshold, read rather than copied: a retune there must not
    // leave this calibration silently stale.
    const post = readFileSync(path.join(ROOT, 'src/render/post.ts'), 'utf8');
    const knee = Number(/const BLOOM_THRESHOLD = ([\d.]+)/.exec(post)?.[1]);
    expect(knee, 'post.ts BLOOM_THRESHOLD').toBeGreaterThan(0);
    const { roleGain } = streetlampEmissiveInternalsForTest;
    const luma = (rgb: readonly number[]): number =>
      0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];

    let emitters = 0;
    let panes = 0;
    for (const accepted of ACCEPTED_ASSETS) {
      const document = await io.read(
        path.join(ROOT, 'public', `models/props/${accepted.name}.glb`),
      );
      for (const material of document.getRoot().listMaterials()) {
        const role = streetlampEmissiveRole(material.getName());
        if (!role) continue;
        const strength =
          material
            .getExtension<EmissiveStrength>('KHR_materials_emissive_strength')
            ?.getEmissiveStrength() ?? 1;
        const lit = luma(material.getEmissiveFactor()) * strength * roleGain[role];
        if (role === 'glass') {
          expect(lit, `${accepted.name} pane under the knee`).toBeLessThan(knee);
          panes++;
        } else {
          expect(lit, `${accepted.name} emitter clears the knee`).toBeGreaterThan(knee);
          // and stays short of the wash-out: driven far past the knee, ACES
          // desaturates a warm emitter into a white blob with a warm rim (the
          // first pass did exactly that at gain 7.5, near luma 3.5).
          expect(lit, `${accepted.name} emitter keeps its hue`).toBeLessThan(3);
          emitters++;
        }
      }
    }
    // every lamp in the wave contributed, and the panes are not all missing
    expect(emitters).toBe(ACCEPTED_ASSETS.filter((a) => a.socket).length);
    expect(panes).toBe(ACCEPTED_ASSETS.filter((a) => a.glass).length);
  });

  it('pins the reviewed bytes, optimized topology, KTX2 textures, and grounded bounds', async () => {
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    let totalBytes = 0;

    for (const accepted of ACCEPTED_ASSETS) {
      const relativePath = `models/props/${accepted.name}.glb`;
      const assetPath = path.join(ROOT, 'public', relativePath);
      const bytes = readFileSync(assetPath);
      totalBytes += bytes.length;
      expect(createHash('sha256').update(bytes).digest('hex'), accepted.name).toBe(accepted.sha256);
      expect(bytes.length, `${accepted.name} shipping bytes`).toBeLessThanOrEqual(128 * 1024);
      expect(MEDIA_ASSETS[relativePath]).toBe(
        `/media/models/props/${accepted.name}.${accepted.sha256.slice(0, 12)}.glb`,
      );
      expect(CREDITS).toContain(
        `| Generated prop model (${accepted.name}) | World of ClaudeCraft | Project-generated via scripts/asset_pipeline (Tripo AI 3D) | Project asset | With the project only |`,
      );

      const json = glbJson(bytes);
      expect([...(json.extensionsUsed ?? [])].sort()).toEqual(SHIPPING_EXTENSIONS);
      expect([...(json.extensionsRequired ?? [])].sort()).toEqual(SHIPPING_EXTENSIONS);
      expect(json.extensions ?? {}).not.toHaveProperty('KHR_lights_punctual');
      expect(json.images).toEqual([
        {
          bufferView: expect.any(Number),
          mimeType: 'image/ktx2',
          name: expect.any(String),
        },
        {
          bufferView: expect.any(Number),
          mimeType: 'image/ktx2',
          name: expect.any(String),
        },
        {
          bufferView: expect.any(Number),
          mimeType: 'image/ktx2',
          name: expect.any(String),
        },
      ]);
      expect(json.animations ?? []).toHaveLength(0);
      expect(json.skins ?? []).toHaveLength(0);
      expect(json.cameras ?? []).toHaveLength(0);

      const document = await io.readBinary(bytes);
      const root = document.getRoot();
      expect(root.listScenes()).toHaveLength(1);
      expect(root.listMeshes()).toHaveLength(1);
      expect(root.listTextures()).toHaveLength(3);

      // Illumination is AUTHORED: a lamp carries its housing material plus the
      // named emitter (and pane, where the design has glass). The names are the
      // runtime contract that streetlamp_emissive.ts classifies on, so pin them.
      const materialNames = root
        .listMaterials()
        .map((material) => material.getName())
        .sort();
      expect(materialNames, `${accepted.name} materials`).toHaveLength(accepted.materials);
      const authored = materialNames.filter((name) => name.startsWith('LAMP_'));
      // `socket` marks the lamps; the ice spire ships in this wave but is not a
      // light fixture and must carry no emitter at all. A fire is named apart
      // from a steady crystal or bulb because that name is what makes the
      // runtime animate it (streetlamp_flame.ts).
      const emitter = accepted.flame ? 'LAMP_FLAME' : 'LAMP_SOURCE';
      const expectedAuthored = !accepted.socket
        ? []
        : accepted.glass
          ? [emitter, 'LAMP_GLASS'].sort()
          : [emitter];
      expect(authored, `${accepted.name} authored materials`).toEqual(expectedAuthored);

      const primitives = root.listMeshes()[0].listPrimitives();
      expect(primitives, `${accepted.name} primitives`).toHaveLength(accepted.materials);
      let triangles = 0;
      for (const primitive of primitives) {
        expect(primitive.getMode()).toBe(Primitive.Mode.TRIANGLES);
        const position = primitive.getAttribute('POSITION');
        if (!position) throw new Error(`${accepted.name} lost POSITION data`);
        triangles += (primitive.getIndices()?.getCount() ?? position.getCount()) / 3;
      }
      expect(triangles, `${accepted.name} triangle ceiling`).toBeLessThanOrEqual(1_250);

      // The authored LIGHT_SOCKET: the anchor the runtime lights and projects
      // from. It must exist, carry its flag, and sit inside the fixture, or a
      // hanging lantern silently lights the ground beside its own post.
      const socket = root.listNodes().find((node) => node.getName() === 'LIGHT_SOCKET');
      if (accepted.socket) {
        if (!socket) throw new Error(`${accepted.name} lost its LIGHT_SOCKET`);
        expect(socket.getExtras(), `${accepted.name} socket flag`).toMatchObject({
          woc_light_socket: true,
        });
        expect(socket.listChildren(), `${accepted.name} socket is a bare anchor`).toHaveLength(0);
        expect(socket.getMesh(), `${accepted.name} socket draws nothing`).toBeNull();
      } else {
        expect(socket, `${accepted.name} needs no socket`).toBeUndefined();
      }

      const bounds = getBounds(root.listScenes()[0]);
      expect(bounds.min[1], `${accepted.name} floor`).toBeCloseTo(0, 3);
      expect(bounds.max[1] - bounds.min[1], `${accepted.name} height`).toBeCloseTo(
        accepted.height,
        3,
      );
      expect((bounds.min[0] + bounds.max[0]) * 0.5, `${accepted.name} X center`).toBeCloseTo(0, 3);
      expect((bounds.min[2] + bounds.max[2]) * 0.5, `${accepted.name} Z center`).toBeCloseTo(0, 3);
    }

    expect(totalBytes).toBe(1_457_460);
    expect(totalBytes).toBeLessThanOrEqual(1.5 * 1024 * 1024);
  });
});
