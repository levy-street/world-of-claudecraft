// Brand-new armor SET concepts: gpt-image-2 redesigns the existing armor-set
// mannequin render (same T-pose arrangement, same chibi proportions, armor
// shells only, no body) around each theme. Output feeds Tripo image-to-model.
import { editImages } from '../lib/openai_image.mjs';

const DIR = 'tmp/asset_pipeline/armor_picker';
const REF = `${DIR}/qa/armor_set_ref/front.png`;
const BASE =
  'Redesign this chibi low-poly armor set into a completely new themed set. ' +
  'Keep EXACTLY the same layout and proportions as the reference: a floating armor set ' +
  'arranged as if worn by an invisible chibi mannequin in T-pose, with a helmet on top, ' +
  'two shoulder pauldrons, a chest and torso plate with belt and tassets, two arm bracers ' +
  'held horizontally at the sides, and two leg greaves with boots. ARMOR PIECES ONLY: ' +
  'no body, no skin, no face, no hair anywhere. Flat-shaded stylized low-poly game art, ' +
  'clean saturated colors, plain solid white background, front view, centered.';
const SETS = {
  dragonscale:
    'Theme: crimson dragonscale. Overlapping deep-red dragon scales, swept-back dragon ' +
    'horns on the helmet, wing-fin shaped pauldrons, amber gem in the chest, dark iron trim.',
  bonewrought:
    'Theme: bonewrought undead knight. Bleached bone plates, a grinning skull-faced helmet, ' +
    'ribcage-shaped breastplate, vertebrae spine details on the belt, small teal soul-fire gems.',
  stormcrystal:
    'Theme: storm crystal arcana. Jagged translucent azure crystal plates with glowing cyan ' +
    'edges, crystal-shard pauldrons, a geode-like chest plate, silver filigree trim.',
};

for (const [name, theme] of Object.entries(process.argv[2] ? { [process.argv[2]]: SETS[process.argv[2]] } : SETS)) {
  const dest = `${DIR}/work/concept_${name}.png`;
  console.log('generating concept', name);
  await editImages({ prompt: `${BASE} ${theme}`, images: [REF], dest, size: '1024x1024' });
  console.log('wrote', dest);
}
