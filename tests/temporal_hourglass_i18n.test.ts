import { describe, expect, it } from 'vitest';
import { en, es, es_ES } from '../src/ui/i18n.resolved.generated';

describe('Hourglass localization', () => {
  it('ships the English source and Spanish base translation with dynamic values', () => {
    expect(en.entities.abilities.temporal_hourglass.name).toBe('Hourglass of Suspension');
    expect(en.entities.abilities.temporal_hourglass.description).toContain('{duration}');
    expect(en.entities.abilities.temporal_hourglass.description).toContain('{healing}%');
    expect(en.entities.abilities.temporal_hourglass.description).toContain(
      '{selfCooldownRecovery}% faster',
    );
    expect(en.entities.abilities.temporal_hourglass.description).toContain(
      '{allyCooldownRecovery}% faster',
    );
    expect(en.entities.abilities.temporal_hourglass.description).toContain('{groundDuration} sec');

    expect(es.entities.abilities.temporal_hourglass.name).toBe('Reloj de suspensión');
    expect(es.entities.abilities.temporal_hourglass.description).toContain('{duration} s');
    expect(es.entities.abilities.temporal_hourglass.description).toContain('{healing}%');
    expect(es.entities.abilities.temporal_hourglass.description).toContain(
      '{selfCooldownRecovery}% más rápido para ti',
    );
    expect(es.entities.abilities.temporal_hourglass.description).toContain(
      '{allyCooldownRecovery}% más rápido para un aliado',
    );
  });

  it('resolves es_ES through the canonical es dialect alias', () => {
    expect(es_ES.entities.abilities.temporal_hourglass).toEqual(
      es.entities.abilities.temporal_hourglass,
    );
    expect(es_ES.hudChrome.auraEffect.temporalHourglass).toBe(
      es.hudChrome.auraEffect.temporalHourglass,
    );
  });
});
