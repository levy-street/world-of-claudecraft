import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { browserslistToTargets } from 'lightningcss';
import { defineConfig } from 'vite';
import { loadBrowserslistFloors } from './scripts/browserslist_targets.mjs';
// Untyped zero-dep build helper (same convention as the other scripts/*.mjs tools).
// vite.config.ts is outside tsconfig `include`, so this import is never type-checked.
import { templateModulepreload } from './scripts/i18n_modulepreload.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));

// Lightning CSS engine targets, derived from .browserslistrc (the single source of
// the floor) via the zero-dep parser, never a hand-typed object. Drives both the
// CSS transform and the minifier below, so the floor governs which prefixes and
// fallbacks survive minification (for example the -webkit-backdrop-filter twin).
const cssTargets = browserslistToTargets(
  loadBrowserslistFloors(fileURLToPath(new URL('.browserslistrc', import.meta.url))),
);

// `#bot-detector` → the private detector if its clone is present, else the no-op
// stub. Mirrors scripts/build_server.mjs (bundle) and tsconfig.json `paths` (tsc).
const privateBotDetector = fileURLToPath(
  new URL('private/bot_detector/src/index.ts', import.meta.url),
);
const botDetectorImpl = existsSync(privateBotDetector)
  ? privateBotDetector
  : fileURLToPath(new URL('server/bot_detector/stub.ts', import.meta.url));
const pkg = JSON.parse(readFileSync(new URL('package.json', import.meta.url), 'utf8')) as {
  version?: string;
};

