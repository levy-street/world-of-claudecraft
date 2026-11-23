import { execSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { browserslistToTargets } from 'lightningcss';
import { defineConfig } from 'vite';
import { loadBrowserslistFloors } from './scripts/browserslist_targets.mjs';
import { BalancedSequencer } from './scripts/ci_balanced_sequencer.mjs';
// Untyped zero-dep build helper (same convention as the other scripts/*.mjs tools).
// vite.config.ts is outside tsconfig `include`, so this import is never type-checked.
import { templateModulepreload } from './scripts/i18n_modulepreload.mjs';
import {
  headStylesheetsBlockingBootSplash,
  moveHeadStylesheetsBehindBootSplash,
} from './scripts/lib/boot_splash_stylesheets.mjs';
import {
  emitCollisionOverridesModule,
  validateOverride,
} from './scripts/lib/collision_overrides_emit.mjs';
import {
  diagnosticsCaptureAllowed,
  diagnosticsReadAllowed,
} from './scripts/lib/diagnostics_capture_guard.mjs';
import { gameModuleEntries, injectGameModules } from './scripts/lib/landing_game_modules.mjs';
import { studioDevGuardMiddleware } from './scripts/lib/studio_dev_guard.mjs';
import { readBase, snapshotBase } from './scripts/lib/studio_map_base.mjs';
import { vitestBoundedRelatedPlugin } from './scripts/lib/vitest_bounded_related.mjs';
import { shouldDisableVitestFsModuleCache } from './scripts/lib/vitest_fs_module_cache.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const disableVitestFsModuleCache = shouldDisableVitestFsModuleCache(root);

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
  env(['WOC_DEV_API_TARGET']) ??
  (isDesktopDevBuild && desktopApiOrigin ? desktopApiOrigin : 'http://127.0.0.1:8787');
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
  ['/wallet-handoff', '/wallet-handoff.html'],
  ['/wallet-handoff/', '/wallet-handoff.html'],
  ['/privacy', '/privacy.html'],
  ['/privacy/', '/privacy.html'],
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
  const rewrite = (req: { url?: string }) => {
    const url = req.url ?? '';
    const pathOnly = url.split('?')[0];
    const target =
      STATIC_PAGE_ALIASES.get(pathOnly) ?? (isGuideSpaPath(pathOnly) ? '/guide.html' : undefined);
    if (target) req.url = target + url.slice(pathOnly.length);
  };
  const attach = (server: {
    middlewares: {
      use: (fn: (req: { url?: string }, res: unknown, next: () => void) => void) => void;
    };
  }) => {
    server.middlewares.use((req, _res, next) => {
      rewrite(req);
      next();
    });
  };
  return { name: 'woc-static-page-alias', configureServer: attach, configurePreviewServer: attach };
}

