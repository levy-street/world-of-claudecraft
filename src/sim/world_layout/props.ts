import type { ZonePropsDef } from '../types';

// Buildings use the authored town registry, never a scenery replacement.
// Dock replacement also carries analytic walk surfaces through scenery.decks.
export const LAYOUT_PROP_FAMILIES = [
  'wells',
  'stalls',
  'tents',
  'crates',
  'campfires',
  'ruinRings',
  'fences',
  'graveyards',
  'decorProps',
  'mudHuts',
  'docks',
] as const;
export type LayoutPropFamily = (typeof LAYOUT_PROP_FAMILIES)[number];
export type LayoutPropRemoval = {
  [K in LayoutPropFamily]: { family: K; source: NonNullable<ZonePropsDef[K]>[number] };
}[LayoutPropFamily];

export function propHutCenter(props: ZonePropsDef): { x: number; z: number } {
  return (
    props.layoutHutCenter ??
    props.mudHuts.reduce(
      (center, [x, z]) => ({
        x: center.x + x / props.mudHuts.length,
        z: center.z + z / props.mudHuts.length,
      }),
      { x: 0, z: 0 },
    )
  );
}

export function propSourceIndex(props: ZonePropsDef, family: string, index: number): number {
  return props.layoutSourceIndices?.[family]?.[index] ?? index;
}

/** Record identity includes every authored field, independent of JSON key order. */
export function propRecordKey(value: unknown): string {
  const stable = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(stable)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v)
              .filter(([, child]) => child !== undefined)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, child]) => [key, stable(child)]),
          )
        : v;
  return JSON.stringify(stable(value));
}

/** Remove exact reviewed records; preserve newer records and index-based variants. */
export function placeLayoutProps(
  base: ZonePropsDef,
  removals?: readonly LayoutPropRemoval[],
  retainedFences: ZonePropsDef['fences'] = [],
): ZonePropsDef {
  if (!removals?.length && !retainedFences.length) return base;
  const indices = { ...base.layoutSourceIndices };
  const out = { ...base, layoutSourceIndices: indices, layoutHutCenter: propHutCenter(base) };
  const removed = new Map<LayoutPropFamily, Set<number>>();
  for (const edit of removals ?? []) {
    if (!LAYOUT_PROP_FAMILIES.includes(edit.family))
      throw new Error(`Unsupported scenery family: ${edit.family}`);
    const key = propRecordKey(edit.source);
    const matches = (base[edit.family] ?? []).flatMap((record, index) =>
      propRecordKey(record) === key ? [index] : [],
    );
    const selected = removed.get(edit.family) ?? new Set<number>();
    if (matches.length !== 1 || selected.has(matches[0]))
      throw new Error(`Missing, ambiguous or repeated scenery record: ${edit.family}`);
    selected.add(matches[0]);
    removed.set(edit.family, selected);
  }
  for (const [family, selected] of removed) {
    const records = base[family] ?? [];
    Object.assign(out, { [family]: records.filter((_, index) => !selected.has(index)) });
    indices[family] = records.flatMap((_, index) =>
      selected.has(index) ? [] : [propSourceIndex(base, family, index)],
    );
  }
  if (retainedFences.length) out.fences = [...out.fences, ...retainedFences];
  return out;
}
