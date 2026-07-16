// Change-aware screenshot targets. Each target knows (a) which changed paths imply it
// (`when`, matched as path substrings) and (b) how to bring that screen up in the running
// offline client and which region to clip (`capture`). pr_screenshots.mjs maps a diff to
// the set of targets it implies and shoots exactly those, instead of a fixed tour.
//
// Adding coverage is one entry here, not a new script. Keep recipes offline-only (they
// drive window.__game directly: sim.addItem, hud.toggleBags/toggleMap, sim.player.pos).

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Poll up to ~10s for `selector` to report a non-zero layout size, checking every
// 500ms. Some windows (crafting: several icon-bearing rows) settle their layout
// noticeably slower than others in headless swiftshader; a fixed wait is either
// too short (flaky) or wastefully long, so this returns as soon as it is ready.
async function pollForSize(page, selector, attempts = 20, intervalMs = 500) {
  for (let i = 0; i < attempts; i++) {
    await wait(intervalMs);
    const ready = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el || getComputedStyle(el).display === 'none') return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }, selector);
    if (ready) return true;
  }
  return false;
}

export const TARGETS = [
  {
    key: 'tank-defensive-cds',
    label: 'Tank defensive cooldowns',
    when: ['tests/tank_defensive_cds.test.ts'],
    variants: [
      {
        key: 'warrior-desktop',
        charClass: 'warrior',
        charName: 'Ironward',
        abilityId: 'ironhold',
        nearbyAbilityId: 'defensive_stance',
      },
      {
        key: 'paladin-desktop',
        charClass: 'paladin',
        charName: 'Dawnward',
        abilityId: 'sacred_bulwark',
        nearbyAbilityId: 'divine_protection',
      },
      {
        key: 'druid-desktop',
        charClass: 'druid',
        charName: 'Leafward',
        abilityId: 'primal_reflexes',
        nearbyAbilityId: 'barkskin',
      },
      {
        key: 'paladin-mobile',
        charClass: 'paladin',
        charName: 'Sunward',
        abilityId: 'sacred_bulwark',
        nearbyAbilityId: 'divine_protection',
        mobile: true,
      },
    ],
    async capture(page, variant) {
      await page.keyboard.press('Escape');
      await wait(400);
      await page.evaluate(() => {
        document.querySelector('.camera-prompt-confirm')?.click();
        document.querySelector('.tut-skip')?.click();
      });
      await wait(300);
      const setup = await page.evaluate((shot) => {
        const game = window.__game;
        const sim = game?.sim;
        const player = sim?.player;
        if (!sim || !player) return { known: false };
        sim.setPlayerLevel?.(20, player.id);
        player.gm = true;
        player.resource = player.maxResource;
        const resolved = sim.resolvedAbility?.(shot.abilityId);
        const known = !!resolved;
        if (known) {
          game.hud.hotbarActions[0] = { type: 'ability', id: shot.abilityId };
          game.hud.saveSlotMap?.();
          sim.castAbility?.(shot.abilityId, player.id);
        }
        game.hud.toggleSpellbook?.();
        return { known, abilityName: resolved?.def.name ?? shot.abilityId };
      }, variant);
      if (!setup.known) throw new Error(`${variant.abilityId} is not known at level 20`);
      const open = await pollForSize(page, '#spellbook', 20, 250);
      if (!open) throw new Error('spellbook did not open');
      await page.evaluate((shot) => {
        const row =
          document.querySelector(`.spell-row[data-ability-id="${shot.abilityId}"]`) ??
          document.querySelector(`.spell-row[data-ability-id="${shot.nearbyAbilityId}"]`);
        row?.scrollIntoView({ block: 'center' });
        if (row?.dataset.abilityId === shot.abilityId) {
          row.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
          row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        }
      }, variant);
      await wait(500);
      const surfaces = await page.evaluate(
        (shot, abilityName) => {
          const row = document.querySelector(`.spell-row[data-ability-id="${shot.abilityId}"]`);
          const actionSelector = shot.mobile
            ? '#mobile-action-ring .mobile-action-slot'
            : '#actionbar .action-btn';
          const action = Array.from(document.querySelectorAll(actionSelector)).find((button) =>
            button.getAttribute('aria-label')?.includes(abilityName),
          );
          const actionIcon = action?.querySelector('.icon-label');
          const game = window.__game;
          const player = game?.sim?.player;
          return {
            exactSpellRow: !!row && getComputedStyle(row).display !== 'none',
            exactAction: !!action && getComputedStyle(action).display !== 'none',
            actionIcon: !!actionIcon && getComputedStyle(actionIcon).backgroundImage !== 'none',
            auraActive: !!player?.auras.some((a) => a.id === shot.abilityId),
            auraPainted: document.querySelectorAll('#buff-bar .buff').length > 0,
            cooldownArmed: (player?.cooldowns.get(shot.abilityId) ?? 0) > 0,
          };
        },
        variant,
        setup.abilityName,
      );
      if (Object.values(surfaces).some((present) => !present)) {
        throw new Error(`missing ability surfaces: ${JSON.stringify(surfaces)}`);
      }
      return {};
    },
  },
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
  {
    key: 'crafting',
    label: 'Crafting window',
    when: ['ui/crafting_view', 'ui/crafting_window', 'sim/content/recipes', 'sim/professions'],
    // Grant a spread of reagents across a few professions so several recipes read
    // craftable, force-hide then toggle so the open is deterministic, and clip to
    // the window.
    async capture(page) {
      await page.evaluate(() => {
        const sim = window.__game?.sim;
        const ids = ['bone_fragments', 'linen_scrap', 'spider_leg'];
        for (const id of ids) {
          try {
            sim?.addItem(id, 10);
          } catch {}
        }
        const el = document.querySelector('#crafting-window');
        if (el) el.style.display = 'none';
        window.__game?.hud?.toggleCrafting?.();
      });
      // A first-open crafting window with several icon-bearing recipe rows takes
      // noticeably longer to lay out in headless swiftshader than the plain-list
      // bags/map windows do (getBoundingClientRect can report 0x0 for 2-4s), so
      // poll for a real size instead of guessing a fixed wait.
      const open = await pollForSize(page, '#crafting-window');
      return open ? { clip: '#crafting-window' } : {};
    },
  },
  {
    key: 'char-window',
    label: 'Character window',
    when: ['ui/char_window', 'ui/char_view'],
    async capture(page) {
      await page.evaluate(() => {
        const el = document.querySelector('#char-window');
        if (el) el.style.display = 'none';
        window.__game?.hud?.toggleChar?.();
      });
      await wait(700);
      const open = await page.evaluate(() => {
        const w = document.querySelector('#char-window');
        return !!w && getComputedStyle(w).display !== 'none';
      });
      return open ? { clip: '#char-window' } : {};
    },
  },
  {
    key: 'chat-general-tab',
    label: 'Chat window: General/Chat tab',
    when: ['log_event_route'],
    // Synthesize one entityId-anchored mob combat-flavor 'log' event (routes to the
    // Combat Log tab on this branch, General/Chat before the fix) and one anchorless
    // system 'log' event (always stays in General/Chat) through the real dispatch
    // (hud.handleEvents), then show the General/Chat tab so the routing is visible
    // without needing a live mob fight.
    async capture(page) {
      // Under CPU contention the #ui template clone (and window.__game) can land
      // well after enterOfflineGame's fixed settleMs; wait for it explicitly so
      // this target does not race a slow machine into an empty full-frame shot.
      await pollForSize(page, '#chatlog-wrap', 60, 500);
      await page.evaluate(() => {
        const hud = window.__game?.hud;
        if (!hud) return;
        hud.handleEvents([
          {
            type: 'log',
            text: 'The Greyjaw Ravager flies into a frenzy!',
            color: '#ff7a6a',
            entityId: 999999,
          },
          {
            type: 'log',
            text: 'Talents updated.',
            color: '#ffd100',
            pid: window.__game?.sim?.player?.id,
          },
        ]);
      });
      await wait(300);
      await page.evaluate(() => {
        document
          .querySelector('#chatlog-tabs button[data-tab="all"]')
          ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await wait(200);
      return { clip: '#chatlog-wrap' };
    },
  },
  {
    key: 'chat-combat-tab',
    label: 'Chat window: Combat Log tab',
    when: ['log_event_route'],
    // Runs on the same page right after chat-general-tab (targets share one browser
    // session in pr_screenshots.mjs), so the two synthetic lines from that capture
    // are still in the log; this just switches to the Combat Log tab to show them.
    async capture(page) {
      await page.evaluate(() => {
        document
          .querySelector('#chatlog-tabs button[data-tab="combat"]')
          ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await wait(200);
      return { clip: '#chatlog-wrap' };
    },
  },
  {
    key: 'gather-node',
    label: 'Gather node (click/tap-to-harvest, #1866)',
    when: ['gather_node', 'gather_nodes'],
    // Walks the player up to the first gather node the renderer actually built
    // (`renderer.gatherNodeMeshes`, the same list `pickGatherNode` raycasts),
    // so the frame shows the node the way a player would approach and click it.
    async capture(page) {
      await page.evaluate(() => {
        const game = window.__game;
        const mesh = game?.renderer?.gatherNodeMeshes?.[0];
        const p = game?.world?.player;
        if (!mesh || !p) return;
        p.pos.x = mesh.position.x + 2.5;
        p.pos.y = mesh.position.y;
        p.pos.z = mesh.position.z + 2.5;
        p.facing = Math.atan2(mesh.position.x - p.pos.x, mesh.position.z - p.pos.z);
      });
      await wait(1200);
      return {};
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