// Loopback same-origin guard in front of every ClaudeCraft Studio dev route
// (scripts/lib/studio_dev_guard.mjs). Registered before the Studio save plugins so
// their middlewares only ever see requests that passed it.
function studioDevGuardPlugin() {
  return {
    name: 'woc-studio-dev-guard',
    configureServer(server: {
      middlewares: { use: (fn: (req: unknown, res: unknown, next: () => void) => void) => void };
    }) {
      server.middlewares.use(studioDevGuardMiddleware);
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
    closeBundle() {
      const { map } = templateModulepreload({ root, outDir, base });
      // eslint-disable-next-line no-console
      console.log(
        `[i18n] modulepreload: templated ${Object.keys(map).length} locale chunk URLs into index.html`,
      );
    },
  };
}

// Runs after Vite injects the built CSS <link>s, so those move too; dev and build share it.
// The build re-reads its own output, so a Vite upgrade that injects CSS later fails loudly.
function bootSplashStylesheetsPlugin() {
  let outDir = path.resolve(root, 'dist');
  return {
    name: 'woc-boot-splash-stylesheets',
    transformIndexHtml: { order: 'post' as const, handler: moveHeadStylesheetsBehindBootSplash },
    configResolved(cfg: { root: string; build: { outDir: string } }) {
      outDir = path.resolve(cfg.root, cfg.build.outDir);
    },
    closeBundle() {
      for (const entry of ['index.html', 'play.html']) {
        const file = path.join(outDir, entry);
        if (!existsSync(file)) continue;
        const blocking = headStylesheetsBlockingBootSplash(readFileSync(file, 'utf8'));
        if (blocking.length > 0) {
          throw new Error(
            `${entry}: stylesheets left in <head> block the boot splash: ${blocking}`,
          );
        }
      }
    },
  };
}

// The landing-first boot prefetches the game client after the home page has loaded
// (src/ui/landing_first.ts). The client is a dynamic import of src/boot.ts, so its
// chunk URLs only exist in the bundle: list them into index.html as JSON. Build-only;
// in dev the list is absent and the prefetch is skipped.
function landingGameModulesPlugin() {
  let base = '/';
  return {
    name: 'woc-landing-game-modules',
    apply: 'build' as const,
    configResolved(cfg: { base: string }) {
      base = cfg.base || '/';
    },
    transformIndexHtml: {
      order: 'post' as const,
      handler(
        html: string,
        ctx: {
          path: string;
          bundle?: Record<string, { code?: string } & Record<string, unknown>>;
          chunk?: { fileName: string };
        },
      ) {
        if (!ctx.bundle || !/(^|\/)index\.html$/.test(ctx.path)) return html;
        const modules = gameModuleEntries(ctx.bundle, ctx.chunk?.fileName, base);
        if (modules.length === 0) {
          throw new Error(
            'index.html: found no src/main.ts chunk to list for the landing prefetch',
          );
        }
        return injectGameModules(html, modules);
      },
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
              '// editor, the tests, and the render tool alike (the shipped game streams the',
              '// remastered renders from public/audio/music/). Do not hand-edit: run',
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

// Dev-only save endpoint for the editor's dungeon mode (/editor, Dungeon
// button): receives a formatted DungeonLayout literal and splices it over the
// matching exported const in src/sim/dungeon_layout.ts, so the sim, renderer,
// colliders, minimap, and tests all pick the edit up via HMR. Same lifecycle
// as musicEditorSavePlugin: configureServer never runs in a build.
function dungeonEditorSavePlugin() {
  // The layout consts the editor may rewrite: one per AUTHORED_DUNGEONS entry
  // (src/editor/dungeon/authored_dungeons.ts). Empty while none is registered,
  // so the endpoint refuses every write.
  const ALLOWED_CONSTS = new Set<string>();
  // The writer emits only plain data: identifiers, numbers, single-quoted
  // slugs, and Math.PI fractions. Anything else (comments, semicolons,
  // backticks, imports) is rejected so the endpoint cannot inject code.
  const LITERAL_RE = /^\{[\w\s{}[\](),:.'+*/-]*\}$/;
  return {
    name: 'woc-dungeon-editor-save',
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
      server.middlewares.use('/__dungeon_editor/save', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('POST only');
          return;
        }
        let body = '';
        let aborted = false;
        req.setEncoding('utf8');
        req.on('data', (chunk) => {
          if (aborted) return;
          body += String(chunk);
          if (body.length > 4_000_000) {
            aborted = true;
            res.statusCode = 413;
            res.end('too large');
          }
        });
        req.on('end', () => {
          if (aborted) return;
          void (async () => {
            try {
              const payload = JSON.parse(body) as { constName?: unknown; literal?: unknown };
              const constName = payload.constName;
              const literal = payload.literal;
              // The literal is spliced verbatim into a source file, so validate
              // structurally, not just by shape: reject property access and call
              // chains (`a.b()`, `require`) that the character-class regex alone
              // would let through, then confirm it parses to plain data by
              // round-tripping it through the writer's own evaluator upstream.
              if (
                typeof constName !== 'string' ||
                !ALLOWED_CONSTS.has(constName) ||
                typeof literal !== 'string' ||
                !LITERAL_RE.test(literal) ||
                /\b(?:require|import|process|global|constructor|eval|Function)\b/.test(literal) ||
                /[a-zA-Z_$][\w$]*\s*\(/.test(literal.replace(/Math\.(?:PI|abs)/g, '')) ||
                /\.\s*[a-zA-Z_$]/.test(literal.replace(/Math\.(?:PI|abs)/g, ''))
              ) {
                res.statusCode = 400;
                res.end('invalid payload');
                return;
              }
              const { replaceLayoutConst } = await import(
                './src/editor/dungeon/dungeon_layout_writer_core'
              );
              const file = path.resolve(root, 'src/sim/dungeon_layout.ts');
              const source = readFileSync(file, 'utf8');
              writeFileSync(file, replaceLayoutConst(source, constName, literal));
              res.statusCode = 200;
              res.end('ok');
            } catch (err) {
              res.statusCode = 400;
              res.end(String(err));
            }
          })();
        });
      });
    },
  };
}

// Dev-only save endpoint for the editor's Ravenrift mode (/editor, Ravenrift
// button): receives the placement consts the author changed and splices each
// over the matching exported const in src/sim/battleground_layout.ts, so the
// sim, colliders, renderer, minimap and tests all pick the edit up via HMR and
// the file is ready to commit. Same lifecycle as dungeonEditorSavePlugin:
// configureServer never runs in a build, so this cannot ship.
function battlegroundEditorSavePlugin() {
  // Only the hand-authored placement lists may be rewritten. The derived
  // geometry (perimeter, keep walls) and every scalar stay code-owned.
  const ALLOWED_CONSTS = new Set([
    'BG_COVER_WALLS',
    'BG_CURTAIN_WALLS',
    'BG_GATEHOUSE_WALLS',
    'BG_KEEP_BARRICADES',
    'BG_GRAVEYARD_FENCES',
    'BG_COVER_PILLARS',
    'BG_COVER_CRATES',
    'BG_RUBBLE_PILES',
    'BG_SPEED_RUNES',
    'BG_POWER_RUNES',
    'BG_GRAVEYARDS',
    'BG_BASES',
  ]);
  // The writer emits only plain data: braces, brackets, the known field names,
  // numbers, and `true`. Anything else (comments, semicolons, backticks,
  // identifiers with call/member syntax) is rejected, so a body spliced into a
  // source file cannot carry code.
  const BODY_RE = /^[\s{}[\],:0-9.eE+-]*$/;
  const FIELD_RE = /\b(?!x|z|hw|hd|low|fence|team|flag|spawns|banner|true)[a-zA-Z_$][\w$]*/;
  return {
    name: 'woc-battleground-editor-save',
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
      server.middlewares.use('/__bg_editor/save', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('POST only');
          return;
        }
        let body = '';
        let aborted = false;
        req.setEncoding('utf8');
        req.on('data', (chunk) => {
          if (aborted) return;
          body += String(chunk);
          if (body.length > 4_000_000) {
            aborted = true;
            res.statusCode = 413;
            res.end('too large');
          }
        });
        req.on('end', () => {
          if (aborted) return;
          void (async () => {
            try {
              const payload = JSON.parse(body) as { changes?: unknown };
              const changes = payload.changes;
              if (!Array.isArray(changes) || changes.length === 0) {
                res.statusCode = 400;
                res.end('no changes');
                return;
              }
              for (const change of changes) {
                const c = change as { constName?: unknown; literal?: unknown; body?: unknown };
                const name = c.constName;
                const text = c.body;
                if (
                  typeof name !== 'string' ||
                  !ALLOWED_CONSTS.has(name) ||
                  typeof text !== 'string' ||
                  // structural check first, then a name check that catches any
                  // identifier the field whitelist does not name
                  !BODY_RE.test(
                    text.replace(/\b(?:x|z|hw|hd|low|fence|team|flag|spawns|banner|true)\b/g, ''),
                  ) ||
                  FIELD_RE.test(
                    text.replace(/\b(?:x|z|hw|hd|low|fence|team|flag|spawns|banner|true)\b/g, ''),
                  )
                ) {
                  res.statusCode = 400;
                  res.end(`invalid payload for ${String(name)}`);
                  return;
                }
              }
              const { applyChangedConsts } = await import(
                './src/editor/battleground/bg_layout_writer_core'
              );
              const file = path.resolve(root, 'src/sim/battleground_layout.ts');
              const source = readFileSync(file, 'utf8');
              writeFileSync(
                file,
                applyChangedConsts(source, changes as { constName: string; body: string }[]),
              );
              res.statusCode = 200;
              res.end('ok');
            } catch (err) {
              res.statusCode = 400;
              res.end(String(err));
            }
          })();
        });
      });
    },
  };
}

// Dev-only save endpoint for the editor's Collision Master tool: receives one
// asset's authored collision override (or null to clear it), merges it into
// data/asset_collision_overrides.json, and regenerates
// src/sim/asset_collision_overrides.generated.ts so the editor, playtest and
// tests pick the new default up immediately via HMR. configureServer only
// runs under the dev server, so this never ships.
function collisionMasterSavePlugin() {
  const generatedPath = path.resolve(root, 'src/sim/asset_collision_overrides.generated.ts');
  return {
    name: 'woc-collision-master-save',
    // Lock In writes a generated data module for the next boot. The editor has
    // already applied the same validated override to its live runtime, so HMR
    // must not tear down the current renderer and stream the map all over again.
    handleHotUpdate(ctx: { file: string }) {
      if (path.resolve(ctx.file) === generatedPath) return [];
      return undefined;
    },
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
      server.middlewares.use('/__collision_master/save', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('POST only');
          return;
        }
        // Cap generously: a maxed-out valid override (24 meshes * 3000 verts +
        // 6000 tri-indices each) serializes to ~1.1MB, so the old 1MB cap
        // rejected legitimate detailed collision. 32MB leaves headroom while
        // still blocking a runaway body.
        const MAX_BODY = 32 * 1024 * 1024;
        let body = '';
        let aborted = false;
        req.setEncoding('utf8');
        req.on('data', (chunk) => {
          if (aborted) return;
          body += String(chunk);
          if (body.length > MAX_BODY) {
            aborted = true; // stop accumulating and never double-end the response
            res.statusCode = 413;
            res.end('too large');
          }
        });
        req.on('end', () => {
          if (aborted) return;
          try {
            const payload = JSON.parse(body) as { assetId?: unknown; override?: unknown };
            const assetId = payload.assetId;
            if (typeof assetId !== 'string') {
              res.statusCode = 400;
              res.end('missing assetId');
              return;
            }
            const jsonPath = path.resolve(root, 'data/asset_collision_overrides.json');
            const overrides = JSON.parse(readFileSync(jsonPath, 'utf8')) as Record<string, unknown>;
            if (payload.override === null || payload.override === undefined) {
              delete overrides[assetId];
            } else {
              const err = validateOverride(assetId, payload.override);
              if (err) {
                res.statusCode = 400;
                res.end(err);
                return;
              }
              // Blender-authored ladders are not part of a Collision Master
              // session: carry them over so a save never drops them.
              const prev = overrides[assetId] as { ladders?: unknown } | undefined;
              const next = payload.override as { ladders?: unknown };
              if (prev?.ladders !== undefined && next.ladders === undefined) {
                next.ladders = prev.ladders;
              }
              overrides[assetId] = next;
            }
            const { source, errors } = emitCollisionOverridesModule(overrides);
            if (errors.length > 0) {
              res.statusCode = 400;
              res.end(errors.join('; '));
              return;
            }
            writeFileSync(jsonPath, `${JSON.stringify(overrides, null, 2)}\n`);
            writeFileSync(generatedPath, source);
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

// Region maps: the editor's "Export to production" writes the generated module
// for a region it opened (Open -> Shipped -> Ravenrift). The editor owns the
// split and the emit - both live in the pure core the CLI shares
// (src/editor/regions/region_export_core.ts) - so this endpoint only has to
// prove the bytes are a generated region module and put them in the right file.
function regionMapSavePlugin() {
  const REGION_IDS = new Set(['ravenrift']);
  const HEADER = '// GENERATED from the map editor';
  const regionsDir = path.resolve(root, 'src/sim/regions');
  return {
    name: 'woc-region-map-save',
    // Same reasoning as Collision Master: the editor already holds the map it
    // just exported, so tearing the page down to hot-reload a data module would
    // only cost the maker their camera and selection.
    handleHotUpdate(ctx: { file: string }) {
      if (path.dirname(path.resolve(ctx.file)) === regionsDir) return [];
      return undefined;
    },
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
      server.middlewares.use('/__region_map/save', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('POST only');
          return;
        }
        // A whole field of placements is a few hundred KB of source; the cap
        // matches the Collision Master endpoint's headroom.
        const MAX_BODY = 32 * 1024 * 1024;
        let body = '';
        let aborted = false;
        req.setEncoding('utf8');
        req.on('data', (chunk) => {
          if (aborted) return;
          body += String(chunk);
          if (body.length > MAX_BODY) {
            aborted = true;
            res.statusCode = 413;
            res.end('too large');
          }
        });
        req.on('end', () => {
          if (aborted) return;
          try {
            const payload = JSON.parse(body) as { regionId?: unknown; source?: unknown };
            const regionId = payload.regionId;
            const source = payload.source;
            if (typeof regionId !== 'string' || !REGION_IDS.has(regionId)) {
              res.statusCode = 400;
              res.end(`unknown region: ${String(regionId)}`);
              return;
            }
            if (typeof source !== 'string' || !source.startsWith(HEADER)) {
              res.statusCode = 400;
              res.end('not a generated region module');
              return;
            }
            if (!source.includes('AuthoredRegion | null =')) {
              res.statusCode = 400;
              res.end('module does not export a region');
              return;
            }
            // The id is allowlisted above, so this can only land in the regions
            // directory; resolve anyway and refuse anything that escapes it.
            const target = path.resolve(regionsDir, `${regionId}.authored.generated.ts`);
            if (path.dirname(target) !== regionsDir) {
              res.statusCode = 400;
              res.end('bad path');
              return;
            }
            writeFileSync(target, source);
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

// Studio "Publish to Game": writes a published map's three artifacts into the
// repo, data/maps/<slug>.map.json, src/sim/maps/<slug>.generated.ts, and the
// regenerated src/sim/maps/index.generated.ts registry. The editor does all
// the real work (prepareMapForEngine gate + map_publish_core emit); like the
// region endpoint above, this only proves the bytes are a generated module and
// puts them in the right files. Dev-only by construction (configureServer).
function studioMapPublishPlugin() {
  const HEADER = '// GENERATED by ClaudeCraft Studio "Publish to Game"';
  const SLUG_RE = /^[a-z0-9][a-z0-9_]{0,63}$/;
  const mapsDir = path.resolve(root, 'src/sim/maps');
  const dataDir = path.resolve(root, 'data/maps');
  const baseCacheDir = path.resolve(root, 'node_modules/.cache/studio-map-bases');
  // Registry regeneration mirrors src/editor/map_publish_core.ts
  // emitPublishedMapRegistry byte-for-byte: entries sorted by slug, metadata
  // re-read from each module on disk so the registry is always a pure
  // function of the maps directory.
  const regenRegistry = (): void => {
    const entries: { slug: string; name: string; seed: number }[] = [];
    for (const file of readdirSync(mapsDir).sort()) {
      const m = /^([a-z0-9][a-z0-9_]*)\.generated\.ts$/.exec(file);
      if (!m || file === 'index.generated.ts') continue;
      const source = readFileSync(path.resolve(mapsDir, file), 'utf8');
      const name = /export const MAP_NAME = (".*?");/.exec(source);
      const seed = /export const MAP_SEED = (-?\d+);/.exec(source);
      if (!name || !seed) continue;
      entries.push({
        slug: m[1],
        name: JSON.parse(name[1]) as string,
        seed: Number(seed[1]),
      });
    }
    const rows = entries
      .sort((a, b) => a.slug.localeCompare(b.slug))
      .map(
        (e) =>
          `\n  {\n    slug: ${JSON.stringify(e.slug)},\n    name: ${JSON.stringify(e.name)},\n    seed: ${JSON.stringify(e.seed)},\n    load: async () => (await import('./${e.slug}.generated')).loadPublishedMap(),\n  },`,
      )
      .join('');
    writeFileSync(
      path.resolve(mapsDir, 'index.generated.ts'),
      `${HEADER} - do not edit by hand.
// The registry of Studio-published maps. The game client boots one with
// ?map=<slug> (src/main.ts); dynamic import keeps map bytes out of the main
// bundle until a map is actually chosen.
import type { WorldContent } from '../types';

export interface PublishedMapEntry {
  slug: string;
  name: string;
  seed: number;
  load(): Promise<WorldContent>;
}

export const PUBLISHED_MAPS: readonly PublishedMapEntry[] = [${rows}
];

export function publishedMapBySlug(slug: string): PublishedMapEntry | undefined {
  return PUBLISHED_MAPS.find((m) => m.slug === slug);
}
`,
    );
  };
  return {
    name: 'woc-studio-map-publish',
    // Publishing must not tear the editor's page down: the maker already holds
    // the exact map that was just written, so hot-reloading the generated data
    // modules would only re-stream the world and lose camera + selection.
    handleHotUpdate(ctx: { file: string }) {
      const dir = path.dirname(path.resolve(ctx.file));
      if (dir === mapsDir || dir === dataDir) return [];
      return undefined;
    },
    configureServer(server: {
      middlewares: {
        use: (
          route: string,
          fn: (
            req: {
              method?: string;
              url?: string;
              on: (ev: string, cb: (chunk?: unknown) => void) => void;
            },
            res: { statusCode: number; end: (body?: string) => void },
          ) => void,
        ) => void;
      };
    }) {
      server.middlewares.use('/__studio_map/publish', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('POST only');
          return;
        }
        // A full-overworld publish (compact JSON + the embedded module copy)
        // runs tens of MB; double headroom over the biggest map seen so far.
        const MAX_BODY = 96 * 1024 * 1024;
        let body = '';
        let aborted = false;
        req.setEncoding('utf8');
        req.on('data', (chunk) => {
          if (aborted) return;
          body += String(chunk);
          if (body.length > MAX_BODY) {
            aborted = true;
            res.statusCode = 413;
            res.end('too large');
          }
        });
        req.on('end', () => {
          if (aborted) return;
          try {
            const payload = JSON.parse(body) as {
              slug?: unknown;
              mapJson?: unknown;
              moduleSource?: unknown;
            };
            const { slug, mapJson, moduleSource } = payload;
            if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
              res.statusCode = 400;
              res.end(`bad slug: ${String(slug)}`);
              return;
            }
            if (typeof moduleSource !== 'string' || !moduleSource.startsWith(HEADER)) {
              res.statusCode = 400;
              res.end('not a generated map module');
              return;
            }
            if (!moduleSource.includes('export function loadPublishedMap()')) {
              res.statusCode = 400;
              res.end('module does not export a map');
              return;
            }
            if (typeof mapJson !== 'string' || JSON.parse(mapJson) === null) {
              res.statusCode = 400;
              res.end('map json missing');
              return;
            }
            // The slug is pattern-gated above, so these can only land in the
            // two publish directories; resolve anyway and refuse an escape.
            const moduleTarget = path.resolve(mapsDir, `${slug}.generated.ts`);
            const jsonTarget = path.resolve(dataDir, `${slug}.map.json`);
            if (path.dirname(moduleTarget) !== mapsDir || path.dirname(jsonTarget) !== dataDir) {
              res.statusCode = 400;
              res.end('bad path');
              return;
            }
            mkdirSync(dataDir, { recursive: true });
            writeFileSync(jsonTarget, mapJson);
            writeFileSync(moduleTarget, moduleSource);
            regenRegistry();
            res.statusCode = 200;
            res.end('ok');
          } catch (err) {
            res.statusCode = 400;
            res.end(String(err));
          }
        });
      });

      // Uninstall a published map: delete its two artifacts and rebuild the
      // registry. The built-in world is never touched by publishing in the
      // first place (it is additive, the game only loads a published map on
      // an explicit ?map=<slug>), so removing the files IS the restore.
      server.middlewares.use('/__studio_map/unpublish', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('POST only');
          return;
        }
        let body = '';
        req.setEncoding('utf8');
        req.on('data', (chunk) => {
          // A slug is a few dozen bytes; anything larger is not this request.
          if (body.length < 4096) body += String(chunk);
        });
        req.on('end', () => {
          try {
            const { slug } = JSON.parse(body) as { slug?: unknown };
            if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
              res.statusCode = 400;
              res.end(`bad slug: ${String(slug)}`);
              return;
            }
            // Same resolve-and-verify guard as the publish route: the pattern
            // above already excludes traversal, this refuses anything that
            // still somehow lands outside the two publish directories.
            const moduleTarget = path.resolve(mapsDir, `${slug}.generated.ts`);
            const jsonTarget = path.resolve(dataDir, `${slug}.map.json`);
            if (path.dirname(moduleTarget) !== mapsDir || path.dirname(jsonTarget) !== dataDir) {
              res.statusCode = 400;
              res.end('bad path');
              return;
            }
            let removed = 0;
            for (const target of [moduleTarget, jsonTarget]) {
              if (existsSync(target)) {
                rmSync(target);
                removed++;
              }
            }
            regenRegistry();
            res.statusCode = 200;
            res.end(JSON.stringify({ removed }));
          } catch (err) {
            res.statusCode = 400;
            res.end(String(err));
          }
        });
      });
      // The published maps, for Studio's Open drawer: every data/maps/*.map.json
      // with the name/seed its meta carries. Publish is otherwise write-only
      // from the editor's point of view (SPACEY: "pressed Publish and the shipped
      // maps in the editor didn't update").
      server.middlewares.use('/__studio_map/published', (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405;
          res.end('GET only');
          return;
        }
        try {
          const out = [];
          if (existsSync(dataDir)) {
            for (const file of readdirSync(dataDir).sort()) {
              if (!file.endsWith('.map.json')) continue;
              const slug = file.slice(0, -'.map.json'.length);
              if (!SLUG_RE.test(slug)) continue;
              const full = path.resolve(dataDir, file);
              let name = slug;
              let seed = 0;
              try {
                const doc = JSON.parse(readFileSync(full, 'utf8'));
                if (doc && typeof doc === 'object' && doc.meta && typeof doc.meta === 'object') {
                  if (typeof doc.meta.name === 'string') name = doc.meta.name;
                  if (typeof doc.meta.seed === 'number') seed = doc.meta.seed;
                }
              } catch {
                // an unreadable file is still listed by its slug
              }
              const st = statSync(full);
              out.push({ slug, name, seed, bytes: st.size, updatedAt: st.mtime.toISOString() });
            }
          }
          res.statusCode = 200;
          res.end(JSON.stringify(out));
        } catch (err) {
          res.statusCode = 500;
          res.end(String(err));
        }
      });
      // One published map's document (the compact MapDoc the publish wrote),
      // so Studio can open it as an ordinary editable copy.
      server.middlewares.use('/__studio_map/doc', (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405;
          res.end('GET only');
          return;
        }
        const url = new URL(req.url ?? '', 'http://localhost');
        const slug = url.searchParams.get('slug') ?? '';
        if (!SLUG_RE.test(slug)) {
          res.statusCode = 400;
          res.end(`bad slug: ${slug}`);
          return;
        }
        const full = path.resolve(dataDir, `${slug}.map.json`);
        if (!existsSync(full)) {
          res.statusCode = 404;
          res.end('not published');
          return;
        }
        // Name this exact version as the base a later change-only push
        // compares against (scripts/lib/studio_map_base.mjs).
        const bytes = readFileSync(full);
        res.setHeader('x-studio-map-base', snapshotBase(baseCacheDir, bytes));
        res.statusCode = 200;
        res.end(bytes.toString('utf8'));
      });
      // One base version of a repo map by its blob id (a change-only push's
      // "where I started"): the cached copy, else git's own object.
      server.middlewares.use('/__studio_map/base', (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405;
          res.end('GET only');
          return;
        }
        const url = new URL(req.url ?? '', 'http://localhost');
        const text = readBase(baseCacheDir, root, url.searchParams.get('id') ?? '');
        if (text === null) {
          res.statusCode = 404;
          res.end('base not found');
          return;
        }
        res.statusCode = 200;
        res.end(text);
      });
    },
  };
}

// Studio "Keep plant": writes one generated foliage GLB into
// public/models/generated/<slug>.glb, where gen_asset_catalog.mjs picks it up
// on its next run and it becomes an ordinary catalogue asset. The editor does
// the real work (grows the model, serializes it, writes its source parameters
// into the GLB extras); like the map and region routes above, this only proves
// the bytes are a GLB and puts them in the right file. Dev-only by
// construction (configureServer).
function studioAssetSavePlugin() {
  const SLUG_RE = /^[a-z0-9][a-z0-9_]{0,63}$/;
  const MAX_BYTES = 24 * 1024 * 1024;
  const outDir = path.resolve(root, 'public/models/generated');
  return {
    name: 'woc-studio-asset-save',
    // Writing an asset must not tear the editor's page down: the maker is
    // still holding the plant they just baked.
    handleHotUpdate(ctx: { file: string }) {
      if (path.dirname(path.resolve(ctx.file)) === outDir) return [];
      return undefined;
    },
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
      server.middlewares.use('/__studio_asset/save', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('POST only');
          return;
        }
        // Base64 inflates by 4/3; leave headroom over the binary ceiling.
        const MAX_BODY = MAX_BYTES * 2;
        let body = '';
        let aborted = false;
        req.setEncoding('utf8');
        req.on('data', (chunk) => {
          if (aborted) return;
          body += String(chunk);
          if (body.length > MAX_BODY) {
            aborted = true;
            res.statusCode = 413;
            res.end('too large');
          }
        });
        req.on('end', () => {
          if (aborted) return;
          try {
            const payload = JSON.parse(body) as {
              slug?: unknown;
              glbBase64?: unknown;
              extras?: unknown;
            };
            const { slug, glbBase64, extras } = payload;
            if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
              res.statusCode = 400;
              res.end(`bad slug: ${String(slug)}`);
              return;
            }
            if (typeof glbBase64 !== 'string' || glbBase64.length === 0) {
              res.statusCode = 400;
              res.end('glb missing');
              return;
            }
            if (
              !extras ||
              typeof extras !== 'object' ||
              typeof (extras as { wocFoliage?: unknown }).wocFoliage !== 'number'
            ) {
              res.statusCode = 400;
              res.end('not a generated-foliage bake');
              return;
            }
            const bytes = Buffer.from(glbBase64, 'base64');
            if (bytes.length > MAX_BYTES) {
              res.statusCode = 413;
              res.end('too large');
              return;
            }
            // "glTF" in ASCII, little-endian: refuse anything that is not one.
            if (bytes.length < 12 || bytes.readUInt32LE(0) !== 0x46546c67) {
              res.statusCode = 400;
              res.end('not a binary GLB');
              return;
            }
            // The slug is pattern-gated above, so this can only land in the
            // generated directory; resolve anyway and refuse an escape.
            const target = path.resolve(outDir, `${slug}.glb`);
            if (path.dirname(target) !== outDir) {
              res.statusCode = 400;
              res.end('bad path');
              return;
            }
            mkdirSync(outDir, { recursive: true });
            writeFileSync(target, bytes);
            res.statusCode = 200;
            res.end(JSON.stringify({ path: `models/generated/${slug}.glb`, bytes: bytes.length }));
          } catch (err) {
            res.statusCode = 400;
            res.end(String(err));
          }
        });
      });
    },
  };
}

