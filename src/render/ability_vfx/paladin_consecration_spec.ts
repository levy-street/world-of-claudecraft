/**
 * Holy Ground's zone (ActiveConsecration) carries no caster, so its cast leaves
 * a short note of the Paladin's spec icon where they stood, and the zone that
 * opens there bears that icon (paladin_consecration_visual.ts). Notes are kept
 * briefly and only the few newest; a zone with none bears Faithwarden's.
 */
interface SpecNote {
  x: number;
  z: number;
  /** Spec icon index (paladin_spec_emblems.ts): 1 Faithwarden, 2 Dawnreaver. */
  spec: number;
  at: number;
  /** Ascension empowered this Holy Ground: it burns hotter. */
  ascended: boolean;
}

const NOTES: SpecNote[] = [];
const MAX_NOTES = 8;
/** How far from where the Paladin stood the zone may open. */
const NOTE_REACH = 2.5;
const NOTE_LIFE_MS = 3000;

export function notePaladinConsecrationSpec(
  x: number,
  z: number,
  spec: number,
  now = performance.now(),
): void {
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(spec)) return;
  NOTES.push({ x, z, spec, at: now, ascended: false });
  if (NOTES.length > MAX_NOTES) NOTES.shift();
}

/** The spec icon of the newest live note near (x, z), or null. */
export function paladinConsecrationSpecAt(
  x: number,
  z: number,
  now = performance.now(),
): number | null {
  for (let i = NOTES.length - 1; i >= 0; i--) {
    const note = NOTES[i];
    if (now - note.at > NOTE_LIFE_MS) continue;
    if (note.spec >= 0 && Math.hypot(note.x - x, note.z - z) <= NOTE_REACH) return note.spec;
  }
  return null;
}

/** Ascension empowered the Holy Ground cast where the Paladin stood. */
export function notePaladinConsecrationAscended(
  x: number,
  z: number,
  now = performance.now(),
): void {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return;
  for (let i = NOTES.length - 1; i >= 0; i--) {
    const note = NOTES[i];
    if (now - note.at > NOTE_LIFE_MS) break;
    if (Math.hypot(note.x - x, note.z - z) <= NOTE_REACH) {
      note.ascended = true;
      return;
    }
  }
  NOTES.push({ x, z, spec: -1, at: now, ascended: true });
  if (NOTES.length > MAX_NOTES) NOTES.shift();
}

/** Whether the newest live note near (x, z) was empowered by Ascension. */
export function paladinConsecrationAscendedAt(
  x: number,
  z: number,
  now = performance.now(),
): boolean {
  for (let i = NOTES.length - 1; i >= 0; i--) {
    const note = NOTES[i];
    if (now - note.at > NOTE_LIFE_MS) continue;
    if (Math.hypot(note.x - x, note.z - z) <= NOTE_REACH && note.ascended) return true;
  }
  return false;
}

/** Test seam: forget every note. */
export function clearPaladinConsecrationSpecs(): void {
  NOTES.length = 0;
}
