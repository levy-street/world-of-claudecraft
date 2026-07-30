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

// Teleport onto the Merchant's stall (zone1, {0, 11.5}) so marketOpen's proximity gate
// passes, then open the Browse tab. Shared by the market filter-chrome targets below.
//
// Two deliberate display writes, mirroring the market-window target: #market-window is
// forced hidden FIRST so pollForSize cannot pass on a window that was already up (only
// openMarket's own display:flex clears it), and #bags is hidden because the market docks
// its companion alongside and, on mobile, over the top of it.
async function openMarketBrowse(page) {
  await page.evaluate(() => {
    const p = window.__game?.sim?.player;
    if (p?.pos) {
      p.pos.x = 0;
      p.pos.z = 11.5;
    }
    const el = document.querySelector('#market-window');
    if (el) el.style.display = 'none';
    window.__game?.hud?.openMarket?.();
    const bags = document.querySelector('#bags');
    if (bags) bags.style.display = 'none';
  });
  return pollForSize(page, '#market-window');
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
    // The desktop and mobile variants share the recipe: the instanced-slot
    // marker must be visible on both (the acceptance's mobile arm).
    variants: [{ key: 'desktop' }, { key: 'mobile', mobile: true }],
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
        // Two same-signer copies grant through the real hub; on the
        // instanced tree they MERGE into one counted instanced stack (marker + count
        // badge in one cell), while the same recipe on the base tree honestly
        // shows two separate unmarked slots.
        try {
          sim?.addItemInstance?.('wolf_fang', { signer: 'Toralin' });
          sim?.addItemInstance?.('wolf_fang', { signer: 'Toralin' });
        } catch {}
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
    key: 'corpse-unified-press',
    label: 'Unified corpse press: one interact loots AND harvests (Professions 2.0)',
    when: [
      'loot_window_controller',
      'corpse_harvest_window',
      'corpse_harvest_view',
      'nearby_interaction',
    ],
    // Kill the nearest forest wolf beside the player, then either press the real
    // interact key (chat shows the loot line AND the gather line from one press;
    // the base tree honestly shows the loot line alone) or open the loot window
    // to show the harvest picker pre-checked from the player's town focus (the
    // base tree opens it empty).
    variants: [
      { key: 'chat-outcome' },
      { key: 'picker-preselected', picker: true },
      // The centered mobile-touch layout of the same picker window (the
      // legibility pass renamed the corpse arm's button and added the footer
      // hint, both of which render on mobile too).
      { key: 'picker-preselected-mobile', picker: true, mobile: true },
      // A MIXED corpse (#2514). forest_wolf's tags both map to an item, so its
      // picker can never show a marked row: the wild boar carries `tusk` beside
      // hide and meat, which is the shape the whole issue is about. Same rig,
      // one template swapped, rather than a bespoke script.
      { key: 'picker-mixed', picker: true, templateId: 'wild_boar' },
      { key: 'picker-mixed-mobile', picker: true, templateId: 'wild_boar', mobile: true },
    ],
    async capture(page, variant) {
      await page.evaluate(() => {
        document.querySelector('.camera-prompt-confirm')?.click();
        document.querySelector('.tut-skip')?.click();
        document.querySelector('.gpu-notice-dismiss')?.click();
      });
      await page.evaluate((templateId) => {
        const game = window.__game;
        const sim = game?.sim;
        const p = sim?.player;
        if (!sim || !p) return;
        // Town focus first, while the fresh spawn still stands in the Eastbrook
        // hub circle (the setter is in-town-only); hide drives every variant,
        // and both templates below carry it.
        try {
          sim.setTownFocus?.({ hide: 5 });
        } catch {}
        let wolf = null;
        let best = Infinity;
        for (const e of sim.entities.values()) {
          if (e.kind !== 'mob' || e.templateId !== templateId || e.dead) continue;
          const dx = e.pos.x - p.pos.x;
          const dz = e.pos.z - p.pos.z;
          const d2 = dx * dx + dz * dz;
          if (d2 < best) {
            best = d2;
            wolf = e;
          }
        }
        if (!wolf) return;
        p.pos.x = wolf.pos.x + 2;
        p.pos.y = wolf.pos.y;
        p.pos.z = wolf.pos.z;
        p.facing = Math.atan2(wolf.pos.x - p.pos.x, wolf.pos.z - p.pos.z);
        wolf.hp = 1;
        sim.targetEntity?.(wolf.id);
        sim.startAutoAttack?.();
        window.__p12dShotWolfId = wolf.id;
      }, variant?.templateId ?? 'forest_wolf');
      // One auto-attack swing at 1 hp kills the wolf; the live 20 Hz loop needs
      // real time for the swing timer and the death resolution.
      await wait(3000);
      if (variant?.picker) {
        await page.evaluate(() => {
          const game = window.__game;
          const id = window.__p12dShotWolfId;
          if (id)
            game?.hud?.openLoot?.(id, Math.round(innerWidth / 2), Math.round(innerHeight / 2));
        });
        await wait(700);
        return { clip: '#loot-window' };
      }
      await page.evaluate(() => {
        // The real bound interact key (KeyF), not the debug hook: the unified
        // press is exactly what this shot is evidence for.
        const down = new KeyboardEvent('keydown', { code: 'KeyF', key: 'f', bubbles: true });
        const up = new KeyboardEvent('keyup', { code: 'KeyF', key: 'f', bubbles: true });
        window.dispatchEvent(down);
        window.dispatchEvent(up);
      });
      await wait(900);
      return { clip: '#chatlog-wrap' };
    },
  },
  {
    key: 'profession-grant-lines',
    label: 'Chat log: one line per profession grant (#2430)',
    when: ['ui/grant_line_view', 'ui/enchanting_view', 'sim/professions'],
    // Runs four profession actions back to back through the REAL sim commands
    // (craft, salvage, disenchant, apply enchant) and clips the chat log, so
    // the before/after pair shows the same four actions producing eight grant
    // lines versus four. The whole set runs TWICE: the first pass burns the
    // once-ever deed unlocks and the profession nudge, which would otherwise
    // push the oldest line out of the fixed-height log, and the shot is taken
    // on the second pass with a cleared log so every line fits. Eight actions
    // stay under the shared 10-per-60s action throttle. Deliberately not a
    // harvest: a gather is a 2.5s cast needing a node underfoot and a matching
    // tool, and these four already cover every line family the change touches.
    // The mobile variant is the same chat log at the touch layout's width,
    // where the longer yield-naming lines have the least room to sit.
    variants: [{ key: 'desktop' }, { key: 'mobile', mobile: true }],
    async capture(page, variant) {
      await page.evaluate(() => {
        document.querySelector('.camera-prompt-confirm')?.click();
        document.querySelector('.tut-skip')?.click();
        document.querySelector('.gpu-notice-dismiss')?.click();
      });
      const staged = await page.evaluate(() => {
        const sim = window.__game?.sim;
        const pid = sim?.playerId;
        if (!sim || pid === undefined) return { ok: false, reason: 'offline world is unavailable' };
        if (!sim.players?.get(pid)) return { ok: false, reason: 'player meta is unavailable' };
        // Two swords broken down per pass (one salvaged, one disenchanted)
        // plus one enchanted per pass; apply-enchant prefers an UNENCHANTED
        // copy, so the second pass takes a fresh one rather than tripping the
        // same-enchant deny. Reagents cover both passes.
        sim.addItem('eastbrook_arming_sword', 6, pid);
        sim.addItem('arcane_dust', 40, pid);
        sim.addItem('spider_leg', 8, pid);
        return { ok: true };
      });
      if (!staged.ok) throw new Error(staged.reason);
      await wait(400);
      const runPass = () =>
        page.evaluate(() => {
          const sim = window.__game?.sim;
          const pid = sim?.playerId;
          if (!sim || pid === undefined) return { ok: false, reason: 'world went away' };
          sim.craftItem?.('recipe_tough_jerky', false, pid);
          sim.salvageItem?.('eastbrook_arming_sword', pid);
          sim.disenchantItem?.('eastbrook_arming_sword', pid);
          sim.applyEnchant?.('eastbrook_arming_sword', 'enchant_weapon_might');
          return { ok: true };
        });
      const warmup = await runPass();
      if (!warmup.ok) throw new Error(warmup.reason);
      // The commands resolve on the tick they arrive on, but the events reach
      // the HUD through the live 20 Hz drain, so give the loop real time.
      await wait(1500);
      // Clear the log so the shot holds ONLY the second pass's four actions.
      await page.evaluate(() => {
        document.querySelector('#chatlog')?.replaceChildren();
      });
      const shot = await runPass();
      if (!shot.ok) throw new Error(shot.reason);
      await wait(1500);
      if (variant?.mobile) {
        // The touch layout parks the chat panel behind its own button; without
        // this the clip target is not visible and the shot silently falls back
        // to the whole HUD.
        await page.evaluate(() => {
          document
            .getElementById('mobile-chat')
            ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
        });
        await wait(700);
      }
      return { clip: '#chatlog-wrap' };
    },
  },
  {
    key: 'corpse-harvest-lines',
    label: 'Chat log: one line and one cue per corpse harvest (#2457)',
    when: ['sim/interaction', 'professions/harvest_yields', 'ui/grant_line_view'],
    // Corpse harvest is the sibling of the profession-grant-lines target above:
    // it was the last flow still logging through the grant hub, so it printed a
    // flat "You receive:" line and a generic ding PER COMPONENT. It is a
    // separate entry rather than a variant of that one because the bring-up is
    // completely different (a dead corpse underfoot, not four bag commands).
    //
    // Two forest_wolf corpses are harvested back to back: that template carries
    // hide and fang, the two-component everyday case, so the pair shows four
    // grant lines from two keypresses. The shared rng stream is pinned to a
    // fixed value immediately before the harvests, so the before and after
    // shots differ ONLY by this change; without it the tier and rarity rolls
    // land differently in each run and the quantities would not line up.
    variants: [{ key: 'desktop' }, { key: 'mobile', mobile: true }],
    async capture(page, variant) {
      await page.evaluate(() => {
        document.querySelector('.camera-prompt-confirm')?.click();
        document.querySelector('.tut-skip')?.click();
        document.querySelector('.gpu-notice-dismiss')?.click();
      });
      const staged = await page.evaluate(() => {
        const sim = window.__game?.sim;
        const player = sim?.player;
        const pid = sim?.playerId;
        if (!sim || !player || pid === undefined) {
          return { ok: false, reason: 'offline world is unavailable' };
        }
        const wolves = [...sim.entities.values()]
          .filter((e) => e.kind === 'mob' && e.templateId === 'forest_wolf')
          .slice(0, 2);
        if (wolves.length < 2) return { ok: false, reason: 'fewer than two forest_wolf spawns' };
        for (const wolf of wolves) {
          wolf.pos.x = player.pos.x;
          wolf.pos.y = player.pos.y;
          wolf.pos.z = player.pos.z;
          wolf.dead = true;
          wolf.aiState = 'dead';
          wolf.corpseTimer = 9999;
          wolf.respawnTimer = 9999;
          wolf.harvestClaimedBy = null;
          // Harvest only: corpse LOOT is a different flow with its own lines,
          // and leaving it on would put unrelated "You receive:" lines in the
          // shot that look like the bug this change fixes.
          wolf.lootable = false;
          wolf.loot = null;
        }
        return { ok: true, ids: wolves.map((wolf) => wolf.id) };
      });
      if (!staged.ok) throw new Error(staged.reason);
      await wait(400);
      const harvested = await page.evaluate((ids) => {
        const sim = window.__game?.sim;
        const pid = sim?.playerId;
        if (!sim || pid === undefined) return { ok: false, reason: 'world went away' };
        // Clear first so the shot holds only these two harvests.
        document.querySelector('#chatlog')?.replaceChildren();
        // Pin the shared stream. `s` is TypeScript-private, which is compile
        // time only, and both harvests run inside this one evaluate so no tick
        // draws between them: the two commands consume the same draws in the
        // same order on either branch.
        sim.rng.s = 20457;
        for (const id of ids) sim.harvestCorpse(id, undefined, pid);
        return { ok: true };
      }, staged.ids);
      if (!harvested.ok) throw new Error(harvested.reason);
      // The commands resolve on arrival but the events reach the HUD through
      // the live 20 Hz drain, so give the loop real time.
      await wait(1500);
      if (variant?.mobile) {
        // The touch layout parks the chat panel behind its own button; without
        // this the clip target is not visible and the shot silently falls back
        // to the whole HUD.
        await page.evaluate(() => {
          document
            .getElementById('mobile-chat')
            ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
        });
        await wait(700);
      }
      return { clip: '#chatlog-wrap' };
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
    // Desktop and mobile variants: the touch layout downscales the fixed 560px
    // map canvas (hud.mobile.css --mobile-map-size), so every on-canvas label is
    // resampled on the way to the screen. Label legibility therefore has to be
    // checked on both, not just at the desktop 1:1.
    variants: [{ key: 'desktop' }, { key: 'mobile', mobile: true }],
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
    // Desktop and mobile variants: the legibility rows (skill line,
    // difficulty label, station badge, combo reason) are actionable info and
    // must read on both form factors. The window shows one craft per tab, so
    // the difficulty ladder splits across two framings: four-states
    // stages a mid-skill unattuned character whose weaponcrafting tab shows
    // the gain ladder (commons two tiers below = minimal green, a known
    // rung-25 recipe = reduced yellow, a known rung-50 recipe = full orange),
    // and ceiling-state switches to the armorcrafting tab where the 75 row
    // sits above the pre-attunement ceiling (none, gray). The discount
    // variants stage the #1134 specialization scene: an armorcrafter at
    // skill 80 holding EXACTLY the discounted reagent amounts for the chain
    // vest (listed 4 copper / 9 flux, charged 3 / 7 at the 0.8 multiplier),
    // so the reagent line and the Craft gate show the discounted requirement.
    variants: [
      { key: 'desktop' },
      { key: 'mobile', mobile: true },
      { key: 'desktop-four-states', fourStates: true },
      { key: 'desktop-ceiling-state', fourStates: true, selectTab: 'armorcrafting' },
      { key: 'desktop-discount', discount: true, selectTab: 'armorcrafting' },
      { key: 'mobile-discount', discount: true, mobile: true, selectTab: 'armorcrafting' },
      // Issue #2375, the bag-freshness scene, and the one variant whose point
      // is WHEN the window repaints rather than how it looks: the default
      // grant leaves the minor healing potion at 2 of its 3 reagents, so the
      // window opens with that row disabled, and the missing silverleaf is
      // granted AFTERWARDS (the shopkeeper handing it over). The shot is taken
      // a slow band later. Before the fix the row is still disabled and the
      // reagent still reads 0/2; after it, the row is live.
      { key: 'desktop-bag-freshness', bagFreshness: true, selectTab: 'alchemy' },
      { key: 'mobile-bag-freshness', bagFreshness: true, mobile: true, selectTab: 'alchemy' },
    ],
    // Grant a spread of reagents across a few professions so several recipes read
    // craftable, force-hide then toggle so the open is deterministic, and clip to
    // the window.
    async capture(page, variant) {
      await page.evaluate(
        (staging) => {
          document.querySelector('#gpu-notice')?.remove();
          const sim = window.__game?.sim;
          const ids = ['bone_fragments', 'linen_scrap', 'spider_leg'];
          for (const id of ids) {
            try {
              sim?.addItem(id, 10);
            } catch {}
          }
          if (staging.fourStates) {
            const meta = sim?.players?.get(sim.primaryId);
            if (meta) {
              meta.craftSkills = { ...meta.craftSkills, weaponcrafting: 60 };
              meta.knownRecipes.add('recipe_ironedge_longsword');
              meta.knownRecipes.add('recipe_thorium_warblade');
            }
          }
          if (staging.discount) {
            try {
              sim?.addItem('copper_ore', 3);
              sim?.addItem('smithing_flux', 7);
            } catch {}
            const meta = sim?.players?.get(sim.primaryId);
            if (meta) meta.craftSkills = { ...meta.craftSkills, armorcrafting: 80 };
          }
          const el = document.querySelector('#crafting-window');
          if (el) el.style.display = 'none';
          window.__game?.hud?.toggleCrafting?.();
        },
        {
          fourStates: Boolean(variant?.fourStates),
          discount: Boolean(variant?.discount),
        },
      );
      // A first-open crafting window with several icon-bearing recipe rows takes
      // noticeably longer to lay out in headless swiftshader than the plain-list
      // bags/map windows do (getBoundingClientRect can report 0x0 for 2-4s), so
      // poll for a real size instead of guessing a fixed wait.
      const open = await pollForSize(page, '#crafting-window');
      if (open && (variant?.fourStates || variant?.discount)) {
        // Staging mid-tier craft skills trips the once-ever first-tier
        // explainer modal over the window, on a drain-window delay rather
        // than synchronously; poll-dismiss it so the shot frames the recipe
        // pane, not the tutorial.
        for (let i = 0; i < 10; i++) {
          const dismissed = await page.evaluate(() => {
            const ok = document.querySelector('#profession-tutorial .cd-ok');
            if (ok) ok.click();
            return Boolean(ok);
          });
          if (dismissed) break;
          await wait(300);
        }
        await wait(200);
      }
      if (open && variant?.selectTab) {
        // The window shows one craft per tab; a variant that frames another
        // craft clicks its tab (the real control, not a state poke).
        await page.evaluate((craft) => {
          document.querySelector(`#crafting-window .crafting-tab[data-craft="${craft}"]`)?.click();
        }, variant.selectTab);
        await wait(300);
      }
      if (open && variant?.bagFreshness) {
        // The whole point of the scene: the bag changes while the window is
        // already open and the player never touches it. Grant the missing
        // reagent through the sim (the same mutation a vendor buy, a loot, or
        // a trade lands) and wait past the 500ms slow band, so the shot shows
        // what the window says a moment after the reagent arrived.
        await page.evaluate(() => {
          try {
            window.__game?.sim?.addItem('silverleaf_herb', 2);
          } catch {}
        });
        await wait(900);
      }
      if (
        open &&
        (variant?.mobile || variant?.fourStates || variant?.discount || variant?.bagFreshness)
      ) {
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
    key: 'gather-tool-tooltip',
    label: 'Bag tooltip: gathering implement kind/requirement/use/bonus lines (#2343)',
    when: ['ui/gather_tool_tooltip', 'professions/tools'],
    // Grant the implements, open bags, focus one cell: the new tooltip lines
    // (kind, required-to, use, speed or bite/reel/band bonuses) read in one
    // frame. Full-frame shot: the tooltip renders beside the bags window.
    variants: [
      { key: 'pick', hover: 'Iron Mining Pick' },
      { key: 'rod', hover: 'Ironreel Fishing Rod' },
    ],
    async capture(page, variant) {
      await page.evaluate(() => {
        document.querySelector('#gpu-notice')?.remove();
        document.querySelector('.camera-prompt-confirm')?.click();
        const sim = window.__game?.sim;
        try {
          sim?.addItem?.('iron_mining_pick', 1);
          sim?.addItem?.('ironreel_fishing_rod', 1);
        } catch {}
        const el = document.querySelector('#bags');
        if (el) el.style.display = 'none';
        window.__game?.hud?.toggleBags?.();
      });
      let open = await pollForSize(page, '#bags');
      if (!open) {
        await page.evaluate(() => window.__game?.hud?.toggleBags?.());
        open = await pollForSize(page, '#bags');
      }
      if (!open) return {};
      await page.evaluate((name) => {
        document.querySelector('.camera-prompt-confirm')?.click();
        const banner = document.querySelector('#banner');
        if (banner) banner.style.opacity = '0';
        // Real focus fires attachTooltip's focusin arm (keyboard-nav path), a
        // sturdier trigger than synthetic mouseenter under headless.
        const cell = Array.from(document.querySelectorAll('#bags button')).find((b) =>
          b.getAttribute('aria-label')?.includes(name),
        );
        cell?.scrollIntoView({ block: 'center' });
        cell?.focus();
      }, variant?.hover ?? 'Iron Mining Pick');
      await pollForSize(page, '#tooltip');
      await wait(300);
      return {};
    },
  },
  {
    key: 'gather-node-hover-tooltip',
    label: 'World hover: gather-node requirement line, tier 1 included (#2343)',
    when: ['ui/gather_node_tooltip', 'ui/gathering_view', 'professions/gathering'],
    // Teleport onto the starter ore vein and sweep the REAL mouse over it: the
    // hover tooltip only paints through the live pointermove raycast, so the
    // sweep proves the actual path. Toolless shows the red requires-a-pick
    // line; tooled shows it neutral.
    variants: [{ key: 'toolless' }, { key: 'tooled', tooled: true }],
    async capture(page, variant) {
      await page.evaluate((tooled) => {
        document.querySelector('#gpu-notice')?.remove();
        document.querySelector('.camera-prompt-confirm')?.click();
        const banner = document.querySelector('#banner');
        if (banner) banner.style.opacity = '0';
        const sim = window.__game?.sim;
        try {
          // The vein sits inside the Copper Dig mob camp: silence the camp
          // FIRST (the test-suite despawnMobs idiom) or the level-1 subject
          // dies mid-hover, then teleport beside ore_eastbrook_1 at (-70,-53).
          for (const e of sim?.entities?.values?.() ?? []) {
            if (e.kind !== 'mob') continue;
            e.dead = true;
            e.hp = 0;
            e.aiState = 'dead';
            e.respawnTimer = 9999;
            e.corpseTimer = 9999;
            e.inCombat = false;
          }
          sim?.chat?.('/dev tp -70 -52');
          if (tooled) sim?.addItem?.('copper_mining_pick', 1);
        } catch {}
      }, Boolean(variant?.tooled));
      await wait(800); // let the teleport settle and the camera follow
      const vp = page.viewport() ?? { width: 1280, height: 720 };
      let shown = false;
      // The vein sits at the player's feet after the teleport, so sweep the
      // lower-center screen region; each stop outwaits the 120ms pick
      // throttle, and the x range stays off the right-edge icon column.
      outer: for (const dy of [60, 100, 140, 20, 180, -20]) {
        for (const dx of [0, -60, 60, -120, 120]) {
          await page.mouse.move(vp.width / 2 + dx, vp.height / 2 + dy);
          await wait(170);
          const visible = await page.evaluate(() => {
            const tip = document.getElementById('tooltip');
            return !!tip && getComputedStyle(tip).display !== 'none' && tip.offsetWidth > 0;
          });
          if (visible) {
            shown = true;
            break outer;
          }
        }
      }
      // No honest hover, no shot: never fake the tooltip into the DOM.
      if (!shown) throw new Error('node hover tooltip never appeared through the live raycast');
      await wait(200);
      return {};
    },
  },
  {
    key: 'masterwork-tooltip',
    label: 'Bag tooltip: masterwork seal, enchanted marker, makers mark',
    when: ['ui/item_instance_tooltip', 'ui/painter_host', 'ui/bank_view'],
    // Grant a signed masterwork copy, open bags, hover its slot: the tooltip's
    // per-copy lines (gold seal, green baked bonus stats, Crafted by) all read
    // in one frame. Full-frame shot: the tooltip renders beside the window and
    // the single-selector clip cannot union the two rects. The
    // gathered variant hovers a signed harvest material instead: the same
    // signer line reads Gathered by there (Crafted by on the base tree, the
    // honest before side).
    variants: [
      { key: 'crafted' },
      { key: 'gathered', gathered: true },
      // A commissioned copy bound to its recipient, so the gold
      // Maker's Bond line reads beside the maker's mark.
      { key: 'commission-bound', commission: true },
    ],
    async capture(page, variant) {
      await page.evaluate(
        (mode) => {
          document.querySelector('#gpu-notice')?.remove();
          document.querySelector('.camera-prompt-confirm')?.click();
          const game = window.__game;
          try {
            if (mode === 'gathered') {
              game?.sim?.addItemInstance('pristine_hide', { signer: 'Thorgar' });
            } else if (mode === 'commission') {
              // A commissioned (bindOnTrade) copy already bound to
              // its recipient; the tooltip composes the bound line with the
              // maker's mark.
              game?.sim?.addItemInstance('gravewyrm_gauntlets', {
                signer: 'Thorgar',
                bindOnTrade: true,
                boundTo: game?.sim?.playerId,
              });
            } else {
              // A dungeon-drop def the starter bag can never contain, so the
              // aria-label lookup below is unambiguous.
              game?.sim?.addItemInstance('gravewyrm_gauntlets', {
                signer: 'Thorgar',
                rolled: { masterwork: true, stats: { str: 2, sta: 1 } },
              });
            }
          } catch {}
          const el = document.querySelector('#bags');
          if (el) el.style.display = 'none';
          game?.hud?.toggleBags?.();
        },
        variant?.gathered ? 'gathered' : variant?.commission ? 'commission' : 'crafted',
      );
      // toggleBags tracks logical open state, so a shared page where an earlier
      // target left the bags logically open needs a second toggle to reopen.
      let open = await pollForSize(page, '#bags');
      if (!open) {
        await page.evaluate(() => window.__game?.hud?.toggleBags?.());
        open = await pollForSize(page, '#bags');
      }
      if (!open) return {};
      await page.evaluate((gathered) => {
        // The grant can pop a transient deed banner and the camera prompt on
        // the shared page; clear both so the tooltip is the frame's subject.
        document.querySelector('.camera-prompt-confirm')?.click();
        const banner = document.querySelector('#banner');
        if (banner) banner.style.opacity = '0';
        // Real focus fires attachTooltip's focusin arm (keyboard-nav path), a
        // sturdier trigger than synthetic mouseenter under headless.
        const name = gathered ? 'Pristine Hide' : 'Gravewyrm Gauntlets';
        const cell = Array.from(document.querySelectorAll('#bags button')).find((b) =>
          b.getAttribute('aria-label')?.includes(name),
        );
        cell?.scrollIntoView({ block: 'center' });
        cell?.focus();
      }, Boolean(variant?.gathered));
      await pollForSize(page, '#tooltip');
      await wait(300);
      return {};
    },
  },
  {
    key: 'weapon-type-tooltip',
    label: 'Item tooltip: weapon type on the slot line (Dagger / Polearm)',
    when: ['ui/weapon_type_label'],
    // Grant a spread of weapons, open bags, hover one: the new type label reads
    // on its own plain line above the slot line. The dagger variant is the
    // headline case (rogues need daggers, and it replaces the old standalone
    // "Dagger" sub-line); the polearm variant shows the added label.
    // Full-frame shot: the tooltip renders beside the bags window and a single
    // selector clip cannot union the two rects.
    variants: [
      { key: 'dagger', hover: 'Fang of Korzul' },
      { key: 'polearm', hover: 'Tidereaver Gaff' },
    ],
    async capture(page, variant) {
      await page.evaluate(() => {
        document.querySelector('#gpu-notice')?.remove();
        document.querySelector('.camera-prompt-confirm')?.click();
        const sim = window.__game?.sim;
        // A sword, a dagger, a staff, a wand and a polearm so several types read
        // in the bag; the hovered one carries the tooltip. Dungeon-drop ids the
        // starter bag can never contain, so the aria-label lookup is unambiguous.
        for (const id of [
          'worn_sword',
          'fang_of_korzul',
          'gnarled_staff',
          'drowned_tide_scepter',
          'tidereaver_gaff',
        ]) {
          try {
            sim?.addItem(id, 1);
          } catch {}
        }
        const el = document.querySelector('#bags');
        if (el) el.style.display = 'none';
        window.__game?.hud?.toggleBags?.();
      });
      let open = await pollForSize(page, '#bags');
      if (!open) {
        await page.evaluate(() => window.__game?.hud?.toggleBags?.());
        open = await pollForSize(page, '#bags');
      }
      if (!open) return {};
      await page.evaluate((name) => {
        document.querySelector('.camera-prompt-confirm')?.click();
        const banner = document.querySelector('#banner');
        if (banner) banner.style.opacity = '0';
        // Real focus fires attachTooltip's focusin arm (the keyboard-nav path), a
        // sturdier trigger than synthetic mouseenter under headless.
        const cell = Array.from(document.querySelectorAll('#bags button')).find((b) =>
          b.getAttribute('aria-label')?.includes(name),
        );
        cell?.scrollIntoView({ block: 'center' });
        cell?.focus();
      }, variant?.hover ?? 'Fang of Korzul');
      await pollForSize(page, '#tooltip');
      await wait(300);
      return {};
    },
  },
  {
    key: 'unbind-window',
    label: "Maker's Bond unbind window (station master service)",
    when: ['ui/hud/vendor/unbind', 'sim/professions/commission'],
    variants: [{ key: 'desktop' }, { key: 'mobile', mobile: true }],
    // Grant a bound commissioned piece plus the fee, stand next to the forge
    // master (the walk-away proximity close needs the player within 8yd of
    // the NPC), and open the service window directly. The row lists the
    // DEF-quality fee off the sim's own unbindFeeFor, so the shot proves the
    // fee-before-confirm surface.
    async capture(page) {
      const staged = await page.evaluate(() => {
        document.querySelector('#gpu-notice')?.remove();
        document.querySelector('.camera-prompt-confirm')?.click();
        const game = window.__game;
        const sim = game?.sim;
        if (!game || !sim) return { ok: false, reason: 'offline world is unavailable' };
        try {
          sim.addItemInstance('eastbrook_arming_sword', {
            bindOnTrade: true,
            boundTo: sim.playerId,
            signer: 'Thorgar',
          });
        } catch {}
        const meta = sim.players?.get(sim.primaryId);
        if (meta) meta.copper = Math.max(meta.copper, 50000);
        let master = null;
        for (const e of sim.entities.values()) {
          if (e.templateId === 'forgemistress_darva') master = e;
        }
        if (!master) return { ok: false, reason: 'forge master not found' };
        const p = sim.player;
        p.pos.x = master.pos.x + 1.5;
        p.pos.z = master.pos.z;
        const el = document.querySelector('#unbind-window');
        if (el) el.style.display = 'none';
        game.hud?.openUnbind?.(master.id);
        return { ok: true };
      });
      if (!staged.ok) throw new Error(staged.reason);
      const open = await pollForSize(page, '#unbind-window');
      return open ? { clip: '#unbind-window' } : {};
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
    key: 'market-armor-filters',
    label: 'World Market armor filters (responsive search and filter grid)',
    when: ['ui/market_window', 'ui/market_view', 'ui/market_filters'],
    variants: [{ key: 'desktop' }, { key: 'mobile', mobile: true }],
    async capture(page, shot) {
      if (!(await openMarketBrowse(page))) return {};
      const selected = await page.evaluate(() => {
        const option = document.querySelector(
          '[data-market-filter-menu="itemType"] [data-market-filter-option="armor"]',
        );
        if (!(option instanceof HTMLElement)) return false;
        option.click();
        document.activeElement instanceof HTMLElement && document.activeElement.blur();
        return true;
      });
      if (!selected) return {};
      await wait(250);
      if (shot?.mobile) {
        await page.evaluate(() => {
          const market = document.querySelector('#market-window');
          if (market) market.scrollTop = 150;
        });
      }
      return { clip: '#market-window' };
    },
  },
  // The market-window target above shoots the browse grid with every dropdown CLOSED, so
  // it is blind to the filter vocabulary itself. These two open the menus. Keyed on the
  // shared query module (which holds the option lists) plus the view core (which decides
  // WHICH menus a type raises), and deliberately NOT on ui/market_window, so an unrelated
  // painter layout change does not drag them along.
  {
    key: 'market-type-filter-list',
    label: 'World Market item-type filter list (open)',
    when: ['sim/market_query', 'ui/market_view'],
    variants: [{ key: 'desktop' }, { key: 'mobile', mobile: true }],
    async capture(page) {
      if (!(await openMarketBrowse(page))) return {};
      const opened = await page.evaluate(() => {
        const menu = document.querySelector('[data-market-filter-menu="itemType"]');
        const btn = menu?.querySelector('.mkt-select-btn');
        if (!btn) return false;
        btn.click();
        return true;
      });
      if (!opened) return {};
      await wait(250);
      return { clip: '#market-window' };
    },
  },
  {
    key: 'market-bag-size-filter',
    label: 'World Market bag capacity filter (Bags selected, sizes open)',
    when: ['sim/market_query', 'ui/market_view'],
    variants: [{ key: 'desktop' }, { key: 'mobile', mobile: true }],
    async capture(page) {
      // Skip rather than clip a selector that never appeared, matching the sibling
      // market-window target: a shot of the whole page is worse than no shot.
      if (!(await openMarketBrowse(page))) return {};
      // On the BASE commit there is no 'bag' option, so this is a no-op and the shot
      // is the plain browse tab: exactly the "before" this change is contrasted with.
      await page.evaluate(() => {
        document
          .querySelector('[data-market-filter-menu="itemType"] [data-market-filter-option="bag"]')
          ?.click();
      });
      await wait(250);
      await page.evaluate(() => {
        const menu = document.querySelector('[data-market-filter-menu="subtype"]');
        menu?.querySelector('.mkt-select-btn')?.click();
      });
      await wait(250);
      return { clip: '#market-window' };
    },
  },
  {
    key: 'market-collect-indicator',
    label: 'World Market collect indicator (minimap rim badge)',
    // Keyed on the feature's own test path (the tank-defensive-cds pattern), so a
    // broad ui/hud.ts or styles diff does not drag this focused shot along.
    when: ['tests/market_collect_indicator.test.ts'],
    variants: [{ key: 'desktop' }, { key: 'mobile', mobile: true }],
    // Credit the primary player's market collection directly (TS-private fields
    // are plain properties at runtime), so the always-on badge lights without
    // staging a full sale; the slow HUD band repaints it within a beat. Desktop
    // clips to the minimap cluster; mobile keeps the full frame because the
    // badge row sits left of (outside) #minimap-wrap's box.
    async capture(page, shot) {
      await page.evaluate(() => {
        const sim = window.__game?.sim;
        if (!sim) return;
        sim.market.marketCollections.set(String(sim.playerId), {
          copper: 9500,
          items: [{ itemId: 'wolf_fang', count: 1 }],
        });
      });
      const lit = await pollForSize(page, '#market-indicator');
      if (!lit) throw new Error('#market-indicator did not light');
      return shot?.mobile ? {} : { clip: '#minimap-wrap' };
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
    key: 'meters-interaction',
    label: 'Meters: tab right-click menu, moving a panel, and resizing one',
    // Two scenes are the menu, but the other three are move and resize, which
    // live in the frame controller and its geometry core (`ui/meters_frame`
    // matches both). Gating on the menu modules alone would let a frame-only
    // change ship without reshooting the drags it changed.
    when: ['ui/meters_menu', 'ui/simple_context_menu', 'ui/meters_frame'],
    variants: [
      { key: 'menu-separate', charClass: 'warlock', charName: 'Nyxaris', scene: 'separate' },
      { key: 'menu-regroup', charClass: 'warlock', charName: 'Nyxaris', scene: 'regroup' },
      { key: 'move', charClass: 'warlock', charName: 'Nyxaris', scene: 'move' },
      { key: 'resize-small', charClass: 'warlock', charName: 'Nyxaris', scene: 'resizeSmall' },
      { key: 'resize-large', charClass: 'warlock', charName: 'Nyxaris', scene: 'resizeLarge' },
    ],
    // One scene per thing being shown: the two menu states, a panel moved off
    // its HUD anchor, and the same panel at two sizes. Every gesture is a REAL
    // pointer drag or a REAL right-click, so each shot proves the shipped
    // interaction rather than a style write.
    async capture(page, variant) {
      await page.evaluate(() => {
        const game = window.__game;
        const sim = game?.sim;
        const player = sim?.player;
        if (!sim || !player) return;
        document.querySelector('#gpu-notice')?.remove();
        document.querySelector('.camera-prompt-confirm')?.click();
        let mobId = null;
        for (const e of sim.entities.values()) {
          if (e.kind === 'mob' && e.ownerId == null && !e.dead) {
            mobId = e.id;
            break;
          }
        }
        const meters = game?.hud?.meters;
        if (meters === undefined || mobId === null) return;
        // Variants share one browser, so a previous scene's saved boxes and
        // popped-out set would leak in. Normalize to the stock layout first.
        meters.dock?.('heal');
        meters.dock?.('threat');
        meters.resetFrames?.();
        const hit = (amount, ability) =>
          meters.onEvent({
            type: 'damage',
            sourceId: player.id,
            targetId: mobId,
            amount,
            crit: false,
            school: 'physical',
            ability,
            kind: 'hit',
          });
        hit(1840, 'Shadow Bolt');
        hit(910, 'Corruption');
        hit(470, 'Immolate');
        const el = document.querySelector('#meters-window');
        if (el) el.style.display = 'none';
        game?.hud?.toggleMeters?.();
        const banner = document.querySelector('#banner');
        if (banner) banner.style.opacity = '0';
      });
      const open = await pollForSize(page, '#meters-window');
      if (!open) return {};
      await wait(1000);

      const titleDrag = async (selector, dx, dy) => {
        const at = await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }, selector);
        if (!at) return;
        await page.mouse.move(at.x, at.y);
        await page.mouse.down();
        await page.mouse.move(at.x + dx, at.y + dy, { steps: 14 });
        await page.mouse.up();
        await wait(200);
      };
      const gripDrag = async (selector, dx, dy) => {
        const at = await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: r.right - 6, y: r.bottom - 6 };
        }, selector);
        if (!at) return;
        await page.mouse.move(at.x, at.y);
        await page.mouse.down();
        await page.mouse.move(at.x + dx, at.y + dy, { steps: 12 });
        await page.mouse.up();
        await wait(200);
      };
      const rightClickTab = async (tab) => {
        const at = await page.evaluate((name) => {
          const el = document.querySelector(`#meters-window .mt-tab[data-tab="${name}"]`);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }, tab);
        if (!at) return;
        await page.mouse.click(at.x, at.y, { button: 'right' });
        await wait(400);
      };

      if (variant.scene === 'separate') {
        // Move the window up first so the menu opens over the world, not off
        // the bottom edge, then right-click the still-docked Threat tab.
        await titleDrag('#meters-window .mt-view', -120, -300);
        await rightClickTab('threat');
      } else if (variant.scene === 'regroup') {
        await titleDrag('#meters-window .mt-view', -120, -300);
        await page.evaluate(() => window.__game?.hud?.meters?.popOut?.('threat'));
        await wait(500);
        await rightClickTab('threat');
      } else if (variant.scene === 'move') {
        // Straight across the screen: the panel's home is the bottom-right HUD
        // stack, so landing upper-left is unambiguous.
        await titleDrag('#meters-window .mt-view', -820, -520);
      } else if (variant.scene === 'resizeSmall') {
        await titleDrag('#meters-window .mt-view', -520, -360);
        await gripDrag('#meters-window', -70, -40);
      } else if (variant.scene === 'resizeLarge') {
        await titleDrag('#meters-window .mt-view', -520, -360);
        await gripDrag('#meters-window', 240, 230);
      }
      await wait(500);
      return {};
    },
  },
  {
    key: 'meters-detached',
    label: 'Damage meters: Threat and Healing popped out into their own movable windows',
    when: ['ui/meters_frame', 'ui/meters_rows', 'meters_frame_core'],
    variants: [{ key: 'desktop', charClass: 'warlock', charName: 'Nyxaris' }],
    // Feed a spread of combat through the real Meters.onEvent path, pop both
    // detachable meters out, then place the three panels apart so the shot shows
    // what the feature is for: three independently positioned meter windows.
    async capture(page) {
      await page.evaluate(() => {
        const game = window.__game;
        const sim = game?.sim;
        const player = sim?.player;
        if (!sim || !player) return;
        document.querySelector('#gpu-notice')?.remove();
        document.querySelector('.camera-prompt-confirm')?.click();
        let mobId = null;
        for (const e of sim.entities.values()) {
          if (e.kind === 'mob' && e.ownerId == null && !e.dead) {
            mobId = e.id;
            break;
          }
        }
        const meters = game?.hud?.meters;
        if (meters === undefined || mobId === null) return;
        const hit = (sourceId, amount, ability) =>
          meters.onEvent({
            type: 'damage',
            sourceId,
            targetId: mobId,
            amount,
            crit: false,
            school: 'physical',
            ability,
            kind: 'hit',
          });
        hit(player.id, 1840, 'Shadow Bolt');
        hit(player.id, 910, 'Corruption');
        hit(player.id, 470, 'Immolate');
        meters.onEvent({
          type: 'heal2',
          sourceId: player.id,
          targetId: player.id,
          amount: 620,
          crit: false,
          ability: 'Drain Life',
        });
        const el = document.querySelector('#meters-window');
        if (el) el.style.display = 'none';
        game?.hud?.toggleMeters?.();
        meters.popOut?.('heal');
        meters.popOut?.('threat');
      });
      const open = await pollForSize(page, '#meters-window');
      if (!open) return {};
      await wait(1200);
      await page.evaluate(() => {
        const banner = document.querySelector('#banner');
        if (banner) banner.style.opacity = '0';
      });

      // Move each panel with a REAL pointer drag on its title bar and a REAL
      // drag on its corner grip, so the shot proves the shipped gesture rather
      // than a style write the feature does not actually perform.
      const dragFrom = async (selector, dx, dy) => {
        const at = await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }, selector);
        if (!at) return;
        await page.mouse.move(at.x, at.y);
        await page.mouse.down();
        await page.mouse.move(at.x + dx, at.y + dy, { steps: 12 });
        await page.mouse.up();
        await wait(150);
      };
      const grip = async (id, dx, dy) => {
        const at = await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: r.right - 6, y: r.bottom - 6 };
        }, id);
        if (!at) return;
        await page.mouse.move(at.x, at.y);
        await page.mouse.down();
        await page.mouse.move(at.x + dx, at.y + dy, { steps: 10 });
        await page.mouse.up();
        await wait(150);
      };

      await dragFrom('#threat-window .panel-title', -300, -300);
      await grip('#threat-window', 70, 90);
      await dragFrom('#heal-window .panel-title', -620, -260);
      await grip('#heal-window', 70, 90);
      await dragFrom('#meters-window .panel-title', -40, -120);
      await grip('#meters-window', 70, 90);
      await wait(600);
      return {};
    },
  },
  {
    key: 'meters',
    label: 'Damage meters: bars plus the per-ability hover breakdown',
    when: ['ui/meters', 'meters_breakdown'],
    variants: [
      { key: 'desktop', charClass: 'warlock', charName: 'Nyxaris' },
      { key: 'mobile', charClass: 'warlock', charName: 'Nyxaris', mobile: true },
    ],
    // Summon a pet so the owner row folds pet output, feed a spread of combat
    // events through the REAL Meters.onEvent path (the same call handleEvents
    // makes, only the events are staged), then focus the top bar: attachTooltip's
    // focusin arm paints the breakdown, a sturdier trigger than a synthetic
    // mouseenter under headless. Full-frame shot: #tooltip sits beside the panel
    // and a single-selector clip cannot union the two rects.
    async capture(page) {
      // The summon lands its own entity, so it gets its own evaluate + settle:
      // scanning for the pet in the same turn raced it, and on the mobile page
      // window.__game is sometimes not published yet on the first try, so this
      // retries until a pet is actually in the world.
      const hasPet = () =>
        page.evaluate(() => {
          const sim = window.__game?.sim;
          if (!sim?.player) return false;
          for (const e of sim.entities.values()) {
            if (e.kind === 'mob' && e.ownerId === sim.player.id) return true;
          }
          return false;
        });
      for (let attempt = 0; attempt < 30 && !(await hasPet()); attempt++) {
        await page.evaluate(() => {
          const sim = window.__game?.sim;
          document.querySelector('#gpu-notice')?.remove();
          document.querySelector('.camera-prompt-confirm')?.click();
          if (!sim?.player) return;
          try {
            sim.summonPet?.(sim.player, 'emberkin');
          } catch {}
        });
        await wait(500);
      }
      await page.evaluate(() => {
        const game = window.__game;
        const sim = game?.sim;
        const player = sim?.player;
        if (!sim || !player) return;
        let petId = null;
        for (const e of sim.entities.values()) {
          if (e.kind === 'mob' && e.ownerId === player.id) petId = e.id;
        }
        // A dummy target the party "fought", so the segment has a mob to name.
        let mobId = null;
        for (const e of sim.entities.values()) {
          if (e.kind === 'mob' && e.ownerId == null && !e.dead) {
            mobId = e.id;
            break;
          }
        }
        const meters = game?.hud?.meters;
        if (meters === undefined || mobId === null) return;
        const hit = (sourceId, amount, ability) =>
          meters.onEvent({
            type: 'damage',
            sourceId,
            targetId: mobId,
            amount,
            crit: false,
            school: 'physical',
            ability,
            kind: 'hit',
          });
        hit(player.id, 1840, 'Shadow Bolt');
        hit(player.id, 910, 'Corruption');
        hit(player.id, 470, 'Immolate');
        hit(player.id, 260, null);
        if (petId !== null) {
          hit(petId, 620, 'Firebolt');
          hit(petId, 180, null);
        }
        const el = document.querySelector('#meters-window');
        if (el) el.style.display = 'none';
        game?.hud?.toggleMeters?.();
      });
      const open = await pollForSize(page, '#meters-window');
      if (!open) return {};
      // The segment's duration (and so its rate column) is still settling right
      // after the events land, and the shared tooltip paints ONCE on focus: let
      // the panel settle first, or the breakdown header disagrees with the bar.
      await wait(2000);
      await page.evaluate(() => {
        const banner = document.querySelector('#banner');
        if (banner) banner.style.opacity = '0';
        const row = document.querySelector('#meters-window .mt-row');
        if (row instanceof HTMLElement) row.focus();
      });
      await pollForSize(page, '#tooltip');
      await wait(300);
      return {};
    },
  },
  {
    key: 'char-window',
    label: 'Character window',
    when: ['ui/char_window', 'ui/char_view', 'ui/stat_tooltip_view'],
    // Desktop and mobile, each in two framings: the default top framing, plus
    // the gathering panel scrolled into view (it sits below the fold and is
    // per-player progression info a player reads on both form factors,
    // including the fishing row).
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
    key: 'worn-enchant-tooltip',
    label: 'Paperdoll tooltip after enchanting the WORN piece in place',
    when: ['professions/enchanting', 'ui/enchant_apply_view'],
    // Equip a plain sword, apply an enchant to it IN PLACE (the worn arm), then
    // hover its paperdoll row: the enchanted marker and the green bonus stat line
    // read off equippedInstances without the piece ever leaving the slot. Full
    // frame, since the tooltip renders beside the window and one selector cannot
    // union the two rects.
    variants: [{ key: 'desktop' }, { key: 'mobile', mobile: true }],
    async capture(page) {
      const staged = await page.evaluate(() => {
        document.querySelector('#gpu-notice')?.remove();
        document.querySelector('.camera-prompt-confirm')?.click();
        document.querySelector('.tut-skip')?.click();
        const sim = window.__game?.sim;
        if (!sim?.player) return { ok: false, reason: 'offline world unavailable' };
        sim.addItem('eastbrook_arming_sword', 1);
        sim.equipItemToSlot('eastbrook_arming_sword', 'mainhand');
        sim.addItem('arcane_dust', 5);
        // The command entry point, exactly what the picker's worn row dispatches
        // (never a hand-written payload): item id, enchant id, worn slot.
        sim.applyEnchant('eastbrook_arming_sword', 'enchant_weapon_might', 'mainhand');
        return { ok: true };
      });
      if (!staged.ok) throw new Error(staged.reason);
      await page.evaluate(() => {
        const el = document.querySelector('#char-window');
        if (el) el.style.display = 'none';
        window.__game?.hud?.toggleChar?.();
      });
      if (!(await pollForSize(page, '#char-window')))
        throw new Error('character window did not open');
      const shown = await page.evaluate(() => {
        const banner = document.querySelector('#banner');
        if (banner) banner.style.opacity = '0';
        // Real focus fires attachTooltip's focusin arm, the sturdier headless
        // trigger (the masterwork-tooltip target's precedent).
        const row = [...document.querySelectorAll('#char-window [data-equip-slot]')].find(
          (r) => r.getAttribute('data-equip-slot') === 'mainhand',
        );
        if (!row) return false;
        row.focus?.();
        row.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
        return true;
      });
      if (!shown) throw new Error('no mainhand paperdoll row to hover');
      await wait(500);
      return { clip: '#ui' };
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
    key: 'interface-options-tabs',
    label: 'Interface options panel (four-tab split)',
    when: ['ui/options_window', 'ui/options_view'],
    variants: [{ key: 'desktop' }, { key: 'mobile', mobile: true }],
    async capture(page) {
      await page.evaluate(() => {
        const hud = window.__game?.hud;
        if (!hud) return;
        // Land on a fresh main menu, then route to the Interface sub-panel. The
        // main menu lists Key Bindings, Controller, Graphics, Interface, Audio,
        // Performance, [Report a Bug (online only)], Log Out, Return; offline has
        // no bug-report row, so Interface is the fourth button.
        const win = document.querySelector('#options-menu');
        if (win && getComputedStyle(win).display !== 'none') hud.toggleOptionsMenu();
        hud.toggleOptionsMenu();
        const buttons = Array.from(document.querySelectorAll('#options-menu .opt-btn'));
        buttons[3]?.click();
      });
      const open = await pollForSize(page, '#options-menu .set-rows');
      return open ? { clip: '#options-menu' } : {};
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
        if (!sim?.player) return { ok: false, reason: 'offline world is unavailable' };
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
    key: 'guild-billboard',
    label: 'Social window: Guild tab billboard (officer edit vs member read-only)',
    // Match the SOURCE files (`.ts` suffix, same reason as guild-roster above).
    when: ['ui/social_window.ts', 'ui/social_view.ts'],
    // Same sanctioned offline-staging fallback as guild-roster: inject a guild
    // fixture (now carrying motd/motdSetBy) through the debug hook and open the
    // Guild tab. The officer variant shows the enabled edit input + save button;
    // the member variant shows the disabled input with no save.
    variants: [
      { key: 'desktop-officer', charName: 'Rueweaver', charClass: 'paladin', rank: 'officer' },
      { key: 'desktop-member', charName: 'Rueweaver', charClass: 'paladin', rank: 'member' },
      { key: 'mobile', charName: 'Rueweaver', charClass: 'paladin', rank: 'officer', mobile: true },
    ],
    async capture(page, variant) {
      const staged = await page.evaluate((rank) => {
        const sim = window.__game?.sim;
        if (!sim?.player) return { ok: false, reason: 'offline world is unavailable' };
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
        sim.socialInfo = {
          friends: [],
          blocks: [],
          ignores: [],
          guild: {
            id: 1,
            name: 'The Loud Ones',
            rank,
            motd: 'Raid night Friday, 8pm server. Bring flasks. Discord: discord.gg/example',
            motdSetBy: 'Gizzelda',
            members: [
              m({
                id: 1,
                name: me,
                cls: 'paladin',
                level: 60,
                online: true,
                status: 'online',
                zone: 'zone:stormwind',
                rank,
              }),
              m({
                id: 2,
                name: 'Gizzelda',
                cls: 'mage',
                level: 60,
                online: true,
                status: 'dungeon',
                zone: 'zone:deadmines',
                rank: 'leader',
              }),
              m({
                id: 3,
                name: 'Bramble',
                cls: 'druid',
                level: 41,
                online: false,
                rank: 'member',
                lastLogin: '2026-07-15T09:30:00.000Z',
              }),
            ],
            events: [],
          },
        };
        const el = document.querySelector('#social-window');
        if (el) el.classList.remove('open');
        window.__game?.hud?.toggleSocial?.();
        return { ok: true };
      }, variant?.rank ?? 'officer');
      if (!staged.ok) throw new Error(staged.reason);
      const open = await pollForSize(page, '#social-window');
      if (!open) return {};
      await page.evaluate(() => {
        document.querySelector('.soc-tab[data-tab="guild"]')?.click();
      });
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
    key: 'class-colors',
    label: 'Class color palette: chat names, party frames + minimap dots, character model',
    // .ts-suffixed so the substring does NOT also fire on tests/class_colors.test.ts
    // (classifyDiff treats .test.ts as non-visual).
    when: ['sim/content/classes.ts', 'styles/shell.css'],
    // The palette is one shared value (CLASSES[cls].color), so a refresh must be
    // eyeballed on every surface that reads it: the chat sender names (all nine
    // classes across channels), the party-frame class accents plus the minimap
    // party dots, and the 3D model tint (priest moved the furthest, off pure white).
    variants: [
      { key: 'chat', charClass: 'warrior', charName: 'Thorgar' },
      // The class names paint on whatever panel the active UI theme sets
      // (src/ui/theme.ts presets), so legibility must be checked per theme,
      // not only on the shipped classic dark panel.
      { key: 'chat-midnight', charClass: 'warrior', charName: 'Thorgar', theme: 'midnight' },
      { key: 'chat-parchment', charClass: 'warrior', charName: 'Thorgar', theme: 'parchment' },
      {
        key: 'chat-highcontrast',
        charClass: 'warrior',
        charName: 'Thorgar',
        theme: 'highContrast',
      },
      { key: 'party', charClass: 'priest', charName: 'Lumina' },
      { key: 'raid', charClass: 'warrior', charName: 'Thorgar' },
      { key: 'model', charClass: 'priest', charName: 'Lumina' },
    ],
    async capture(page, variant) {
      // Headless-swiftshader GPU notice is a capture-environment artifact; the
      // camera prompt can arrive late and overlay the scene.
      await page.evaluate(() => {
        document.querySelector('.camera-prompt-confirm')?.click();
        document.querySelector('.tut-skip')?.click();
        document.querySelector('#gpu-notice')?.remove();
      });
      if (variant.key.startsWith('chat')) {
        if (variant.theme) {
          // Switch the UI theme through the REAL options hook (store +
          // applyTheme), the same path the Options panel preset buttons take.
          await page.evaluate((preset) => {
            window.__game?.hud?.optionsHooks?.theme?.setPreset(preset);
          }, variant.theme);
          await wait(300);
        }
        await pollForSize(page, '#chatlog-wrap', 60, 500);
        // One line per class, spread across channels, through the real dispatch
        // (hud.handleEvents; mirrors the chat-flair-class-color target). pid-less
        // events pass the personal-event gate; classId is what colors the name.
        // Mage sits in PARTY on purpose: the old cyan collided with the party
        // channel tint, which is the collision this refresh fixes.
        await page.evaluate(() => {
          const hud = window.__game?.hud;
          if (!hud) return;
          const lines = [
            ['warrior', 'Thorgar', 'yell', 'Form up at the gate, pulling in ten.'],
            ['mage', 'Emberlyn', 'party', 'Sheep is on the moon marker, do not break it.'],
            ['druid', 'Brightoak', 'party', 'Innervate is ready when you need it.'],
            ['shaman', 'Stormcaller', 'general', 'Dropping totems at the bridge camp.'],
            ['warlock', 'Morgatha', 'general', 'Summons up at the stone in two minutes.'],
            ['priest', 'Selene', 'guild', 'Renew rolling on the tank, save your potions.'],
            ['rogue', 'Nightblade', 'whisper', 'Meet me behind the mill after this pull.'],
            ['paladin', 'Aurelius', 'world', 'Selling arcane dust stacks, whisper me.'],
            ['hunter', 'Fletcher', 'lfg', 'LF healer for the delve, last spot.'],
          ];
          hud.handleEvents(
            lines.map(([classId, from, channel, text], i) => ({
              type: 'chat',
              channel,
              from,
              fromPid: 9000 + i,
              classId,
              text,
            })),
          );
        });
        await wait(300);
        await page.evaluate(() => {
          document
            .querySelector('#chatlog-tabs button[data-tab="all"]')
            ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        await wait(200);
        return { clip: '#chatlog-wrap' };
      }
      if (variant.key === 'party') {
        // Mixed-class party staged on the PartyMachine (the party-below-target
        // recipe); full frame so the shot shows the frame accents AND the
        // minimap party dots reading the same shared color.
        await page.evaluate(() => {
          const sim = window.__game.sim;
          const me = sim.primaryId;
          const p = sim.player;
          const pm = sim.party;
          const roster = [
            ['Thorgar', 'warrior'],
            ['Stormcaller', 'shaman'],
            ['Emberlyn', 'mage'],
            ['Brightoak', 'druid'],
          ];
          const pids = roster.map(([name, cls], i) => {
            const pid = sim.addPlayer(cls, name);
            const e = sim.entities.get(pid);
            if (e) {
              e.pos = { x: p.pos.x + (i % 4) * 2 - 3, y: p.pos.y, z: p.pos.z + 2 };
              e.prevPos = { ...e.pos };
            }
            return pid;
          });
          const party = {
            id: pm.nextPartyId++,
            leader: me,
            members: [me, ...pids],
            raid: false,
            raidGroups: new Map(),
            lootStrategies: {},
          };
          pm.parties.set(party.id, party);
          pm.partyByPid.set(me, party.id);
          for (const q of pids) pm.partyByPid.set(q, party.id);
        });
        await wait(1200);
        // Becoming leader auto-opens Loot Settings; close it after the HUD
        // noticed the party so the scene stays clean.
        await page.evaluate(() => window.__game.hud.closeLootSettings?.());
        await wait(600);
        return {};
      }
      if (variant.key === 'raid') {
        // Two-group raid covering all nine classes (me = warrior makes ten), so
        // the raid-style frames show every class accent at once; same
        // PartyMachine struct as the party variant with raid: true and each
        // member placed into a raid group.
        await page.evaluate(() => {
          const sim = window.__game.sim;
          const me = sim.primaryId;
          const p = sim.player;
          const pm = sim.party;
          const roster = [
            ['Aurelius', 'paladin'],
            ['Fletcher', 'hunter'],
            ['Nightblade', 'rogue'],
            ['Selene', 'priest'],
            ['Stormcaller', 'shaman'],
            ['Emberlyn', 'mage'],
            ['Morgatha', 'warlock'],
            ['Brightoak', 'druid'],
            ['Ironhide', 'warrior'],
          ];
          const pids = roster.map(([name, cls], i) => {
            const pid = sim.addPlayer(cls, name);
            const e = sim.entities.get(pid);
            if (e) {
              e.pos = {
                x: p.pos.x + (i % 5) * 2 - 4,
                y: p.pos.y,
                z: p.pos.z + 2 + Math.floor(i / 5) * 2,
              };
              e.prevPos = { ...e.pos };
            }
            return pid;
          });
          const members = [me, ...pids];
          const party = {
            id: pm.nextPartyId++,
            leader: me,
            members,
            raid: true,
            raidGroups: new Map(members.map((pid, i) => [pid, i < 5 ? 1 : 2])),
            lootStrategies: {},
          };
          pm.parties.set(party.id, party);
          for (const q of members) pm.partyByPid.set(q, party.id);
        });
        await wait(1200);
        await page.evaluate(() => window.__game.hud.closeLootSettings?.());
        await wait(600);
        return {};
      }
      // model: the character sheet's 3D stage, tinted via the shared class color
      // (partial lerp, so the shift is subtle; priest moved the furthest).
      await page.evaluate(() => window.__game.hud.toggleChar());
      await pollForSize(page, '#char-window');
      await wait(600);
      return { clip: '#char-window' };
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
    key: 'perf-nudge',
    label: 'Performance nudge toast (perf-doctor machine-local causes)',
    when: ['ui/perf_nudge', 'game/perf_nudge'],
    variants: [
      { key: 'web-integrated', ids: ['integrated-gpu'], desktopShell: false },
      { key: 'web-software', ids: ['hardware-acceleration'], desktopShell: false },
      { key: 'desktop-shell-software', ids: ['hardware-acceleration'], desktopShell: true },
      { key: 'web-mobile-integrated', ids: ['integrated-gpu'], desktopShell: false, mobile: true },
    ],
    // The nudge fires only when the live perf-doctor finds a machine-local cause
    // (software GL, or a hybrid laptop pinned to its integrated GPU), which a
    // healthy capture machine never produces; import the module directly (Vite
    // serves /src in dev) and force the id set, exactly what src/game/perf_nudge.ts
    // would pass on an affected box. Clearing the persisted dismissal and any prior
    // element keeps the recipe rerunnable; removing #gpu-notice keeps the sibling
    // toast slot out of the clip.
    async capture(page, variant) {
      await page.evaluate(
        async (opts) => {
          localStorage.removeItem('woc_perf_nudge_dismissed');
          document.querySelector('#perf-nudge')?.remove();
          document.querySelector('#gpu-notice')?.remove();
          const mod = await import('/src/ui/perf_nudge_toast.ts');
          mod.initPerfNudgeToast({
            suggestionIds: opts.ids,
            softwareNoticeAlreadyShown: false,
            desktopShell: opts.desktopShell,
          });
        },
        { ids: variant?.ids ?? ['integrated-gpu'], desktopShell: Boolean(variant?.desktopShell) },
      );
      const open = await pollForSize(page, '#perf-nudge');
      return open ? { clip: '#perf-nudge' } : {};
    },
  },
  {
    key: 'gather-node',
    label: 'Gather node (click/tap-to-harvest #1866; tool tier gating, Professions 2.0)',
    when: ['gather_node', 'gather_nodes', 'gathering_view', 'professions/tools'],
    // The variants stand at the mirefen tier-2 ore vein (falling back
    // to the nearest base-tree mirefen vein when the id does not exist, so the
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
          // ore_mirefen_t2 exists only on the reworked tree; ore_mirefen_1 is the
          // base-tree vein 12 yd away, the honest before-side stand-in.
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
      // framing scrolls it into view.
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
              // Cap-legal staging: 125 is the enforced
              // craft cap, staging the mastered state honestly; a live
              // character can never exceed it, so the stub must not either.
              weaponcrafting: 125,
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
            knownRecipes: [],
          };
          Object.defineProperty(game.world, 'craftingIdentity', {
            value: identity,
            configurable: true,
          });
          const gathering = {
            // Cap-legal staging: the enforced caps are
            // 100/100/100/200 (content/professions.ts maxSkill) and skills
            // can never exceed them; herbalism stages a mastered row at cap.
            skills: [
              { professionId: 'mining', skill: 88, maxSkill: 100 },
              { professionId: 'logging', skill: 45, maxSkill: 100 },
              { professionId: 'herbalism', skill: 100, maxSkill: 100 },
              { professionId: 'fishing', skill: 68, maxSkill: 200 },
            ],
          };
          // professionsState is a data read on BOTH world shapes (a getter on
          // Sim, a field on ClientWorld), so typeof never yields 'function'
          // and a plain-object value shadows either shape correctly.
          Object.defineProperty(game.world, 'professionsState', {
            value: gathering,
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
      // Staging tier-1 weaponcrafting trips the once-ever first-tier explainer
      // modal on a drain-window delay rather than synchronously (the crafting
      // target's trap); poll-dismiss it so the frame carries the ladder.
      for (let i = 0; i < 10; i++) {
        const dismissed = await page.evaluate(() => {
          const ok = document.querySelector('#profession-tutorial .cd-ok');
          if (ok) ok.click();
          return Boolean(ok);
        });
        if (dismissed) break;
        await wait(300);
      }
      await wait(200);
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
    key: 'train-window-pending',
    label: 'Train view: Learn in flight (pending row disables, issue #2342)',
    when: ['ui/hud/vendor/train_learn_core'],
    // Desktop and mobile: the pending row IS the first-click feedback (the
    // button reads a disabled Learning state until the trainResult lands), so
    // it must read on both form factors.
    variants: [
      { key: 'desktop', charClass: 'warrior', charName: 'Pendaline' },
      { key: 'mobile', charClass: 'warrior', charName: 'Pendamora', mobile: true },
    ],
    // The forge staging of train-window above (weaponcrafting 30 makes
    // recipe_forgeguard_bulwark_gauntlets the TEACHABLE row), then stage the
    // in-flight state exactly as trainRecipeClicked paints it: open the learn
    // flight on the HUD tracker and repaint. The staged flight never sends the
    // command, because offline the sim answers synchronously and the very next
    // event drain would resolve the row back out of pending; online this state
    // is what the window shows for the whole round trip.
    async capture(page, _variant) {
      await page.evaluate(() => {
        document.querySelector('.camera-prompt-confirm')?.click();
        document.querySelector('.tut-skip')?.click();
        document.querySelector('.gpu-notice-dismiss')?.click();
        document.querySelector('#gpu-notice')?.remove();
      });
      await wait(300);
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
      if (!setup.ok) throw new Error(`train-window-pending setup failed: ${setup.reason}`);
      const open = await pollForSize(page, '#train-window');
      if (!open) throw new Error('train window did not open');
      // The once-ever first-tier explainer fires on a drain-window delay
      // (the train-window target's trap); poll-dismiss it before staging the
      // flight so the 5s pending TTL cannot lapse under the dismiss loop.
      for (let i = 0; i < 10; i++) {
        const dismissed = await page.evaluate(() => {
          const ok = document.querySelector('#profession-tutorial .cd-ok');
          if (ok) ok.click();
          return Boolean(ok);
        });
        if (dismissed) break;
        await wait(300);
      }
      const staged = await page.evaluate(() => {
        const game = window.__game;
        const hud = game?.hud;
        if (!hud?.trainLearns) return { ok: false, reason: 'no trainLearns tracker on hud' };
        hud.trainLearns.begin('recipe_forgeguard_bulwark_gauntlets', performance.now());
        hud.renderTrain();
        // The staged skills leave SEVERAL rows teachable (both crafts' tier-0
        // rungs plus the tier-1 weaponcrafting ones); exactly the begun one
        // must read disabled-pending, every copper check passes (affordable
        // rows never disable on their own at the staged purse).
        const disabled = document.querySelectorAll('#train-window .train-teachable:disabled');
        if (disabled.length !== 1) {
          return { ok: false, reason: `expected 1 disabled pending row, got ${disabled.length}` };
        }
        return { ok: true, state: disabled[0].querySelector('.train-state')?.textContent ?? '' };
      });
      if (!staged.ok) throw new Error(`pending staging failed: ${staged.reason}`);
      // Bring the pending row into the frame (the ladder scrolls on both form
      // factors and the combo row sits deep in the weaponcrafting section).
      await page.evaluate(() => {
        document
          .querySelector('#train-window .train-teachable:disabled')
          ?.scrollIntoView({ block: 'center' });
      });
      await wait(300);
      return { clip: '#train-window' };
    },
  },
  {
    key: 'attunement-legibility',
    label: 'Attunement legibility: quest-dialog preview with return cost, first-tier tutorial',
    when: [
      'ui/hud/quest/quest_dialog_controller',
      'sim/quests/profession_quest_effects',
      'ui/profession_tutorial_window',
      'ui/profession_identity_view.ts',
    ],
    // The legibility rule: the full pre-commit picture (majors, hobby,
    // dormancy, and the escalating make-amends return cost) must be visible in
    // the lore-quest dialog BEFORE the player commits, and the one-time tier
    // tutorial must fire at the first tier-1 crossing. The quest variants shoot
    // the q_prof_attune_smith detail at Forgemistress Darva for a fresh
    // unattuned character; the tutorial variant crosses weaponcrafting to
    // skill 26 and lets the REAL 1 Hz sweep emit the event that opens the panel.
    variants: [
      { key: 'quest-desktop' },
      { key: 'quest-mobile', mobile: true },
      { key: 'tutorial-desktop', tutorial: true },
      { key: 'tutorial-mobile', tutorial: true, mobile: true },
    ],
    async capture(page, variant) {
      await page.evaluate(() => {
        document.querySelector('.camera-prompt-confirm')?.click();
        document.querySelector('.tut-skip')?.click();
        document.querySelector('#gpu-notice')?.remove();
      });
      await wait(300);
      if (variant?.tutorial) {
        const armed = await page.evaluate(() => {
          const sim = window.__game?.sim;
          const meta = sim?.players?.get(sim.primaryId);
          if (!meta) return { ok: false, reason: 'no primary player meta' };
          meta.craftSkills = { ...meta.craftSkills, weaponcrafting: 26 };
          return { ok: true };
        });
        if (!armed.ok) throw new Error(`tutorial setup failed: ${armed.reason}`);
        // The prof-nudges sweep runs at 1 Hz on sim ticks; the panel opens on
        // the resulting profTierTutorial event, so poll rather than guess.
        const open = await pollForSize(page, '#profession-tutorial');
        if (!open) throw new Error('profession tutorial did not open');
        return { clip: '#profession-tutorial' };
      }
      // Quest-dialog variants: stand beside Darva (the dialog auto-closes on
      // distance like the train window) and open her quest list, then the
      // lore-quest detail row.
      const setup = await page.evaluate(() => {
        const game = window.__game;
        const sim = game?.sim;
        if (!sim) return { ok: false, reason: 'no sim' };
        const master = [...sim.entities.values()].find(
          (e) => e.templateId === 'forgemistress_darva',
        );
        if (!master) return { ok: false, reason: 'no forgemistress_darva entity' };
        const p = sim.player;
        if (p?.pos) {
          p.pos.x = master.pos.x;
          p.pos.z = master.pos.z - 2;
        }
        const el = document.querySelector('#quest-dialog');
        if (el) el.style.display = 'none';
        game.hud.openQuestDialog(master.id);
        return { ok: true };
      });
      if (!setup.ok) throw new Error(`quest-dialog setup failed: ${setup.reason}`);
      const open = await pollForSize(page, '#quest-dialog');
      if (!open) throw new Error('quest dialog did not open');
      await page.evaluate(() => {
        document.querySelector('#quest-dialog [data-quest="q_prof_attune_smith"]')?.click();
      });
      await wait(400);
      // The detail must carry the pinned-pair preview with the return-cost
      // sentence (the whole point of the shot).
      const hasPreview = await page.evaluate(() =>
        Boolean(document.querySelector('#quest-dialog [data-profession-preview]')),
      );
      if (!hasPreview) throw new Error('attunement preview line missing from the quest detail');
      return { clip: '#quest-dialog' };
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
    key: 'party-below-target',
    label: 'Party frames clear the target buff strip',
    when: ['party_below_target'],
    variants: [
      { key: 'desktop', charClass: 'paladin', charName: 'Overlap' },
      { key: 'mobile', charClass: 'paladin', charName: 'Overlap', mobile: true },
      // The common case: an unwrapped strip, where the full 2x2 party fits
      // above the move joystick (the 18-aura variant shows the degraded
      // one-row-plus-scroll extreme).
      { key: 'mobile-light', charClass: 'paladin', charName: 'Overlap', mobile: true, auras: 6 },
    ],
    async capture(page, variant) {
      await page.evaluate((auraCount) => {
        const sim = window.__game.sim;
        const me = sim.primaryId;
        const p = sim.player;
        // Party state lives on the PartyMachine (sim.party); assemble the
        // struct directly (offline invites queue stale cards).
        const pm = sim.party;
        const roster = [
          ['Brightoak', 'druid'],
          ['Stormcaller', 'shaman'],
          ['Nightblade', 'rogue'],
          ['Emberlyn', 'mage'],
        ];
        const pids = roster.map(([name, cls], i) => {
          const pid = sim.addPlayer(cls, name);
          const e = sim.entities.get(pid);
          if (e) {
            e.pos = { x: p.pos.x + (i % 4) * 2 - 3, y: p.pos.y, z: p.pos.z + 2 };
            e.prevPos = { ...e.pos };
          }
          return pid;
        });
        const party = {
          id: pm.nextPartyId++,
          leader: me,
          members: [me, ...pids],
          raid: false,
          raidGroups: new Map(),
          lootStrategies: {},
        };
        pm.parties.set(party.id, party);
        pm.partyByPid.set(me, party.id);
        for (const q of pids) pm.partyByPid.set(q, party.id);
        // Target a nearby mob and load its strip with enough auras that the
        // wrapped rows exceed the old hand-tuned below-target offset.
        let mob = null;
        for (const e of sim.entities.values()) {
          if (e.kind === 'mob' && e.ownerId === null && !e.dead) {
            mob = e;
            break;
          }
        }
        if (!mob) return;
        mob.pos = { x: p.pos.x + 2, y: p.pos.y, z: p.pos.z + 8 };
        mob.prevPos = { ...mob.pos };
        sim.rebucket(mob);
        sim.targetEntity(mob.id);
        for (let i = 0; i < auraCount; i++) {
          sim.applyAura(mob, {
            id: `overlap_probe_${i}`,
            name: `Probe ${i}`,
            kind: 'dot',
            value: 1,
            remaining: 600,
            duration: 600,
            sourceId: me,
            school: 'shadow',
          });
        }
      }, variant.auras ?? 18);
      await wait(1200);
      // Becoming leader auto-opens Loot Settings on the frame the HUD notices
      // the new party; close it AFTER that frame so the corner stays clean.
      await page.evaluate(() => window.__game.hud.closeLootSettings?.());
      if (variant.mobile) {
        // Expand the party chip (persisted-collapse default) so the member
        // frames render below the strip; poll its own aria-expanded state.
        for (let i = 0; i < 8; i++) {
          const state = await page.evaluate(() => {
            const chip = document.querySelector('#party-frames [aria-expanded]');
            if (!chip) return 'no-chip';
            if (chip.getAttribute('aria-expanded') === 'true') return 'expanded';
            chip.click();
            return 'clicked';
          });
          if (state === 'expanded' || state === 'no-chip') break;
          await wait(400);
        }
      }
      await wait(600);
      return {};
    },
  },
  {
    key: 'target-of-target',
    label: 'Target-of-target mini-frame beside the target frame, clear of the aura strip',
    when: ['totarget', 'ui/target_of_target'],
    variants: [
      { key: 'desktop', charClass: 'warrior', charName: 'Marksman' },
      // Slider maximum: the mini zoom compounds --target-frame-scale, so the
      // 18px gap and the top-aligned anchor must hold at the largest frame.
      { key: 'desktop-scale-max', charClass: 'warrior', charName: 'Marksman', frameScale: 1.15 },
      // Move mode: the unlocked frame grows a dashed outline and the corner
      // button lights gold; the mini must stay clear of both.
      { key: 'desktop-unlocked', charClass: 'warrior', charName: 'Marksman', unlockFrame: true },
      // Party pushed below the target: the painter measures frame + strip only,
      // so the beside-the-frame mini must no longer interact with the pushed rows.
      { key: 'desktop-party', charClass: 'paladin', charName: 'Marksman', party: true },
      // Boss rank: the move button moves to right: -30px and the dragon emblem
      // overhangs the portrait side, so the mini takes the widened boss gap.
      { key: 'desktop-boss', charClass: 'warrior', charName: 'Marksman', boss: true },
      { key: 'mobile', charClass: 'mage', charName: 'Marksman', mobile: true },
    ],
    async capture(page, variant) {
      await page.evaluate(
        ({ withParty, asBoss }) => {
          const game = window.__game;
          const sim = game.sim;
          const me = sim.primaryId;
          const p = sim.player;
          if (withParty) {
            // Party state lives on the PartyMachine (sim.party); assemble the
            // struct directly (offline invites queue stale cards).
            const pm = sim.party;
            const roster = [
              ['Brightoak', 'druid'],
              ['Stormcaller', 'shaman'],
              ['Nightblade', 'rogue'],
              ['Emberlyn', 'mage'],
            ];
            const pids = roster.map(([name, cls], i) => {
              const pid = sim.addPlayer(cls, name);
              const e = sim.entities.get(pid);
              if (e) {
                e.pos = { x: p.pos.x + (i % 4) * 2 - 3, y: p.pos.y, z: p.pos.z + 2 };
                e.prevPos = { ...e.pos };
              }
              return pid;
            });
            const party = {
              id: pm.nextPartyId++,
              leader: me,
              members: [me, ...pids],
              raid: false,
              raidGroups: new Map(),
              lootStrategies: {},
            };
            pm.parties.set(party.id, party);
            pm.partyByPid.set(me, party.id);
            for (const q of pids) pm.partyByPid.set(q, party.id);
          }
          // Target a nearby mob, make it target US (a mob's target-of-target is
          // its aggro target), and load the strip so its first wrapped row
          // reaches the frame's right edge, the old collision band.
          let mob = null;
          for (const e of sim.entities.values()) {
            if (e.kind === 'mob' && e.ownerId === null && !e.dead) {
              mob = e;
              break;
            }
          }
          if (!mob) return;
          // Boss variant: re-template the mob to a boss record so the HUD's
          // rank resolution (MOBS[templateId].boss) applies the .boss chrome.
          if (asBoss) mob.templateId = 'mirefen_broodmother';
          mob.pos = { x: p.pos.x + 2, y: p.pos.y, z: p.pos.z + 8 };
          mob.prevPos = { ...mob.pos };
          sim.rebucket(mob);
          sim.targetEntity(mob.id);
          mob.aggroTargetId = me;
          // The same call the options row lands on (applySetting delegates here).
          game.hud.setShowTargetOfTarget(true);
          for (let i = 0; i < 9; i++) {
            sim.applyAura(mob, {
              id: `tot_probe_${i}`,
              name: `Probe ${i}`,
              kind: 'dot',
              value: 1,
              remaining: 600,
              duration: 600,
              sourceId: me,
              school: 'shadow',
            });
          }
        },
        { withParty: !!variant.party, asBoss: !!variant.boss },
      );
      if (variant.frameScale) {
        await page.evaluate((scale) => {
          document.documentElement.style.setProperty('--target-frame-scale', String(scale));
        }, variant.frameScale);
      }
      await wait(1200);
      if (variant.party) {
        // Becoming leader auto-opens Loot Settings on the frame the HUD notices
        // the new party; close it AFTER that frame so the scene stays clean.
        await page.evaluate(() => window.__game.hud.closeLootSettings?.());
      }
      if (variant.unlockFrame) {
        await page.evaluate(() => document.querySelector('#target-frame > .tf-move-btn')?.click());
      }
      await wait(600);
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
    when: ['ui/perf_ornament_svg', 'ui/perf_overlay_settings'],
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
      if (!wide) return {};
      // Scroll the panel body all the way down: issue #2569 (the ornament
      // scrolling with the content) only shows up once the panel has
      // actually scrolled. Try the post-fix `.perf-scroll` wrapper first and
      // fall back to the pre-fix scrolling host itself, so this one capture
      // works for both a before and an after shot.
      await page.evaluate(() => {
        const scrollHost =
          document.querySelector('#options-menu.perf-wide .perf-scroll') ??
          document.querySelector('#options-menu.perf-wide');
        if (scrollHost) scrollHost.scrollTop = scrollHost.scrollHeight;
      });
      await wait(150);
      return { clip: '#options-menu' };
    },
  },
  {
    key: 'gathering-rhythm',
    label: 'Gathering rhythm: gather cast bar + fishing bobber and bite (Professions 2.0)',
    when: [
      'professions/fishing',
      'professions/gathering',
      'combat/casting_lifecycle',
      'render/fishing_bobber',
      'render/cast_bar',
    ],
    // The gather rework turns the instant harvest into a short visible cast and the
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
  {
    key: 'p13-bag-actions',
    label: 'Bag item action menu (disenchant / salvage / apply enchant)',
    when: [
      'bag_item_context_menu',
      'bag_item_action_menu',
      'enchant_apply_view',
      'item_slot_labels',
    ],
    // Four states of the bag-action surface: the desktop right-click menu, the same
    // menu from a mobile tap (the mobile arm), the stronger
    // destruction warning (the only held copy is signed masterwork), and the
    // Apply Enchant picker (the first render sink for enchant names). The recipe
    // branches on variant.key; menu opening goes through the REAL bound events
    // (contextmenu / click on the bag row), never a debug hook.
    variants: [
      { key: 'menu-desktop' },
      { key: 'menu-mobile', mobile: true },
      { key: 'confirm-special', confirm: true },
      { key: 'picker', picker: true },
      { key: 'picker-mobile', picker: true, mobile: true },
      // The TARGET step (step two of the picker): worn gear is enchanted in
      // place, so an equipped copy lists there beside the bagged ones, tagged
      // with its equipment slot. The dual-wield variant is a rogue with the SAME
      // sword in both hands, the case the slot discriminator exists for: two
      // identical item ids, two separate rows.
      { key: 'targets', targets: true },
      { key: 'targets-mobile', targets: true, mobile: true },
      { key: 'targets-dualwield', targets: true, dualWield: true, charClass: 'rogue' },
      // #2466: the two holdings that painted two rows with ONE accessible name.
      // A heroic variant renders its BASE item's display name (classic
      // behavior), so a plain base beside a plain heroic copy was two rows of
      // identical text; and both fingers share the one "Finger" slot label, so
      // identical rings worn on each hand read alike. Each is its own scene
      // because they land in different families (bagged vs worn) and carry
      // different discriminators.
      { key: 'targets-heroic', targets: true, heroicPair: true },
      { key: 'targets-heroic-mobile', targets: true, heroicPair: true, mobile: true },
      { key: 'targets-rings', targets: true, rings: true, drill: 'Ring' },
      { key: 'targets-rings-mobile', targets: true, rings: true, drill: 'Ring', mobile: true },
      // The #2415 replace flow: already-enchanted copies list as FLAGGED
      // replace rows (worn and bagged families both, the meta naming the
      // enchant a confirm would destroy, the same-enchant row disabled), and
      // accepting one runs the destroy-confirm dialog that names the doomed
      // enchant, the no-refund ruling, and the reagent cost.
      { key: 'targets-replace', targets: true, replace: true },
      { key: 'targets-replace-mobile', targets: true, replace: true, mobile: true },
      { key: 'replace-confirm', targets: true, replace: true, replaceConfirm: true },
      // The confirm on touch: this dialog carries the most copy of any state
      // here (what dies, the no-refund ruling, what survives, the price), so
      // the narrow landscape viewport is where it is most likely to wrap or
      // clip, and it needs its own capture rather than a desktop stand-in.
      {
        key: 'replace-confirm-mobile',
        targets: true,
        replace: true,
        replaceConfirm: true,
        mobile: true,
      },
    ],
    async capture(page, variant) {
      await page.evaluate(() => {
        document.querySelector('.camera-prompt-confirm')?.click();
        document.querySelector('.tut-skip')?.click();
        document.querySelector('.gpu-notice-dismiss')?.click();
      });
      const staged = await page.evaluate(
        (
          wantsConfirm,
          wantsPicker,
          wantsTargets,
          wantsDualWield,
          wantsReplace,
          wantsHeroicPair,
          wantsRings,
        ) => {
          const game = window.__game;
          const sim = game?.sim;
          if (!game || !sim?.player) return { ok: false, reason: 'offline world unavailable' };
          if (wantsHeroicPair) {
            // #2466: a base item and its HEROIC variant, two ids that resolve to
            // ONE display name. Both copies stay PLAIN, which is the worst case:
            // no state tag separates them either, so the heroic mark is the only
            // thing between the two rows. Real content ids, never a hand-written
            // name.
            sim.addItem('gravewyrm_thornmaul', 1);
            sim.addItem('heroic_gravewyrm_thornmaul', 1);
            sim.addItem('arcane_dust', 6);
            return { ok: true, itemName: 'Chime Dust' };
          }
          if (wantsRings) {
            // #2466: one ring id worn on BOTH fingers. ring1 and ring2 share the
            // single "Finger" label, so the two rows were identical down to the
            // byte and both stayed activatable. The rings are epic and carry a
            // level requirement, so the player is levelled first (the ladder
            // target's own idiom) or equipItem refuses them.
            const p = sim.entities.get(sim.playerId);
            if (p) p.level = 60;
            sim.addItem('iron_vow_band', 1);
            sim.equipItemToSlot('iron_vow_band', 'ring1');
            sim.addItem('iron_vow_band', 1);
            sim.equipItemToSlot('iron_vow_band', 'ring2');
            sim.addItem('arcane_dust', 6);
            return { ok: true, itemName: 'Chime Dust' };
          }
          if (wantsReplace) {
            // The #2415 scene: a WORN enchanted copy (the in-place replace
            // target), a bagged copy carrying a DIFFERENT enchant (the flagged
            // bagged replace row, signed so the swap's carry-through is the
            // one on screen), and a plain bagged copy (the classic target), so
            // the target step paints all three families at once. Real ids
            // only, never hand-written display strings.
            //
            // The bagged victim carries ALL THREE surviving facts (#2421): the
            // signature, a masterwork bake (str, distinct from the int the
            // enchant contributes, so the confirm's kept line and the tooltip's
            // own attribution split agree), and an armed bind-on-trade lock.
            // That is what puts a full "Kept: ..." line on screen; the worn
            // copy stays plain-enchanted, so the same shot also shows the arm
            // that deliberately claims no bind state. The bagged plain copy of
            // the SAME item id is the mixed holding whose twin now says so.
            sim.addItemInstance('eastbrook_arming_sword', {
              enchant: 'enchant_weapon_agility',
              rolled: { stats: { agi: 2 } },
            });
            sim.equipItemToSlot('eastbrook_arming_sword', 'mainhand');
            sim.addItemInstance('eastbrook_arming_sword', {
              signer: 'Aldric',
              enchant: 'enchant_weapon_intellect',
              rolled: { masterwork: true, stats: { int: 2, str: 3 } },
              bindOnTrade: true,
            });
            sim.addItem('eastbrook_arming_sword', 1);
            sim.addItem('arcane_dust', 6);
            return { ok: true, itemName: 'Chime Dust' };
          }
          if (wantsTargets) {
            // One sword WORN (the in-place target) and one in the bags (the
            // classic target), so the target step shows both families at once.
            // The dual-wield scene aims BOTH hands explicitly.
            sim.addItem('eastbrook_arming_sword', 1);
            sim.equipItemToSlot('eastbrook_arming_sword', 'mainhand');
            if (wantsDualWield) {
              sim.addItem('eastbrook_arming_sword', 1);
              sim.equipItemToSlot('eastbrook_arming_sword', 'offhand');
            }
            sim.addItem('eastbrook_arming_sword', 1);
            sim.addItem('arcane_dust', 6);
            sim.addItem('arcane_essence', 1);
            return { ok: true, itemName: 'Chime Dust' };
          }
          if (wantsPicker) {
            // Chime Essence is the one reagent that reaches ALL THREE tiers, so
            // the picker opened on it is the motivating case for the tier
            // grouping. Held counts leave a mix of ready and short rows, so the
            // affordability lines stay exercised too.
            sim.addItem('arcane_essence', 4);
            sim.addItem('arcane_dust', 6);
            sim.addItem('resonant_steel', 1);
            return { ok: true, itemName: 'Chime Essence' };
          }
          if (wantsConfirm) {
            // The ONLY held copy is a signed masterwork instance, so the confirm
            // must take the stronger-warning path.
            sim.addItemInstance('eastbrook_arming_sword', {
              signer: 'Aldric',
              rolled: { masterwork: true, stats: { str: 2 } },
            });
            return { ok: true, itemName: 'Eastbrook Arming Sword' };
          }
          sim.addItem('eastbrook_arming_sword', 1);
          return { ok: true, itemName: 'Eastbrook Arming Sword' };
        },
        Boolean(variant?.confirm),
        Boolean(variant?.picker),
        Boolean(variant?.targets),
        Boolean(variant?.dualWield),
        Boolean(variant?.replace),
        Boolean(variant?.heroicPair),
        Boolean(variant?.rings),
      );
      if (!staged.ok) throw new Error(staged.reason);
      await page.evaluate(() => {
        const game = window.__game;
        if (!document.querySelector('#bags')?.checkVisibility?.()) game.hud.toggleBags();
      });
      if (!(await pollForSize(page, '#bags'))) throw new Error('bags window did not open');
      // Open the menu through the real handler: contextmenu on desktop, a plain
      // tap (click) on the mobile-touch variant, on the granted item's bag row.
      const opened = await page.evaluate((itemName) => {
        // Occupied squares only: empty cells share the bag-item class (with
        // .empty) and would swallow the dispatch. The staged stack is found by
        // its aria-label (which carries the localized display name).
        const rows = [...document.querySelectorAll('#bags .bag-item:not(.empty)')];
        const el =
          rows.find((r) => (r.getAttribute('aria-label') ?? '').includes(itemName)) ??
          rows[rows.length - 1];
        if (!el) return false;
        const r = el.getBoundingClientRect();
        const ev = new MouseEvent(
          document.body.classList.contains('mobile-touch') ? 'click' : 'contextmenu',
          {
            bubbles: true,
            cancelable: true,
            clientX: r.x + r.width / 2,
            clientY: r.y + r.height / 2,
          },
        );
        el.dispatchEvent(ev);
        return true;
      }, staged.itemName);
      if (!opened) throw new Error('no bag row to open the action menu on');
      if (!(await pollForSize(page, '#ctx-menu'))) throw new Error('action menu did not open');
      if (variant?.confirm) {
        // Click the Disenchant row (row two: the classic action is row one).
        await page.evaluate(() => {
          const rows = [...document.querySelectorAll('#ctx-menu .ctx-item')];
          rows[1]?.click();
        });
        if (!(await pollForSize(page, '#confirm-dialog')))
          throw new Error('destruction confirm did not open');
        await wait(300);
        return { clip: '#ui' };
      }
      if (variant?.picker || variant?.targets) {
        // Click the Apply Enchant row (the staged reagent's only action).
        await page.evaluate(() => {
          const rows = [...document.querySelectorAll('#ctx-menu .ctx-item')];
          rows[rows.length - 1]?.click();
        });
        await wait(500);
        if (!(await pollForSize(page, '#ctx-menu'))) throw new Error('enchant picker did not open');
        if (variant?.targets) {
          // Drill one step further into the TARGET list by clicking the weapon
          // enchant's own row (matched by its localized name, so a reordered
          // enchant table cannot silently shoot the wrong step).
          // Matched by the enchant's own localized name, so a reordered enchant
          // table cannot silently shoot the wrong step. The ring scenes need a
          // RING enchant rather than the weapon default.
          const drilled = await page.evaluate((match) => {
            const rows = [...document.querySelectorAll('#ctx-menu .ctx-item[data-act]')];
            const row = rows.find((r) => (r.textContent ?? '').includes(match)) ?? rows[0];
            if (!row) return false;
            row.click();
            return true;
          }, variant?.drill ?? 'Might');
          if (!drilled) throw new Error('no affordable enchant row to drill into');
          await wait(500);
          if (!(await pollForSize(page, '#ctx-menu')))
            throw new Error('enchant target step did not open');
          if (variant?.replaceConfirm) {
            // Accept path of the #2415 flow: click the BAGGED replace row
            // (its act token is the discriminator) and shoot the confirm
            // dialog that names the doomed enchant, the no-refund ruling,
            // and the reagent cost.
            const clicked = await page.evaluate(() => {
              const row = document.querySelector('#ctx-menu .ctx-item[data-act^="replace:"]');
              if (!row) return false;
              row.click();
              return true;
            });
            if (!clicked) throw new Error('no bagged replace row to confirm');
            if (!(await pollForSize(page, '#confirm-dialog')))
              throw new Error('replace confirm did not open');
          }
        }
        await wait(300);
        return { clip: '#ui' };
      }
      await wait(300);
      return { clip: '#ui' };
    },
  },
  {
    key: 'chrome-icons',
    label: 'HUD chrome icons (side rail, mobile bar, More tray)',
    when: ['ui/ui_icons', 'ui/chrome_icon_art', 'public/ui/chrome'],
    // The icons live on three surfaces, and each is its own clip: the desktop rail is a
    // narrow column a full-HUD frame renders too small to judge, and the mobile set splits
    // between the always-visible bottom bar and the More tray behind a toggle.
    variants: [
      { key: 'desktop-rail' },
      { key: 'mobile-bar', mobile: true },
      { key: 'mobile-more-tray', mobile: true, moreTray: true },
    ],
    async capture(page, variant) {
      if (variant?.moreTray) {
        await page.evaluate(() => {
          document.querySelector('#mobile-more')?.click();
        });
        if (!(await pollForSize(page, '#mobile-extra-controls')))
          throw new Error('mobile More tray did not open');
        await wait(400);
        return { clip: '#mobile-extra-controls' };
      }
      // Both remaining clips are persistent chrome, already on screen after entry; the wait
      // only lets the launcher art decode so a shot never lands on a half-painted rail.
      await wait(600);
      const sel = variant?.mobile ? '#mobile-combat-controls' : '#side-buttons';
      if (!(await pollForSize(page, sel))) throw new Error(`${sel} never laid out`);
      return { clip: sel };
    },
  },
  {
    key: 'p14-instance-tooltip',
    label: 'Bag tooltip: enchant attribution on the per-copy bonus stat lines',
    when: ['item_instance_tooltip'],
    // The two shapes the attribution has to get right: a plain enchanted copy
    // (the whole bonus is the enchant's) and an enchanted MASTERWORK copy (the
    // bonus splits between the enchant and the masterwork bake). Both stage one
    // copy per page and read the tooltip through the real focus path.
    variants: [
      {
        key: 'enchanted',
        instance: { enchant: 'enchant_chest_stamina', rolled: { stats: { sta: 4 } } },
      },
      {
        key: 'enchanted-masterwork',
        instance: {
          signer: 'Aldric',
          enchant: 'enchant_chest_stamina',
          rolled: { masterwork: true, stats: { sta: 7 } },
        },
      },
    ],
    async capture(page, variant) {
      // The DEF name, not the id-shaped guess: militia_vest displays as
      // "Militia Chainvest", and the cell lookup keys on the accessible name.
      await openBagsWithInstance(page, 'militia_vest', variant.instance);
      await focusBagCell(page, 'Militia Chainvest');
      await pollForSize(page, '#tooltip');
      await wait(300);
      return { clip: '#ui' };
    },
  },
  {
    key: 'p14-material-hint',
    label: 'Bag tooltip: purpose hint on an enchanting material',
    when: ['material_hint_view'],
    // One arcane tier and one typed resonant, so both hint wordings (quality
    // band vs armor/weapon material) are visible.
    variants: [
      { key: 'dust', itemId: 'arcane_dust', name: 'Chime Dust' },
      { key: 'timber', itemId: 'resonant_timber', name: 'Resonant Timber' },
    ],
    async capture(page, variant) {
      await openBagsWithInstance(page, variant.itemId, null);
      await focusBagCell(page, variant.name);
      await pollForSize(page, '#tooltip');
      await wait(300);
      return { clip: '#ui' };
    },
  },
  {
    key: 'p14-bag-glyphs',
    label: 'Bag grid: per-kind instance corner glyphs',
    when: ['bag_instance_glyph_view'],
    // One stack of every marker kind side by side, which is the only way to see
    // whether the corner actually distinguishes them: signed, enchanted,
    // bind-on-trade, masterwork, and a plain copy for the baseline.
    variants: [{ key: 'desktop' }, { key: 'mobile', mobile: true }],
    async capture(page) {
      await page.evaluate(() => {
        document.querySelector('.camera-prompt-confirm')?.click();
        document.querySelector('.tut-skip')?.click();
        document.querySelector('.gpu-notice-dismiss')?.click();
        document.querySelector('#gpu-notice')?.remove();
        const sim = window.__game?.sim;
        if (!sim?.player) throw new Error('offline world unavailable');
        sim.addItemInstance('copper_ore', { signer: 'Aldric' }, undefined, 4);
        sim.addItemInstance('militia_vest', {
          enchant: 'enchant_chest_stamina',
          rolled: { stats: { sta: 4 } },
        });
        sim.addItemInstance('resonant_steel', { bindOnTrade: true }, undefined, 2);
        sim.addItemInstance('worn_sword', {
          signer: 'Aldric',
          rolled: { masterwork: true, stats: { str: 2 } },
        });
        sim.addItem('arcane_dust', 7);
        const game = window.__game;
        if (!document.querySelector('#bags')?.checkVisibility?.()) game.hud.toggleBags();
      });
      if (!(await pollForSize(page, '#bags'))) throw new Error('bags window did not open');
      await wait(500);
      return { clip: '#bags' };
    },
  },
];

// Grant one staged stack (a plain count, or a specific ItemInstancePayload) and
// open the bags window on it. Shared by the tooltip targets above, which each
// stage exactly ONE copy per page so the cell lookup by display name is
// unambiguous.
async function openBagsWithInstance(page, itemId, instance) {
  await page.evaluate(
    (id, payload) => {
      document.querySelector('.camera-prompt-confirm')?.click();
      document.querySelector('.tut-skip')?.click();
      document.querySelector('.gpu-notice-dismiss')?.click();
      document.querySelector('#gpu-notice')?.remove();
      const sim = window.__game?.sim;
      if (!sim?.player) throw new Error('offline world unavailable');
      if (payload) sim.addItemInstance(id, payload);
      else sim.addItem(id, 3);
      const game = window.__game;
      if (!document.querySelector('#bags')?.checkVisibility?.()) game.hud.toggleBags();
    },
    itemId,
    instance,
  );
  if (!(await pollForSize(page, '#bags'))) throw new Error('bags window did not open');
}

// Focus the bag cell whose accessible name carries `name`. Real focus fires
// attachTooltip's focusin arm (the keyboard-nav path), a sturdier tooltip
// trigger under headless than a synthetic mouseenter.
async function focusBagCell(page, name) {
  const found = await page.evaluate((wanted) => {
    document.querySelector('.camera-prompt-confirm')?.click();
    const banner = document.querySelector('#banner');
    if (banner) banner.style.opacity = '0';
    const cells = [...document.querySelectorAll('#bags .bag-item:not(.empty)')];
    // Match on the accessible name, but fall back to the LAST occupied square:
    // the staged stack is the most recently granted one, so a display-name
    // rename cannot silently turn this target into a no-shot.
    const cell =
      cells.find((b) => (b.getAttribute('aria-label') ?? '').includes(wanted)) ??
      cells[cells.length - 1];
    if (!cell) return false;
    cell.scrollIntoView({ block: 'center' });
    cell.focus();
    return true;
  }, name);
  if (!found) throw new Error(`no occupied bag cell to focus (wanted ${name})`);
}

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
