import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Api } from '../src/net/online';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('online character creation appearance', () => {
  it('posts every selected head field, including explicit false and black', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await new Api().createCharacter('Aldric', 'warrior', 2, {
      face: 1,
      hairStyle: 3,
      beard: false,
      hairColor: 0x000000,
      faceColor: 0x000000,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/characters');
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({
      name: 'Aldric',
      class: 'warrior',
      skin: 2,
      face: 1,
      hairStyle: 3,
      beard: false,
      hairColor: 0,
      faceColor: 0,
    });
  });

  it('passes all five picker values from the create form into the API call', () => {
    const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    const call = source.slice(source.indexOf('await api.createCharacter('));
    const request = call.slice(0, call.indexOf(');') + 2);
    for (const field of ['hairStyle', 'beard', 'face', 'hairColor', 'faceColor']) {
      expect(request).toContain(`${field}: online`);
    }
  });
});