function env(names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

function gitSha(): string | undefined {
  try {
    return execSync('git rev-parse --short=12 HEAD', {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
}

const appVersion = pkg.version ?? env(['APP_VERSION', 'npm_package_version']) ?? '0.0.0';
const appBuildDate = env(['APP_BUILD_DATE', 'BUILD_DATE']) ?? new Date().toISOString();
const appBuildId =
  env([
    'APP_BUILD_ID',
    'APP_BUILD_NUMBER',
    'BUILD_NUMBER',
    'GITHUB_RUN_NUMBER',
    'RENDER_BUILD_ID',
    'RENDER_GIT_COMMIT',
    'VERCEL_GIT_COMMIT_SHA',
    'CF_PAGES_COMMIT_SHA',
  ]) ??
  gitSha() ??
  appBuildDate.replace(/[-:TZ.]/g, '').slice(0, 12);
const desktopApiOrigin = env(['VITE_DESKTOP_API_ORIGIN']);
const isDesktopDevBuild = env(['VITE_DESKTOP_APP']) === '1';
const apiProxyTarget =
  isDesktopDevBuild && desktopApiOrigin ? desktopApiOrigin : 'http://127.0.0.1:8787';
const patchNotesProxyTarget =
  env(['VITE_PATCH_NOTES_API_ORIGIN']) ?? 'https://worldofclaudecraft.com';
const leaderboardProxyTarget =
  env(['VITE_HIGHSCORES_API_ORIGIN', 'VITE_LEADERBOARD_API_ORIGIN']) ??
  'https://worldofclaudecraft.com';
const projectStatsProxyTarget =
  env(['VITE_PROJECT_STATS_API_ORIGIN']) ?? 'https://worldofclaudecraft.com';
const wsProxyTarget = apiProxyTarget.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');

// Pretty-URL aliases for standalone static HTML pages. Mirrors the production
// server rewrite in server/main.ts so these paths resolve in dev and preview too.
const STATIC_PAGE_ALIASES = new Map([
  ['/links', '/links.html'],
  ['/links/', '/links.html'],
  ['/social', '/links.html'],
  ['/social/', '/links.html'],
  ['/social-media-links', '/links.html'],
  ['/social-media-links/', '/links.html'],
  ['/play', '/play.html'],
  ['/play/', '/play.html'],
  ['/app', '/app.html'],
  ['/app/', '/app.html'],
  ['/privacy', '/privacy.html'],
  ['/highscores', '/highscores.html'],
  ['/highscores/', '/highscores.html'],
  ['/patch-notes', '/patch-notes.html'],
  ['/patch-notes/', '/patch-notes.html'],
  ['/news', '/news.html'],
  ['/news/', '/news.html'],
  ['/download', '/download.html'],
  ['/download/', '/download.html'],
  ['/community', '/community.html'],
  ['/community/', '/community.html'],
  ['/privacy/', '/privacy.html'],
  ['/cookies', '/cookies.html'],
  ['/cookies/', '/cookies.html'],
  ['/terms', '/terms.html'],
  ['/terms/', '/terms.html'],
  ['/merch', '/merch.html'],
  ['/merch/', '/merch.html'],
  ['/press', '/press.html'],
  ['/press/', '/press.html'],
  ['/data-deletion', '/data-deletion.html'],
  ['/data-deletion/', '/data-deletion.html'],
  ['/support', '/support.html'],
  ['/support/', '/support.html'],
  ['/wiki', '/guide.html'],
  ['/wiki/', '/guide.html'],
  ['/editor', '/editor.html'],
  ['/editor/', '/editor.html'],
]);
// The Guide is the site wiki: a client-routed SPA at /wiki. Deep paths like
// /wiki/classes/warrior have no static file, so any extensionless /wiki* request falls
// back to guide.html (mirrored in server/main.ts serveStatic). Asset requests under
// /wiki keep their extension and are left alone so they 404 rather than serving HTML.
function isGuideSpaPath(pathOnly: string): boolean {
  if (pathOnly !== '/wiki' && !pathOnly.startsWith('/wiki/')) return false;
  const last = pathOnly.slice(pathOnly.lastIndexOf('/') + 1);
  return !last.includes('.');
}
function staticPageAliasPlugin() {
  const generatedLandingShells = new Set([
    '/download.html',
    '/highscores.html',
    '/news.html',
    '/patch-notes.html',
  ]);
  const rewrite = (req: { url?: string }, useGeneratedLandingShells: boolean) => {
    const url = req.url ?? '';
    const pathOnly = url.split('?')[0];
    let target =
      STATIC_PAGE_ALIASES.get(pathOnly) ?? (isGuideSpaPath(pathOnly) ? '/guide.html' : undefined);
    // Route-specific shells are emitted only by a production build. During `vite`
    // development, retain the shared source shell; runtime head management supplies
    // the same route metadata once the app starts.
    if (!useGeneratedLandingShells && target && generatedLandingShells.has(target)) {
      target = '/index.html';
    }
    if (target) req.url = target + url.slice(pathOnly.length);
  };
  const attach = (
    server: {
      middlewares: {
        use: (fn: (req: { url?: string }, res: unknown, next: () => void) => void) => void;
      };
    },
    useGeneratedLandingShells: boolean,
  ) => {
    server.middlewares.use((req, _res, next) => {
      rewrite(req, useGeneratedLandingShells);
      next();
    });
  };
  return {
    name: 'woc-static-page-alias',
    configureServer: (server: Parameters<typeof attach>[0]) => attach(server, false),
    configurePreviewServer: (server: Parameters<typeof attach>[0]) => attach(server, true),
  };
}

// The four public landing views are one app shell, but they are individual search
// destinations. Build static HTML variants so crawlers and social previews receive
// their route-specific head tags before JavaScript executes.
const LANDING_ROUTE_STATIC_SEO = [
  {
    path: '/download',
    file: 'download.html',
    title: 'Download World of ClaudeCraft | Desktop Launcher',
    description:
      'Download the World of ClaudeCraft desktop launcher for a dedicated classic-style MMO experience.',
  },
  {
    path: '/highscores',
    file: 'highscores.html',
    title: 'World of ClaudeCraft High Scores | Global Leaderboard',
    description:
      'Explore the World of ClaudeCraft global leaderboard and see the adventurers leading the realm.',
  },
  {
    path: '/news',
    file: 'news.html',
    title: 'World of ClaudeCraft News & Updates',
    description:
      'Read the latest World of ClaudeCraft news, community stories, livestream updates, and announcements.',
  },
  {
    path: '/patch-notes',
    file: 'patch-notes.html',
    title: 'World of ClaudeCraft Patch Notes | Latest Updates',
    description:
      'Read the latest World of ClaudeCraft patch notes, releases, improvements, and game updates.',
  },
] as const;

function routeStaticHtml(html: string, page: (typeof LANDING_ROUTE_STATIC_SEO)[number]): string {
  const canonical = `https://worldofclaudecraft.com${page.path}`;
  const meta = (attribute: string, value: string) => `<meta ${attribute} content="${value}" />`;
  const pageJsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    '@id': `${canonical}#webpage`,
    url: canonical,
    name: page.title,
    description: page.description,
    inLanguage: 'en',
    isPartOf: { '@id': 'https://worldofclaudecraft.com/#website' },
  });

  return html
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, `<title>${page.title}</title>`)
    .replace(/<meta\b[^>]*name="description"[^>]*>/i, meta('name="description"', page.description))
    .replace(/<meta\b[^>]*property="og:title"[^>]*>/i, meta('property="og:title"', page.title))
    .replace(/<meta\b[^>]*property="og:description"[^>]*>/i, meta('property="og:description"', page.description))
    .replace(/<meta\b[^>]*property="og:url"[^>]*>/i, meta('property="og:url"', canonical))
    .replace(/<meta\b[^>]*name="twitter:title"[^>]*>/i, meta('name="twitter:title"', page.title))
    .replace(/<meta\b[^>]*name="twitter:description"[^>]*>/i, meta('name="twitter:description"', page.description))
    .replace(/<link rel="canonical" href="[^"]*"\s*\/>/i, `<link rel="canonical" href="${canonical}" />`)
    .replace(
      /<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"\s*\/>/g,
      (_match, locale: string, href: string) => {
        const alternate = new URL(href);
        alternate.pathname = page.path;
        return `<link rel="alternate" hreflang="${locale}" href="${alternate}" />`;
      },
    )
    .replace('</head>', `  <script id="landing-route-structured-data" type="application/ld+json">${pageJsonLd}</script>\n</head>`);
}

function landingRouteStaticSeoPlugin() {
  let outDir = path.resolve(root, 'dist');
  return {
    name: 'woc-landing-route-static-seo',
    apply: 'build' as const,
    configResolved(cfg: { root: string; build: { outDir: string } }) {
      outDir = path.isAbsolute(cfg.build.outDir) ? cfg.build.outDir : path.resolve(cfg.root, cfg.build.outDir);
    },
    writeBundle() {
      const indexPath = path.join(outDir, 'index.html');
      if (!existsSync(indexPath)) return;
      const indexHtml = readFileSync(indexPath, 'utf8');
      for (const page of LANDING_ROUTE_STATIC_SEO) {
        writeFileSync(path.join(outDir, page.file), routeStaticHtml(indexHtml, page));
      }
    },
  };
}
// Phase 4 (i18n Lazy Locales): after the production build, resolve each lazy locale
// chunk's content-hashed URL from Vite's manifest and template a { locale: hashedChunkUrl }
// lookup into dist/index.html. The inline boot <script> reads it to modulepreload a stored
// non-en visitor's locale chunk before main parses. Build-only: in dev the inline script's
// sentinel stays undefined (no-op). The manifest is metadata, so enabling it does not move
// the resolved-table SHA. See scripts/i18n_modulepreload.mjs.
function i18nModulepreloadPlugin() {
  let outDir = path.resolve(root, 'dist');
  let base = '/';
  return {
    name: 'woc-i18n-modulepreload',
    apply: 'build' as const,
    configResolved(cfg: { root: string; base: string; build: { outDir: string } }) {
      base = cfg.base || '/';
      outDir = path.isAbsolute(cfg.build.outDir)
        ? cfg.build.outDir
        : path.resolve(cfg.root, cfg.build.outDir);
    },
    writeBundle() {
      const { map } = templateModulepreload({ root, outDir, base });
      // eslint-disable-next-line no-console
      console.log(
        `[i18n] modulepreload: templated ${Object.keys(map).length} locale chunk URLs into index.html`,
      );
    },
  };
}

// Dev-only save endpoint for the music editor (music_editor.html): receives the
// edited theme map as JSON and writes src/game/music_overrides.generated.ts so
// the game, tests, and render tool pick the edits up immediately via HMR.
// configureServer only runs under the dev server, so this never ships.
function musicEditorSavePlugin() {
  const INST_RE = /^[a-zA-Z]{2,20}$/;
  const NAME_RE = /^[a-z0-9_]{1,40}$/;
  type RawEvent = { beat?: unknown; midi?: unknown; dur?: unknown; vel?: unknown; inst?: unknown };
  type RawTheme = { bpm?: unknown; bars?: unknown; events?: RawEvent[] };
  const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const validTheme = (t: RawTheme): boolean =>
    !!t &&
    isNum(t.bpm) &&
    t.bpm > 20 &&
    t.bpm < 400 &&
    Number.isInteger(t.bars) &&
    (t.bars as number) > 0 &&
    (t.bars as number) <= 128 &&
    Array.isArray(t.events) &&
    t.events.length <= 20000 &&
    t.events.every(
      (e) =>
        isNum(e.beat) &&
        isNum(e.midi) &&
        isNum(e.dur) &&
        isNum(e.vel) &&
        typeof e.inst === 'string' &&
        INST_RE.test(e.inst),
    );
  const round = (v: number, places: number) => {
    const p = 10 ** places;
    return Math.round(v * p) / p;
  };
  return {
    name: 'woc-music-editor-save',
    configureServer(server: {
      middlewares: {
        use: (
          route: string,
          fn: (
            req: { method?: string; on: (ev: string, cb: (chunk?: unknown) => void) => void },
            res: { statusCode: number; end: (body?: string) => void },
          ) => void,
        ) => void;
      };
    }) {
      server.middlewares.use('/__music_editor/save', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('POST only');
          return;
        }
        let body = '';
        req.on('data', (chunk) => {
          body += String(chunk);
          if (body.length > 8_000_000) {
            res.statusCode = 413;
            res.end('too large');
          }
        });
        req.on('end', () => {
          try {
            type SavedEvent = {
              beat: number;
              midi: number;
              dur: number;
              vel: number;
              inst: string;
            };
            type SavedTheme = { bpm: number; bars: number; events: SavedEvent[] };
            const overrides = JSON.parse(body) as Record<string, SavedTheme>;
            const names = Object.keys(overrides);
            if (
              !names.every((n) => NAME_RE.test(n)) ||
              !names.every((n) => validTheme(overrides[n]))
            ) {
              res.statusCode = 400;
              res.end('invalid payload');
              return;
            }
            const lines: string[] = [
              '// Generated by music_editor.html (dev tool): themes edited in the browser are',
              '// saved here and override the composed versions in buildMusicThemes(), for the',
              '// game, the tests, and the render tool alike. Do not hand-edit: run',
              '// npm run dev, open /music_editor.html, edit, and press Save.',
              "import type { Theme } from './music';",
              '',
              'export const MUSIC_OVERRIDES: Record<string, Theme> = {',
            ];
            for (const name of names) {
              const t = overrides[name];
              lines.push(
                `  ${name}: {`,
                `    bpm: ${t.bpm},`,
                `    bars: ${t.bars},`,
                '    events: [',
              );
              const sorted = [...t.events].sort((a, b) => a.beat - b.beat);
              for (const e of sorted) {
                const vel = round(Math.min(1, Math.max(0.005, e.vel)), 3);
                lines.push(
                  '      { beat: ' +
                    round(e.beat, 4) +
                    ', midi: ' +
                    Math.round(e.midi) +
                    ', dur: ' +
                    round(e.dur, 4) +
                    ', vel: ' +
                    vel +
                    ", inst: '" +
                    e.inst +
                    "' },",
                );
              }
              lines.push('    ],', '  },');
            }
            lines.push('};', '');
            writeFileSync(
              path.resolve(root, 'src/game/music_overrides.generated.ts'),
              lines.join('\n'),
            );
            res.statusCode = 200;
            res.end('ok');
          } catch (err) {
            res.statusCode = 400;
            res.end(String(err));
          }
        });
      });
    },
  };
}

