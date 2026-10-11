import { dismissEntryOverlays } from '../enter_offline_game.mjs';

export async function seedTideCapture(page, preset) {
  await page.evaluateOnNewDocument((graphicsPreset) => {
    localStorage.setItem(
      'woc_settings',
      JSON.stringify({ graphicsPreset, graphicsDetected: true }),
    );
  }, preset);
}

/** Production scene and painter; only encounter time is held for the three review frames. */
export async function captureHoardTide(page, phase) {
  await dismissEntryOverlays(page);
  await page.evaluate(async () => {
    if (window.__tideCapture) return;
    const { sim, input } = window.__game;
    sim.chat('/dev hoard maw', sim.player.id);
    const inst = sim.riftInstances.find((i) => i.vault && i.partyKey !== null);
    if (!inst) throw new Error('legendary hoard command failed');
    const boss = sim.entities.get(inst.bossId);
    const { hoardTidePattern } = await import('/src/sim/rift/hoard_tide_pattern.ts');
    const plan = hoardTidePattern(inst.seed, 'legendary', false)[0];
    const cue = {
      instanceId: inst.instanceId,
      cueId: 9001,
      kind: 'sweep',
      variant: 'tide-wave',
      phase: 'warning',
      x: boss.spawnPos.x,
      z: boss.spawnPos.z,
      radius: plan.radius,
      facing: 0,
      waveSpan: plan.span,
      waveGap: -4,
      waveLead: plan.lead,
      total: plan.total,
      remaining: plan.total,
    };
    sim.player.pos = sim.ctx.groundPos(cue.x - 4, cue.z - 5);
    sim.player.prevPos = { ...sim.player.pos };
    sim.player.damageImmune = true;
    input.camYaw = 0.3;
    input.camPitch = 0.85;
    input.camDist = 30;
    const mobs = inst.mobIds.map((id) => sim.entities.get(id)).filter(Boolean);
    const { createMob } = await import('/src/sim/entity.ts');
    const { MOBS } = await import('/src/sim/data.ts');
    while (mobs.length < 25) {
      const extra = createMob(
        sim.ctx.nextId++,
        MOBS.rift_deep_lurker ?? MOBS[mobs[0].templateId],
        20,
        sim.ctx.groundPos(cue.x, cue.z),
      );
      sim.ctx.addEntity(extra);
      inst.mobIds.push(extra.id);
      mobs.push(extra);
    }
    for (let i = 0; i < mobs.length; i++) {
      const mob = mobs[i];
      mob.damageImmune = true;
      mob.aggroRadius = 0;
      mob.hostile = false;
      mob.aiState = 'idle';
      mob.inCombat = false;
      mob.targetId = null;
      mob.aggroTargetId = null;
      mob.threat.clear();
      if (mob.id !== boss.id) {
        mob.pos = sim.ctx.groundPos(cue.x + (i % 2 ? -22 : 22), cue.z - 45 - i);
        mob.prevPos = { ...mob.pos };
        mob.spawnPos = { ...mob.pos };
      }
    }
    window.__tideCapture = { cue, inst, mobs, mobCount: mobs.length };
    sim.hoardBossCues = () => [window.__tideCapture.cue];
  });
  await page.waitForFunction(() => window.__game.renderer.riftDeathZoneVisuals, {
    timeout: 120000,
  });
  await page.evaluate(async (stage) => {
    const { cue } = window.__tideCapture;
    cue.remaining =
      stage === 'telegraph'
        ? cue.total - cue.waveLead * 0.55
        : stage === 'surge'
          ? (cue.total - cue.waveLead) * 0.55
          : -0.2;
    await window.__game.renderer.riftDeathZoneVisuals.hoardBossFx.readyForEntry;
  }, phase);
  await page.waitForFunction(
    () => {
      const el = document.getElementById('loading-screen');
      return !el || getComputedStyle(el).display === 'none' || +getComputedStyle(el).opacity === 0;
    },
    { timeout: 120000 },
  );
  await new Promise((r) => setTimeout(r, 1500));
  return {};
}

export function hoardTideReviewTargets() {
  return ['telegraph', 'surge', 'crash'].map((phase) => ({
    key: `hoard-tide-${phase}`,
    label: `Buried Hoard tide ${phase}`,
    when: ['render/hoard_tide_wave', 'scripts/lib/pr_shot_hoard_tide'],
    variants: [
      { key: 'desktop-ultra', beforeLoad: (p) => seedTideCapture(p, 4) },
      { key: 'phone-low', mobile: true, beforeLoad: (p) => seedTideCapture(p, 1) },
    ],
    capture: (page) => captureHoardTide(page, phase),
  }));
}

export async function measureHoardTide(page) {
  return page.evaluate(async () => {
    const { sim, renderer } = window.__game;
    const c = window.__tideCapture.cue;
    window.__tideCapture.mobs.forEach((m, i) => {
      m.pos = sim.ctx.groundPos(c.x + Math.sin(i * 2.4) * 18, c.z + Math.cos(i * 2.4) * 12);
      m.prevPos = { ...m.pos };
      m.spawnPos = { ...m.pos };
    });
    const cues = [0, 1, 2].map((i) => ({
      ...c,
      cueId: 9100 + i,
      facing: (i * Math.PI) / 2,
      remaining: 2 + i * 0.3,
    }));
    sim.hoardBossCues = () => {
      for (const q of cues) q.remaining = 3.9 - ((sim.time + q.cueId * 0.3) % 3.8);
      return cues;
    };
    await new Promise((r) => setTimeout(r, 3000));
    let last = performance.now();
    const times = [];
    await new Promise((resolve) => {
      function frame(now) {
        times.push(now - last);
        last = now;
        if (times.length < 600) requestAnimationFrame(frame);
        else resolve();
      }
      requestAnimationFrame(frame);
    });
    times.sort((a, b) => a - b);
    const gl = renderer.webgl.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      frames: times.length,
      avgMs: times.reduce((a, b) => a + b) / times.length,
      p95Ms: times[Math.floor(times.length * 0.95)],
      adapter: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown',
      mobCount: window.__tideCapture.mobCount,
      fixture: '3 simultaneous cosmetic waves, 25 living idle mobs, ticking simulation',
    };
  });
}
