// Public character-sheet REST read. Carries no authenticated identity or bearer.
import { apiUrl } from '../client_origin';
import type { CharacterProfile } from '../world_api';

export async function readCharacterProfile(
  name: string,
  base: string,
): Promise<CharacterProfile | null> {
  const wanted = name.trim();
  if (!wanted) return null;
  try {
    // No Authorization header: this route is a public read (meta.publicRead) and
    // ignores one, so sending the bearer would leak it for nothing.
    const res = await fetch(
      apiUrl(`/api/public/characters/${encodeURIComponent(wanted)}/sheet`, base),
    );
    if (!res.ok) return null;
    const sheet = await res.json();
    if (typeof sheet?.name !== 'string') return null;
    return {
      name: sheet.name,
      cls: sheet.class,
      classLabel: sheet.classLabel ?? sheet.class,
      spec: sheet.spec ?? '',
      level: sheet.level ?? 1,
      guild: sheet.guild ?? null,
      zone: sheet.zone ?? '',
      skin: sheet.skin ?? 0,
      realm: sheet.realm ?? '',
    };
  } catch {
    return null;
  }
}
