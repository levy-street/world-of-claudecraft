/** Curated Warrior material recordings, protected from bulk regeneration. */
import { HARVEST_IMPACT_SFX } from './harvest_impact_sfx.mjs';
export const FURY_SFX = [
  {
    key: 'melee_warrior_twinstrike_release',
    duration: 0.14,
    prompt:
      'One extremely short pair of heavy steel blades drawing back through air, leather grip creak and focused cloth snap. Grounded close combat preparation, crisp beginning, tight dry tail. No impact, no voice, no music, no ambience.',
  },
  {
    key: 'impact_warrior_twinstrike_first',
    duration: 0.18,
    prompt:
      'One immediate sharp sword slash hitting thick leather and flesh, bright cutting edge followed by a compact wet tear and weighty low midrange punch. Powerful stylized fantasy melee game hit. Very fast transient, dry short decay. No voice, no music, no ambience, no metallic ringing.',
  },
  {
    key: 'impact_warrior_twinstrike_second',
    duration: 0.21,
    prompt:
      'One immediate decisive backhand sword cleave, forceful low cutting whoosh into dense leather rupture and a short wet snap. Bigger and lower than a light sword hit, clear steel edge. Dry close perspective, extremely tight tail. No voice, no music, no ambience, no ringing.',
  },
  {
    key: 'melee_warrior_red_harvest_release',
    duration: 0.14,
    prompt:
      'One short furious gathering motion of two massive blades, deep aggressive air compression with strained leather and rushing cloth. A grounded warrior loading a brutal attack. Tight rising onset, dry cutoff. No impact, no voice, no music, no ambience, no magic.',
  },
  {
    key: 'impact_warrior_red_harvest_first',
    duration: 0.18,
    prompt:
      'One instantaneous brutal heavy sword cut, vicious shearing steel air edge and compact wet tearing body impact, dense low midrange thump. Aggressive physical fantasy melee hit, not an explosion. Extremely short dry decay. No voice, no music, no ambience, no ringing.',
  },
  {
    key: 'impact_warrior_red_harvest_second',
    duration: 0.18,
    prompt:
      'One instantaneous savage returning blade slash, rough serrated wet rip over a hard leathery crack and heavy chesty punch. Visceral stylized fantasy warrior combat, sharp readable edge and weight. Short dry isolated tail. No voice, no music, no ambience, no explosion.',
  },
  {
    key: 'impact_warrior_red_harvest_finish',
    duration: 0.23,
    prompt:
      'One overwhelming instantaneous two-blade rising cleave landing together: deep physical slam beneath a wide wet ripping slash, sharp steel shear, then a brief falling debris rattle. A huge rage finisher with real body weight. Compact dry close perspective, no booming explosion, no voice, no music, no ambience, no long reverb.',
  },
].map(
  (cue) =>
    HARVEST_IMPACT_SFX.find((authored) => authored.key === cue.key) ?? {
      ...cue,
      custom: true,
      variants: [{}, {}],
    },
);
