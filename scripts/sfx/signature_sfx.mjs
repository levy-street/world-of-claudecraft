// Original, deterministically authored sound-design tails. The contact recordings
// remain the foreground; these add a quiet, separate material resonance.
export const SIGNATURE_SFX = [
  {
    key: 'signature_pyre',
    duration: 1.8,
    prompt: 'Low fire pressure, crackling ember tail',
    base: 67,
    mode: 0,
  },
  {
    key: 'signature_glacier',
    duration: 1.5,
    prompt: 'Brittle ice fracture and descending crystal resonance',
    base: 720,
    mode: 1,
  },
  {
    key: 'signature_thunder',
    duration: 1.3,
    prompt: 'Electrical crack followed by a short rolling thunder body',
    base: 49,
    mode: 2,
  },
  {
    key: 'signature_tide',
    duration: 1.6,
    prompt: 'Soft liquid bubbles and an upward water resonance',
    base: 290,
    mode: 3,
  },
  {
    key: 'signature_wolf',
    duration: 1.7,
    prompt: 'Breathy spectral transformation with a low harmonic swell',
    base: 145,
    mode: 4,
  },
  {
    key: 'signature_judgement',
    duration: 1.9,
    prompt: 'Golden struck-metal resonance with a restrained bell tail',
    base: 392,
    mode: 5,
  },
  {
    key: 'signature_execution',
    duration: 0.85,
    prompt: 'Heavy steel contact with stone grit and a dry low thump',
    base: 82,
    mode: 6,
  },
  {
    key: 'signature_rift',
    duration: 2.0,
    prompt: 'Descending spectral pressure and a ragged hollow tail',
    base: 96,
    mode: 7,
  },
].map((entry) => ({ ...entry, custom: true, generator: 'signature' }));
