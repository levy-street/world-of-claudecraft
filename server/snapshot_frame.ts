export interface SnapshotJsonFrameParts {
  head: string;
  timerWireJson: string;
  selfJson: string;
  entityJson: readonly string[];
  rings: readonly Record<string, unknown>[];
  hourglasses: readonly Record<string, unknown>[];
  keep: readonly number[];
}

/** Assemble the byte-compatible JSON snapshot only when that transport is needed. */
export function assembleSnapshotJson(parts: SnapshotJsonFrameParts): string {
  const ringsJson = parts.rings.length > 0 ? `,"rings":${JSON.stringify(parts.rings)}` : '';
  const hourglassesJson =
    parts.hourglasses.length > 0 ? `,"hourglasses":${JSON.stringify(parts.hourglasses)}` : '';
  const keepJson = parts.keep.length > 0 ? `,"keep":[${parts.keep.join(',')}]` : '';
  return `${parts.head}${parts.timerWireJson},"self":${parts.selfJson},"ents":[${parts.entityJson.join(
    ',',
  )}]${ringsJson}${hourglassesJson}${keepJson}}`;
}
