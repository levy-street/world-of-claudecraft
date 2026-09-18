import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';

// Each call advances the real sim and renderer synchronously, so brief Land,
// attack and jump edges cannot disappear between slow SwiftShader paints.
export async function advanceDruidCat(page, command = {}) {
  return page.evaluate((c) => {
    const g = window.__game;
    if (g.online) throw new Error('This harness requires an offline world');
    const sim = g.sim;
    const p = sim.player;
    const idle = {
      forward: false,
      back: false,
      turnLeft: false,
      turnRight: false,
      strafeLeft: false,
      strafeRight: false,
      jump: false,
    };
    if (c.reset) {
      sim.stopAutoAttack();
      sim.targetEntity(null);
      for (const id of ['dash', 'prowl']) sim.cancelAura(id);
      p.dead = false;
      p.hp = p.maxHp;
      p.inCombat = false;
      p.combatTimer = 30;
      p.sitting = false;
      p.pos = sim.groundPos(-354, -2);
      p.prevPos = { ...p.pos };
      p.facing = p.prevFacing = 0;
      p.vx = p.vy = p.vz = 0;
      p.onGround = true;
      p.jumping = false;
      p.climb = null;
      p.fallStartY = p.pos.y;
      sim.rebucket(p);
    }
    if (c.reset) p.auras = p.auras.filter((a) => a.id !== 'cat_harness_slow');
    if (c.stage) Object.assign(p, c.stage);
    if (c.slow)
      p.auras.push({
        id: 'cat_harness_slow',
        name: 'Local cadence fixture',
        kind: 'slow',
        value: c.slow,
        duration: 30,
        remaining: 30,
        sourceId: p.id,
        school: 'frost',
      });
    if (c.position) {
      p.pos = { ...c.position };
      p.prevPos = { ...p.pos };
      p.fallStartY = p.pos.y;
      sim.rebucket(p);
    }
    if (c.cancel) sim.cancelAura(c.cancel);
    if (c.chat) sim.chat(c.chat);
    if (c.cast) {
      p.gcdRemaining = 0;
      p.resource = p.maxResource;
      p.cooldowns.delete(c.cast);
      sim.castAbility(c.cast, c.pid);
    }
    g.hud.handleEvents(sim.drainEvents());
    const trace = [];
    for (let i = 0; i < (c.steps ?? 1); i++) {
      Object.assign(sim.moveInput, idle, c.move);
      if (!c.renderOnly) g.hud.handleEvents(sim.tick());
      const cameraTarget = g.renderer.camera.position.clone().set(p.pos.x, p.pos.y + 0.7, p.pos.z);
      g.renderer.editorCam = {
        target: cameraTarget,
        pos: cameraTarget.clone().add(
          g.renderer.camera.position
            .clone()
            .set(2.8, 1, 2.8)
            .multiplyScalar(innerWidth < 1000 ? 0.7 : 1),
        ),
      };
      g.renderer.sync(
        1,
        0.05,
        null,
        0,
        null,
        !!(c.reset || c.position) && i === 0,
        i === (c.steps ?? 1) - 1,
      );
      if (i === (c.steps ?? 1) - 1) g.hud.update();
      const v = g.renderer.views.get(c.pid ?? p.id);
      const active = [v?.catVisual, v?.bearVisual, v?.visual].find(
        (visual) => visual?.root.visible,
      );
      let bones = 0;
      let finite = true;
      active?.root.traverse((node) => {
        if (node.isSkinnedMesh && node.skeleton) {
          bones = Math.max(bones, node.skeleton.bones.length);
          finite &&= node.skeleton.bones.every((bone) =>
            bone.matrixWorld.elements.every(Number.isFinite),
          );
        }
      });
      trace.push({
        key: active?.key,
        clip: active?.current?.getClip().name,
        base: active?.baseState,
        clipTime: active?.current?.time,
        paused: active?.current?.paused,
        rate: active?.current?.timeScale,
        bones,
        finite,
        onGround: p.onGround,
        y: p.pos.y,
        vy: p.vy,
        position: { ...p.pos },
        speed: Math.hypot(p.pos.x - p.prevPos.x, p.pos.z - p.prevPos.z) / 0.05,
        auras: p.auras.map((a) => a.id),
        weighted: active
          ? [...active.actions]
              .filter(([, a]) => a.isScheduled() && a.getEffectiveWeight() > 0.01)
              .map(([name]) => name)
          : [],
      });
    }
    return trace;
  }, command);
}

/** Encode actual rendered frames at their .05-second simulation cadence.
 * This keeps slow headless painting from turning the review video into slow motion. */
export async function recordDruidCat(page, directory) {
  const frames = path.join(directory, 'video-frames');
  fs.mkdirSync(frames, { recursive: true });
  let frame = 0;
  for (const [initial, movement, count] of [
    [{ reset: true }, { forward: true }, 30],
    [{ reset: true, cast: 'dash' }, { forward: true }, 25],
    [{ reset: true, move: { jump: true, forward: true } }, { forward: true }, 20],
    [{ reset: true, cast: 'prowl' }, { forward: true }, 35],
  ]) {
    await advanceDruidCat(page, initial);
    for (let i = 0; i < count; i++) {
      await advanceDruidCat(page, { move: movement });
      await page.screenshot({ path: path.join(frames, `${String(frame++).padStart(4, '0')}.png`) });
    }
  }
  const video = path.join(directory, 'druid-cat-gameplay.mp4');
  execFileSync(ffmpegPath, [
    '-y',
    '-loglevel',
    'error',
    '-framerate',
    '20',
    '-i',
    path.join(frames, '%04d.png'),
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-crf',
    '20',
    '-movflags',
    '+faststart',
    video,
  ]);
  return video;
}
