import { bindModel } from './keyed/anatomy.mjs';
import { bakeKeyed, KEYED } from './keyed/index.mjs';

const models = new WeakMap();
const bindFor = (rig) => {
  if (!models.has(rig)) models.set(rig, bindModel(rig));
  return models.get(rig);
};

/** Bakes one hand-keyed clip on a fit's bind rig: 60 Hz local tracks for every bone. */
export function authorClip(rig, fit, name) {
  if (!KEYED[name]) throw new Error(`No hand-keyed clip named ${name}`);
  return bakeKeyed(bindFor(rig), fit, name);
}
