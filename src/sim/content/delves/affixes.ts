import type { DelveAffixDef } from '../../types';

export const DELVE_AFFIXES: Record<string, DelveAffixDef> = {
  restless_graves: { id: 'restless_graves', name: 'Restless Graves', themes: ['crypt'] },
  bad_air: { id: 'bad_air', name: 'Bad Air', themes: ['crypt', 'mine', 'sewer'] },
  candleblind: { id: 'candleblind', name: 'Candleblind', themes: ['crypt', 'mine'] },
  old_mechanisms: { id: 'old_mechanisms', name: 'Old Mechanisms', themes: ['vault', 'sewer'] },
  flooded_paths: { id: 'flooded_paths', name: 'Flooded Paths', themes: ['sewer', 'mine'] },
  grave_tax: { id: 'grave_tax', name: 'Grave Tax', themes: ['crypt', 'vault'] },
  unstable_roof: { id: 'unstable_roof', name: 'Unstable Roof', themes: ['mine', 'crypt', 'vault'] },
  cult_remnants: {
    id: 'cult_remnants',
    name: 'Cult Remnants',
    themes: ['crypt', 'vault', 'sewer'],
  },
  chapel_candle: { id: 'chapel_candle', name: 'Chapel Candle', themes: ['crypt'], blessing: true },
};
