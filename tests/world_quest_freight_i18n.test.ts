import { afterEach, describe, expect, it } from 'vitest';
import { WORLD_QUEST_ESCORTS } from '../src/sim/content/world_quests';
import { setLanguage } from '../src/ui/i18n';
import { localizeAuthoredYellSpeakerName, localizeAuthoredYellText } from '../src/ui/sim_i18n';

const START = "Keep close! Eastbrook's provisions must reach the market.";
const SUCCESS = 'The freight is safe. Eastbrook owes you a debt.';
const FAIL = 'The caravan is lost!';

describe('world quest freight yells', () => {
  afterEach(() => setLanguage('en'));

  it('preserves the authored driver only on the caravan mob without changing ordinary speaker names', () => {
    expect(localizeAuthoredYellSpeakerName('Tobin', 'mob', 'eastbrook_freight_caravan')).toBe(
      'Tobin',
    );
    expect(
      localizeAuthoredYellSpeakerName(
        'Eastbrook Freight Caravan',
        'mob',
        'eastbrook_freight_caravan',
      ),
    ).toBe('Eastbrook Freight Caravan');
    expect(localizeAuthoredYellSpeakerName('Tobin', 'mob', 'vale_bandit')).not.toBe('Tobin');
    expect(localizeAuthoredYellSpeakerName('Mira', 'mob', 'willowfen_remedy_caravan')).toBe('Mira');
    expect(localizeAuthoredYellSpeakerName('Orin', 'mob', 'frostveil_supply_caravan')).toBe('Orin');
    expect(localizeAuthoredYellSpeakerName('Mira', 'mob', 'frostveil_supply_caravan')).toBe(
      'Frostveil Supply Caravan',
    );
    expect(localizeAuthoredYellSpeakerName('Tobin', 'player', 'vale_bandit')).toBe('Tobin');
    expect(
      localizeAuthoredYellSpeakerName('Player Name', 'mob', 'eastbrook_freight_caravan', 'warrior'),
    ).toBe('Player Name');
  });

  it('localizes every caravan bark in Spanish', () => {
    setLanguage('es_ES');
    expect(localizeAuthoredYellText(START, 'mob')).toBe(
      '¡Mantente cerca! Las provisiones de Eastbrook deben llegar al mercado.',
    );
    expect(localizeAuthoredYellText(SUCCESS, 'mob')).toBe(
      'La mercancía está a salvo. Eastbrook está en deuda contigo.',
    );
    expect(localizeAuthoredYellText(FAIL, 'mob')).toBe('¡La caravana se ha perdido!');
  });

  it('has a non-English localized form in every non-English locale', () => {
    const storyLines = Object.values(WORLD_QUEST_ESCORTS).flatMap((def) => [
      def.startText,
      def.successText,
      def.failText,
      def.story!.ambushText,
      ...def.story!.lines.map((line) => line.text),
    ]);
    expect(Object.keys(WORLD_QUEST_ESCORTS)).toEqual([
      'esc_wq_eastbrook_caravan',
      'esc_wq_willowfen_caravan',
      'esc_wq_frostveil_caravan',
    ]);
    for (const language of [
      'cs_CZ',
      'da_DK',
      'de_DE',
      'es',
      'es_ES',
      'fr_CA',
      'fr_FR',
      'id_ID',
      'it_IT',
      'ja_JP',
      'ko_KR',
      'nl_NL',
      'pl_PL',
      'pt_BR',
      'ru_RU',
      'sv_SE',
      'tr_TR',
      'vi_VN',
      'zh_CN',
      'zh_TW',
    ] as const) {
      setLanguage(language);
      expect(localizeAuthoredYellText(START, 'mob'), language).not.toBe(START);
      expect(localizeAuthoredYellText(SUCCESS, 'mob'), language).not.toBe(SUCCESS);
      expect(localizeAuthoredYellText(FAIL, 'mob'), language).not.toBe(FAIL);
      for (const line of storyLines) {
        const localized = localizeAuthoredYellText(line, 'mob');
        expect(localized, `${language}: ${line}`).toBeTypeOf('string');
        expect(localized.trim().length, `${language}: ${line}`).toBeGreaterThan(0);
        expect(localized, `${language}: ${line}`).not.toBe(line);
        // Player-authored text that happens to match a story must stay verbatim.
        expect(localizeAuthoredYellText(line, 'player'), language).toBe(line);
      }
    }
  });

  it('localizes both regional introductions and endings in Spanish', () => {
    setLanguage('es_ES');
    const willowfen = WORLD_QUEST_ESCORTS.esc_wq_willowfen_caravan;
    const frostveil = WORLD_QUEST_ESCORTS.esc_wq_frostveil_caravan;
    expect(localizeAuthoredYellText(willowfen.startText, 'mob')).toBe(
      'Soy Mira. Estos remedios deben llegar a Bridgemere. ¿Me acompañas?',
    );
    expect(localizeAuthoredYellText(willowfen.successText, 'mob')).toBe(
      'A salvo junto al puente. Esta noche, alguien en Bridgemere dormirá sin fiebre. Gracias.',
    );
    expect(localizeAuthoredYellText(frostveil.startText, 'mob')).toBe(
      'Orin, a tu servicio. Mantas y aceite de lámpara para los Peldaños de la Aurora. Vigila la nieve.',
    );
    expect(localizeAuthoredYellText(frostveil.successText, 'mob')).toBe(
      'Suministros entregados. Mantened esa linterna encendida, amigos. Nadie se queda en la nieve.',
    );
  });

  it('translates Tobin’s introduction and the toy reveal into Spanish', () => {
    const def = WORLD_QUEST_ESCORTS.esc_wq_eastbrook_caravan;
    setLanguage('es_ES');
    expect(localizeAuthoredYellText(def.startText, 'mob')).toBe(
      'Soy Tobin. Esta es la última entrega de mi viejo amigo Bram. Quédate cerca.',
    );
    expect(localizeAuthoredYellText(def.story!.lines[2].text, 'mob')).toBe(
      '¿Qué hay dentro? Caballitos de madera y muñecas remendadas. Los reparaba para los niños de Eastbrook.',
    );
  });
});