// Dev-only in-memory collector for an unattended local diagnostics run. Reports never
// touch disk and the endpoints do not exist in preview or production builds.
function diagnosticsCapturePlugin() {
  let latestReport = '';
  return {
    name: 'woc-diagnostics-capture',
    apply: 'serve' as const,
    configureServer(server: {
      middlewares: {
        use: (
          fn: (
            req: {
              url?: string;
              method?: string;
              headers: Record<string, string | string[] | undefined>;
              socket: { remoteAddress?: string };
              setEncoding: (encoding: BufferEncoding) => void;
              on: (event: string, callback: (chunk?: unknown) => void) => void;
            },
            res: {
              statusCode: number;
              setHeader: (name: string, value: string) => void;
              end: (body?: string) => void;
            },
            next: () => void,
          ) => void,
        ) => void;
      };
    }) {
      server.middlewares.use((req, res, next) => {
        const pathOnly = (req.url ?? '').split('?')[0];
        const host = Array.isArray(req.headers.host) ? req.headers.host[0] : req.headers.host;
        if (pathOnly === '/__diagnostics/latest') {
          if (req.method !== 'GET') {
            res.statusCode = 405;
            res.end('GET only');
            return;
          }
          if (!diagnosticsReadAllowed(req.socket.remoteAddress, host)) {
            res.statusCode = 403;
            res.end('loopback requests only');
            return;
          }
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
          res.statusCode = latestReport ? 200 : 404;
          res.end(latestReport || 'No completed diagnostics capture yet.');
          return;
        }
        if (pathOnly !== '/__diagnostics/capture') {
          next();
          return;
        }
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('POST only');
          return;
        }
        const origin = Array.isArray(req.headers.origin)
          ? req.headers.origin[0]
          : req.headers.origin;
        if (!diagnosticsCaptureAllowed(req.socket.remoteAddress, origin, host)) {
          res.statusCode = 403;
          res.end('loopback same-origin requests only');
          return;
        }
        let body = '';
        let bodyBytes = 0;
        let rejected = false;
        req.setEncoding('utf8');
        req.on('data', (chunk) => {
          if (rejected) return;
          const text = typeof chunk === 'string' ? chunk : String(chunk ?? '');
          bodyBytes += Buffer.byteLength(text, 'utf8');
          if (bodyBytes > 2_000_000) {
            rejected = true;
            res.statusCode = 413;
            res.end('report too large');
            return;
          }
          body += text;
        });
        req.on('end', () => {
          if (rejected) return;
          latestReport = body;
          res.statusCode = 204;
          res.end();
        });
      });
    },
  };
}

