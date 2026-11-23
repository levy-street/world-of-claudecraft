import { describe, expect, it } from 'vitest';
import {
  GAME_MODULES_ELEMENT_ID,
  gameModuleEntries,
  gameModuleFiles,
  injectGameModules,
} from '../scripts/lib/landing_game_modules.mjs';

// A miniature of the production bundle (Vite 8): index.html's entry chunk (src/boot.ts)
// shares a chunk with the client; src/main.ts sits in a facade-less chunk, because
// play.html enters it too, and that chunk pulls the renderer and three.
const bundle = {
  'assets/boot-1.js': {
    type: 'chunk',
    fileName: 'assets/boot-1.js',
    imports: ['assets/shared-2.js'],
    facadeModuleId: '/repo/index.html',
    moduleIds: ['/repo/index.html', '/repo/src/boot.ts'],
  },
  'assets/shared-2.js': {
    type: 'chunk',
    fileName: 'assets/shared-2.js',
    imports: [],
    facadeModuleId: null,
  },
  'assets/main-3.js': {
    type: 'chunk',
    fileName: 'assets/main-3.js',
    imports: ['assets/shared-2.js', 'assets/renderer-4.js', 'assets/three-5.js'],
    facadeModuleId: null,
    moduleIds: ['/repo/src/game/start.ts', '/repo/src/main.ts'],
  },
  'assets/renderer-4.js': {
    type: 'chunk',
    fileName: 'assets/renderer-4.js',
    imports: ['assets/three-5.js'],
    facadeModuleId: null,
  },
  'assets/three-5.js': {
    type: 'chunk',
    fileName: 'assets/three-5.js',
    imports: [],
    facadeModuleId: null,
  },
  'assets/main-6.css': { type: 'asset', fileName: 'assets/main-6.css' },
};

describe('gameModuleFiles', () => {
  it('lists the client chunk first, then what it statically imports, minus what the entry loads', () => {
    expect(gameModuleFiles(bundle, 'assets/boot-1.js')).toEqual([
      'assets/main-3.js',
      'assets/renderer-4.js',
      'assets/three-5.js',
    ]);
  });

  it('finds the client chunk from a Windows path, or from a facade', () => {
    const win = {
      ...bundle,
      'assets/main-3.js': { ...bundle['assets/main-3.js'], moduleIds: ['C:\\repo\\src\\main.ts'] },
    };
    expect(gameModuleFiles(win, 'assets/boot-1.js')[0]).toBe('assets/main-3.js');
    const facade = {
      ...bundle,
      'assets/main-3.js': {
        ...bundle['assets/main-3.js'],
        facadeModuleId: '/repo/src/main.ts',
        moduleIds: [],
      },
    };
    expect(gameModuleFiles(facade, 'assets/boot-1.js')[0]).toBe('assets/main-3.js');
  });

  it('refuses a landing entry that statically reaches the client', () => {
    const eager = {
      ...bundle,
      'assets/boot-1.js': { ...bundle['assets/boot-1.js'], imports: ['assets/main-3.js'] },
    };
    expect(() => gameModuleFiles(eager, 'assets/boot-1.js')).toThrow(/statically imports/);
  });

  it("ignores a dependency's own src/main.ts", () => {
    const dep = {
      'assets/vendor-9.js': {
        type: 'chunk',
        fileName: 'assets/vendor-9.js',
        imports: [],
        facadeModuleId: null,
        moduleIds: ['/repo/node_modules/some-lib/src/main.ts'],
      },
      ...bundle,
    };
    expect(gameModuleFiles(dep, 'assets/boot-1.js')[0]).toBe('assets/main-3.js');
  });

  it('lists nothing when the bundle has no client chunk', () => {
    const { 'assets/main-3.js': _main, ...rest } = bundle;
    expect(gameModuleFiles(rest, 'assets/boot-1.js')).toEqual([]);
  });
});

describe('gameModuleEntries', () => {
  it('lists each client chunk with its uncompressed size, under the base path', () => {
    const sized = {
      ...bundle,
      'assets/main-3.js': { ...bundle['assets/main-3.js'], code: 'é'.repeat(5) },
      'assets/renderer-4.js': { ...bundle['assets/renderer-4.js'], code: 'abc' },
    };
    expect(gameModuleEntries(sized, 'assets/boot-1.js', '/')).toEqual([
      { url: '/assets/main-3.js', bytes: 10 },
      { url: '/assets/renderer-4.js', bytes: 3 },
      { url: '/assets/three-5.js', bytes: 0 },
    ]);
  });
});

describe('injectGameModules', () => {
  it('writes the list as a JSON block before </body>', () => {
    const html = injectGameModules('<html><body><p>x</p></body></html>', [
      { url: '/assets/main-3.js', bytes: 12 },
    ]);
    expect(html).toBe(
      `<html><body><p>x</p><script type="application/json" id="${GAME_MODULES_ELEMENT_ID}">[{"url":"/assets/main-3.js","bytes":12}]</script>\n</body></html>`,
    );
  });

  it('cannot close its own script element', () => {
    const html = injectGameModules('<body></body>', [{ url: '/a</script><b>.js', bytes: 1 }]);
    expect(html).not.toContain('</script><b>');
    expect(html).toContain('\\u003c/script>');
  });
});
