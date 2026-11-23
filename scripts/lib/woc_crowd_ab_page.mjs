// The page-side half of the WOC crowd A/B rig (scripts/woc_crowd_ab.mjs).
//
// installPageRig is handed to puppeteer's page.evaluate, so it is SERIALIZED
// into the game page: it closes over nothing in this module and imports
// nothing. It installs window.__wocCrowdAb, which opens a measurement window,
// records it, adds and moves the crowd through the sim, and reports what is
// drawn.
//
// It may rely only on what BOTH the release and the WOC branch expose on the
// dev hook, because the same file measures every arm:
//   - window.__game.{sim, renderer, perf, input} (src/main.ts, after the reveal);
//   - renderer.perfStats(): calls, triangles, programs, gpuTimer, gpuPrep,
//     buildLedger, gpuQueue (src/render/renderer.ts);
//   - renderer.views (entity id to view), a view's `visual.root`, `isFar`,
//     `compilePending` and `visualKey`;
//   - the sim's own player API: addPlayer, setPlayerLevel, players, entities,
//     groundPos, rebucket, isSwimming (src/sim/sim.ts);
//   - PerfMonitor.frame, called once per rendered frame with the game's own
//     frame dt (src/game/perf.ts, src/main.ts frame());
//   - two dev-served modules it imports by path: src/render/day_night_clock.ts
//     (the time-of-day override) and src/sim/data.ts (the item table).
//     tests/woc_crowd_ab_core.test.ts pins that both still export what is read.
//
// What "drawn" means here, the same rule for every arm: a body is drawn when
// its view exists, every ancestor of its visual root is visible, and at least
// one mesh under that root is visible and still in a render layer. It is
// articulated when one of those meshes is skinned, and on its far mesh when
// none is. Frustum culling is three's own and is not replayed; the rig checks
// instead that every body projects inside the camera view.
//
// The rig's own cost is kept small and is REPORTED per window (rigMs): one
// extra animation-frame callback, a perfStats() read once a second, and in a
// window that follows the crowd (ARRIVAL, TRANSIT) a visibility walk of the
// bodies that have not reached the goal yet plus, every sixth callback, of
// all of them.

/**
 * Freeze the world's time of day. The day and night cycle is render-only, runs
 * on a UTC-anchored clock and turns once every 45 minutes
 * (src/render/day_night_clock.ts, day_night_core.ts DAY_NIGHT_CYCLE_MS), so two
 * arms measured ten minutes apart would otherwise stand under different light:
 * lamps lit or dark, another light count in every program key. The override is
 * the dev build's own (`/daynight`); the moon is frozen full beside it. Also
 * serialized into the page; callable as soon as the page's modules have loaded.
 */
export async function pinDayNightClock(phase) {
  try {
    const clock = await import('/src/render/day_night_clock.ts');
    const before = clock.dayNightPhaseOverride();
    const livePhase = before === null ? clock.currentDayNightPhase() : null;
    clock.setDayNightPhaseOverride(phase);
    clock.setLunarPhaseOverride(0.5);
    const pinnedPhase = clock.dayNightPhaseOverride();
    return { ok: pinnedPhase === phase, pinnedPhase, livePhase, error: null };
  } catch (error) {
    return {
      ok: false,
      pinnedPhase: null,
      livePhase: null,
      error: String(error?.message ?? error),
    };
  }
}

