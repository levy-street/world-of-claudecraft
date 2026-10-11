// Hidden-valley evidence: eight zones plus an Epic valley and Common cave,
// each at day and night on desktop Ultra and a landscape-phone Low viewport.
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from '../../browser_path.mjs';
import { enterOfflineGame } from '../../enter_offline_game.mjs';
import { suppressGpuNotice } from '../../lib/gpu_notice_suppress.mjs';

// biome-ignore lint/suspicious/noUndeclaredEnvVars: Capture output override.
const out = process.env.SHOTS_DIR ?? 'docs/screenshots/buried-hoard-valley';
// biome-ignore lint/suspicious/noUndeclaredEnvVars: Select the cave entry or open basin for review.
const basinView = process.env.CAVERN_VIEW === 'basin';
// biome-ignore lint/suspicious/noUndeclaredEnvVars: Opt-in gameplay camera regression capture.
const cameraCheck = process.env.CAMERA_CHECK === '1';
const url = process.env.GAME_URL ?? 'http://localhost:5182';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const cases = [
  ['legendary', 'drakelands'],
  ['legendary', 'frostveil'],
  ['legendary', 'amberfall'],
  ['legendary', 'willowfen'],
  ['legendary', 'nightbloom'],
  ['legendary', 'wraithwood'],
  ['legendary', 'palmreach'],
  ['legendary', 'galecrest'],
  ['epic', 'nightbloom'],
  ['common', 'amberfall'],
].filter(
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: Screenshot-only CLI input is not a Turbo task dependency.
  ([rarity, zone]) => !process.env.CASE_FILTER || `${rarity}-${zone}` === process.env.CASE_FILTER,
);

