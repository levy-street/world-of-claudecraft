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
