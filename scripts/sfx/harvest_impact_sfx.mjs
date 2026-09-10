/** Red Harvest's impact-first revision. Each phrase has one precise contact. */
export const HARVEST_IMPACT_SFX = [
  [
    'melee_warrior_red_harvest_release',
    0.14,
    'A single fast warrior preparation: two heavy steel blades loading together, tight leather grip strain and compressed air inhaling into the motion. Sudden close dry tension. No impact yet, no voice, music or ambience.',
  ],
  [
    'impact_warrior_red_harvest_first',
    0.16,
    'One savage heavy sword collision at the very start. A sharp steel cutting crack, dense low midrange body thump and short coarse wet tear, fused into one forceful punch. Detailed physical fantasy combat, extremely dry and close. No music, voices, boom, ringing or ambience.',
  ],
  [
    'impact_warrior_red_harvest_second',
    0.16,
    'One brutal reverse sword cut landing immediately: hard leathery SNAP with a serrated tearing rasp and thick woody body impact underneath. Aggressive and tactile, quick compact decay. One collision only. No voice, music, ambience or long metallic ring.',
  ],
  [
    'impact_warrior_red_harvest_finish',
    0.25,
    'One gigantic two-sword extraction impact, both blades bite at the same instant. Immediate hard steel CRACK over a dense chesty body SLAM, then a broad coarse wet ripping release that rapidly pitches downward into falling droplets. Extremely powerful stylized physical rage finisher. Punch audible on small speakers. Dry tight ending, no music, voices, explosion, ringing or reverb.',
  ],
].map(([key, duration, prompt]) => ({ key, duration, prompt, custom: true, variants: [{}, {}] }));