mkdirSync(out, { recursive: true });
for (const mobile of [false, true]) {
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: Screenshot-only CLI input is not a Turbo task dependency.
  if (process.env.DEVICE === 'desktop' && mobile) continue;
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: Screenshot-only CLI input is not a Turbo task dependency.
  if (process.env.DEVICE === 'mobile' && !mobile) continue;
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: true,
    args: [],
    defaultViewport: { width: mobile ? 844 : 1600, height: mobile ? 390 : 900 },
  });
  try {
    const page = await browser.newPage();
    const shaderErrors = [];
    page.on('pageerror', (error) => console.error(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (
        message.type() === 'error' &&
        /Shader Error|VALIDATE_STATUS|shader.*compil/i.test(message.text())
      ) {
        shaderErrors.push(message.text());
      }
    });
    await suppressGpuNotice(page);
    if (mobile) {
      await page.emulate({
        viewport: { width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 1 },
        userAgent:
          'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36',
      });
    }
    await page.evaluateOnNewDocument((low) => {
      localStorage.setItem(
        'woc_settings',
        JSON.stringify({ graphicsPreset: low ? 1 : 4, graphicsDefaultApplied: true }),
      );
    }, mobile);
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 120000 });
    if (
      !(await enterOfflineGame(page, {
        charName: 'Valleyseer',
        selectorTimeoutMs: 90000,
        gameBootTimeoutMs: 120000,
      }))
    ) {
      throw new Error('World did not boot');
    }
    await page.waitForFunction(
      () => getComputedStyle(document.querySelector('#loading-screen')).display === 'none',
      { timeout: 180000 },
    );
    await page.evaluate(() => {
      const sim = window.__game.sim;
      sim.devCommands = true;
      sim.chat('/dev level 20');
      sim.chat('/dev god');
      sim.chat('/dev noaggro');
    });

    for (const [rarity, zone] of cases) {
      await page.evaluate(() => {
        const sim = window.__game.sim;
        if (sim.riftFloor) sim.leaveRift();
        window.__game.renderer.editorCam = null;
      });
      await page.waitForFunction(() => !window.__game.sim.riftFloor, { timeout: 30000 });
      const state = await page.evaluate(
        async ({ quality, zoneId }) => {
          const game = window.__game;
          const sim = game.sim;
          const { TREASURE_SITES } = await import('/src/sim/content/treasure_maps.ts');
          const { Rng } = await import('/src/sim/rng.ts');
          const siteIndex = TREASURE_SITES.findIndex((site) => site.zoneId === zoneId);
          if (siteIndex < 0) throw new Error(`Missing treasure site for ${zoneId}`);
          let seed = 1;
          while (new Rng(seed).int(0, TREASURE_SITES.length - 1) !== siteIndex) seed++;
          sim.chat(`/dev map ${quality}`);
          sim.rng.s = seed;
          sim.useItem(`treasure_map_${quality}`);
          const site = TREASURE_SITES[siteIndex];
          if (sim.treasureMap?.siteId !== site.id) throw new Error('Treasure site roll diverged');
          sim.chat(`/dev tp ${site.x} ${site.z}`);
          sim.player.facing = 0;
          sim.useItem(`treasure_map_${quality}`);
          const entrance = [...sim.entities.values()]
            .filter(
              (entity) => entity.templateId === 'hoard_entrance' && entity.vaultRarity === quality,
            )
            .sort((a, b) => b.id - a.id)[0];
          if (!entrance) throw new Error('Hoard entrance did not spawn');
          sim.player.pos.x = entrance.pos.x;
          sim.player.pos.z = entrance.pos.z;
          sim.player.prevPos.x = entrance.pos.x;
          sim.player.prevPos.z = entrance.pos.z;
          sim.player.targetId = entrance.id;
          sim.interact();
          document.querySelector('#treasure-map-window')?.querySelector('[data-close]')?.click();
          return { rarity: quality, zone: zoneId, siteId: site.id };
        },
        { quality: rarity, zoneId: zone },
      );

      await page.waitForFunction(() => window.__game.sim.riftFloor !== null, { timeout: 30000 });
      await page.waitForFunction(
        () => getComputedStyle(document.querySelector('#loading-screen')).display === 'none',
        { timeout: 180000 },
      );
      const renderState = await page.evaluate(async (basin) => {
        const game = window.__game;
        const sim = game.sim;
        const view = sim.riftFloor;
        const { generateRiftFloor } = await import('/src/sim/rift/rift_gen.ts');
        const floor = generateRiftFloor(view.seed, view.baseLevel, view.floorIndex, view.upgrade);
        const origin = view.origin;
        const vector = (x, y, z) => game.renderer.camera.position.clone().set(x, y, z);
        if (floor.outdoor) {
          const playerZ =
            origin.z + (basin ? floor.outdoor.valleyStartZ + 20 : floor.outdoor.gorgeEndZ - 5);
          sim.player.pos.x = origin.x;
          sim.player.pos.z = playerZ;
          sim.player.prevPos.x = origin.x;
          sim.player.prevPos.z = playerZ;
          sim.player.facing = 0;
          game.renderer.editorCam = {
            pos: vector(origin.x + 2, 10, playerZ - 12),
            target: vector(
              origin.x,
              2.4,
              basin ? playerZ + 35 : origin.z + floor.outdoor.valleyStartZ + 31,
            ),
          };
        } else {
          game.renderer.editorCam = {
            pos: vector(origin.x + 8, 8, origin.z + floor.layout.zMin + 8),
            target: vector(origin.x, 2.2, origin.z + floor.layout.dais.z),
          };
        }
        game.renderer.camera.position.copy(game.renderer.editorCam.pos);
        game.renderer.cameraLookAt.copy(game.renderer.editorCam.target);
        return {
          outdoorZone: floor.outdoor?.zoneId ?? null,
          mobs: floor.spawns.length,
          groupName: floor.outdoor ? `hoard-valley:${floor.outdoor.zoneId}` : null,
          lights: {
            fogState: game.renderer.fogState,
            sun: game.renderer.sun.intensity,
            hemi: game.renderer.hemi.intensity,
            environment: game.renderer.scene.environmentIntensity,
          },
        };
      }, basinView);
      const shouldBeOutdoor = rarity === 'epic' || rarity === 'legendary';
      if (shouldBeOutdoor !== Boolean(renderState.outdoorZone)) {
        throw new Error(
          `${rarity} ${zone} expected ${shouldBeOutdoor ? 'an outdoor valley' : 'a cave'}`,
        );
      }
      if (renderState.outdoorZone && renderState.outdoorZone !== zone) {
        throw new Error(`${rarity} ${zone} rendered as ${renderState.outdoorZone}`);
      }
      if (renderState.groupName) {
        await page.waitForFunction(
          (name) => window.__game.renderer.scene.getObjectByName(name) !== undefined,
          { timeout: 60000 },
          renderState.groupName,
        );
      }
      await delay(mobile ? 5000 : 7000);
      Object.assign(
        renderState.lights,
        await page.evaluate(() => ({
          ground: (() => {
            const mesh = window.__game.renderer.scene.getObjectByName('HoardValleyGround');
            const material = mesh?.material;
            return {
              type: material?.type,
              color: material?.color?.getHexString(),
              vertexColors: material?.vertexColors,
              instanceColor: mesh?.instanceColor
                ? Array.from(mesh.instanceColor.array.slice(0, 3))
                : null,
              haze: material?.userData?.wocZoneHaze ?? false,
            };
          })(),
          sky: (() => {
            const material = window.__game.renderer.sky.material;
            return {
              type: material?.type,
              color: material?.color?.getHexString(),
            };
          })(),
          settledFogState: window.__game.renderer.fogState,
          settledSun: window.__game.renderer.sun.intensity,
          sunColor: window.__game.renderer.sun.color.getHexString(),
          settledHemi: window.__game.renderer.hemi.intensity,
          hemiColor: window.__game.renderer.hemi.color.getHexString(),
          hemiGround: window.__game.renderer.hemi.groundColor.getHexString(),
          settledEnvironment: window.__game.renderer.scene.environmentIntensity,
          fog: {
            color: window.__game.renderer.scene.fog.color.getHexString(),
            near: window.__game.renderer.scene.fog.near,
            far: window.__game.renderer.scene.fog.far,
          },
        })),
      );
      for (const phase of ['day', 'night']) {
        await page.evaluate((value) => {
          const input = document.querySelector('#chat-input');
          input.value = `/daynight ${value}`;
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
          input.blur();
        }, phase);
        await delay(2500);
        const cycle = await page.evaluate(() => {
          const material = window.__game.renderer.sky.material;
          return { skyColor: material?.color?.getHexString() ?? null };
        });
        const kind = shouldBeOutdoor ? `${rarity}-${zone}` : `common-cave-${zone}`;
        const file = `${out}/${kind}-${phase}-${mobile ? 'landscape-phone-low' : 'desktop-ultra'}.png`;
        await page.screenshot({ path: file });
        console.log(JSON.stringify({ file, ...state, ...renderState, ...cycle }));
      }
      if (cameraCheck && shouldBeOutdoor) {
        for (const [label, yaw, pitch, dist] of [
          ['arrival', 0, 0.32, 12],
          ['raised-north', 0, 0.95, 30],
          ['raised-east', Math.PI / 2, 0.95, 30],
          ['raised-south', Math.PI, 0.95, 30],
          ['raised-west', -Math.PI / 2, 0.95, 30],
        ]) {
          await page.evaluate(
            async ({ yaw, pitch, dist }) => {
              const { sim, renderer, input } = window.__game;
              const view = sim.riftFloor;
              const { generateRiftFloor } = await import('/src/sim/rift/rift_gen.ts');
              const floor = generateRiftFloor(
                view.seed,
                view.baseLevel,
                view.floorIndex,
                view.upgrade,
              );
              sim.player.pos.x = view.origin.x + floor.entry.x;
              sim.player.pos.z = view.origin.z + floor.entry.z;
              Object.assign(sim.player.prevPos, sim.player.pos);
              renderer.editorCam = null;
              input.camYaw = yaw;
              input.camPitch = pitch;
              input.camDist = dist;
            },
            { yaw, pitch, dist },
          );
          await delay(3000);
          const camera = await page.evaluate(() => {
            const renderer = window.__game.renderer;
            return {
              position: renderer.camera.position.toArray(),
              target: renderer.cameraLookAt.toArray(),
              roofVisible: renderer.scene.getObjectByName('HoardCavernEntryRoof')?.visible,
            };
          });
          const file = `${out}/camera-${label}-${mobile ? 'landscape-phone-low' : 'desktop-ultra'}.png`;
          await page.screenshot({ path: file });
          console.log(JSON.stringify({ file, camera }));
        }
      }
      if (shaderErrors.length) throw new Error(`Shader compilation failed: ${shaderErrors[0]}`);
    }
  } finally {
    await browser.close();
  }
}
