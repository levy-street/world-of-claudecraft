// Tiny GLBs carrying WOC_lod, written with gltf-transform (the writer the split build uses), for
// the suites that parse them back through GLTFLoader and the runtime's plugin
// (src/render/assets/woc_lod_plugin.ts). The extension here is a WRITER only, to the contract:
// per primitive `{ levels: [{ indices: <accessor>, maxDeviation }] }`, mid first then far, in
// `extensionsUsed` and never `extensionsRequired`.
//
// Each level accessor hangs off its primitive's extension property by a graph edge that says it
// is INDEX data (usage ELEMENT_ARRAY_BUFFER, the way gltf-transform's own instancing extension
// tags its attributes). No primitive references a level as its index, so without that tag
// gltf-transform files the accessor under usage OTHER, and its meshopt writer encodes such an
// accessor as a vertex stream padded to a 4-byte stride without recording the stride: a 16-bit
// list reads back with a zero after every entry (geometry_lod_core.ts LOD_MAX_DEGENERATE_SHARE).
// The tag rides the graph, so it holds whatever order the writer runs its extensions in (marking
// usage in a prewrite does not: the meshopt writer, sorted first, has filed the accessor by
// then). `markIndexUsage: false` writes it the broken way, for the suite that pins the guard.
import {
  type Accessor,
  Document,
  Extension,
  ExtensionProperty,
  type IProperty,
  NodeIO,
  type Nullable,
  PropertyType,
  RefList,
  WriterContext,
} from '@gltf-transform/core';
import { EXTMeshoptCompression } from '@gltf-transform/extensions';
import { MeshoptEncoder } from 'meshoptimizer';

export const WOC_LOD = 'WOC_lod';

interface ILevels extends IProperty {
  levels: RefList<Accessor>;
}

/** One primitive's level list (mid first then far, or far alone). */
export class WocLodLevels extends ExtensionProperty<ILevels> {
  static EXTENSION_NAME = WOC_LOD;
  declare extensionName: typeof WOC_LOD;
  declare propertyType: 'WocLodLevels';
  declare parentTypes: [PropertyType.PRIMITIVE];

  protected init(): void {
    this.extensionName = WOC_LOD;
    this.propertyType = 'WocLodLevels';
    this.parentTypes = [PropertyType.PRIMITIVE];
  }

  protected getDefaults(): Nullable<ILevels> {
    return Object.assign(super.getDefaults() as Nullable<IProperty>, {
      levels: new RefList<Accessor>(),
    });
  }

  /** Append a level, tagged as index data unless `asIndex` is false (the broken way). */
  addLevel(accessor: Accessor, asIndex = true): this {
    return this.addRef(
      'levels',
      accessor,
      asIndex ? { usage: WriterContext.BufferViewUsage.ELEMENT_ARRAY_BUFFER } : undefined,
    );
  }

  listLevels(): Accessor[] {
    return this.listRefs('levels');
  }
}

/** The WOC_lod writer: each primitive's level list, by its accessors' written indices. */
export class WocLodWriter extends Extension {
  static readonly EXTENSION_NAME = WOC_LOD;
  readonly extensionName = WOC_LOD;

  createLevels(): WocLodLevels {
    return new WocLodLevels(this.document.getGraph());
  }

  read(): this {
    return this;
  }

  write(context: WriterContext): this {
    const json = context.jsonDoc.json;
    for (const mesh of this.document.getRoot().listMeshes()) {
      const at = context.meshIndexMap.get(mesh);
      const meshDef = at === undefined ? undefined : json.meshes?.[at];
      if (!meshDef) continue;
      mesh.listPrimitives().forEach((primitive, i) => {
        const levels = primitive.getExtension<WocLodLevels>(WOC_LOD);
        const def = meshDef.primitives[i];
        if (!levels || !def) return;
        def.extensions = {
          ...(def.extensions ?? {}),
          [WOC_LOD]: {
            levels: levels.listLevels().map((accessor, n) => ({
              indices: context.accessorIndexMap.get(accessor),
              maxDeviation: 0.01 * (n + 1),
            })),
          },
        };
      });
    }
    return this;
  }
}

/** One primitive of a fixture GLB: its positions, its own index, and the level lists it
 *  ships (in file order: mid first then far, or far alone). */
