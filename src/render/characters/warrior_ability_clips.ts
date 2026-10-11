import type * as THREE from 'three';

/** Alias only the Warrior's authored libraries. Other class clips stay untouched. */
export function prepareWarriorAbilityClips(
  key: string,
  clips: Map<string, THREE.AnimationClip>,
  overrides: Readonly<Record<string, string>> | undefined,
): void {
  if (key !== 'player_warrior' && key !== 'player_warrior_modular') return;
  for (const [id, name] of Object.entries(overrides ?? {})) {
    if (!name.startsWith('Warrior_') && !name.startsWith('Fury_')) continue;
    const source = clips.get(name);
    if (!source) continue;
    const clip = source.clone();
    clip.name = `Signature_${id}`;
    clips.set(clip.name, clip);
  }
}
