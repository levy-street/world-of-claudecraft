// Example realm overlay — a neutral reference showing the RealmContent shape.
// Copy this to build your own realms; none of the base game depends on it.
import type { RealmContent } from './types';

export const EXAMPLE_REALM: RealmContent = {
  id: 'example',
  name: 'Example Realm',
  tagline: 'A reference realm overlay',
  description: 'Demonstrates the realm-overlay shape: branding, classes, and rarity flavor layered on the base sim.',
  mood: 'Neutral · Reference',
  accentHex: '#4a9eff',
  bgGradient: 'linear-gradient(135deg, #10131a 0%, #080a0f 100%)',
  previewColors: { primary: '#4a9eff', secondary: '#ffd166', bg: '#10131a' },
  isDefault: true,
  classes: [
    {
      id: 'guardian', name: 'Guardian', role: 'Tank', icon: '🛡', color: '#f1c40f',
      lore: 'A frontline protector.',
      baseStats: { maxHp: 190, maxMp: 80, str: 28, dex: 10, vit: 34, nrg: 12, dmg: 20, def: 34, spd: 1.0 },
      skills: [
        { name: 'Shield Bash', icon: '🛡', mp: 18, type: 'Melee', dmg: 200, range: 3, desc: 'Strike and stun briefly', color: '#f1c40f' },
      ],
      skillTrees: ['Defense', 'Valor'],
    },
  ],
};
