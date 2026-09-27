/** Short, distinct material voices. No control-success sound on failed attempts. */
export const WARRIOR_CONTROL_SFX = [
  {
    key: 'melee_warrior_hobble_release',
    duration: 0.13,
    prompt:
      'One short low sword sweep winding across ankle height, taut leather glove and a narrow serrated steel air whistle. Dry close physical preparation, no impact, voice, music or ambience.',
  },
  {
    key: 'impact_warrior_hobble_cut',
    duration: 0.23,
    prompt:
      'One immediate low slicing sword contact, crisp fibrous cutting snap over a compact dark leather tear and a tiny metal grit tail. Quick precise disabling physical strike. No giant explosion, repeated hits, voice, music or ambience.',
  },
  {
    key: 'melee_warrior_jawcrack_release',
    duration: 0.12,
    prompt:
      'One very short leather gauntlet jab through dense air, tightly compressed swish with glove creak. Rapid close dry bare-fist preparation, no injury impact, voice, music or ambience.',
  },
  {
    key: 'impact_warrior_jawcrack_break',
    duration: 0.23,
    prompt:
      'One sharp compact interruption crack, a muted gauntlet clap breaks a taut crystalline filament into two falling brittle fragments. Physical punch stops a spell. Dry close perspective, no flesh injury, bell, explosion, voice or music.',
  },
  {
    key: 'melee_warrior_shear_release',
    duration: 0.14,
    prompt:
      'One short steel weapon edge biting under an armor seam, tense leather grip and a low scraping metallic preload. Close dry preparation, no completed break, voice, music or ambience.',
  },
  {
    key: 'impact_warrior_shear_peel',
    duration: 0.32,
    prompt:
      'One immediate armor plate being pried open, sharp stressed metal buckle followed by a rough short sheet-steel peel and three tiny falling rivets. Satisfying dry mechanical material separation. No flesh hit, blood, explosion, voice or music.',
  },
  {
    key: 'melee_warrior_hammer_throw',
    duration: 0.16,
    prompt:
      'One short heavy war hammer thrown by hand, leather grip releases into a dense rotating iron air rush, a low metallic hum with a sharp leading whip. Powerful compact dry throw, no landing, explosion, voice, music or ambience.',
  },
  {
    key: 'impact_warrior_hammer_land',
    duration: 0.32,
    prompt:
      'One immediate solid blunt iron hammer collision, dense low metal-on-armor thud under a bright beveled steel clack, short gritty splinters and an abruptly damped iron resonance. Heavy satisfying martial impact. No explosion, repeated hit, voice or music.',
  },
].map((cue) => ({ ...cue, custom: true, variants: [{}, {}] }));
