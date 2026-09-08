import { describe, expect, it } from 'vitest';
import { DEFAULT_STUDIO_CONFIG } from '../src/vfx_studio/session';
import { StudioWorkspace } from '../src/vfx_studio/workspace';

describe('studio workspace', () => {
  it('remembers separate builds and favourite abilities after reopening', () => {
    let value = '';
    const storage = {
      getItem: () => value,
      setItem: (_key: string, next: string) => {
        value = next;
      },
    };
    const workspace = new StudioWorkspace(storage);
    workspace.remember(
      { ...DEFAULT_STUDIO_CONFIG, rows: { 5: 'sha_r5_concussion' } },
      'chain_heal',
    );
    workspace.remember({ ...DEFAULT_STUDIO_CONFIG, cls: 'warrior', spec: 'arms' }, 'execute');
    workspace.toggleFavourite('execute');
    const restored = new StudioWorkspace(storage);
    expect(restored.builds.get('shaman')?.rows?.[5]).toBe('sha_r5_concussion');
    expect(restored.builds.get('warrior')?.selected).toBe('execute');
    expect(restored.favourites.has('execute')).toBe(true);
    expect(restored.toggleFavourite('execute')).toBe(false);
  });
  it('drops unknown talents and IDs and tolerates blocked or corrupt storage', () => {
    const workspace = new StudioWorkspace({
      getItem: () =>
        JSON.stringify({
          builds: {
            shaman: { spec: 'restoration', rows: { 5: 'unknown' }, selected: 'fake' },
            warrior: { spec: 'missing', rows: {} },
          },
          favourites: ['execute', 'fake', '__proto__'],
        }),
      setItem: () => {
        throw Error();
      },
    });
    expect(workspace.builds.get('shaman')?.rows).toEqual({});
    expect(workspace.builds.has('warrior')).toBe(false);
    expect([...workspace.favourites]).toEqual(['execute']);
    expect(() => workspace.remember(DEFAULT_STUDIO_CONFIG, 'chain_heal')).not.toThrow();
    expect(new StudioWorkspace({ getItem: () => '{', setItem: () => {} }).builds.size).toBe(0);
  });
});
