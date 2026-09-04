// Masterwrought regression shots use the same production UI/renderer on both
// revisions. Only fixture state is staged; no DOM or mesh correction is applied.
async function waitForFixtureBanners(page) {
  // Grants can queue several celebrations. One transparent frame can be the
  // gap between two banners; require a quiet interval before the screenshot.
  await page.evaluate(async () => {
    const started = performance.now();
    let quietSince = started;
    while (performance.now() - started < 60000) {
      const now = performance.now();
      const banner = document.querySelector('#banner');
      if (banner && Number(getComputedStyle(banner).opacity) >= 0.05) quietSince = now;
      else if (now - quietSince >= 3000) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('fixture celebration banners did not settle');
  });
}

export function masterwroughtReviewTargets({ beforeLoad, dismissOverlays }) {
  const variants = [
    { key: 'desktop', beforeLoad },
    { key: 'mobile', mobile: true, beforeLoad },
  ];
  return [
    {
      key: 'perfecting-dismissal',
      label: 'Perfecting bind prompt after its owning window is force-closed',
      when: ['ui/hud/professions/perfecting_window', 'scripts/lib/pr_shot_masterwrought'],
      variants,
      async capture(page) {
        await dismissOverlays(page);
        await page.evaluate(() => {
          const { sim, hud } = window.__game;
          sim.players.get(sim.primaryId).craftSkills.weaponcrafting = 125;
          sim.addItem('duskforged_warblade', 1);
          for (const item of ['makers_ember', 'sundered_essence', 'prismglass_setting']) {
            sim.addItem(item, 1);
          }
          hud.openPerfecting();
        });
        await dismissOverlays(page);
        await waitForFixtureBanners(page);
        await page.waitForSelector('#perfecting-window [data-action]:not(:disabled)', {
          visible: true,
        });
        // A real click opens the confirmation. Close through its owning controller:
        // the generic HUD dispatcher may first dismiss an unrelated mobile overlay.
        // Escape belongs to the active prompt and would only cancel confirmation.
        await page.click('#perfecting-window [data-action]');
        await page.waitForSelector('.pf-bind-prompt', { visible: true });
        await page.evaluate(() => window.__game.hud.perfectingWindow.close());
        await page.waitForFunction(
          () => getComputedStyle(document.querySelector('#perfecting-window')).display === 'none',
        );
        console.log(
          '[perfecting-dismissal]',
          await page.evaluate(() => ({
            promptsAfterClose: document.querySelectorAll('.pf-bind-prompt').length,
            ownerInert: document.querySelector('#perfecting-window').inert,
          })),
        );
        await waitForFixtureBanners(page);
        return { clip: '#ui' };
      },
    },
    {
      key: 'feast-dungeon-floor',
      label: 'The shipped feast GLB on the raised Dawnhold gallery floor',
      when: ['render/farm_patches', 'sim/professions/feast', 'scripts/lib/pr_shot_masterwrought'],
      variants,
      async capture(page) {
        await dismissOverlays(page);
        await page.evaluate(async () => {
          const { DUNGEONS, instanceOrigin } = await import('/src/sim/data.ts');
          const { enterDungeon } = await import('/src/sim/instances/dungeons.ts');
          const { sim, input } = window.__game;
          enterDungeon(sim.ctx, 'dawnhold_castle', sim.player.id);
          const origin = instanceOrigin(DUNGEONS.dawnhold_castle.index, 0);
          const player = sim.player;
          player.pos = { x: origin.x + 2, y: 3, z: origin.z + 38 };
          player.prevPos = { ...player.pos };
          player.facing = 0;
          for (const entity of sim.entities.values()) {
            if (entity.hostile) {
              entity.dead = true;
              entity.hp = 0;
              entity.lootable = false;
            }
          }
          sim.addItem('harvest_feast', 1);
          sim.placeFeast();
          const feast = [...sim.feasts.keys()][0];
          if (feast === undefined) throw new Error('the dungeon feast did not place');
          window.__masterwroughtFeastId = feast;
          // The gallery rug is clear of permanent furniture, unlike the
          // solar's reading table. Keep the camera inside the narrow room.
          player.pos.x -= 3;
          player.prevPos = { ...player.pos };
          player.facing = Math.PI / 2;
          input.camYaw = Math.PI / 2;
          input.camPitch = 0.55;
          input.camDist = 4;
        });
        await dismissOverlays(page);
        await page.waitForFunction(
          () => {
            const { renderer } = window.__game;
            const group = renderer.scene.getObjectByName(
              `farmFeast:${window.__masterwroughtFeastId}`,
            );
            return (
              group?.visible &&
              group.children.some((child) => child.geometry?.attributes.position.count > 24)
            );
          },
          { timeout: 90000 },
        );
        await page.waitForFunction(
          () => !document.querySelector('#loading-screen')?.classList.contains('visible'),
          { timeout: 90000 },
        );
        console.log(
          '[feast-dungeon-floor]',
          await page.evaluate(() => {
            const { sim, renderer } = window.__game;
            const id = window.__masterwroughtFeastId;
            const group = renderer.scene.getObjectByName(`farmFeast:${id}`);
            return {
              entityY: sim.entities.get(id).pos.y,
              renderedY: group.position.y,
              vertices: group.children.reduce(
                (sum, child) => sum + (child.geometry?.attributes.position.count ?? 0),
                0,
              ),
              gpuPrep: renderer.perfStats().gpuPrep,
            };
          }),
        );
        await waitForFixtureBanners(page);
        return { clip: '#ui' };
      },
    },
  ];
}
