// Public service roles: all station masters, farmers, and the gathering/hobby
// onboarding givers. Story-only vendors are not profession trainers.
export const PROFESSION_TRAINERS = {
  forgemistress_darva: 'blacksmithing',
  cook_marlow: 'cooking',
  weaver_ottilie: 'tailoring',
  tinker_gizzel: 'engineering',
  tanner_hesk: 'leatherworking',
  alchemist_verane: 'alchemy',
  farmer_jessica: 'farming',
  farmer_teasel: 'farming',
  farmer_hollis: 'farming',
  farmer_verbena: 'farming',
  foreman_odell: 'mining',
  smith_haldren: 'hobby',
} as const;
