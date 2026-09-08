const IDENTITIES: Readonly<Record<string, string>> = {
  pyroblast: 'pyre',
  frost_nova: 'glacier',
  chain_lightning: 'thunder',
  chain_heal: 'tide',
  ghost_wolf: 'wolf',
  hammer_of_wrath: 'judgement',
  execute: 'execution',
  abyssal_rift: 'rift',
};
export function masterworkAudioKey(
  id: string | undefined,
  phase: 'charge' | 'release' | 'impact',
): string | null {
  const identity = id ? IDENTITIES[id] : undefined;
  return identity
    ? `${phase === 'charge' ? 'cast' : phase === 'release' ? 'proj' : 'impact'}_masterwork_${identity}`
    : null;
}
const LOOP = { start: 1, end: 3, fade: 0.055 };
const CHARGES = new Set(Object.keys(IDENTITIES).map((id) => masterworkAudioKey(id, 'charge')));
export function masterworkLoop(key: string): typeof LOOP | null {
  return CHARGES.has(key) ? LOOP : null;
}
export function masterworkAudioKeys(): string[] {
  return Object.keys(IDENTITIES).flatMap((id) =>
    ['charge', 'release', 'impact'].map(
      (phase) => masterworkAudioKey(id, phase as 'charge' | 'release' | 'impact')!,
    ),
  );
}
