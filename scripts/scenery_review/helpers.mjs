import { installProbe } from './probe.mjs';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const scenes = [
  { name: 'thornpeak', x: 30, z: 700, yaw: 0.5, pitch: 0.3, dist: 8 },
  { name: 'beach', x: -352, z: 806, yaw: 0, pitch: 0.5, dist: 8 },
];
export const quiet = (x) =>
  [x.start, ...x.points, x.end].every(
    (p) => !p.queuePending && !p.queueActive && !p.pendingZones && !p.waitingTails?.length,
  ) &&
  x.start.queueUnits === x.end.queueUnits &&
  x.start.programs === x.end.programs;
export async function configure(page, mobile = false) {
  await page.evaluate(async (mobile) => {
    if (mobile) {
      await window.__holdSessionWake();
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    }
    const g = window.__game,
      h = window.__celProductionHelpers;
    h.setDayNightPhaseOverride(0.5);
    window.__celCadence = h.sharedFrameCadence();
    window.__celCadence.setIntent(0);
    g.sim.devCommands = true;
    g.sim.setPlayerLevel(20);
    g.sim.player.devNoAggro = true;
    window.__cellView = { yaw: 0.5, pitch: 0.3, dist: 8 };
    setInterval(() => {
      const v = window.__cellView;
      g.input.camYaw = v.yaw;
      g.input.camPitch = v.pitch;
      g.input.camDist = v.dist;
      g.renderer.camDist = v.dist;
    }, 50);
  }, mobile);
  await page.evaluate(installProbe);
}
export async function place(page, view) {
  await page.evaluate((v) => {
    window.__cellView = v;
    window.__game.sim.chat(`/dev tp ${v.x} ${v.z}`);
  }, view);
  await sleep(12000);
}
export async function settle(pages) {
  let streak = 0;
  for (let i = 0; i < 144; i++) {
    const xs = await Promise.all(
      pages.map((p) => p.evaluate(() => window.__celDecision.sample(5000))),
    );
    streak = xs.every(quiet) ? streak + 1 : 0;
    if (streak === 3) return;
  }
  throw Error('Preparation did not settle');
}
