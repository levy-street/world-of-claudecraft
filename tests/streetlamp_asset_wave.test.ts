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

// `kit` rows are the hand-built painted lamps (scripts/assets/eastbrook_houses/props_lamps.py
// zone_lamp, built over the release path on quarter-size maps): they wear the kit's own
// sheets, so their texture and material counts are their own, and every one burns a flame
// behind glass. The other rows are the release's Tripo fixtures, kept where they looked
// better than the kit's lamp, and in the Drakelands.
const ACCEPTED_ASSETS = [
  {
    name: 'frostveil_ice_spire',
    height: 3.2,
    sha256: '607eaf953ec4454d0317ec0c0b490a2ba9096da4fc74d9e86caaa408ef05c5f4',
    materials: 1,
    textures: 3,
    glass: false,
    socket: false,
    flame: false,
    kit: false,
  },
  {
    name: 'streetlamp_amberfall_crystal',
    height: 5.5,
    sha256: 'c501b2402d74408fb6d84abb6c5a6665b22cc3240a5ae37f0c8a3ecbcd309d89',
    materials: 4,
    textures: 3,
    glass: true,
    socket: true,
    flame: true,
    kit: true,
  },
  {
    name: 'streetlamp_drakelands_brazier',
    height: 5.5,
    sha256: '9fe8cf7385bc3c794cbaf109b01a864392592e7c371d020c3114d14b070a654c',
    materials: 2,
    textures: 3,
    glass: false,
    socket: true,
    flame: true,
    kit: false,
  },
  {
    name: 'streetlamp_eastbrook_civic',
    height: 5.5,
    sha256: '892cc4a627f540bdfd88de2a57ab0016a0eaa46c3a66ef28b953cc8e15203ec4',
    materials: 4,
    textures: 3,
    glass: true,
    socket: true,
    flame: true,
    kit: true,
  },
  {
    name: 'streetlamp_evergarden_flower',
    height: 5.5,
    sha256: '463e9617c70fe98d1f236760dc2ce34d21bf87dbfac6d8c1d11b4e6bc1921950',
    materials: 5,
    textures: 4,
    glass: true,
    socket: true,
    flame: true,
    kit: true,
  },
  {
    name: 'streetlamp_farshore_coral',
    height: 5.5,
    sha256: '0033541a6120a4da5b17362f0dc37dfabdd6a8b7d1e20e3c2dd7f0cd67f79c11',
    materials: 3,
    textures: 3,
    glass: true,
    socket: true,
    flame: false,
    kit: false,
  },
  {
    name: 'streetlamp_frostveil_icicle',
    height: 5.5,
    sha256: '71648b51d8ba8d276ec9d37628570b7a5c6bc7c33dbc852955e5d3c2f39be9d6',
    materials: 5,
    textures: 4,
    glass: true,
    socket: true,
    flame: true,
    kit: true,
  },
  {
    name: 'streetlamp_galecrest_mast',
    height: 5.5,
    sha256: '13e199cf7ccd6a114faaf3b30ee6ec2d171485f300134619523b441cd29d1e5b',
    materials: 3,
    textures: 2,
    glass: true,
    socket: true,
    flame: true,
    kit: true,
  },
  {
    name: 'streetlamp_mirefen_witchflame',
    height: 5.5,
    sha256: 'bfb8da17a055a0b9cc6f53db6850b1ff41d378ac18467fd22afe71350fca769a',
    materials: 3,
    textures: 3,
    glass: true,
    socket: true,
    flame: true,
    kit: false,
  },
  {
    name: 'streetlamp_nightbloom_moonflower',
    height: 5.5,
    sha256: 'b29ab475d85234ba0ece99e15bd543139aab78452a6ab77def39891b05d5187a',
    materials: 4,
    textures: 3,
    glass: true,
    socket: true,
    flame: true,
    kit: true,
  },
  {
    name: 'streetlamp_palmreach_totem',
    height: 5.5,
    sha256: '0f387548729d1fee213fb7749723853709d9435b9ba32b72e75f791d6ee0afc0',
    materials: 3,
    textures: 2,
    glass: true,
    socket: true,
    flame: true,
    kit: true,
  },
  {
    name: 'streetlamp_thornpeak_beacon',
    height: 5.5,
    sha256: '2ee14635a078fa2cb10a8bd181877e63ec979797a51d81889b3dc1397de057a3',
    materials: 3,
    textures: 3,
    glass: true,
    socket: true,
    flame: true,
    kit: false,
  },
  {
    name: 'streetlamp_veiled_crystal',
    height: 5.5,
    sha256: 'e75867d3820fb951ba0e9db2ec4c7ccb50a751844e3563fcb380a9d01ebf9e9b',
    materials: 4,
    textures: 3,
    glass: true,
    socket: true,
    flame: true,
    kit: true,
  },
  {
    name: 'streetlamp_willowfen_reed',
    height: 5.5,
    sha256: 'fec11b43a0af526618bdbf0f5ea377e8ee2abec534152b03f29736dc11be3a78',
    materials: 3,
    textures: 2,
    glass: true,
    socket: true,
    flame: true,
    kit: true,
  },
  {
    name: 'streetlamp_wraithwood_ghost',
    height: 5.5,
    sha256: '0fe1ffd69277032fb0040f4855b57b8e40f4a12246bdfe08bc25d002a447d09d',
    materials: 4,
    textures: 3,
    glass: true,
    socket: true,
    flame: true,
    kit: true,
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

describe('accepted streetlamp and Frostveil ice asset wave', () => {
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
        accepted.kit
          ? `| Hand-built prop model (${accepted.name}) | World of ClaudeCraft | Project-made: hand-built painted kit (\`scripts/assets/eastbrook_houses/\``
          : `| Generated prop model (${accepted.name}) | World of ClaudeCraft | Project-generated via scripts/asset_pipeline (Tripo AI 3D) | Project asset | With the project only |`,
      );

      const json = glbJson(bytes);
      expect([...(json.extensionsUsed ?? [])].sort()).toEqual(SHIPPING_EXTENSIONS);
      expect([...(json.extensionsRequired ?? [])].sort()).toEqual(SHIPPING_EXTENSIONS);
      expect(json.extensions ?? {}).not.toHaveProperty('KHR_lights_punctual');
      expect(json.images).toEqual(
        Array.from({ length: accepted.textures }, () => ({
          bufferView: expect.any(Number),
          mimeType: 'image/ktx2',
          name: expect.any(String),
        })),
      );
      expect(json.animations ?? []).toHaveLength(0);
      expect(json.skins ?? []).toHaveLength(0);
      expect(json.cameras ?? []).toHaveLength(0);

      const document = await io.readBinary(bytes);
      const root = document.getRoot();
      expect(root.listScenes()).toHaveLength(1);
      expect(root.listMeshes()).toHaveLength(1);
      expect(root.listTextures()).toHaveLength(accepted.textures);

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

    expect(totalBytes).toBe(1_525_052);
    expect(totalBytes).toBeLessThanOrEqual(1.5 * 1024 * 1024);
  });
});
