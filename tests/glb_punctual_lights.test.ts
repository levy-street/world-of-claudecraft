import { closeSync, openSync, readdirSync, readSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// three's GLTFLoader builds a PointLight for every KHR_lights_punctual light a
// GLB declares, inside node_modules where no source scan can see it. In the
// world scene such a light is gathered beside the point-light carriers: the
// light count moves (every lit program relinks) and the light sits after a
// black carrier, where the lit programs' point loop has already stopped, so it
// never shines. The only route that handles one is a placed GLB
// (src/render/placed_assets.ts registers its lights with the budget); every
// shipped asset must carry none.

const PUBLIC_ROOT = fileURLToPath(new URL('../public', import.meta.url));
const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;

/** Every .glb under `dir`, recursively, sorted within each directory. */
function glbFilesUnder(dir: string): string[] {
  const out: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...glbFilesUnder(full));
    else if (entry.name.endsWith('.glb')) out.push(full);
  }
  return out;
}

/** The JSON chunk alone: the 20-byte header says how long it is, so the
 *  binary buffer is never read. */
function glbJsonText(file: string): string {
  const fd = openSync(file, 'r');
  try {
    const header = Buffer.alloc(20);
    readSync(fd, header, 0, 20, 0);
    expect(header.readUInt32LE(0), `${file} is not a GLB`).toBe(GLB_MAGIC);
    expect(header.readUInt32LE(16), `${file} does not open with a JSON chunk`).toBe(JSON_CHUNK);
    const length = header.readUInt32LE(12);
    const json = Buffer.alloc(length);
    readSync(fd, json, 0, length, 20);
    return json.toString('utf8');
  } finally {
    closeSync(fd);
  }
}

function declaresPunctualLights(json: string): boolean {
  const gltf = JSON.parse(json) as {
    extensionsUsed?: string[];
    extensions?: Record<string, unknown>;
  };
  return (
    (gltf.extensionsUsed ?? []).includes('KHR_lights_punctual') ||
    Object.hasOwn(gltf.extensions ?? {}, 'KHR_lights_punctual')
  );
}

describe('shipped GLBs carry no glTF punctual lights', () => {
  it('declares KHR_lights_punctual in no GLB under public/', () => {
    const files = glbFilesUnder(PUBLIC_ROOT);
    // Vacuity floor near the real set: a walk that quietly narrowed would
    // pass over nothing.
    expect(files.length).toBeGreaterThan(1300);
    const offenders = files
      .filter((file) => declaresPunctualLights(glbJsonText(file)))
      .map((file) => path.relative(PUBLIC_ROOT, file));
    expect(
      offenders,
      'these GLBs declare glTF point lights, which three gathers beside the carriers. Strip the lights at export and author the light in code through the budget (src/render/CLAUDE.md)',
    ).toEqual([]);
  });

  it('detects the extension wherever the JSON declares it (positive control)', () => {
    expect(declaresPunctualLights('{"extensionsUsed":["KHR_lights_punctual"]}')).toBe(true);
    expect(declaresPunctualLights('{"extensions":{"KHR_lights_punctual":{"lights":[]}}}')).toBe(
      true,
    );
    expect(declaresPunctualLights('{"extensionsUsed":["KHR_texture_basisu"]}')).toBe(false);
    expect(declaresPunctualLights('{"asset":{"version":"2.0"}}')).toBe(false);
  });
});