export function installPageRig() {
  if (window.__wocCrowdAb) return true;
  const { renderer, sim, perf, input } = window.__game;
  let win = null;
  const placed = new Map();
  const longTasks = [];
  let longTaskObserver = null;
  try {
    longTaskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) longTasks.push([entry.startTime, entry.duration]);
      if (longTasks.length > 20000) longTasks.splice(0, longTasks.length - 20000);
    });
    longTaskObserver.observe({ entryTypes: ['longtask'] });
  } catch {
    longTaskObserver = null;
  }

  // Every rendered frame hands the game's own dt to PerfMonitor.frame: wrap it.
  const gameFrame = perf.frame;
  perf.frame = function wocCrowdAbFrame(dt, now) {
    if (win?.open) win.frameMs.push(dt * 1000);
    return gameFrame.call(this, dt, now);
  };

  function bodyCensus(id) {
    const view = renderer.views.get(id);
    if (!view) return { built: false, drawn: false, meshes: 0, skinned: 0 };
    const visual = view.visual;
    if (!visual?.root) return { built: true, drawn: false, meshes: 0, skinned: 0, key: null };
    let shown = true;
    for (let node = visual.root; node; node = node.parent) {
      if (!node.visible) {
        shown = false;
        break;
      }
    }
    let meshes = 0;
    let skinned = 0;
    if (shown) {
      visual.root.traverseVisible((node) => {
        if (!node.isMesh || node.layers.mask === 0) return;
        meshes += 1;
        if (node.isSkinnedMesh) skinned += 1;
      });
    }
    return {
      built: true,
      drawn: meshes > 0,
      meshes,
      skinned,
      isFar: view.isFar === true,
      compilePending: view.compilePending === true,
      key: view.visualKey ?? null,
      composed: Boolean(visual.modularLook),
    };
  }

  // A watch follows the crowd through a window that starts with a change:
  // 'drawn' (ARRIVAL) notes when each body first has a view, and when it is
  // first drawn; 'far' (TRANSIT) notes when each body first stands on its far
  // mesh. Once a body has reached the goal it is not walked again.
  function newWatch(ids, goal) {
    return {
      ids,
      goal,
      first: new Map(),
      firstView: new Map(),
      reached: 0,
      polls: 0,
      timeline: [],
      signature: -1,
      lastChangeMs: null,
      sets: [],
    };
  }

  function pollWatch(w, at) {
    const watch = w.watch;
    watch.polls += 1;
    let reached = 0;
    for (const id of watch.ids) {
      if (watch.first.has(id)) {
        reached += 1;
        continue;
      }
      if (!watch.firstView.has(id) && renderer.views.has(id)) watch.firstView.set(id, at - w.t0);
      const body = bodyCensus(id);
      if (watch.goal === 'far' ? body.drawn && body.skinned === 0 : body.drawn) {
        watch.first.set(id, at - w.t0);
        reached += 1;
      }
    }
    if (reached !== watch.reached) {
      watch.reached = reached;
      watch.timeline.push([Math.round(at - w.t0), reached]);
    }
    // The drawn SET (which meshes, how many skinned), every sixth callback:
    // its last change is when the crowd reached the form it keeps.
    if (watch.polls % 6 === 0) {
      let meshes = 0;
      let skinned = 0;
      for (const id of watch.ids) {
        const body = bodyCensus(id);
        meshes += body.meshes;
        skinned += body.skinned;
      }
      const signature = meshes * 4096 + skinned;
      if (signature !== watch.signature) {
        watch.signature = signature;
        watch.lastChangeMs = at - w.t0;
        if (watch.sets.length < 400) watch.sets.push([Math.round(at - w.t0), meshes, skinned]);
      }
    }
  }

  let lastRaf = 0;
  const onRaf = (ts) => {
    const w = win;
    if (w?.open) {
      const started = performance.now();
      w.rafTs.push(ts);
      if (w.watch) pollWatch(w, started);
      if (started - w.t0 >= w.durationMs) {
        w.open = false;
        w.t1 = started;
        clearInterval(w.timer);
        w.resolve();
      }
      w.rigMs += performance.now() - started;
    }
    lastRaf = ts;
    requestAnimationFrame(onRaf);
  };
  requestAnimationFrame(onRaf);

  // Units the background GPU queue has run so far, per kind (the label up to
  // its colon) with the kind's learned cost: a delta between two reads names
  // the work a window or a settle carried.
  function queueKinds(stats) {
    const kinds = {};
    for (const row of stats.gpuPrep?.budget?.kinds ?? []) {
      kinds[row.kind] = { units: row.samples, emaMs: row.emaMs };
    }
    return kinds;
  }

  function boundary() {
    const stats = renderer.perfStats();
    const timer = stats.gpuTimer ?? {};
    const ledger = {};
    for (const [kind, row] of Object.entries(stats.buildLedger?.kinds ?? {})) {
      if (kind.startsWith('view')) {
        ledger[kind] = { count: row.count, totalMs: row.totalMs, maxMs: row.maxMs };
      }
    }
    const cadence = window.__wocFrameCadence?.snapshot?.();
    return {
      at: performance.now(),
      tier: stats.tier,
      zone: stats.currentZoneId ?? null,
      programs: stats.programs,
      textures: stats.textures,
      geometries: stats.geometries,
      views: stats.views,
      night: stats.nightAmount,
      renderScale: stats.effectiveRenderScale,
      gpu: {
        available: timer.available === true,
        framesResolved: timer.framesResolved ?? 0,
        disjointFrames: timer.disjointFrames ?? 0,
        droppedFrames: timer.droppedFrames ?? 0,
        sceneNoHandover: timer.sceneNoHandover ?? 0,
        halted: timer.halted === true,
      },
      eventCounts: { ...(stats.gpuPrep?.events?.counts ?? {}) },
      events: (stats.gpuPrep?.events?.events ?? []).map((event) => ({
        kind: event.kind,
        key: event.key,
        ageMs: event.ageMs,
        atMs: event.atMs,
      })),
      ledger,
      ledgerSlowest: (stats.buildLedger?.slowest ?? []).map((row) => ({
        kind: row.kind,
        ms: row.ms,
        atMs: row.atMs,
      })),
      queueKinds: queueKinds(stats),
      queue: {
        units: stats.gpuQueue?.units ?? 0,
        pending: stats.gpuQueue?.pending ?? 0,
        totalSyncMs: stats.gpuQueue?.totalSyncMs ?? 0,
        worstSyncMs: stats.gpuQueue?.worstSyncMs ?? 0,
      },
      cadence: cadence
        ? {
            verdict: cadence.verdict,
            refreshHz: cadence.refreshHz,
            intent: cadence.intent,
            divisor: cadence.divisor,
            targetIntervalMs: cadence.targetIntervalMs,
            rendered: cadence.rendered,
            skipped: cadence.skipped,
          }
        : null,
      visibility: document.visibilityState,
      camera: { yaw: input.camYaw, pitch: input.camPitch, dist: input.camDist },
      observer: { x: sim.player.pos.x, z: sim.player.pos.z },
    };
  }

  function sample(w) {
    const started = performance.now();
    const stats = renderer.perfStats();
    const timer = stats.gpuTimer ?? {};
    const brackets = {};
    if (timer.available) {
      for (const [name, row] of Object.entries(timer.brackets ?? {})) brackets[name] = row.avg;
    }
    w.samples.push({
      t: Math.round(started - w.t0),
      calls: stats.calls,
      triangles: stats.triangles,
      programs: stats.programs,
      gpuAvail: timer.available === true,
      gpuFrames: timer.framesResolved ?? 0,
      gpuAvg: timer.frameSum?.avg ?? 0,
      gpuP95: timer.frameSum?.p95 ?? 0,
      brackets,
    });
    w.rigMs += performance.now() - started;
  }

  function place(entity, spot, facing) {
    const pos = sim.groundPos(spot.x, spot.z);
    entity.pos = pos;
    entity.prevPos = { ...pos };
    entity.facing = facing;
    sim.rebucket(entity);
    placed.set(entity.id, { x: pos.x, z: pos.z });
  }

  function crowdState(ids) {
    const camera = renderer.camera;
    const probe = camera.position.clone();
    const out = {
      expected: ids.length,
      built: 0,
      drawn: 0,
      articulated: 0,
      onFarMesh: 0,
      farVerdict: 0,
      compilePending: 0,
      inFrustum: 0,
      meshes: 0,
      skinnedMeshes: 0,
      composed: 0,
      dressed: 0,
      moved: 0,
      swimming: 0,
      dead: 0,
      inCombat: 0,
      maxDriftYd: 0,
      visualKeys: {},
      offenders: [],
    };
    for (const id of ids) {
      const entity = sim.entities.get(id);
      const body = bodyCensus(id);
      if (body.built) out.built += 1;
      if (body.drawn) out.drawn += 1;
      if (body.drawn && body.skinned > 0) out.articulated += 1;
      if (body.drawn && body.skinned === 0) out.onFarMesh += 1;
      if (body.isFar) out.farVerdict += 1;
      if (body.compilePending) out.compilePending += 1;
      if (body.composed) out.composed += 1;
      out.meshes += body.meshes;
      out.skinnedMeshes += body.skinned;
      if (body.key) out.visualKeys[body.key] = (out.visualKeys[body.key] ?? 0) + 1;
      if (!entity) {
        out.offenders.push(`${id}: no entity`);
        continue;
      }
      probe.set(entity.pos.x, entity.pos.y + 1, entity.pos.z).project(camera);
      const seen =
        Math.abs(probe.x) <= 1 && Math.abs(probe.y) <= 1 && probe.z >= -1 && probe.z <= 1;
      if (seen) out.inFrustum += 1;
      const worn = entity.equippedItems ?? {};
      const slots = ['helmet', 'shoulder', 'gloves', 'chest', 'waist', 'feet'];
      if (slots.every((slot) => typeof worn[slot] === 'string')) out.dressed += 1;
      const spot = placed.get(id);
      const drift = spot ? Math.hypot(entity.pos.x - spot.x, entity.pos.z - spot.z) : 0;
      if (drift > out.maxDriftYd) out.maxDriftYd = drift;
      const swimming = sim.isSwimming(entity) === true;
      if (drift > 0.05) out.moved += 1;
      if (swimming) out.swimming += 1;
      if (entity.dead) out.dead += 1;
      if (entity.inCombat) out.inCombat += 1;
      if (!body.drawn || !seen || drift > 0.05 || swimming || entity.dead || entity.inCombat) {
        if (out.offenders.length < 12) {
          out.offenders.push(
            `${entity.name}: drawn=${body.drawn} seen=${seen} drift=${drift.toFixed(2)} swim=${swimming} dead=${!!entity.dead} combat=${!!entity.inCombat}`,
          );
        }
      }
    }
    out.maxDriftYd = Math.round(out.maxDriftYd * 100) / 100;
    return out;
  }

  window.__wocCrowdAb = {
    longTaskSupported: longTaskObserver !== null,

    environment() {
      const stats = renderer.perfStats();
      const gl = renderer.webgl.getContext();
      const extensions = gl.getSupportedExtensions?.() ?? [];
      const player = sim.player;
      return {
        tier: stats.tier,
        glVendor: stats.glVendor,
        glRenderer: stats.glRenderer,
        glPowerPreference: stats.glPowerPreference ?? null,
        gpuTimerAvailable: stats.gpuTimer?.available === true,
        timerExtensionSupported: extensions.includes('EXT_disjoint_timer_query_webgl2'),
        parallelShaderCompile: extensions.includes('KHR_parallel_shader_compile'),
        autoGovernor: stats.autoGovernor,
        drawingBuffer: stats.drawingBuffer,
        pixelRatio: stats.pixelRatio,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
        screen: { width: screen.width, height: screen.height },
        pageBuildId:
          typeof globalThis.__APP_BUILD_ID__ === 'string' ? globalThis.__APP_BUILD_ID__ : null,
        pageVersion:
          typeof globalThis.__APP_VERSION__ === 'string' ? globalThis.__APP_VERSION__ : null,
        viteDevClient: document.querySelector('script[src*="/@vite/client"]') !== null,
        search: location.search,
        longTaskSupported: longTaskObserver !== null,
        player: {
          id: player.id,
          cls: player.templateId,
          level: player.level,
          x: player.pos.x,
          y: player.pos.y,
          z: player.pos.z,
          facing: player.facing,
          worn: { ...(player.equippedItems ?? {}) },
        },
      };
    },

    async verifyItems(ids) {
      try {
        const data = await import('/src/sim/data.ts');
        return ids.map((id) => Boolean(data.ITEMS?.[id]));
      } catch {
        return null;
      }
    },

    /** Stand the observer where the run measures from, behind a fixed camera. */
    prepareObserver(override) {
      const player = sim.player;
      if (override && Number.isFinite(override.x) && Number.isFinite(override.z)) {
        const pos = sim.groundPos(override.x, override.z);
        player.pos = pos;
        player.prevPos = { ...pos };
        sim.rebucket(player);
      }
      if (override && Number.isFinite(override.facing)) player.facing = override.facing;
      player.devNoAggro = true;
      input.camYaw = player.facing;
      input.camPitch = 0.32;
      input.camDist = 12;
      return { x: player.pos.x, z: player.pos.z, facing: player.facing };
    },

    quiet() {
      const stats = renderer.perfStats();
      const queue = stats.gpuQueue ?? {};
      return {
        programs: stats.programs,
        textures: stats.textures,
        views: stats.views,
        pending: queue.pending ?? 0,
        units: queue.units ?? 0,
        queueKinds: queueKinds(stats),
      };
    },

    begin(scene, durationMs) {
      const start = boundary();
      const w = {
        scene,
        durationMs,
        open: true,
        t0: 0,
        t1: 0,
        frameMs: [],
        rafTs: [],
        samples: [],
        rigMs: 0,
        start,
        watch: null,
        timer: 0,
        resolve: null,
        promise: null,
      };
      w.promise = new Promise((resolve) => {
        w.resolve = resolve;
      });
      w.t0 = performance.now();
      if (lastRaf > 0) w.rafTs.push(lastRaf);
      w.timer = setInterval(() => {
        if (w.open) sample(w);
      }, 1000);
      win = w;
    },

    /** Add the crowd through the sim: one task, so the bodies arrive together. */
    spawn(roster, spots, wornSet, facing) {
      const started = performance.now();
      const ids = [];
      for (const bot of roster) {
        const id = sim.addPlayer(bot.cls, bot.name, {
          bot: true,
          appearance: { gender: bot.gender },
        });
        const meta = sim.players.get(id);
        const entity = sim.entities.get(id);
        Object.assign(meta.equipment, wornSet);
        // The sim's own stats pass mirrors the worn set onto the entity.
        sim.setPlayerLevel(entity.level, id);
        entity.devNoAggro = true;
        place(entity, spots[bot.index], facing);
        ids.push(id);
      }
      const spawnTaskMs = performance.now() - started;
      if (win?.open) {
        win.watch = newWatch(ids, 'drawn');
        win.actionTaskMs = spawnTaskMs;
      }
      return { ids, spawnTaskMs };
    },

    /** Move the crowd, all in one task. Inside an open window it also starts
     *  the watch for every body reaching its far mesh (TRANSIT). */
    move(ids, spots, facing) {
      const started = performance.now();
      ids.forEach((id, index) => {
        const entity = sim.entities.get(id);
        if (entity) place(entity, spots[index], facing);
      });
      if (win?.open) {
        win.watch = newWatch(ids, 'far');
        win.actionTaskMs = performance.now() - started;
      }
      return { ids };
    },

    crowdState,

    done() {
      return win.promise;
    },

    collect(ids) {
      const w = win;
      if (longTaskObserver) {
        for (const entry of longTaskObserver.takeRecords()) {
          longTasks.push([entry.startTime, entry.duration]);
        }
      }
      const end = boundary();
      const out = {
        scene: w.scene,
        t0: w.t0,
        t1: w.t1,
        frameMs: w.frameMs,
        rafTs: w.rafTs,
        samples: w.samples,
        rigMs: w.rigMs,
        start: w.start,
        end,
        longTasks: longTasks.filter((entry) => entry[0] >= w.t0 - 1 && entry[0] < w.t1),
        bodies: ids ? crowdState(ids) : null,
        actionTaskMs: w.actionTaskMs ?? null,
        watch: null,
      };
      if (w.watch) {
        const sorted = (map) => [...map.values()].sort((a, b) => a - b).map((ms) => Math.round(ms));
        out.watch = {
          goal: w.watch.goal,
          expected: w.watch.ids.length,
          reachedTimes: sorted(w.watch.first),
          viewTimes: sorted(w.watch.firstView),
          timeline: w.watch.timeline,
          lastChangeMs: w.watch.lastChangeMs,
          sets: w.watch.sets,
        };
      }
      win = null;
      return out;
    },
  };
  return true;
}
