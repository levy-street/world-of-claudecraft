/** Distinct material voices for native Warrior contacts; never bulk-regenerated. */
export const WARRIOR_CONTACT_SFX = [
  {
    key: 'melee_warrior_brute_release',
    duration: 0.12,
    prompt:
      'One extremely short heavy two-handed sword sweeping down through air, taut leather creak into a broad dense downward whoosh. Grounded armored warrior movement. Crisp dry start and cutoff. No impact, voice, music, ambience or ringing.',
  },
  {
    key: 'impact_warrior_brute',
    duration: 0.23,
    prompt:
      'One immediate blunt-edged greatsword chop into hard armor, a thick low wooden body knock under a crisp steel crack, short scattering stone grit and leather compression. Weighty repeatable martial combat hit, compact clean dry ending. No explosion, voice, music, ambience or long metallic ring.',
  },
  {
    key: 'melee_warrior_redhand_release',
    duration: 0.12,
    prompt:
      'One extremely short reverse greatsword rising from a low guard, taut leather pull and thin accelerating steel-air hiss. Controlled powerful warrior levering a heavy blade upward. Crisp dry close perspective. No impact, voice, music, ambience or ringing.',
  },
  {
    key: 'impact_warrior_redhand',
    duration: 0.22,
    prompt:
      'One immediate rising sword cleave through armor, sharp bright shearing edge, solid low body punch, short upward metal scrape with two tiny brittle splinter clicks. Disciplined powerful fantasy warrior combat, crisp close and dry with no sustain. No explosion, voice, music, ambience or magical shimmer.',
  },
  {
    key: 'melee_warrior_maiming_release',
    duration: 0.13,
    prompt:
      'One extremely short diagonal greatsword preparation, heavy forged steel slicing air with taut leather grip creak and cloth snap. Disciplined powerful warrior, dry close perspective, crisp start. No impact, voice, music, ambience or ringing.',
  },
  {
    key: 'impact_warrior_maiming',
    duration: 0.23,
    prompt:
      'One instantaneous heavy diagonal sword cleave into hard armor: focused steel cutting crack, dense low wooden leather body punch, brief jagged scraping grit. Weighty deliberate martial combat impact with sharp readable edge and short dry decay. No explosion, voice, music, ambience or long ringing.',
  },
  {
    key: 'melee_warrior_early_grave_release',
    duration: 0.14,
    prompt:
      'One extremely short massive execution blade loading overhead, heavy air suction, strained leather grip and tight cloth creak. A decisive physical downward strike about to land. Dry close perspective. No impact, voice, music, ambience or magical shimmer.',
  },
  {
    key: 'impact_warrior_early_grave',
    duration: 0.3,
    prompt:
      'One immediate enormous downward execution cleave, a sharp forged steel crack over a dense low body slam, crushing armor fracture and a brief shower of gritty fragments. Very powerful fantasy warrior finishing blow, compact dry transient with substantial low midrange weight, short falling debris tail. No explosion, voice, music, ambience or long reverb.',
  },
  {
    key: 'melee_warrior_bloodletting_release',
    duration: 0.12,
    prompt:
      'One extremely short hooked blade drawing across air, fast rough steel hiss, tight leather hand grip and aggressive cloth movement. Close physical warrior attack preparation with crisp onset and dry ending. No impact, voice, music, ambience or sustained tones.',
  },
  {
    key: 'impact_warrior_bloodletting',
    duration: 0.21,
    prompt:
      'One immediate vicious hooked sword cut into thick leather and flesh, sharp slicing edge followed by dense wet tearing and a short deep punch. Visceral grounded fantasy warrior combat, distinct rough extraction scrape, crisp readable transient and very tight dry decay. No voice, music, ambience, metal ringing or explosion.',
  },
  {
    key: 'melee_warrior_victory_release',
    duration: 0.13,
    prompt:
      'One extremely short low-to-high sword preparation, taut leather creak into an accelerating rising blade whoosh and cloth snap. Confident grounded warrior movement, crisp dry close perspective. No impact, voice, music, ambience or magic chime.',
  },
  {
    key: 'impact_warrior_victory',
    duration: 0.24,
    prompt:
      'One immediate powerful rising sword cleave, bright steel shearing edge over a solid leather rupture and broad confident body punch, followed by a short upward air snap. Satisfying decisive martial recovery strike, energetic and weighty with dry clean tail. No voice, music, ambience, magic shimmer or long ringing.',
  },
  {
    key: 'melee_warrior_shieldcrack_release',
    duration: 0.13,
    prompt:
      'One very short heavy shield drawing back, dense steel plate movement, leather arm strap strain and a compact cloth rustle. A planted knight preparing a shield bash. Crisp close perspective, dry cutoff. No impact, voice, music, ambience or ringing.',
  },
  {
    key: 'impact_warrior_shieldcrack',
    duration: 0.26,
    prompt:
      'One immediate heavy broad shield smashing armor, dense low steel plate clang with a hard leathery body thump and short brittle rivet rattle. Solid weight and compression, powerful grounded knight melee impact, crisp attack and very short dry metallic decay. No long ringing, explosion, voice, music or ambience.',
  },
].map((cue) => ({ ...cue, custom: true, variants: [{}, {}] }));