export interface FixturePrimitive {
  readonly positions: readonly number[];
  readonly index: readonly number[];
  readonly levels?: readonly (readonly number[])[];
  /** Write the index (and level lists) 32-bit. */
  readonly wide?: boolean;
}

export interface FixtureMesh {
  readonly name: string;
  readonly primitives: readonly FixturePrimitive[];
}

/** A GLB of these meshes, one node each, as an ArrayBuffer GLTFLoader parses. */
export async function wocLodGlb(
  meshes: readonly FixtureMesh[],
  opts: { meshopt?: boolean; markIndexUsage?: boolean } = {},
): Promise<ArrayBuffer> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene();
  const writer = meshes.some((m) => m.primitives.some((p) => p.levels?.length))
    ? doc.createExtension(WocLodWriter)
    : null;
  const list = (values: readonly number[], wide = false): Accessor =>
    doc
      .createAccessor()
      .setType('SCALAR')
      .setArray(wide ? new Uint32Array(values) : new Uint16Array(values))
      .setBuffer(buffer);
  for (const spec of meshes) {
    const mesh = doc.createMesh(spec.name);
    for (const p of spec.primitives) {
      const position = doc
        .createAccessor()
        .setType('VEC3')
        .setArray(new Float32Array(p.positions))
        .setBuffer(buffer);
      const primitive = doc
        .createPrimitive()
        .setAttribute('POSITION', position)
        .setIndices(list(p.index, p.wide));
      if (writer && p.levels?.length) {
        const levels = writer.createLevels();
        for (const values of p.levels) {
          levels.addLevel(list(values, p.wide), opts.markIndexUsage !== false);
        }
        primitive.setExtension(WOC_LOD, levels);
      }
      mesh.addPrimitive(primitive);
    }
    scene.addChild(doc.createNode(spec.name).setMesh(mesh));
  }
  const io = new NodeIO().registerExtensions([WocLodWriter, EXTMeshoptCompression]);
  if (opts.meshopt) {
    await MeshoptEncoder.ready;
    io.registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
    doc.createExtension(EXTMeshoptCompression).setRequired(true);
  }
  const glb = await io.writeBinary(doc);
  return glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer;
}

/** The JSON chunk of a GLB (what a fixture wrote, as the loader reads it). */
export function glbJson(glb: ArrayBuffer): {
  extensionsUsed?: string[];
  extensionsRequired?: string[];
  meshes?: { primitives: { extensions?: Record<string, unknown> }[] }[];
} {
  const view = new DataView(glb);
  const length = view.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(new Uint8Array(glb, 20, length)));
}

/** The same GLB with its JSON chunk rewritten by `edit` (the binary chunk as is). */
export function patchGlbJson(
  glb: ArrayBuffer,
  edit: (json: Record<string, unknown> & ReturnType<typeof glbJson>) => void,
): ArrayBuffer {
  const view = new DataView(glb);
  const length = view.getUint32(12, true);
  const json = glbJson(glb) as Record<string, unknown> & ReturnType<typeof glbJson>;
  edit(json);
  let text = JSON.stringify(json);
  while (text.length % 4) text += ' ';
  const chunk = new TextEncoder().encode(text);
  const rest = new Uint8Array(glb, 20 + length);
  const out = new Uint8Array(20 + chunk.length + rest.length);
  const head = new DataView(out.buffer);
  head.setUint32(0, 0x46546c67, true);
  head.setUint32(4, 2, true);
  head.setUint32(8, out.length, true);
  head.setUint32(12, chunk.length, true);
  head.setUint32(16, 0x4e4f534a, true);
  out.set(chunk, 20);
  out.set(rest, 20 + chunk.length);
  return out.buffer;
}

/** A grid of `cells` quads in a row: 2 * (cells + 1) vertices, 2 * cells triangles. */
export function quadRow(cells: number): { positions: number[]; index: number[] } {
  const positions: number[] = [];
  for (let i = 0; i <= cells; i++) positions.push(i, 0, 0, i, 1, 0);
  const index: number[] = [];
  for (let i = 0; i < cells; i++) {
    const a = i * 2;
    index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  return { positions, index };
}
