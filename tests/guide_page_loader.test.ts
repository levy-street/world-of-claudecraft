import { describe, expect, it, vi } from 'vitest';

const moduleLoads = vi.hoisted(() => ({ arena: 0, home: 0 }));

vi.mock('../src/guide/pages/home', () => {
  moduleLoads.home += 1;
  return {
    home: {
      render: () => '<h1>Home</h1>',
    },
  };
});

vi.mock('../src/guide/pages/arena', () => {
  moduleLoads.arena += 1;
  return {
    arena: {
      render: () => '<h1>Arena</h1>',
    },
  };
});

import { loadPage } from '../src/guide/pages';

describe('Guide page loader', () => {
  it('imports only the requested route module and reuses the loaded module', async () => {
    expect(moduleLoads).toEqual({ arena: 0, home: 0 });

    const home = await loadPage('home');
    expect(home?.render({ params: [], sub: '', titleKey: 'guide.nav.overview' })).toContain('Home');
    expect(moduleLoads).toEqual({ arena: 0, home: 1 });

    expect(await loadPage('missing')).toBeNull();
    expect(moduleLoads).toEqual({ arena: 0, home: 1 });

    expect(await loadPage('home')).toBe(home);
    expect(moduleLoads).toEqual({ arena: 0, home: 1 });

    const arena = await loadPage('arena');
    expect(arena?.render({ params: [], sub: 'arena', titleKey: 'guide.nav.arena' })).toContain(
      'Arena',
    );
    expect(moduleLoads).toEqual({ arena: 1, home: 1 });
  });
});
