// Which merged WOC head may skip its compile gate (woc_head_dressing.ts revealMerged),
// answered by the gate's OWN readiness proof and nothing else.
//
// Every merged head wraps a per-character clone of one tier material (its colours and
// slot rows are uniforms of its own), and every clone of one tier material and one
// sidedness variant draws with ONE program. So once a head of that program has stood
// behind the compile gate, the next one links nothing, and a crowd arriving in the
// same face would otherwise queue forty gates behind each other for a program the
// first of them linked. That is the saving.
//
// What it must never be is a page-wide "this program is linked" bit: three releases a
// program with the last material that holds it, a lost context takes every program
// with it, and a bit that outlives either sends the next head to a live frame to link
// there. So nothing is remembered as true here. What is kept is the WITNESS of the
// last proven reveal: the mesh it was taken on, the material that mesh wore, and the
// gate's readiness proof for it (the renderer hands compileTargetPrepared over its
// context's own settle record: src/render/compile_target_readiness.ts), which is
// asked AGAIN every time a head wants to skip. It answers for this context as it is
// now: after a context restore, a renderer rebuild, or once the witness's material
// was disposed (so its program may be gone), it says no, the witness is dropped, and
// the head takes the gate, becoming the next witness. A host that hands no proof (no
// renderer behind the body, or no way to prove a link) leaves no witness: nothing
// skips there, and nothing needs to. A body that is disposed lets go of its witness
// there and then (dropWocMergedProof), so a witness never keeps a dead body's mesh, or
// the renderer behind its proof, alive until somebody happens to ask.
//
// Three-free and DOM-free (RENDER_PURE_CORES, tests/architecture.test.ts): the mesh
// and the material are read structurally.

/** The last proven reveal of one merged head program. */
export interface WocMergedProofWitness {
  /** The merged mesh the gate proved. */
  readonly holder: { readonly material: unknown };
  /** The material it wore when the gate settled prepared (the plain merged wrap). */
  readonly material: object;
  /** The gate's own readiness proof for that reveal: asked again at every use. */
  readonly ready: () => boolean;
}

/** Tier material a merged head was wrapped from -> sidedness variant -> its witness. */
const witnesses = new WeakMap<object, Map<number, WocMergedProofWitness>>();

/** Keep the witness of a reveal the gate just proved, for the program `variant` of the
 *  merged wraps of `source`. The newest proof replaces the one before it. */
export function recordWocMergedProof(
  source: object,
  variant: number,
  witness: WocMergedProofWitness,
): void {
  let byVariant = witnesses.get(source);
  if (!byVariant) {
    byVariant = new Map();
    witnesses.set(source, byVariant);
  }
  byVariant.set(variant, witness);
}

/**
 * Let go of the witness of this program if it is the one wearing `material`: its body is
 * being disposed (or stops merging), so it could only answer no from here on, and until
 * somebody asked it would keep its mesh, its buffers and the renderer behind its proof
 * alive. Another body's witness is left alone.
 */
export function dropWocMergedProof(source: object, variant: number, material: object): void {
  const byVariant = witnesses.get(source);
  if (byVariant?.get(variant)?.material === material) byVariant.delete(variant);
}

/**
 * Whether a merged head of this program can draw without linking: a witness of it still
 * wears the very material the gate proved, and the gate's proof for it still holds in
 * this context, asked now. A proof that no longer holds (or throws: its renderer is
 * gone) drops the witness, so the caller takes the gate and proves the program again. A
 * witness wearing another material for the moment (an effect over it) proves nothing
 * right now and is kept: it may wear the proven one again.
 */
export function wocMergedProgramProven(source: object, variant: number): boolean {
  const byVariant = witnesses.get(source);
  const witness = byVariant?.get(variant);
  if (!byVariant || !witness) return false;
  const worn = witness.holder.material;
  if ((Array.isArray(worn) ? worn[0] : worn) !== witness.material) return false;
  let ready = false;
  try {
    ready = witness.ready() === true;
  } catch {
    ready = false;
  }
  if (!ready) byVariant.delete(variant);
  return ready;
}
