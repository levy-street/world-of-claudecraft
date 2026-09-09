// Browser-local scenario helpers. They exercise the actual offline Sim and
// renderer; only travel, invulnerability and mechanic scheduling are staged.
export async function prepareRoachKingScenario(page, seed = 42) {
  return page.evaluate(async (riftSeed) => {
    const { descendRift } = await import('/src/sim/rift/runs.ts');
    const { sim, input } = window.__game;
    sim.setPlayerLevel(20);
    sim.player.profilerInvulnerable = true;
    sim.player.autoAttack = false;
    sim.enterRift(riftSeed, 28, sim.playerId);
    const inst = sim.riftInstances.find((candidate) => candidate.partyKey !== null);
    if (!inst) throw new Error('Rift entry failed');
    while (inst.floorIndex < inst.floorCount - 1) {
      inst.descentOpen = true;
      descendRift(sim.ctx, sim.playerId);
    }
    const boss = sim.entities.get(inst.bossId);
    if (boss?.templateId !== 'rift_boss_asmon') throw new Error('Final guardian is not Asmon');
    for (const id of [...inst.mobIds]) if (id !== boss.id) sim.ctx.dropEntity(id);
    inst.mobIds = [boss.id];
    boss.hostile = false;
    boss.inCombat = false;
    boss.facing = 0;
    boss.prevFacing = 0;
    const player = sim.player;
    player.pos = { ...boss.pos, z: boss.pos.z + 9 };
    player.prevPos = { ...player.pos };
    player.facing = Math.PI;
    player.prevFacing = Math.PI;
    player.vx = 0;
    player.vz = 0;
    player.targetId = boss.id;
    input.camYaw = Math.PI;
    input.camPitch = 0.85;
    input.camDist = 20;
    const emit = sim.emit.bind(sim);
    window.__roachSmokeEvents = [];
    sim.emit = (event) => {
      if (event.ability?.startsWith('rift_asmon') || event.type.startsWith('riftDeathZone')) {
        window.__roachSmokeEvents.push(structuredClone(event));
      }
      emit(event);
    };
    window.__roachSmokeTick = sim.tick.bind(sim);
    return {
      bossId: boss.id,
      seed: inst.seed,
      floor: inst.floorIndex,
      floors: inst.floorCount,
      bossPosition: { ...boss.pos },
      scale: boss.scale,
    };
  }, seed);
}

export async function pauseRoachScenario(page, paused) {
  await page.evaluate((hold) => {
    window.__game.sim.tick = hold ? () => [] : window.__roachSmokeTick;
  }, paused);
}

export async function beginRoachMechanic(page, bossId, phase) {
  await page.evaluate(
    async (id, name) => {
      const { sim } = window.__game;
      const { addThreat } = await import('/src/sim/threat.ts');
      const { createRoachKingState } = await import('/src/sim/rift/roach_king.ts');
      const boss = sim.entities.get(id);
      boss.hostile = true;
      boss.inCombat = true;
      boss.aiState = 'attack';
      boss.aggroTargetId = sim.playerId;
      boss.targetId = sim.playerId;
      addThreat(boss, sim.playerId, 1000);
      boss.roachKing ??= createRoachKingState();
      boss.roachKing.nextCast = 0;
      if (name === 'tribute') boss.roachKing.sequence = 1;
      else if (name === 'filth') boss.roachKing.sequence = 2;
      else boss.roachKing.sequence = 0;
      if (name === 'coronation') boss.hp = Math.floor(boss.maxHp * 0.49);
      sim.tick = window.__roachSmokeTick;
    },
    bossId,
    phase,
  );
}

export async function finishRoachMechanic(page, bossId, natural = false) {
  await page.evaluate(
    (id, useFullCast) => {
      if (!useFullCast) window.__game.sim.entities.get(id).castRemaining = 0.05;
      window.__game.sim.tick = window.__roachSmokeTick;
    },
    bossId,
    natural,
  );
  await page.waitForFunction(
    (id) => !window.__game.sim.entities.get(id).castingAbility,
    { timeout: 30000 },
    bossId,
  );
  await pauseRoachScenario(page, true);
  // Fast-forwarding the sim cast preserves its actual impact event, while
  // transient render lifetimes finish naturally before the next mechanic.
  await page.waitForFunction(() => window.__game.renderer.mageGroundFx.runes.length === 0, {
    timeout: 15000,
  });
}

