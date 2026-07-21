import { describe, expect, it } from 'vitest';
import { GROUND_PICKUP_LINES } from '../src/sim/content/ground_pickup_lines';
import { supportedLanguages } from '../src/ui/i18n';
import { DICT, localizeSimText } from '../src/ui/sim_i18n';

// The custom per-item ground-pickup lines are emitted via def.pickupDeny /
// def.pickupEnough (variable-routed), so the S3 emit-site guard cannot see
// them. This suite is their drift guard instead: every line in the content
// table must be recognized by the sim matcher (EXACT), and every locale must
// carry a real translation, not the English passthrough the DICT spread would
// silently fall back to.

const GROUND_PICKUP_KEYS = (Object.keys(DICT.en) as (keyof typeof DICT.en)[]).filter((k) =>
  k.startsWith('groundPickup.'),
);

describe('ground-pickup line localization (the S3-invisible surface)', () => {
  it('recognizes every deny/enough line in GROUND_PICKUP_LINES via the EXACT matcher', () => {
    for (const [id, lines] of Object.entries(GROUND_PICKUP_LINES)) {
      expect(localizeSimText(lines.deny), `deny line for ${id}`).not.toBeNull();
      expect(localizeSimText(lines.enough), `enough line for ${id}`).not.toBeNull();
    }
  });

  it('covers 34 distinct lines with groundPickup.* keys', () => {
    expect(GROUND_PICKUP_KEYS.length).toBe(34);
  });

  it('pins a known literal per representative locale', () => {
    expect(DICT.es['groundPickup.supplyCrateDeny']).toBe('El cajón está cerrado con clavos.');
    expect(DICT.ru_RU['groundPickup.supplyCrateDeny']).toBe('Ящик наглухо заколочен.');
    expect(DICT.zh_CN['groundPickup.graveSealedDeny']).toBe('坟墓向生者封闭，直到死者召唤你前来。');
  });

  it('every non-English locale carries a real translation for every groundPickup key', () => {
    const nonEnglish = supportedLanguages.filter((l) => l !== 'en' && l !== 'en_CA');
    for (const lang of nonEnglish) {
      for (const key of GROUND_PICKUP_KEYS) {
        expect(DICT[lang][key], `${lang} ${key}`).not.toBe(DICT.en[key]);
      }
    }
  });
});
