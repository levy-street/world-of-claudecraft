import { describe, expect, it } from 'vitest';
import { foldClassMap, parsePinnedModel } from '@/lib/inference';

// Pure routing-resolution helpers: how a request's model class or pinned
// model becomes a concrete (vendor, model) target.

describe('parsePinnedModel', () => {
  it('splits "vendor:model" for known vendors', () => {
    expect(parsePinnedModel('openai:gpt-4o-mini')).toEqual({ vendor: 'openai', model: 'gpt-4o-mini' });
    expect(parsePinnedModel('anthropic:claude-haiku-4-5')).toEqual({
      vendor: 'anthropic',
      model: 'claude-haiku-4-5',
    });
  });

  it('treats a bare model as the legacy Venice contract', () => {
    expect(parsePinnedModel('llama-3.3-70b')).toEqual({ vendor: 'venice', model: 'llama-3.3-70b' });
  });

  it('leaves unknown prefixes intact as venice model names (colons are legal there)', () => {
    expect(parsePinnedModel('org:custom-model')).toEqual({ vendor: 'venice', model: 'org:custom-model' });
    expect(parsePinnedModel(':leading-colon')).toEqual({ vendor: 'venice', model: ':leading-colon' });
  });

  it('only splits on the first colon', () => {
    expect(parsePinnedModel('kimi:models:v2')).toEqual({ vendor: 'kimi', model: 'models:v2' });
  });
});

describe('foldClassMap', () => {
  const row = (
    cls: string,
    vendor: string,
    model: string,
    priority: number,
    active = true,
  ) => ({ class: cls, vendor, model, priority, active });

  it('picks the lowest-priority-number active model per (class, vendor)', () => {
    const map = foldClassMap([
      row('fast', 'openai', 'gpt-4o', 50),
      row('fast', 'openai', 'gpt-4o-mini', 10),
      row('fast', 'venice', 'llama-3.2-3b', 10),
      row('smart', 'openai', 'gpt-4.1', 10),
    ]);
    expect(map.get('fast')?.get('openai')).toBe('gpt-4o-mini');
    expect(map.get('fast')?.get('venice')).toBe('llama-3.2-3b');
    expect(map.get('smart')?.get('openai')).toBe('gpt-4.1');
  });

  it('is input-order independent (sorts by priority itself)', () => {
    const rows = [
      row('fast', 'kimi', 'kimi-k2', 20),
      row('fast', 'kimi', 'moonshot-v1-8k', 5),
    ];
    expect(foldClassMap(rows).get('fast')?.get('kimi')).toBe('moonshot-v1-8k');
    expect(foldClassMap([...rows].reverse()).get('fast')?.get('kimi')).toBe('moonshot-v1-8k');
  });

  it('skips inactive rows entirely — an inactive best does not shadow the runner-up', () => {
    const map = foldClassMap([
      row('fast', 'openai', 'gpt-4o-mini', 10, false),
      row('fast', 'openai', 'gpt-4.1-mini', 20),
    ]);
    expect(map.get('fast')?.get('openai')).toBe('gpt-4.1-mini');
  });

  it('yields no entry when every mapping for a vendor is inactive', () => {
    const map = foldClassMap([row('fast', 'openai', 'gpt-4o-mini', 10, false)]);
    expect(map.get('fast')?.get('openai')).toBeUndefined();
  });
});
