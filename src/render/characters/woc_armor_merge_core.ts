// The pure half of the merged WOC armor (woc_armor_merge.ts draws it): which of the
// armor meshes a character draws fold into one draw, and the identity a merged
// geometry is cached under. Three-free and DOM-free, so a Vitest reads the same
// rules the fold applies.
//
// Why a merge at all: a set's file is one mesh per part (the shoulders and a helm are
// rigid meshes hung on their bones; a hood, the waist, the boots, the chest and the
// gauntlets are skinned), and a kit shares one to three materials between them (the
// set's atlas, cut by its specular factor). Measured on 2026-10-02 a full kit drew 7
// armor meshes in the colour pass and 7 more in the shadow pass, per character. What
// keeps two parts apart is only their MATERIAL: parts on one file material draw with
// the same program and the same uniforms, so they fold into one skinned mesh on the
// body's skeleton, a rigid part becoming vertices weighted to its bone.
//
// A batch is the drawn parts sharing one file material AND everything else a draw
// has one of (the vertex attributes its program reads, its draw order, its layers,
// whether it casts): the layout string, opaque here. A batch of one is left alone
// (nothing to gain), and a part that cannot fold keeps drawing by itself.

/** The vertex attributes a merged part carries besides its position, in the order the
 *  layout lists them, with the item sizes the fold writes (three's built-in programs
 *  read no other attribute). */
export const WOC_ARMOR_MERGE_ATTRIBUTES: ReadonlyMap<string, readonly number[]> = new Map([
  ['normal', [3]],
  ['uv', [2]],
  ['uv1', [2]],
  ['uv2', [2]],
  ['uv3', [2]],
  ['tangent', [4]],
  ['color', [3, 4]],
]);

/** The skin attributes: a skinned part's are carried, a rigid part's are minted (all
 *  of its weight on the bone it rides), so neither enters the layout. */
const SKIN_ATTRIBUTES: ReadonlySet<string> = new Set(['skinIndex', 'skinWeight']);

/** What the layout reads off one drawn armor mesh. */
export interface WocArmorMergeLayoutFacts {
  /** Its geometry's attributes: name to item size. */
  readonly attributes: Readonly<Record<string, number>>;
  readonly renderOrder: number;
  /** Its layer mask as it draws (never the zero a standing stand-in left on it). */
  readonly layers: number;
  /** Whether it belongs in the shadow-caster set (shadow_policy.ts). */
  readonly caster: boolean;
}

/**
 * Everything two parts on one material must still agree on to share a draw, as one
 * string (equal strings agree): the attributes carried in a fixed order with their
 * item sizes, the draw order, the layers and the caster flag. Null for a mesh no
 * merged draw can carry: no 3-component position, a carried attribute at an item size
 * the fold does not write, or an attribute outside the carried set (a custom shader's
 * input, which a merged buffer would silently drop).
 */
export function wocArmorMergeLayout(facts: WocArmorMergeLayoutFacts): string | null {
  const sizes = new Map(Object.entries(facts.attributes));
  if (sizes.get('position') !== 3) return null;
  for (const [name, size] of sizes) {
    if (name === 'position' || SKIN_ATTRIBUTES.has(name)) continue;
    if (!WOC_ARMOR_MERGE_ATTRIBUTES.get(name)?.includes(size)) return null;
  }
  const carried: string[] = [];
  for (const name of WOC_ARMOR_MERGE_ATTRIBUTES.keys()) {
    const size = sizes.get(name);
    if (size !== undefined) carried.push(`${name}${size}`);
  }
  return `${carried.join(',')}|${facts.renderOrder}|${facts.layers}|${facts.caster ? 'c' : 'n'}`;
}

