/** Manual control cues use actual success; Hobbling Cut uses retained hit audio. */
export const WARRIOR_CONTROL_AUDIO = {
  hamstring: {
    release: 'melee_warrior_hobble_release',
    impacts: ['impact_warrior_hobble_cut'],
    times: [0.15],
  },
  pummel: {
    release: 'melee_warrior_jawcrack_release',
    impacts: ['impact_warrior_jawcrack_break'],
    times: [0.15],
  },
  sunder_armor: {
    release: 'melee_warrior_shear_release',
    impacts: ['impact_warrior_shear_peel'],
    times: [0.15],
  },
  storm_bolt: {
    release: 'melee_warrior_hammer_throw',
    impacts: ['impact_warrior_hammer_land'],
    times: [0],
  },
} as const;

export function warriorControlReleaseSample(id: string): string | undefined {
  return id === 'pummel' || id === 'sunder_armor' ? WARRIOR_CONTROL_AUDIO[id].release : undefined;
}
