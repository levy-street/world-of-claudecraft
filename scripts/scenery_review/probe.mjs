// Page-side diagnostics only. Installed after offline entry; removed on browser close.
export function installProbe() {
  const g = window.__game,
    r = g.renderer;
  const longTasks = [];
  const longTasksSupported =
    typeof PerformanceObserver !== 'undefined' &&
    PerformanceObserver.supportedEntryTypes?.includes('longtask');
  const observer = longTasksSupported
    ? new PerformanceObserver((list) => {
        for (const e of list.getEntries()) longTasks.push({ at: e.startTime, ms: e.duration });
      })
    : null;
  observer?.observe({ entryTypes: ['longtask'] });
  let restorers = [];
  let roots = [];
  function snapshot() {
    const s = r.perfStats();
    return {
      longTasksSupported,
      visibility: document.visibilityState,
      at: performance.now(),
      presented: r.presentedFrames(),
      zone: s.currentZoneId,
      tier: s.tier,
      cadence: window.__celCadence ? { ...window.__celCadence.snapshot() } : null,
      calls: s.calls,
      triangles: s.triangles,
      programs: s.programs,
      geometries: s.geometries,
      textures: s.textures,
      views: s.views,
      phaseMs: structuredClone(s.phaseMs),
      lastFrame: structuredClone(s.lastFrame),
      quality: structuredClone(s.qualityBuckets),
      postRung: s.postShedRung,
      governor: s.autoGovernor,
      governorFrozen: window.__celStudyGovernorFrozen === true,
      buffer: structuredClone(s.drawingBuffer),
      scale: s.effectiveRenderScale,
      queueUnits: s.gpuQueue?.units,
      pendingZones: s.zoneStreaming?.pending,
      preparedZones: s.zoneStreaming?.prepared,
      queuePending: s.gpuQueue?.pending ?? null,
      queueActive: s.gpuQueue?.active ?? null,
      waitingTails: s.gpuQueue?.waitingTails ?? null,
      heap: performance.memory
        ? { used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize }
        : null,
      sceneRoots: r.scene.children.length,
      glRenderer: s.glRenderer,
      player: { x: g.sim.player.pos.x, z: g.sim.player.pos.z },
    };
  }
  function stopRoots() {
    for (const restore of restorers) restore();
    restorers = [];
    return roots;
  }
  function startRoots() {
    stopRoots();
    roots = [];
    for (const root of r.scene.children) {
      let nodes = 0,
        bones = 0,
        hidden = 0;
      root.traverse((n) => {
        nodes++;
        bones += !!n.isBone;
        hidden += !n.visible;
      });
      const row = {
        uuid: root.uuid,
        name: root.name,
        category: root.userData.renderCategory ?? null,
        nodes,
        bones,
        hidden,
        visible: root.visible,
        matrixWorldAutoUpdate: root.matrixWorldAutoUpdate,
        calls: 0,
        ms: 0,
        maxMs: 0,
      };
      roots.push(row);
      const original = root.updateMatrixWorld;
      const own = Object.hasOwn(root, 'updateMatrixWorld');
      root.updateMatrixWorld = function (...args) {
        const t = performance.now();
        try {
          return original.apply(this, args);
        } finally {
          const ms = performance.now() - t;
          row.calls++;
          row.ms += ms;
          row.maxMs = Math.max(row.maxMs, ms);
        }
      };
      restorers.push(() => {
        if (own) root.updateMatrixWorld = original;
        else delete root.updateMatrixWorld;
      });
    }
  }
  async function sample(ms) {
    const start = snapshot(),
      t0 = performance.now(),
      frames = [],
      points = [start];
    let previous = r.presentedFrames(),
      last = t0,
      lastPoint = t0,
      callbacks = 0,
      skips = 0,
      multiple = 0;
    await new Promise((resolve) => {
      function step() {
        const t = performance.now(),
          count = r.presentedFrames(),
          d = count - previous;
        callbacks++;
        if (d === 0) skips++;
        else {
          if (d !== 1) multiple++;
          frames.push(t - last);
          last = t;
        }
        previous = count;
        if (t - lastPoint >= 1000) {
          points.push(snapshot());
          lastPoint = t;
        }
        if (t - t0 >= ms) resolve();
        else requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });
    const end = snapshot();
    return {
      start,
      end,
      elapsedMs: end.at - start.at,
      submitted: end.presented - start.presented,
      callbacks,
      skips,
      multiple,
      frames,
      points,
      longTasks: longTasks.filter((x) => x.at >= t0 && x.at <= end.at),
    };
  }
  window.__celDecision = {
    snapshot,
    sample,
    startRoots,
    stopRoots,
    dispose() {
      stopRoots();
      observer?.disconnect();
      delete window.__celDecision;
    },
  };
  return snapshot();
}