/** What the batching reads off one drawn armor mesh. */
export interface WocArmorMergeFacts {
  /** Identity of the FILE material the mesh hangs with (its uuid): two parts on one
   *  file material derive the same tier material and draw with the same uniforms. */
  readonly material: string;
  /** Its layout (wocArmorMergeLayout). */
  readonly layout: string;
  /** Whether it can fold at all (an opaque, depth-writing, single-material mesh whose
   *  vertices convert into the body's bind). */
  readonly foldable: boolean;
}

/**
 * The batches of a character's drawn armor meshes: each a list of input indices that
 * fold into one draw, the members in input order and the batches in first-seen order.
 * Only batches of two or more: a mesh in none keeps drawing by itself.
 */
export function wocArmorMergeBatches(meshes: readonly WocArmorMergeFacts[]): number[][] {
  const byKey = new Map<string, number[]>();
  for (const [i, mesh] of meshes.entries()) {
    if (!mesh.foldable) continue;
    const key = `${mesh.material}|${mesh.layout}`;
    const batch = byKey.get(key);
    if (batch) batch.push(i);
    else byKey.set(key, [i]);
  }
  return [...byKey.values()].filter((batch) => batch.length > 1);
}

/** How one part's vertices are converted on their way into a merged buffer. */
export interface WocArmorMergeBakeFacts {
  /** Its vertex space to the body's bind space (a 4x4, column major); null: none. */
  readonly matrix: readonly number[] | null;
  /** Its normals' conversion (a 3x3, column major); null: none. */
  readonly normal: readonly number[] | null;
  /** A skinned part's joint renumbering into the body's bone order; null: none. */
  readonly joints: readonly number[] | null;
  /** A mirrored rigid part: its winding is flipped. */
  readonly flip: boolean;
}

/**
 * The part of a merged buffer's identity a part's conversion decides, as given (the
 * numbers themselves, never a hash: two conversions that differ at all bake different
 * vertices). Empty for a part copied as stored, the shipped skinned parts' case.
 */
export function wocArmorMergeBake(facts: WocArmorMergeBakeFacts): string {
  const out: string[] = [];
  if (facts.matrix) out.push(`m${facts.matrix.join(',')}`);
  if (facts.normal) out.push(`n${facts.normal.join(',')}`);
  if (facts.joints) out.push(`j${facts.joints.join(',')}`);
  if (facts.flip) out.push('f');
  return out.join(';');
}

/** One folded part in a merged geometry's identity. */
export interface WocArmorMergeKeyPart {
  /** The shared geometry it draws (a set's geometry is one object per part). */
  readonly geometry: string;
  /** The file material it hangs with. */
  readonly material: string;
  /** The joint a rigid part is weighted to (its index in the body's bone order); null
   *  for a skinned part. */
  readonly bone: number | null;
  /** Its conversion (wocArmorMergeBake). */
  readonly bake: string;
}

/**
 * The identity of a merged GEOMETRY: the parts it folds, in order. Two characters
 * answering the same key draw one shared buffer (the same kit on the same body fit);
 * a part more, a part less or another part gives another key.
 */
export function wocArmorMergeKey(parts: readonly WocArmorMergeKeyPart[]): string {
  return parts
    .map((p) => `${p.geometry}:${p.material}:${p.bone === null ? 's' : `r${p.bone}`}:${p.bake}`)
    .join('|');
}

/** Whether a node's scale is the same size on every axis (a mirror is: the sign of an
 *  axis is not its size). */
export function wocScaleIsUniform(x: number, y: number, z: number, eps = 1e-5): boolean {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const az = Math.abs(z);
  const tolerance = eps * Math.max(ax, ay, az, 1);
  return Math.abs(ax - ay) <= tolerance && Math.abs(ay - az) <= tolerance;
}

const IDENTITY_4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Whether a 4x4 (column major) is exactly the identity: a part whose conversion is
 *  one is copied as stored, bit for bit. */
export function wocMatrixIsIdentity(elements: readonly number[]): boolean {
  for (let i = 0; i < 16; i++) if (elements[i] !== IDENTITY_4[i]) return false;
  return true;
}