export default defineConfig({
  base: '/',
  // The Svelte plugin only transforms the standalone admin entry. The testing
  // plugins are scoped to Vitest so they cannot affect production client builds.
  // The bounded-related plugin swaps `vitest related`'s selection for a
  // same-result walk with bounded heap (scripts/lib/vitest_bounded_related.mjs):
  // the stock walk exhausted the CI main process's heap on this suite.
  plugins: [
    svelte(),
    ...(process.env.VITEST
      ? [svelteTesting({ autoCleanup: false }), vitestBoundedRelatedPlugin()]
      : []),
    staticPageAliasPlugin(),
    i18nModulepreloadPlugin(),
    bootSplashStylesheetsPlugin(),
    landingGameModulesPlugin(),
    musicEditorSavePlugin(),
    studioDevGuardPlugin(),
    dungeonEditorSavePlugin(),
    battlegroundEditorSavePlugin(),
    collisionMasterSavePlugin(),
    regionMapSavePlugin(),
    studioMapPublishPlugin(),
    studioAssetSavePlugin(),
    ...(process.env.WOC_DIAGNOSTICS_CAPTURE === '1' ? [diagnosticsCapturePlugin()] : []),
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
    // Dev-only: never let the browser reuse cached asset bytes. GLBs and other
    // public/ files are fetched LAZILY by the asset loader, after page load, so
    // even a hard refresh (which bypasses cache only for the document's own
    // requests) can leave a replaced model serving day-old bytes from disk
    // cache; a swapped weapon or creature GLB then "looks exactly the same"
    // through any number of reloads. Prod is unaffected (this is the dev
    // server block); prod busts via content-hashed /media/ URLs instead.
    headers: { 'Cache-Control': 'no-store' },
    // Vite's default watch ignore list is only .git, node_modules, test-results,
    // cacheDir and outDir, so the dev watcher otherwise descends into every agent
    // runtime directory at the repo root. A linked worktree parked under one of them
    // is a full second checkout: its 7 root *.html entries each trigger a page reload
    // on change (Vite reloads for ANY watched .html, in the module graph or not), and
    // its tsconfig.json triggers a full reload plus a moduleGraph.invalidateAll().
    // Creating, deleting, or switching branches inside such a worktree rewrites all of
    // them at once, so the served game reloads for edits that cannot reach it. Same
    // rows as `test.exclude` below (see its comment), for the same reason; pinned by
    // tests/vite_dev_watch.test.ts.
    watch: {
      ignored: [
        '**/.claude/**',
        '**/.codex/**',
        '**/.agents/**',
        '**/.worktrees/**',
        '**/.wt/**',
        '**/.venv/**',
        '**/tmp/**',
      ],
    },
    proxy: {
      '/api': { target: apiProxyTarget, changeOrigin: true },
      '/admin/api': { target: apiProxyTarget, changeOrigin: true },
      '/ws': { target: wsProxyTarget, ws: true },
      // MediaWiki community wiki runs as its own container on :8080. Proxy /wiki*
      // to it so the in-app "Browse the Wiki" link resolves in dev too — mirrors
      // the prod reverse-proxy route (nginx /wiki -> :8080). Needs the container
      // up: `docker compose up -d mediawiki mediawiki-db`.
      '/wiki': { target: 'http://127.0.0.1:8080', changeOrigin: true },
      // No '/terms' proxy: STATIC_PAGE_ALIASES above already serves the
      // Marketplace consent links' target from public/terms.html in dev, and a
      // prefix proxy captured the rewritten '/terms.html' and made the page
      // depend on a running game server with a built dist/.
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
        guide: fileURLToPath(new URL('guide.html', import.meta.url)),
        editor: fileURLToPath(new URL('editor.html', import.meta.url)),
        walletHandoff: fileURLToPath(new URL('wallet-handoff.html', import.meta.url)),
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
    // happy-dom resolves a relative resource URL against its window origin,
    // which vitest defaults to http://localhost:3000, and then opens a REAL
    // socket to that port. Nothing is listening, so several DOM-env window
    // suites (professions, perfecting) printed one ECONNREFUSED AggregateError
    // per request on top of otherwise green output. Traced with a
    // net.Socket.prototype.connect probe, the requests are the character
    // model preloads (`/models/weapons/sword_1handed.glb` and kin), reached
    // through the painters those suites import.
    //
    // The virtual server is what a happy-dom origin is SUPPOSED to have: it
    // resolves the origin against the filesystem instead of the network, and
    // `public/` is exactly what Vite (and server/main.ts serveStatic) serves
    // at that origin, so `/models/...` now resolves to the same bytes a real
    // browser would get, and a path with no file answers 404 locally. Nothing
    // opens a socket either way. Disabling resource loading was tried first
    // and is NOT the fix here: the loaders these suites trip are neither the
    // CSS nor the JS one, so `disableCSSFileLoading`/`disableJavaScriptFileLoading`
    // left the noise exactly where it was. A fetch interceptor cannot be used
    // at all: environmentOptions is structured-cloned to the worker, so a
    // function value throws before any test runs.
    environmentOptions: {
      happyDOM: {
        settings: {
          fetch: {
            virtualServers: [
              {
                url: 'http://localhost:3000',
                directory: fileURLToPath(new URL('public', import.meta.url)),
              },
            ],
          },
        },
      },
    },
    // Sharding: BalancedSequencer (LPT over MEASURED per-file durations,
    // scripts/ci_shard_weights.generated.json, harvested from green CI runs
    // by scripts/ci_shard_weights_harvest.mjs). Re-wired 2026-08-14: the D11
    // follow-on's LPT missed its bar on static import-cost weights and
    // stripe re-measured WORSE than sha1-contiguous with real durations.
    // Measured on the lane-excluded shard pool, scored in real ms: contiguous
    // worst 10.49m, measured-LPT worst 9.79m spread 0.06m; the
    // measured-scale FALLBACK for unknown files is load-bearing (raw
    // heuristic units regressed to 11.21m). shard() only runs under --shard, so unsharded
    // local runs are untouched. passWithNoTests false so an empty pack
    // cannot green the sequencer.
    sequence: { sequencer: BalancedSequencer },
    passWithNoTests: false,
    globalSetup: ['./tests/global_setup.ts'],
    // Runs per test file (unlike globalSetup, which runs once outside any
    // DOM environment). Needed on Node 22+ for jsdom and happy-dom files;
    // no-op when `window` is absent (default node env). See the file.
    setupFiles: ['./tests/svelte_testing_setup.ts', './tests/jsdom_local_storage_setup.ts'],
    // Two kinds of exclusion, kept together:
    // - agent-runtime directories may contain local worktree copies, and their tracked
    //   config or instruction files are not product test sources. Excluding them keeps a
    //   stale local worktree from duplicating tests. .venv is local Python tooling.
    //   .worktrees/ is the repo's own gitignored convention for local linked worktrees
    //   (see .gitignore), while .wt/ is the OSS Brain linked-worktree cache used by
    //   release automation. These entries are root-relative on purpose: an active
    //   checkout can itself live under .wt/, and an absolute-style **/.wt/** pattern
    //   hides its entire suite. Leaving either parked-worktree directory out of this
    //   list means a stale branch snapshot can fail tests/architecture.test.ts or
    //   tests/localization_fixes.test.ts and block pre-push for reasons unrelated to
    //   the current branch.
    // - the opt-in browser suite (vitest.browser.config.ts, npm run test:browser) must NOT
    //   leak into a bare `vitest run`: excluding its files keeps the default Node run from
    //   importing the Playwright provider or launching a browser. Cross-engine CI is P17b.
    // - tmp/ is gitignored scratch (screenshot tours, the new:endpoint golden test's emitted
    //   *.test.ts under a temp root); excluding it keeps a crashed golden run's orphan emitted
    //   test out of a bare `vitest run`. The golden test runs its emitted test through a child
    //   vitest with an explicit --config override so this exclude does not block it.
    // - docs/ carries handoff snapshots that copy another branch's code in at its
    //   ORIGINAL repo-relative path (docs/rallycart-mount/reference/, regenerated by
    //   its own refresh script), so the tree holds *.test.ts files that are reference
    //   TEXT, not product test sources: their imports resolve against the path they
    //   were copied from and would fail a bare `vitest run`. Documentation never
    //   holds a real suite, so the whole directory is excluded rather than each copy.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '.claude/**',
      '.codex/**',
      '.agents/**',
      '.worktrees/**',
      '.wt/**',
      '.venv/**',
      'tmp/**',
      'docs/**',
      'tests/browser/**',
      '**/*.browser.test.ts',
    ],
    // The world grew from 3 zones to 11 and Sim construction/tick cost with
    // it: the long tick-loop tests written against the 3-zone world brush
    // vitest's 5s default under full-suite parallel load and flip flakily by
    // scheduling luck. Seed sweeps use subsystem-sized world fixtures instead of
    // repeatedly constructing unrelated ambient content, so 20s remains honest
    // headroom for the current world size; deliberately long walkers keep their
    // own explicit budgets.
    testTimeout: 20000,
    // Phase 4 local-gate-perf: persist Vite module transform cache across runs
    // (Vitest 4.1 experimental.fsModuleCache). Default path is under
    // node_modules/.experimental-vitest-cache (gitignored via node_modules/).
    // OSS Brain linked worktrees symlink node_modules back to the parent checkout,
    // and base-health gates run from that parent checkout under ORCH. Both shapes
    // can contend on the same experimental temp-file store and fail before
    // reporting parseable tests. Disable it for OSS Brain-controlled checkouts;
    // normal local checkouts and CI keep the warm-cache path.
    // Clear with `npx vitest --clearCache` if a warm run misbehaves. Full gate
    // remains the merge bar; this speeds warm re-runs and related/day-loop paths.
    experimental: {
      fsModuleCache: !disableVitestFsModuleCache,
    },
  },
});