export default defineConfig({
  base: '/',
  // The Svelte plugin only transforms the standalone admin entry. The testing
  // plugin is scoped to Vitest so it cannot affect production client builds.
  plugins: [
    svelte(),
    ...(process.env.VITEST ? [svelteTesting()] : []),
    staticPageAliasPlugin(),
    i18nModulepreloadPlugin(),
    landingRouteStaticSeoPlugin(),
    musicEditorSavePlugin(),
  ],
  resolve: { alias: { '#bot-detector': botDetectorImpl } },
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __APP_BUILD_ID__: JSON.stringify(appBuildId.slice(0, 12)),
    __APP_BUILD_DATE__: JSON.stringify(appBuildDate),
  },
  // Lightning CSS handles all CSS transform and minify. Under the lightningcss
  // transformer css.postcss is inert, so no postcss.config is consulted and the
  // project stays vanilla (no Tailwind, no PostCSS plugins).
  css: {
    transformer: 'lightningcss',
    lightningcss: { targets: cssTargets },
  },
  server: {
    port: 5173,
    proxy: {
      // Patch notes are a global public feed, not realm-local game state. Keep
      // them available when the local game server is not running (including
      // `vite preview` on :4173), while retaining an env override for backend work.
      '/api/releases': { target: patchNotesProxyTarget, changeOrigin: true },
      // The homepage global board is a public read. During website-only work,
      // route it to the live source instead of a missing local game server.
      // Production stays same-origin, while backend work can opt back into a
      // local/staging board through VITE_HIGHSCORES_API_ORIGIN.
      '/api/leaderboard': { target: leaderboardProxyTarget, changeOrigin: true },
      // The launcher count is another public, global read used by the homepage,
      // /play, and /app. Website-only dev/preview should show the same live total
      // instead of falling through to an absent local game server.
      '/api/project-stats': { target: projectStatsProxyTarget, changeOrigin: true },
      '/api': { target: apiProxyTarget, changeOrigin: true },
      '/admin/api': { target: apiProxyTarget, changeOrigin: true },
      '/ws': { target: wsProxyTarget, ws: true },
      // MediaWiki community wiki runs as its own container on :8080. Proxy /wiki*
      // to it so the in-app "Browse the Wiki" link resolves in dev too — mirrors
      // the prod reverse-proxy route (nginx /wiki -> :8080). Needs the container
      // up: `docker compose up -d mediawiki mediawiki-db`.
      '/wiki': { target: 'http://127.0.0.1:8080', changeOrigin: true },
    },
  },
  build: {
    target: 'es2022',
    cssMinify: 'lightningcss',
    chunkSizeWarningLimit: 1500,
    // Emit dist/.vite/manifest.json so the Phase 4 modulepreload hook can resolve each
    // lazy locale chunk's content-hashed filename. Metadata only - does not perturb the
    // bundle or move the resolved-table SHA.
    manifest: true,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('index.html', import.meta.url)),
        admin: fileURLToPath(new URL('admin.html', import.meta.url)),
        play: fileURLToPath(new URL('play.html', import.meta.url)),
        community: fileURLToPath(new URL('community.html', import.meta.url)),
        app: fileURLToPath(new URL('app.html', import.meta.url)),
        guide: fileURLToPath(new URL('guide.html', import.meta.url)),
        editor: fileURLToPath(new URL('editor.html', import.meta.url)),
      },
      output: {
        // three.js almost never changes between our releases and is the single
        // heaviest dependency in the game/editor bundles; splitting it into its
        // own chunk lets the browser fetch it in parallel with app code and
        // reuse the browser cache across app-only redeploys (its content hash
        // stays stable unless the three version itself bumps).
        manualChunks(id: string): string | undefined {
          if (id.includes('node_modules/three/')) return 'vendor-three';
          return undefined;
        },
      },
    },
  },
  test: {
    // server/db.ts (and every module importing it) requires DATABASE_URL at module
    // load. Locally db.ts fills it from .env; a CI checkout has no .env, so default
    // a dummy here to keep the suite runnable in plain Node. Unit tests never open
    // a connection (the pg Pool connects only on first query, and db-touching tests
    // use FakeDb/mocks), and a real DATABASE_URL from the shell still wins.
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL ?? 'postgres://vitest:vitest@127.0.0.1:5433/wocc_vitest_dummy',
    },
    globalSetup: ['./tests/global_setup.ts'],
    // Two kinds of exclusion, kept together:
    // - agent-runtime directories may contain local worktree copies, and their tracked
    //   config or instruction files are not product test sources. Excluding them keeps a
    //   stale local worktree from duplicating tests. .venv is local Python tooling.
    // - the opt-in browser suite (vitest.browser.config.ts, npm run test:browser) must NOT
    //   leak into a bare `vitest run`: excluding its files keeps the default Node run from
    //   importing the Playwright provider or launching a browser. Cross-engine CI is P17b.
    // - tmp/ is gitignored scratch (screenshot tours, the new:endpoint golden test's emitted
    //   *.test.ts under a temp root); excluding it keeps a crashed golden run's orphan emitted
    //   test out of a bare `vitest run`. The golden test runs its emitted test through a child
    //   vitest with an explicit --config override so this exclude does not block it.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.claude/**',
      '**/.codex/**',
      '**/.agents/**',
      '**/.venv/**',
      'tmp/**',
      'tests/browser/**',
      '**/*.browser.test.ts',
    ],
  },
});
