// The Last Bell campaign text: every scene line, speaker label, prompt, and
// choice the sim emits as a stable lb.* key (S3: the sim carries keys, this
// catalog carries the English). Values follow the campaign doc's voice bible
// (docs/design/last-bell-campaign.html): plain-first, no melodrama.
// Contributors add ENGLISH here; locale fills land at release (M16 wordy
// values carry their five non-Latin fills in the same change).

export const lastBellStrings = {
  speaker: {
    tam: 'Bellkeeper Tam',
    coalfast: 'Warden Coalfast',
    ollun: 'Riftwatch Ollun',
    edda: 'Quartermaster Edda',
    saul: 'Mender Saul',
  },
  q0: {
    scene: {
      harbor:
        'A working harbor: nets drying, star-glass salvage crates stenciled for mainland buyers.',
      plinth:
        'Above the harbor steps a bronze warden faces inland. The newest name on the plinth is a century old: WARDEN HALE. There is room below it for more.',
      toll: 'A bell tolls, once. Everyone in the street stops walking, and counts. Nothing follows, and the whole street exhales at once.',
    },
    tam: {
      stretchers: 'The last one of those cost the whole watch a morning and two stretchers.',
    },
    coalfast: {
      look: 'The grey man looks at the dead stalker, then at you, slightly longer. Then he walks back toward the cliffs.',
    },
  },
};
