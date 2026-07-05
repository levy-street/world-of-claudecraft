// Change-aware screenshot targets. Each target knows (a) which changed paths imply it
// (`when`, matched as path substrings) and (b) how to bring that screen up in the running
// offline client and which region to clip (`capture`). pr_screenshots.mjs maps a diff to
// the set of targets it implies and shoots exactly those, instead of a fixed tour.
//
// Adding coverage is one entry here, not a new script. Keep recipes offline-only (they
// drive window.__game directly: sim.addItem, hud.toggleBags/toggleMap, sim.player.pos).

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export const TARGETS = [
  {
    key: 'inventory',
    label: 'Inventory / bags',
    when: ['ui/bags', 'ui/inventory', 'ui/item', 'ui/vendor', 'ui/loot', 'sim/content/items'],
    // Fill the bags with a spread so the window has content, then open it and clip to #bags.
    async capture(page) {
      await page.evaluate(() => {
        const sim = window.__game?.sim;
        const ids = [
          'eastbrook_arming_sword',
          'apprentice_staff',
          'cryptbone_helm',
          'baked_bread',
          'minor_healing_potion',
          'minor_mana_potion',
          'boar_hide',
          'glade_pelt',
        ];
        for (const id of ids) {
          try {
            sim?.addItem(id, 1);
          } catch {}
        }
        // Force-hide then toggle so the open is deterministic regardless of prior state
        // (the same trick the bag_filter screenshot harness uses).
        const el = document.querySelector('#bags');
        if (el) el.style.display = 'none';
        window.__game?.hud?.toggleBags?.();
      });
      await wait(700);
      return { clip: '#bags' };
    },
  },
  {
    key: 'world-map',
    label: 'World map / zone',
    when: [
      'ui/map',
      'map_window',
      'minimap',
      'sim/content/zones',
      'sim/zone',
      'render/terrain',
      'render/world',
    ],
    // Teleport to a known landmark (offline, no dev command), open the world-map window,
    // and clip to it; fall back to the full frame if the window did not open.
    async capture(page) {
      await page.evaluate(() => {
        const p = window.__game?.sim?.player;
        if (p?.pos) {
          p.pos.x = 65; // Boar Meadow, Eastbrook Vale
          p.pos.z = 0;
        }
      });
      await wait(400);
      await page.evaluate(() => window.__game?.hud?.toggleMap?.());
      await wait(600);
      const open = await page.evaluate(() => {
        const w = document.querySelector('#map-window');
        return !!w && getComputedStyle(w).display !== 'none';
      });
      return open ? { clip: '#map-window' } : {};
    },
  },
];

// Map a list of changed file paths to the targets they imply (deduped, registry order).
export function resolveTargets(changedFiles) {
  return TARGETS.filter((t) => changedFiles.some((f) => t.when.some((w) => f.includes(w))));
}

// Every path a unified diff touches. Reads BOTH sides of each file header: an addition has
// only a real "+++ b/" path, a deletion only a real "--- a/" path (its "+++" side is
// /dev/null, which must still count as a visual change when a renderer/CSS file is removed).
export function diffChangedPaths(diff) {
  const paths = new Set();
  for (const m of diff.matchAll(/^(?:---|\+\+\+) [ab]\/(.+)$/gm)) paths.add(m[1]);
  return [...paths];
}

// Path prefixes/names that make a change "visual": the renderer, the HUD/UI, the extracted
// CSS, local input/camera/mobile controls, and the two HTML shells. A change here can alter
// what the client looks like even when it does not map to a specific window target above.
const VISUAL_PREFIXES = ['src/render/', 'src/ui/', 'src/styles/', 'src/game/'];
const VISUAL_FILES = ['index.html', 'play.html'];

// Not visual even under those prefixes: the i18n text tables (labels are text, not layout),
// and the test/doc files that sit alongside the code.
function isTextOrTest(path) {
  return (
    path.includes('i18n') ||
    path.includes('.test.') ||
    path.startsWith('tests/') ||
    path.endsWith('.md')
  );
}

function isVisualPath(path) {
  if (isTextOrTest(path)) return false;
  if (VISUAL_FILES.includes(path)) return true;
  return VISUAL_PREFIXES.some((p) => path.startsWith(p));
}

// A change touches the mobile/responsive surface: the mobile HUD CSS, the touch controls,
// or the /play shell (which carries its own chrome and mobile layout).
function isMobilePath(path) {
  return path.includes('hud.mobile') || path.includes('mobile') || path.includes('play.html');
}

// Decide, from the changed files alone, WHAT to shoot:
//   specific  the window targets the diff maps to (bags, world map, ...). Shot when non-empty.
//   generic   fallback HUD frames ('hud-desktop', optionally 'hud-mobile') used only when the
//             change is visual but maps to no specific window, so the reviewer still sees the
//             in-world view the change lives in.
//   isVisual  true when anything visual changed at all. When false, capture nothing: a
//             backend/data/i18n-only diff gets no screenshots.
// This is the whole "only shoot visual changes, and only the relevant sections" policy, kept
// pure so it is unit-tested without a browser.
export function classifyDiff(changedFiles) {
  const specific = resolveTargets(changedFiles);
  const visualFiles = changedFiles.filter(isVisualPath);
  const isVisual = specific.length > 0 || visualFiles.length > 0;

  let generic = [];
  if (specific.length === 0 && visualFiles.length > 0) {
    generic = ['hud-desktop'];
    if (visualFiles.some(isMobilePath)) generic.push('hud-mobile');
  }
  return { specific, generic, isVisual };
}