export async function roachScenarioSnapshot(page, bossId) {
  return page.evaluate((id) => {
    const { sim, renderer } = window.__game;
    const boss = sim.entities.get(id);
    const view = renderer.views.get(id);
    const stats = renderer.perfStats();
    const actions = [...(view?.visual?.actions?.entries() ?? [])]
      .filter(([, action]) => action.isScheduled() && action.getEffectiveWeight() > 0)
      .map(([name, action]) => ({
        name,
        weight: action.getEffectiveWeight(),
        time: action.time,
        duration: action.getClip().duration,
        paused: action.paused,
      }));
    const adds = boss.summonedIds.map((addId) => {
      const add = sim.entities.get(addId);
      const addView = renderer.views.get(addId);
      return {
        id: addId,
        templateId: add?.templateId,
        dead: add?.dead,
        visualKey: addView?.visualKey,
        visible: addView?.group.visible,
      };
    });
    const zones = sim.riftBossDeathZones();
    let corpseBounds = null;
    if (boss.dead && view?.visual?.modelWrap) {
      let minY = Infinity;
      let maxY = -Infinity;
      view.visual.modelWrap.updateWorldMatrix(true, true);
      view.visual.modelWrap.traverse((mesh) => {
        if (!mesh.isSkinnedMesh) return;
        mesh.skeleton.update();
        const point = mesh.position.clone();
        for (let index = 0; index < mesh.geometry.attributes.position.count; index++) {
          mesh.getVertexPosition(index, point);
          mesh.localToWorld(point);
          minY = Math.min(minY, point.y);
          maxY = Math.max(maxY, point.y);
        }
      });
      corpseBounds = { minY, maxY, simY: boss.pos.y, viewY: view.group.position.y };
    }
    return {
      boss: {
        id,
        hp: boss.hp,
        maxHp: boss.maxHp,
        casting: boss.castingAbility,
        remaining: boss.castRemaining,
        auras: boss.auras.map((aura) => aura.id),
        visualKey: view?.visualKey,
        visible: view?.group.visible,
        compilePending: view?.compilePending || view?.visualCompilePending,
        actions,
        height: view?.height,
        scale: boss.scale,
        farMeshVisible: view?.visual?.farMesh?.visible,
        modelVisible: view?.visual?.modelWrap?.visible,
        corpseBounds,
        pooledGroundY: renderer.abilityVfxFx.groundYAt(boss.pos.x, boss.pos.z),
        warningGroundY: renderer.mageGroundFx.groundY(boss.pos.x, boss.pos.z),
      },
      adds,
      zones,
      groundRunes: renderer.mageGroundFx.runes.map((rune) => ({
        elapsed: rune.elapsed,
        duration: rune.duration,
        visible: rune.group.visible,
        rings: rune.group.children
          .filter((child) => child.name.includes('outer-ring'))
          .map((child) => ({ opacity: child.material.opacity, visible: child.visible })),
      })),
      documentVisibility: document.visibilityState,
      gpu: {
        adapter: stats.glRenderer,
        vendor: stats.glVendor,
        calls: stats.calls,
        programs: stats.programs,
        geometries: stats.geometries,
        textures: stats.textures,
        tier: stats.tier,
        viewport: { width: stats.width, height: stats.height, pixelRatio: stats.pixelRatio },
        renderScale: stats.effectiveRenderScale,
        gpuPrep: stats.gpuPrep,
        contextLost: stats.contextLost,
        prewarmResume: stats.prewarm?.resume,
      },
      effects: window.__game.abilityVfxStats?.() ?? null,
      events: window.__roachSmokeEvents,
    };
  }, bossId);
}

// Observe normal renderer-driven locomotion, melee and a full cast. Simulation
// time is never skipped inside this window; screenshot staging stays separate.
export async function exerciseRoachNaturalMotion(page, bossId) {
  const saved = await page.evaluate(async (id) => {
    const { sim } = window.__game;
    const { addThreat } = await import('/src/sim/threat.ts');
    const { createRoachKingState } = await import('/src/sim/rift/roach_king.ts');
    const boss = sim.entities.get(id);
    const previous = { bossPos: { ...boss.pos }, playerPos: { ...sim.player.pos } };
    sim.player.pos = { ...boss.pos, z: boss.pos.z + 15 };
    sim.player.prevPos = { ...sim.player.pos };
    boss.hostile = true;
    boss.inCombat = true;
    boss.aiState = 'attack';
    boss.aggroTargetId = sim.playerId;
    boss.targetId = sim.playerId;
    boss.swingTimer = 0;
    boss.roachKing ??= createRoachKingState();
    boss.roachKing.nextCast = 100;
    addThreat(boss, sim.playerId, 1000);
    sim.tick = window.__roachSmokeTick;
    return previous;
  }, bossId);
  await new Promise((resolve) => setTimeout(resolve, 8000));
  await page.evaluate((id) => {
    const boss = window.__game.sim.entities.get(id);
    boss.roachKing.sequence = 0;
    boss.roachKing.nextCast = 0;
  }, bossId);
  await page.waitForFunction(
    (id) => !!window.__game.sim.entities.get(id)?.castingAbility,
    { timeout: 15000 },
    bossId,
  );
  await page.waitForFunction(
    (id) => !window.__game.sim.entities.get(id)?.castingAbility,
    { timeout: 15000 },
    bossId,
  );
  await pauseRoachScenario(page, true);
  await page.evaluate(
    (id, previous) => {
      const { sim } = window.__game;
      const boss = sim.entities.get(id);
      boss.pos = previous.bossPos;
      boss.prevPos = { ...boss.pos };
      boss.vx = 0;
      boss.vz = 0;
      boss.hostile = false;
      boss.inCombat = false;
      boss.aggroTargetId = null;
      boss.targetId = null;
      sim.player.pos = previous.playerPos;
      sim.player.prevPos = { ...sim.player.pos };
    },
    bossId,
    saved,
  );
  await page.waitForFunction(() => window.__game.renderer.mageGroundFx.runes.length === 0, {
    timeout: 15000,
  });
}
