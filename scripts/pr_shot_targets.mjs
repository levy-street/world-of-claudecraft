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
    key: 'player-tooltip',
    label: 'Player hover tooltip',
    when: ['player_tooltip'],
    async capture(page) {
      const staged = await page.evaluate(() => {
        const game = window.__game;
        const sim = game?.sim;
        const player = sim?.player;
        if (!game || !sim || !player) return { ok: false, reason: 'offline world is unavailable' };
        const id = sim.addPlayer('mage', 'Aldwin');
        const other = sim.entities.get(id);
        if (!other) return { ok: false, reason: 'player spawn failed' };
        other.level = 18;
        other.guild = 'The Azure Order';
        // Put the bot in front of the camera's focal point. Renderer places the
        // camera behind the player along the opposite of this vector.
        other.pos.x = player.pos.x + Math.sin(game.input.camYaw) * 3;
        other.pos.z = player.pos.z + Math.cos(game.input.camYaw) * 3;
        return { ok: true, id };
      });
      if (!staged.ok) throw new Error(staged.reason);
      await wait(500);
      let point = null;
      for (let attempt = 0; attempt < 12 && !point; attempt++) {
        point = await page.evaluate((id) => {
          const game = window.__game;
          const other = game?.sim?.entities.get(id);
          if (!game || !other) return null;
          const anchor = game.renderer.worldToScreen(other.pos.x, other.pos.y + 0.8, other.pos.z);
          if (anchor.behind) return null;
          for (let dy = -120; dy <= 120; dy += 12) {
            for (let dx = -80; dx <= 80; dx += 12) {
              const x = anchor.x + dx;
              const y = anchor.y + dy;
              if (game.renderer.pick(x, y) === id) return { x, y };
            }
          }
          return null;
        }, staged.id);
        if (!point) await wait(250);
      }
      if (!point) throw new Error('no renderer pick point for staged player');
      await page.hover('#game-canvas');
      await page.mouse.move(point.x, point.y);
      await wait(500);
      const shown = await page.evaluate((id) => {
        const game = window.__game;
        const tip = document.querySelector('#tooltip');
        return (
          game?.renderer.pick(game.input.hoverX, game.input.hoverY) === id &&
          tip?.classList.contains('mob-tooltip') &&
          getComputedStyle(tip).display !== 'none' &&
          tip.textContent?.includes('Aldwin') &&
          tip.textContent?.includes('The Azure Order')
        );
      }, staged.id);
      if (!shown) throw new Error('player tooltip did not appear through the hover path');
      return {};
    },
  },
  {
    key: 'tank-defensive-cds',
    label: 'Tank defensive cooldowns',
    when: ['tests/tank_defensive_cds.test.ts'],
    variants: [
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
    // Desktop and mobile variants: the Phase 6 legibility rows (skill line,
    // difficulty label, station badge, combo reason) are actionable info and
    // must read on both form factors. The four-states variant stages a
    // mid-skill unattuned character so one window shows the whole 12c
    // difficulty ladder at once: commons two tiers below (minimal, green),
    // a known rung-25 recipe one below (reduced, yellow), a known rung-50
    // recipe at capability (full, orange), and the armorcrafting 75 row
    // above the pre-attunement ceiling (none, gray).
    variants: [
      { key: 'desktop' },
      { key: 'mobile', mobile: true },
      { key: 'desktop-four-states', fourStates: true },
    ],
    // Grant a spread of reagents across a few professions so several recipes read
    // craftable, force-hide then toggle so the open is deterministic, and clip to
    // the window.
    async capture(page, variant) {
      await page.evaluate((fourStates) => {
        document.querySelector('#gpu-notice')?.remove();
        const sim = window.__game?.sim;
        const ids = ['bone_fragments', 'linen_scrap', 'spider_leg'];
        for (const id of ids) {
          try {
            sim?.addItem(id, 10);
          } catch {}
        }
        if (fourStates) {
          const meta = sim?.players?.get(sim.primaryId);
          if (meta) {
            meta.craftSkills = { ...meta.craftSkills, weaponcrafting: 60 };
            meta.knownRecipes.add('recipe_ironedge_longsword');
            meta.knownRecipes.add('recipe_thorium_warblade');
          }
        }
        const el = document.querySelector('#crafting-window');
        if (el) el.style.display = 'none';
        window.__game?.hud?.toggleCrafting?.();
      }, Boolean(variant?.fourStates));
      // A first-open crafting window with several icon-bearing recipe rows takes
      // noticeably longer to lay out in headless swiftshader than the plain-list
      // bags/map windows do (getBoundingClientRect can report 0x0 for 2-4s), so
      // poll for a real size instead of guessing a fixed wait.
      const open = await pollForSize(page, '#crafting-window');
      if (open && (variant?.mobile || variant?.fourStates)) {
        // The identity card fills the top of the window (all of it on the short
        // landscape viewport); scroll the first recipe section into view so the
        // legibility rows, and for four-states the whole difficulty ladder
        // (weaponcrafting green/yellow/orange plus the armorcrafting gray 75
        // row), are the shot.
        await page.evaluate(() => {
          document
            .querySelector('#crafting-window .vendor-section-title')
            ?.scrollIntoView({ block: 'start' });
        });
        await wait(300);
      }
      return open ? { clip: '#crafting-window' } : {};
    },
  },
  {
    key: 'masterwork-tooltip',
    label: 'Bag tooltip: masterwork seal, enchanted marker, makers mark',
    when: ['ui/item_instance_tooltip', 'ui/painter_host', 'ui/bank_view'],
    // Grant a signed masterwork copy, open bags, hover its slot: the tooltip's
    // per-copy lines (gold seal, green baked bonus stats, Crafted by) all read
    // in one frame. Full-frame shot: the tooltip renders beside the window and
    // the single-selector clip cannot union the two rects.
    async capture(page) {
      await page.evaluate(() => {
        document.querySelector('#gpu-notice')?.remove();
        document.querySelector('.camera-prompt-confirm')?.click();
        const game = window.__game;
        try {
          // A dungeon-drop def the starter bag can never contain, so the
          // aria-label lookup below is unambiguous.
          game?.sim?.addItemInstance('gravewyrm_gauntlets', {
            signer: 'Thorgar',
            rolled: { masterwork: true, stats: { str: 2, sta: 1 } },
          });
        } catch {}
        const el = document.querySelector('#bags');
        if (el) el.style.display = 'none';
        game?.hud?.toggleBags?.();
      });
      // toggleBags tracks logical open state, so a shared page where an earlier
      // target left the bags logically open needs a second toggle to reopen.
      let open = await pollForSize(page, '#bags');
      if (!open) {
        await page.evaluate(() => window.__game?.hud?.toggleBags?.());
        open = await pollForSize(page, '#bags');
      }
      if (!open) return {};
      await page.evaluate(() => {
        // The grant can pop a transient deed banner and the camera prompt on
        // the shared page; clear both so the tooltip is the frame's subject.
        document.querySelector('.camera-prompt-confirm')?.click();
        const banner = document.querySelector('#banner');
        if (banner) banner.style.opacity = '0';
        // Real focus fires attachTooltip's focusin arm (keyboard-nav path), a
        // sturdier trigger than synthetic mouseenter under headless.
        const cell = Array.from(document.querySelectorAll('#bags button')).find((b) =>
          b.getAttribute('aria-label')?.includes('Gravewyrm Gauntlets'),
        );
        cell?.scrollIntoView({ block: 'center' });
        cell?.focus();
      });
      await pollForSize(page, '#tooltip');
      await wait(300);
      return {};
    },
  },
  {
    key: 'market-window',
    label: 'World Market window (landscape multi-column listings)',
    when: ['ui/market_window', 'ui/market_view', 'ui/market_filters', 'sim/market'],
    variants: [{ key: 'desktop' }, { key: 'mobile', mobile: true }],
    // Teleport onto the Merchant's stall (zone1, {0, 11.5}) so marketOpen's proximity
    // gate passes, then open the Browse tab directly. The Merchant always keeps some of
    // its own standing stock (market.ts), so the listing grid is never empty offline.
    async capture(page) {
      await page.evaluate(() => {
        const p = window.__game?.sim?.player;
        if (p?.pos) {
          p.pos.x = 0;
          p.pos.z = 11.5;
        }
        const el = document.querySelector('#market-window');
        if (el) el.style.display = 'none';
        const hud = window.__game?.hud;
        hud?.openMarket?.();
        // Market docks its Bags companion alongside (like vendor/bank; unlike
        // those, Market has no docking CSS pairing them side by side), and on
        // mobile both share the same edge-pinned sheet position, so Bags stacks
        // fully over Market. Hide the companion for this shot: the point of the
        // capture is the Market window's own multi-column relayout, not the
        // Bags pairing (a separate, pre-existing behavior this change does not
        // touch).
        const bags = document.querySelector('#bags');
        if (bags) bags.style.display = 'none';
      });
      const open = await pollForSize(page, '#market-window');
      return open ? { clip: '#market-window' } : {};
    },
  },
  {
    key: 'card-duel',
    label: 'Card Duel window (Card Master)',
    when: [
      'ui/card_duel',
      'sim/social/card_duel',
      'sim/content/card_master',
      'sim/minigames/card_hand',
    ],
    // Teleport next to the Card Master (Eastbrook zone1, {13, 2}) so joinCardDuelQueue's
    // range gate passes, then open the Card Duel window directly (idle state: this target
    // only covers the bring-up the diff implies; queued/in-match/complete states are
    // fixture-driven separately for the PR screenshot set, see docs/screenshots/card-duel).
    async capture(page) {
      await page.evaluate(() => {
        const p = window.__game?.sim?.player;
        if (p?.pos) {
          p.pos.x = 13;
          p.pos.z = 2;
        }
        const el = document.querySelector('#card-duel-window');
        if (el) el.style.display = 'none';
        window.__game?.hud?.toggleCardDuel?.();
      });
      const open = await pollForSize(page, '#card-duel-window');
      return open ? { clip: '#card-duel-window' } : {};
    },
  },
  {
    key: 'char-window',
    label: 'Character window',
    when: ['ui/char_window', 'ui/char_view'],
    // Desktop and mobile, each in two framings: the default top framing, plus
    // the gathering panel scrolled into view (it sits below the fold and is
    // per-player progression info a player reads on both form factors; Phase
    // 11 added its fishing row).
    variants: [
      { key: 'desktop' },
      { key: 'mobile', mobile: true },
      { key: 'desktop-gathering', scrollSel: '.char-progression' },
      { key: 'mobile-gathering', mobile: true, scrollSel: '.char-progression' },
    ],
    async capture(page, variant) {
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
      if (open && variant?.scrollSel) {
        // The window repaints on world changes and a repaint resets the scroll
        // position, so a one-shot scrollIntoView can be undone before the
        // screenshot lands. Pin the scrollable ancestor to the bottom on an
        // interval that outlives this evaluate (cleared after 5s).
        await page.evaluate((sel) => {
          const pin = () => {
            const target = document.querySelector(sel);
            if (!target) return;
            let sc = target.parentElement;
            while (sc && sc.scrollHeight <= sc.clientHeight + 1) sc = sc.parentElement;
            if (sc) sc.scrollTop = sc.scrollHeight;
          };
          pin();
          const iv = setInterval(pin, 50);
          setTimeout(() => clearInterval(iv), 5000);
        }, variant.scrollSel);
        await wait(400);
      }
      return open ? { clip: '#char-window' } : {};
    },
  },
  {
    key: 'social-window',
    label: 'Social window (Friends tab, landscape layout)',
    when: ['ui/social_window'],
    variants: [{ key: 'desktop' }, { key: 'mobile', mobile: true }],
    async capture(page) {
      await page.evaluate(() => {
        const el = document.querySelector('#social-window');
        if (el) el.classList.remove('open');
        window.__game?.hud?.toggleSocial?.();
      });
      const open = await pollForSize(page, '#social-window');
      return open ? { clip: '#social-window' } : {};
    },
  },
  {
    key: 'guild-roster',
    label: 'Social window: Guild tab roster grouped by online status',
    // Match the SOURCE files (the `.ts` suffix keeps `ui/social_view` from also
    // matching `src/ui/social_view.test.ts`, which classifyDiff treats as non-visual).
    when: ['ui/social_window.ts', 'ui/social_view.ts', 'ui/guild_hide_offline.ts'],
    // Social is an online-only feature, so the offline Sim reports socialInfo=null.
    // Inject a guild fixture through the debug hook (the sanctioned offline-staging
    // fallback), open the social window, and switch to the Guild tab. The
    // `desktop-hidden` variant also engages the hide-offline toggle.
    variants: [
      { key: 'desktop', charName: 'Rueweaver', charClass: 'paladin' },
      { key: 'desktop-hidden', charName: 'Rueweaver', charClass: 'paladin', hide: true },
      { key: 'mobile', charName: 'Rueweaver', charClass: 'paladin', mobile: true },
    ],
    async capture(page, variant) {
      const staged = await page.evaluate(() => {
        const sim = window.__game?.sim;
        if (!sim || !sim.player) return { ok: false, reason: 'offline world is unavailable' };
        const me = sim.player.name;
        const m = (over) => ({
          id: over.id,
          name: over.name,
          cls: over.cls,
          level: over.level,
          realm: 'Aurora',
          online: over.online,
          status: over.status,
          zone: over.zone,
          rank: over.rank ?? 'member',
          lastLogin: over.lastLogin ?? null,
          activeTitle: over.activeTitle ?? null,
        });
        // A leaf assignment: socialInfo is typed `null` on the offline Sim, but at
        // runtime it is a plain field the HUD reads through IWorld.
        sim.socialInfo = {
          friends: [],
          blocks: [],
          ignores: [],
          guild: {
            id: 1,
            name: 'Emberwatch Vanguard',
            rank: 'leader',
            members: [
              m({
                id: 1,
                name: me,
                cls: 'paladin',
                level: 60,
                online: true,
                status: 'online',
                zone: 'zone:stormwind',
                rank: 'leader',
              }),
              m({
                id: 2,
                name: 'Seraphine',
                cls: 'priest',
                level: 58,
                online: true,
                status: 'dungeon',
                zone: 'zone:deadmines',
                rank: 'officer',
              }),
              m({
                id: 3,
                name: 'Gorehowl',
                cls: 'warrior',
                level: 55,
                online: true,
                status: 'combat',
                zone: 'zone:elwynn',
                rank: 'member',
              }),
              m({
                id: 4,
                name: 'Lyria',
                cls: 'mage',
                level: 44,
                online: false,
                rank: 'member',
                lastLogin: '2026-07-18T20:15:00.000Z',
              }),
              m({
                id: 5,
                name: 'Thornbeard',
                cls: 'hunter',
                level: 39,
                online: false,
                rank: 'member',
                lastLogin: '2026-07-10T11:00:00.000Z',
              }),
              m({
                id: 6,
                name: 'Wisp',
                cls: 'druid',
                level: 22,
                online: false,
                rank: 'member',
                lastLogin: null,
              }),
            ],
          },
        };
        const el = document.querySelector('#social-window');
        if (el) el.classList.remove('open');
        window.__game?.hud?.toggleSocial?.();
        return { ok: true };
      });
      if (!staged.ok) throw new Error(staged.reason);
      const open = await pollForSize(page, '#social-window');
      if (!open) return {};
      // Switch to the Guild tab (the strip fires on data-tab), then optionally engage
      // the hide-offline toggle for the hidden variant.
      await page.evaluate((hide) => {
        document.querySelector('.soc-tab[data-tab="guild"]')?.click();
        if (hide) document.querySelector('[data-act="toggle-hide-offline"]')?.click();
      }, variant?.hide === true);
      await wait(400);
      return { clip: '#social-window' };
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
    key: 'chat-flair-class-color',
    label: 'Chat: class-colored name + verified-streamer badge',
    when: ['ui/hud/chat/chat_line'],
    // Mage: a bright, unmistakably-not-default-white class color, so the
    // before/after class-color diff is obvious at a glance (the default
    // 'warrior' tan reads close to the plain sender-name white already).
    variants: [
      { key: 'desktop', charClass: 'mage', charName: 'Lyravel' },
      { key: 'mobile', charClass: 'mage', charName: 'Lyravel', mobile: true },
    ],
    // Synthesizes one party-channel 'chat' SimEvent, anchored on the real player
    // entity (so its class resolves and the sender name colors accordingly) with
    // a fabricated streamer flair, through the real dispatch (hud.handleEvents).
    // Mirrors the log_event_route targets above: no live second player needed.
    async capture(page, variant) {
      // On mobile the chat log is collapsed behind the overlay toggle (body
      // .mobile-chat-open); a real tap on the chat-open control sets this same
      // class (src/game/mobile_controls.ts), so this reproduces that state
      // directly rather than re-deriving the touch gesture. Also drop the
      // headless-swiftshader GPU notice: it is a capture-environment artifact
      // (no real GPU in CI/headless), not part of what this target shows.
      await page.evaluate(() => {
        document.querySelector('#gpu-notice')?.remove();
      });
      if (variant?.mobile) {
        await page.evaluate(() => document.body.classList.add('mobile-chat-open'));
      }
      await pollForSize(page, '#chatlog-wrap', 60, 500);
      await page.evaluate(() => {
        const hud = window.__game?.hud;
        const sim = window.__game?.sim;
        if (!hud || !sim) return;
        hud.handleEvents([
          {
            type: 'chat',
            channel: 'party',
            from: sim.player?.name ?? 'Zyx',
            fromPid: sim.playerId,
            text: 'checking flair: class-colored name and verified-streamer badge render correctly',
            flair: { links: { twitch: 'https://twitch.tv/zyx' } },
          },
          // A trailing filler line, so the flair line above is not the very
          // bottom row: the mobile chat log fades its bottom-most row under a
          // "more content below" peek gradient (see hud.mobile.css), which
          // would otherwise wash out the exact line this target exists to show.
          { type: 'log', text: 'ready.', color: '#8a8a8a' },
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
    key: 'gpu-notice',
    label: 'Software rendering notice',
    when: ['ui/gpu_notice', 'render/software_renderer', 'game/software_render_notice'],
    variants: [
      { key: 'web-desktop', desktopShell: false },
      { key: 'desktop-shell', desktopShell: true },
      { key: 'web-mobile', desktopShell: false, mobile: true },
    ],
    // The toast only shows when the session resolved to a software rasterizer, which a
    // capture machine with a real GPU never does; import the module directly (Vite serves
    // /src in dev) and force the state, exactly what src/game/software_render_notice.ts
    // would pass on a WARP box. Clearing the persisted dismissal and any prior element
    // keeps the recipe rerunnable; the two desktopShell variants show both copy branches.
    async capture(page, variant) {
      await page.evaluate(async (desktopShell) => {
        localStorage.removeItem('woc_gpu_notice_dismissed');
        document.querySelector('#gpu-notice')?.remove();
        const mod = await import('/src/ui/gpu_notice_toast.ts');
        mod.initGpuNotice({ softwareRendering: true, desktopShell });
      }, Boolean(variant?.desktopShell));
      const open = await pollForSize(page, '#gpu-notice');
      return open ? { clip: '#gpu-notice' } : {};
    },
  },
  {
    key: 'gather-node',
    label: 'Gather node (click/tap-to-harvest #1866; tool tier gating, Professions 2.0 Phase 12)',
    when: ['gather_node', 'gather_nodes', 'gathering_view', 'professions/tools'],
    // The Phase 12 variants stand at the mirefen tier-2 ore vein (falling back
    // to the nearest pre-phase mirefen vein when the id does not exist, so the
    // SAME recipe shoots the before side on the base tree): bare hands for the
    // locked tooltip + minimap lock tint, an iron pick for the unlocked
    // contrast, and a mobile tap-harvest whose outcome line is the denial
    // toast on the gated tree and a plain gather line before it.
    variants: [
      { key: 'desktop-approach' },
      { key: 'desktop-locked-hover' },
      { key: 'desktop-unlocked-hover', pickup: 'iron_mining_pick' },
      { key: 'desktop-minimap-locked', clipMinimap: true, standOff: true },
      { key: 'mobile-harvest-outcome', mobile: true, harvest: true },
    ],
    async capture(page, variant) {
      await page.evaluate(() => {
        document.querySelector('.camera-prompt-confirm')?.click();
        document.querySelector('.tut-skip')?.click();
        document.querySelector('.gpu-notice-dismiss')?.click();
      });
      await page.evaluate(
        (opts) => {
          const game = window.__game;
          const meshes = game?.renderer?.gatherNodeMeshes ?? [];
          const byId = (id) => meshes.find((m) => m.userData?.gatherNodeId === id);
          // ore_mirefen_t2 exists only on the Phase 12 tree; ore_mirefen_1 is the
          // pre-phase vein 12 yd away, the honest before-side stand-in.
          const mesh = byId('ore_mirefen_t2') ?? byId('ore_mirefen_1') ?? meshes[0];
          const p = game?.world?.player;
          if (!mesh || !p) return;
          if (opts.pickup) game.world.addItem(opts.pickup, 1);
          // The minimap variant stands off the vein so the lock-tinted marker
          // is not hidden under the player arrow at the map centre.
          const off = opts.standOff ? 14 : 2.5;
          p.pos.x = mesh.position.x + off;
          p.pos.y = mesh.position.y;
          p.pos.z = mesh.position.z + off;
          p.facing = Math.atan2(mesh.position.x - p.pos.x, mesh.position.z - p.pos.z);
          window.__p12ShotNodeId = mesh.userData?.gatherNodeId ?? null;
        },
        { pickup: variant?.pickup ?? null, standOff: Boolean(variant?.standOff) },
      );
      await wait(1200);
      if (variant?.harvest) {
        // Tap-harvest through the real IWorld command: denied on the gated
        // tree (error toast), a plain gather line before it.
        await page.evaluate(() => {
          const game = window.__game;
          if (window.__p12ShotNodeId) game.world.harvestNode(window.__p12ShotNodeId);
        });
        await wait(600);
        return {};
      }
      if (variant?.key?.includes('hover')) {
        // Project the node mesh to client coords and dispatch real pointermove
        // events on the canvas (two, spaced past the tooltip's 120 ms pick
        // throttle). On the base tree no hover listener exists and the frame
        // simply shows no tooltip, which IS the before shot.
        for (let i = 0; i < 4; i++) {
          // Recompute the projection immediately before every dispatch (the
          // camera settles over several frames) and aim at the rock's upper
          // half so neither the ground nor the player steals the pick. The
          // listener lives on #game-canvas specifically (main.ts wiring).
          await page.evaluate(() => {
            const game = window.__game;
            const mesh = (game?.renderer?.gatherNodeMeshes ?? []).find(
              (m) => m.userData?.gatherNodeId === window.__p12ShotNodeId,
            );
            const canvas = document.querySelector('#game-canvas');
            const cam = game?.renderer?.camera;
            if (!mesh || !canvas || !cam) return;
            const v = mesh.position.clone();
            v.y += 0.4;
            v.project(cam);
            const rect = canvas.getBoundingClientRect();
            canvas.dispatchEvent(
              new PointerEvent('pointermove', {
                pointerType: 'mouse',
                clientX: rect.left + ((v.x + 1) / 2) * rect.width,
                clientY: rect.top + ((1 - v.y) / 2) * rect.height,
                bubbles: true,
              }),
            );
          });
          await wait(200);
        }
        await wait(300);
        return {};
      }
      if (variant?.clipMinimap) return { clip: '#minimap' };
      return {};
    },
  },
  {
    key: 'renown-board',
    label: 'High-score window: the Renown (deeds) board tab',
    when: [
      'src/ui/leaderboard_window.ts',
      'src/ui/deeds_leaderboard_view.ts',
      'src/world_api/deeds.ts',
      'server/deeds_board.ts',
    ],
    variants: [
      { key: 'desktop', charClass: 'warrior', charName: 'Chronicler' },
      { key: 'mobile', charClass: 'warrior', charName: 'Chronicler', mobile: true },
    ],
    // The offline Sim resolves an EMPTY Renown board (a sandbox has no account
    // population), so stub the IWorld read with a representative ranked page
    // before opening: the real pure core + painter render it exactly as the
    // live board would, self line and me-row highlight included.
    async capture(page) {
      // Dismiss the overlays that can outlive entry (camera-mode prompt,
      // tutorial, the headless-swiftshader GPU notice), the same pre-shot
      // sweep the tank target does. No Escape: that opens the game menu
      // behind the window.
      await page.evaluate(() => {
        document.querySelector('.camera-prompt-confirm')?.click();
        document.querySelector('.tut-skip')?.click();
        document.querySelector('.gpu-notice-dismiss')?.click();
      });
      await wait(300);
      await page.evaluate(() => {
        const game = window.__game;
        if (!game) return;
        const fakePage = {
          leaders: [
            {
              rank: 1,
              name: 'Aldwin',
              realm: 'Claudemoon',
              cls: 'warrior',
              level: 20,
              renown: 1620,
              title: 'prog_veteran',
            },
            {
              rank: 2,
              name: 'Berrin',
              realm: 'Duskhold',
              cls: 'mage',
              level: 20,
              renown: 1490,
              title: null,
            },
            {
              rank: 3,
              name: 'Cifern',
              realm: 'Claudemoon',
              cls: 'priest',
              level: 19,
              renown: 1390,
              title: null,
            },
            {
              rank: 4,
              name: 'Doran',
              realm: 'Claudemoon',
              cls: 'rogue',
              level: 20,
              renown: 1350,
              title: 'prog_veteran',
            },
            {
              rank: 5,
              name: 'Elvane',
              realm: 'Duskhold',
              cls: 'druid',
              level: 18,
              renown: 1245,
              title: null,
            },
          ],
          page: 0,
          pageCount: 1,
          total: 5,
          pageSize: 50,
          self: { rank: 1, topPercent: 1, renown: 1620 },
        };
        game.world.deedsLeaderboard = async () => fakePage;
        game.hud.toggleLeaderboard();
      });
      let open = await pollForSize(page, '#leaderboard-window', 10, 300);
      if (!open) throw new Error('leaderboard window did not open');
      await page.evaluate(() => {
        document.querySelector('button[data-leaderboard-tab="deeds"]')?.click();
      });
      open = await pollForSize(
        page,
        '#leaderboard-window .lb-row-deeds, #leaderboard-window .lb-self',
        10,
        300,
      );
      if (!open) throw new Error('Renown board rows did not render');
      return { clip: '#leaderboard-window' };
    },
  },
  {
    key: 'professions',
    label: 'Professions wheel window',
    when: ['src/ui/professions_view.ts', 'src/ui/professions_window.ts'],
    variants: [
      { key: 'desktop-full', charClass: 'warrior', charName: 'Forgeheart' },
      { key: 'desktop-simplified', charClass: 'mage', charName: 'Newhand', simplified: true },
      { key: 'mobile', charClass: 'warrior', charName: 'Anvilmar', mobile: true },
      // The gathering section sits below the craft-skill fold; a fourth
      // framing scrolls it into view (Phase 11 added its fishing row).
      {
        key: 'desktop-gathering',
        charClass: 'warrior',
        charName: 'Forgeheart',
        scrollSel: '.prof-gathering',
      },
    ],
    // The offline sandbox starts unattuned with zero craft skill, which IS the
    // simplified variant. The full variants stub the two IWorld reads with a
    // representative attuned Smith (the renown-board precedent: the real pure
    // core and painter render it exactly as a live identity), picking values
    // that light every section: both majors specialized, a tier-1 hobby, a
    // dormant-knowledge craft, a near-tier craft, and mixed gathering skill.
    async capture(page, variant) {
      await page.evaluate(() => {
        document.querySelector('.camera-prompt-confirm')?.click();
        document.querySelector('.tut-skip')?.click();
        document.querySelector('.gpu-notice-dismiss')?.click();
      });
      await wait(300);
      await page.evaluate((shot) => {
        const game = window.__game;
        if (!game) return;
        if (!shot.simplified) {
          const identity = {
            version: 1,
            synced: true,
            craftSkills: {
              weaponcrafting: 132,
              armorcrafting: 87,
              tailoring: 23,
              leatherworking: 0,
              cooking: 26,
              alchemy: 4,
              engineering: 51,
              enchanting: 0,
              jewelcrafting: 0,
              inscription: 61,
            },
            activeArchetype: 'weaponcrafting',
            pairedMajor: 'armorcrafting',
            hobbyCraft: 'cooking',
            attunedPairs: ['weaponcrafting+armorcrafting'],
            switchCount: 1,
            amendsProgress: 2,
            amendsRequired: 8,
          };
          Object.defineProperty(game.world, 'craftingIdentity', {
            value: identity,
            configurable: true,
          });
          const gathering = {
            skills: [
              { professionId: 'mining', skill: 112, maxSkill: 300 },
              { professionId: 'logging', skill: 45, maxSkill: 300 },
              { professionId: 'herbalism', skill: 203, maxSkill: 300 },
              { professionId: 'fishing', skill: 68, maxSkill: 300 },
            ],
          };
          const stateIsFn = typeof game.world.professionsState === 'function';
          Object.defineProperty(game.world, 'professionsState', {
            value: stateIsFn ? () => gathering : gathering,
            configurable: true,
          });
        }
        const el = document.querySelector('#professions-window');
        if (el) el.style.display = 'none';
        game.hud.toggleProfessions?.();
      }, variant);
      const open = await pollForSize(page, '#professions-window');
      if (!open) throw new Error('professions window did not open');
      if (variant?.scrollSel) {
        // Same repaint-vs-scroll race as the char-window target: pin the
        // scrollable ancestor to the bottom until the screenshot lands.
        await page.evaluate((sel) => {
          const pin = () => {
            const target = document.querySelector(sel);
            if (!target) return;
            let sc = target.parentElement;
            while (sc && sc.scrollHeight <= sc.clientHeight + 1) sc = sc.parentElement;
            if (sc) sc.scrollTop = sc.scrollHeight;
          };
          pin();
          const iv = setInterval(pin, 50);
          setTimeout(() => clearInterval(iv), 5000);
        }, variant.scrollSel);
        await wait(400);
      }
      return { clip: '#professions-window' };
    },
  },
  {
    key: 'train-window',
    label: 'Train view: station-master recipe training ladder',
    when: ['ui/hud/vendor/train_view', 'ui/hud/vendor/train_window'],
    // Desktop and mobile: the three-state teaching ladder is actionable info (a
    // player decides what to train), so it must read on both form factors.
    variants: [
      { key: 'desktop', charClass: 'warrior', charName: 'Forgeheart' },
      { key: 'mobile', charClass: 'warrior', charName: 'Anvilmar', mobile: true },
    ],
    // Show all three row states in one frame at Forgemistress Darva's forge. Set
    // the viewer's craft skills so the forge ladder renders every state at once:
    // weaponcrafting at tier 1 (skill 30) makes recipe_forgeguard_bulwark_gauntlets
    // TEACHABLE at a 25s fee; armorcrafting at tier 0 (skill 10) leaves
    // recipe_ironbound_warplate_helm LOCKED with its named "Taught at ... 25"
    // requirement; the acquisition-free commons of both crafts read KNOWN. The two
    // combo recipes are grandfathered into knownRecipes for existing saves, so drop
    // them from the set first or they would read KNOWN too. Give the player enough
    // copper that the fee reads affordable. openTrain takes the master's ENTITY id
    // (renderTrain does sim.entities.get(id).templateId), so resolve the entity, not
    // the template id.
    async capture(page, variant) {
      await page.evaluate(() => {
        document.querySelector('.camera-prompt-confirm')?.click();
        document.querySelector('.tut-skip')?.click();
        document.querySelector('.gpu-notice-dismiss')?.click();
        document.querySelector('#gpu-notice')?.remove();
      });
      await wait(300);
      // Set state and open the window in ONE evaluate: the ticking sim would drift
      // between two evaluates, and renderTrain reads the state synchronously here.
      const setup = await page.evaluate(() => {
        const game = window.__game;
        const sim = game?.sim;
        if (!sim) return { ok: false, reason: 'no sim' };
        const master = [...sim.entities.values()].find(
          (e) => e.templateId === 'forgemistress_darva',
        );
        if (!master) return { ok: false, reason: 'no forgemistress_darva entity' };
        const meta = sim.players.get(sim.primaryId);
        if (!meta) return { ok: false, reason: 'no primary player meta' };
        meta.craftSkills = { ...meta.craftSkills, weaponcrafting: 30, armorcrafting: 10 };
        meta.knownRecipes.delete('recipe_forgeguard_bulwark_gauntlets');
        meta.knownRecipes.delete('recipe_ironbound_warplate_helm');
        sim.copper = 100000;
        // The HUD auto-closes the train window when the player is more than 8yd
        // from the master (hud.ts openTrainNpcId proximity check), so stand the
        // player right beside Darva in this SAME evaluate or the next tick closes it.
        const p = sim.player;
        if (p?.pos) {
          p.pos.x = master.pos.x;
          p.pos.z = master.pos.z - 2;
        }
        const el = document.querySelector('#train-window');
        if (el) el.style.display = 'none';
        game.hud.openTrain(master.id);
        return { ok: true };
      });
      if (!setup.ok) throw new Error(`train-window setup failed: ${setup.reason}`);
      const open = await pollForSize(page, '#train-window');
      if (!open) throw new Error('train window did not open');
      // Verify the ladder rendered all three states (the whole point of the shot).
      const states = await page.evaluate(() => ({
        known: document.querySelectorAll('#train-window .train-known').length,
        teachable: document.querySelectorAll('#train-window .train-teachable').length,
        locked: document.querySelectorAll('#train-window .train-locked').length,
      }));
      if (!(states.known > 0 && states.teachable > 0 && states.locked > 0)) {
        throw new Error(`train ladder missing a state: ${JSON.stringify(states)}`);
      }
      if (variant?.mobile) {
        // The short landscape viewport cannot show the whole ladder at once, and
        // the teachable (AVAILABLE) row sits last; scroll it to the bottom so the
        // frame carries all three states (a KNOWN and the LOCKED row stay above it).
        await page.evaluate(() => {
          document
            .querySelector('#train-window .train-teachable')
            ?.scrollIntoView({ block: 'end' });
        });
        await wait(300);
      }
      return { clip: '#train-window' };
    },
  },
  {
    key: 'station-props',
    label: 'Crafting-station scenery (Eastbrook forge)',
    when: ['render/stations', 'src/sim/content/professions'],
    variants: [{ key: 'desktop', charClass: 'warrior', charName: 'Forgeheart' }],
    // A world-scene shot of the Eastbrook forge station props (anvil + reused
    // crate/barrel clutter) beside Forgemistress Darva, framed the way a player
    // walks up to it. The station sits at STATIONS station_eastbrook_forge
    // {x:7, z:16.5} (content/professions.ts); stand a few yards south-east and
    // face it (the gather-node facing idiom: atan2(dx, dz) toward the target).
    // The GLB streams in on first view, so wait generously before the frame.
    // Full-viewport shot (return {}), no selector clip: this is scenery, not a
    // window, and the corner minimap with its new station diamond marker rides
    // along.
    async capture(page) {
      await page.evaluate(() => {
        document.querySelector('.camera-prompt-confirm')?.click();
        document.querySelector('.tut-skip')?.click();
        document.querySelector('.gpu-notice-dismiss')?.click();
        document.querySelector('#gpu-notice')?.remove();
        const p = window.__game?.sim?.player;
        if (p?.pos) {
          // Eastbrook forge station (content/professions.ts station_eastbrook_forge).
          const forge = { x: 7, z: 16.5 };
          p.pos.x = 10;
          p.pos.z = 10;
          p.facing = Math.atan2(forge.x - p.pos.x, forge.z - p.pos.z);
        }
      });
      // The anvil GLB and station clutter stream in on first view; wait generously.
      await wait(4500);
      await page.evaluate(() => document.querySelector('#gpu-notice')?.remove());
      return {};
    },
  },
  {
    key: 'confirm-gates',
    label: 'Confirm dialogs: spirit-healer revive + marks purchases',
    when: ['ui/hud/delve/delve_board_controller', 'tests/hud_confirm_gates'],
    variants: [
      { key: 'healer-desktop', scene: 'healer' },
      { key: 'heroic-desktop', scene: 'heroic' },
      { key: 'delve-desktop', scene: 'delve' },
      { key: 'healer-mobile', scene: 'healer', mobile: true },
      { key: 'heroic-mobile', scene: 'heroic', mobile: true },
    ],
    // Each scene stages the pre-existing one-tap action and takes it through the
    // REAL button so the shot proves the confirm dialog now gates it. Full-frame
    // shots: the dialog matters together with the scene it interrupts (ghost
    // prompt / vendor window / delve board).
    async capture(page, variant) {
      await page.evaluate(() => {
        document.querySelector('.camera-prompt-confirm')?.click();
        document.querySelector('.tut-skip')?.click();
        document.querySelector('#gpu-notice')?.remove();
      });
      await wait(300);
      if (variant.scene === 'healer') {
        // Die, release through the real death overlay button, then stand at the
        // Pale Keeper so the ghost prompt offers the healer revive.
        await page.evaluate(() => {
          const sim = window.__game?.sim;
          if (!sim) return;
          sim.player.hp = 1;
          sim.player.dead = true;
        });
        await wait(600);
        await page.evaluate(() => document.querySelector('#release-btn')?.click());
        await wait(600);
        await page.evaluate(() => {
          const sim = window.__game?.sim;
          if (!sim) return;
          for (const ent of sim.entities.values()) {
            if (ent.kind === 'npc' && ent.templateId === 'spirit_healer') {
              sim.player.pos.x = ent.pos.x + 2;
              sim.player.pos.z = ent.pos.z + 2;
              break;
            }
          }
        });
        await wait(600);
        await page.evaluate(() => document.querySelector('#resurrect-healer-btn')?.click());
      } else if (variant.scene === 'heroic') {
        await page.evaluate(() => {
          const game = window.__game;
          const sim = game?.sim;
          if (!sim) return;
          sim.addItem('heroic_mark', 60);
          for (const ent of sim.entities.values()) {
            if (ent.kind === 'npc' && ent.templateId === 'heroic_quartermaster') {
              game.hud.openHeroicVendor(ent.id);
              break;
            }
          }
        });
        await wait(500);
        await page.evaluate(() =>
          document.querySelector('#vendor-window .vendor-item:not([disabled])')?.click(),
        );
      } else {
        // Unlock the delve shop stock and fund the marks wallet, then buy
        // through the real shop-tab button.
        await page.evaluate(() => {
          const game = window.__game;
          const sim = game?.sim;
          if (!sim) return;
          const meta = sim.players.get(sim.player.id);
          if (meta) {
            meta.delveMarks = 99;
            meta.delveClears = {
              'collapsed_reliquary:normal': 20,
              'collapsed_reliquary:heroic': 20,
            };
          }
          for (const ent of sim.entities.values()) {
            if (ent.kind === 'npc' && ent.templateId === 'brother_halven') {
              game.hud.delveBoard.open(ent.id);
              break;
            }
          }
        });
        await wait(500);
        await page.evaluate(() =>
          document.querySelector('#delve-board [data-board-tab="shop"]')?.click(),
        );
        await wait(400);
        await page.evaluate(() =>
          document.querySelector('#delve-board [data-buy]:not([disabled])')?.click(),
        );
      }
      await pollForSize(page, '#confirm-dialog');
      return {};
    },
  },
  {
    key: 'held-weapon-variants',
    label: 'Held weapon model variants (mainhand + dual-wield offhand)',
    when: ['src/ui/weapon_variants.ts', 'tests/held_weapon_models.test.ts'],
    variants: [
      {
        key: 'cleaver-mainhand',
        charClass: 'warrior',
        charName: 'Cleaverjaw',
        items: ['gravewyrm_cleaver'],
        // Mirrored three-quarter: the mainhand (the subject) is the RIGHT hand.
        yawFactor: 1.28,
      },
      {
        key: 'dual-fang',
        charClass: 'rogue',
        charName: 'Twinfang',
        items: ['mirejaw_fang_knife', 'mirejaw_fang_knife'],
      },
    ],
    // A world-scene shot of the character facing the camera with the listed items
    // equipped (second item, when present, goes to the offhand slot: the
    // dual-wield case). Full-viewport shot (return {}): the subject is the 3D
    // held model, not a window.
    async capture(page, variant) {
      await page.evaluate(() => {
        document.querySelector('.camera-prompt-confirm')?.click();
        document.querySelector('.tut-skip')?.click();
        document.querySelector('#gpu-notice')?.remove();
      });
      await wait(300);
      await page.evaluate((shot) => {
        const game = window.__game;
        const sim = game.sim;
        const player = sim.player;
        sim.setPlayerLevel?.(30, player.id);
        // Draw the weapons: the held (not sheathed) pose is the subject.
        if (player.weaponStowed) game.world.toggleWeaponStow();
        const [mainId, offId] = shot.items;
        // Aim each hand explicitly: the no-slot resolver (desiredEquipSlot) routes
        // a dual-wielder's one-hander into an empty offhand, which would leave the
        // starter weapon in the mainhand.
        sim.addItem(mainId, 1, player.id);
        sim.equipItemToSlot(mainId, 'mainhand', player.id);
        if (offId) {
          sim.addItem(offId, 1, player.id);
          sim.equipItemToSlot(offId, 'offhand', player.id);
        }
        // Step away from the spawn campfire so the held models read against clean
        // ground, then park the camera in front of the character, pulled back and
        // level, so the whole body and both hands are in frame.
        player.pos.x += 6;
        player.pos.z += 4;
        game.input.camDist = 5.5;
        game.input.camPitch = 0.1;
        // Three-quarter front view: an edge-on blade reads as a sliver from dead
        // ahead; the off-angle shows the weapon's profile. The factor picks which
        // hand is nearest the camera (below PI favors the left, above the right).
        game.input.camYaw = player.facing + Math.PI * (shot.yawFactor ?? 0.72);
      }, variant);
      // The weapon GLBs and the rig settle, and the levelup/deed banners fade.
      await wait(4500);
      const equipped = await page.evaluate(() => {
        const player = window.__game.sim.player;
        return { mainhand: player.mainhandItemId, offhand: player.offhandItemId };
      });
      if (equipped.mainhand !== variant.items[0]) {
        throw new Error(`mainhand equip failed: ${JSON.stringify(equipped)}`);
      }
      if (variant.items[1] && equipped.offhand !== variant.items[1]) {
        throw new Error(`offhand equip failed: ${JSON.stringify(equipped)}`);
      }
      return {};
    },
  },
  {
    key: 'perf-overlay-ornament',
    label: 'Performance Overlay window: gilded ornament pilot',
    when: ['ui/perf_ornament_svg'],
    variants: [{ key: 'desktop' }, { key: 'mobile', mobile: true }],
    async capture(page) {
      // The first-spawn "Choose Your Camera" prompt can still be up (or
      // reappear) at this point even after enterOfflineGame's own dismissal
      // pass; confirm it before touching the options menu, or it sits on top
      // of (and dims) the window this target is trying to shoot.
      await page.evaluate(() => document.querySelector('.camera-prompt-confirm')?.click());
      await wait(300);
      // The whole point of this target is the gilded ornament, which sheds
      // itself at the low effect tier by design (see tokens.css); this
      // sandbox auto-detects low under software rendering, so force the
      // attribute the drop rule actually reads rather than skip the shot.
      await page.evaluate(() => document.documentElement.setAttribute('data-fx-level', 'ultra'));
      await page.evaluate(() => {
        const el = document.querySelector('#options-menu');
        if (el) el.style.display = 'none';
        window.__game?.hud?.toggleOptionsMenu?.();
      });
      const open = await pollForSize(page, '#options-menu');
      if (!open) return {};
      await page.evaluate(() => {
        const btns = [
          ...document.querySelectorAll('#options-menu button, #options-menu .opt-tile'),
        ];
        const perfBtn = btns.find((b) => /performance overlay/i.test(b.textContent || ''));
        perfBtn?.click();
      });
      const wide = await pollForSize(page, '#options-menu.perf-wide');
      return wide ? { clip: '#options-menu' } : {};
    },
  },
  {
    key: 'gathering-rhythm',
    label:
      'Gathering rhythm: gather cast bar + fishing bobber and bite (Professions 2.0 Phase 12b)',
    when: [
      'professions/fishing',
      'professions/gathering',
      'combat/casting_lifecycle',
      'render/fishing_bobber',
      'render/cast_bar',
    ],
    // Phase 12b turns the instant harvest into a short visible cast and the
    // fixed 5 s fishing cast into a bite minigame. The gather variants shoot
    // mid-cast at the eastbrook ore vein (the base tree grants instantly, so
    // the SAME recipe degrades honestly to the post-harvest frame). The
    // fishing variants stand at the hunted Mirror Lake shore spot: the wait
    // shot shows the constant waiting bar plus the new bobber (base: the old
    // filling bar, no bobber); the bite shot polls the chat log for the bite
    // line and shoots inside the reaction window (base: the poll times out
    // after the old cast lands, degrading to the post-catch frame). Both
    // bring-ups still the local mobs first: mob damage cancels a cast and a
    // boar camp sits near the vale vein.
    variants: [
      { key: 'desktop-gather-cast' },
      { key: 'mobile-gather-cast', mobile: true },
      { key: 'desktop-fishing-wait', fishing: true },
      { key: 'desktop-fishing-bite', fishing: true, bite: true },
    ],
    async capture(page, variant) {
      await page.evaluate(() => {
        document.querySelector('.camera-prompt-confirm')?.click();
        document.querySelector('.tut-skip')?.click();
        document.querySelector('.gpu-notice-dismiss')?.click();
        for (const e of window.__game?.world?.entities?.values?.() ?? []) {
          if (e.kind !== 'mob') continue;
          e.dead = true;
          e.hp = 0;
          e.aiState = 'dead';
          e.respawnTimer = 9999;
          e.corpseTimer = 9999;
          e.inCombat = false;
        }
      });
      if (variant?.fishing) {
        await page.evaluate(async () => {
          const game = window.__game;
          const p = game?.world?.player;
          if (!p) return;
          const { groundHeight, waterLevelAt } = await import('/src/sim/world.ts');
          const { PLAYER_SWIM_DEPTH } = await import('/src/sim/pathfind.ts');
          const { LAKE } = await import('/src/sim/content/zone1.ts');
          const seed = game.world.cfg.seed;
          const dists = [4, 8, 12, 16, 20, 24];
          const fishable = (x, z, facing) => {
            const sin = Math.sin(facing);
            const cos = Math.cos(facing);
            return dists.some(
              (d) =>
                groundHeight(x + sin * d, z + cos * d, seed) <
                waterLevelAt(x + sin * d, z + cos * d) - PLAYER_SWIM_DEPTH,
            );
          };
          let spot = null;
          for (let r = LAKE.radius * 0.7; r <= LAKE.radius * 1.8 && !spot; r += 1) {
            for (let i = 0; i < 72 && !spot; i++) {
              const a = (i / 72) * Math.PI * 2;
              const x = LAKE.x + Math.cos(a) * r;
              const z = LAKE.z + Math.sin(a) * r;
              if (groundHeight(x, z, seed) < waterLevelAt(x, z)) continue;
              const facing = Math.atan2(LAKE.x - x, LAKE.z - z);
              if (fishable(x, z, facing)) spot = { x, z, facing };
            }
          }
          if (!spot) return;
          p.pos.x = spot.x;
          p.pos.y = groundHeight(spot.x, spot.z, seed);
          p.pos.z = spot.z;
          p.facing = spot.facing;
          game.world.addItem('simple_fishing_pole', 1);
        });
        await wait(1200);
        await page.evaluate(() => {
          window.__game.world.useItem('simple_fishing_pole');
        });
        if (variant?.bite) {
          // The hidden delay tops out at 8 s bare-handed; the reaction window
          // (3 s) is generous enough for the settle frame plus the shot.
          for (let i = 0; i < 45; i++) {
            const bit = await page.evaluate(() =>
              (document.querySelector('#chatlog')?.textContent ?? '').includes('takes the bait'),
            );
            if (bit) break;
            await wait(250);
          }
          await wait(250);
          return {};
        }
        await wait(1500);
        return {};
      }
      await page.evaluate(() => {
        const game = window.__game;
        const meshes = game?.renderer?.gatherNodeMeshes ?? [];
        const mesh =
          meshes.find((m) => m.userData?.gatherNodeId === 'ore_eastbrook_1') ?? meshes[0];
        const p = game?.world?.player;
        if (!mesh || !p) return;
        p.pos.x = mesh.position.x + 2.5;
        p.pos.y = mesh.position.y;
        p.pos.z = mesh.position.z + 2.5;
        p.facing = Math.atan2(mesh.position.x - p.pos.x, mesh.position.z - p.pos.z);
        window.__p12bShotNodeId = mesh.userData?.gatherNodeId ?? null;
      });
      await wait(1200);
      await page.evaluate(() => {
        const game = window.__game;
        if (window.__p12bShotNodeId) game.world.harvestNode(window.__p12bShotNodeId);
      });
      // Mid-cast at the 2.5 s base duration; on the base tree the grant has
      // already landed and the frame shows the harvest outcome instead.
      await wait(900);
      return {};
    },
  },
  {
    // $WOC holder-tier badges (Ascendant Sigils reskin). Stages a row of players
    // whose holderTier spans all four bands (coin, gem, sigil, regalia) so one
    // frame shows the ladder on real nameplates, over a bright and a darkened
    // scene (exposure is dropped for the dark variant; the DOM badges float over
    // the canvas and stay bright, which is the whole legibility test), a close-up
    // for badge detail, and the inspect/player-card surface.
    key: 'holder-tier',
    label: 'Ascendant Sigils badges (holder + contributor)',
    // .ts-suffixed so the substring match does not also fire on the *.test.ts files.
    when: ['ui/holder_tier.ts', 'ui/dev_tier.ts', 'render/nameplate_painter.ts'],
    variants: [
      { key: 'ladder-bright' },
      { key: 'ladder-dark' },
      { key: 'closeup' },
      { key: 'card' },
      { key: 'dev-ladder-bright' },
      { key: 'dev-ladder-dark' },
      { key: 'dev-card' },
    ],
    async capture(page, variant) {
      const mode = variant?.key ?? 'ladder-bright';
      const staged = await page.evaluate((mode) => {
        const g = window.__game;
        const sim = g?.sim;
        const p = sim?.player;
        if (!g || !sim || !p) return { ok: false, reason: 'offline world is unavailable' };
        g.renderer.showDevBadges = true;
        // A holder ladder spanning every band: Ember/Gilded (coins), Whale (gem),
        // Titanforged/Worldforger (sigils), Worldbearer/Sovereign (regalia).
        const HOLDER = [
          { holderTier: 1, name: 'Emberlyn', cls: 'mage', bal: 1 },
          { holderTier: 5, name: 'Goldwyn', cls: 'paladin', bal: 10000 },
          { holderTier: 7, name: 'Whalimir', cls: 'warrior', bal: 1000000 },
          { holderTier: 12, name: 'Titanys', cls: 'druid', bal: 50000000 },
          { holderTier: 16, name: 'Forgemara', cls: 'priest', bal: 90000000 },
          { holderTier: 17, name: 'Worlding', cls: 'hunter', bal: 100000000 },
          { holderTier: 18, name: 'Sovryn', cls: 'rogue', bal: 1000000000 },
        ];
        // The contributor ladder: five merged-PR rungs (Tinkerer to Worldwright).
        const DEV = [
          { devTier: 1, name: 'Tinkwyn', cls: 'mage', prs: 1 },
          { devTier: 2, name: 'Artifica', cls: 'rogue', prs: 5 },
          { devTier: 3, name: 'Runael', cls: 'warlock', prs: 15 },
          { devTier: 4, name: 'Archibald', cls: 'paladin', prs: 30 },
          { devTier: 5, name: 'Wrightlynn', cls: 'druid', prs: 70 },
        ];
        // Verified-empty open terrain so nothing clutters the row.
        p.pos.x = -200;
        p.pos.z = 0;
        let set;
        let dark = false;
        let camDist = 22;
        let camPitch = 0.3;
        let spacing = 4;
        let zAhead = 9;
        if (mode === 'closeup') {
          set = HOLDER.slice(4);
          camDist = 6.5;
          camPitch = 0.14;
          spacing = 3.4;
          zAhead = 6;
        } else if (mode === 'card') {
          set = [HOLDER[6]]; // Sovereign holder card
        } else if (mode === 'dev-card') {
          set = [DEV[4]]; // Worldwright contributor card
        } else if (mode === 'dev-ladder-bright' || mode === 'dev-ladder-dark') {
          set = DEV;
          dark = mode === 'dev-ladder-dark';
        } else {
          set = HOLDER; // ladder-bright / ladder-dark
          dark = mode === 'ladder-dark';
        }
        const isCard = mode.indexOf('card') >= 0;
        const ids = [];
        set.forEach((row, i) => {
          const pid = sim.addPlayer(row.cls, row.name);
          const e = sim.entities.get(pid);
          if (!e) return;
          e.level = 60;
          if (row.holderTier != null) {
            e.holderTier = row.holderTier;
            e.holderBalance = row.bal;
          }
          if (row.devTier != null) {
            e.devTier = row.devTier;
            e.devMergedPrs = row.prs;
          }
          e.hp = e.maxHp;
          e.dead = false;
          e.pos.x = p.pos.x + (i - (set.length - 1) / 2) * spacing;
          e.pos.z = p.pos.z + zAhead;
          e.pos.y = p.pos.y;
          ids.push(pid);
        });
        p.facing = 0; // look +z toward the line-up
        g.input.camYaw = 0;
        g.input.camPitch = camPitch;
        g.input.camDist = camDist;
        // Darken the 3D scene for the dark variants: the DOM nameplate badges are
        // positioned over the canvas, so they keep full brightness while the world
        // behind them goes dark. A display-only harness tweak, not shipped code.
        g.renderer.setBrightness(dark ? 0.1 : 1);
        window.__ladderIds = ids;
        window.__ladderCardPid = isCard ? ids[0] : null;
        return { ok: true, count: ids.length };
      }, mode);
      if (!staged.ok) throw new Error(staged.reason);
      await wait(1200);
      // Re-assert pose right before the shot so no drift/fall/combat sneaks in.
      await page.evaluate(() => {
        const g = window.__game;
        const p = g.sim.player;
        (window.__ladderIds || []).forEach((id) => {
          const e = g.sim.entities.get(id);
          if (!e) return;
          e.hp = e.maxHp;
          e.dead = false;
          e.inCombat = false;
          e.pos.y = p.pos.y;
        });
      });
      if (mode.indexOf('card') >= 0) {
        const shown = await page.evaluate(() => {
          const g = window.__game;
          const pid = window.__ladderCardPid;
          if (pid == null) return false;
          g.hud.openInspect(pid);
          const el = document.querySelector('#inspect-window');
          return !!el && getComputedStyle(el).display !== 'none';
        });
        if (!shown) throw new Error('inspect/player-card window did not open');
        await wait(400);
        return { clip: '#inspect-window' };
      }
      await wait(300);
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
