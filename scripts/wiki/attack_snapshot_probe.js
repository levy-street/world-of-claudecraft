// In-page probe for scripts/wiki/render_attack_snapshots.mjs. Injected into the REAL
// offline client (the Vite dev build of index.html) after the world boots; it never
// touches game source. It wraps the live Sim's tick() on the instance (the game loop
// calls offlineSim.tick() through the property, so an own-property wrapper sees every
// tick) and, after each real tick, checks whether one of the attacks still wanted has
// reached its best visible moment:
//   - a cast-bar attack: some entity's cast label is the attack's castId, or folds equal
//     to its wiki name through the client's own targetCastDisplayName, and the bar is past
//     its fraction;
//   - an instant attack (aoePulse, stomp): its cadence timer on the boss reset (it fired),
//     then IMPACT_TICKS more ticks so the nova or slam is on screen; a rift-stamped
//     carrier's windup ring counts too;
//   - an expected attack (the driver just forced it with a /dev trigger): its bar as
//     above, else a fixed number of ticks after the trigger.
// At that moment it FREEZES the sim (the wrapper returns no events and does not advance),
// so the telegraph holds still while the renderer keeps drawing, and records the catch.
// The driver frames and screenshots it, then calls release() to resume the fight.
// boost(n) runs n extra ticks per interval so slow software-GL frames do not stretch a
// long fight; their events go to hud.handleEvents exactly as the game loop sends them.
(() => {
  const DEFAULT_FRACTION = 0.5;
  const IMPACT_TICKS = 2;
  const game = window.__game;
  const world = game.world;
  const realTick = world.tick.bind(world);
  const fold = (s) =>
    String(s ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  const probe = {
    bossId: null,
    attacks: [],
    done: new Set(),
    frozen: false,
    caught: null,
    expected: null,
    pending: null,
    labels: {},
    castName: (label) => label,
    prevTimers: {},
    ticks: 0,
    boostTimer: null,
    arm(bossId, attacks, done) {
      this.bossId = bossId;
      this.attacks = attacks;
      this.done = new Set(done);
      this.frozen = false;
      this.caught = null;
      this.pending = null;
      this.expected = null;
      this.prevTimers = {};
      this.labels = {};
    },
    disarm() {
      this.bossId = null;
      this.frozen = false;
      this.pending = null;
      this.expected = null;
    },
    expect(name, castId, ticks, fraction) {
      this.expected = {
        name,
        castId: castId ?? null,
        ticks: ticks ?? null,
        fraction: fraction ?? DEFAULT_FRACTION,
        seen: false,
      };
    },
    release(done) {
      if (done) this.done.add(done);
      this.caught = null;
      this.frozen = false;
    },
    boost(n) {
      clearInterval(this.boostTimer);
      this.boostTimer = null;
      if (!n) return;
      this.boostTimer = setInterval(() => {
        for (let i = 0; i < n && !this.frozen; i++) {
          const events = world.tick();
          if (events.length) game.hud.handleEvents(events);
        }
      }, 30);
    },
    status() {
      const boss = this.bossId === null ? null : world.entities.get(this.bossId);
      return {
        frozen: this.frozen,
        caught: this.caught,
        ticks: this.ticks,
        expected: this.expected ? this.expected.name : null,
        labels: this.labels,
        boss: boss
          ? {
              hp: boss.hp,
              maxHp: boss.maxHp,
              dead: boss.dead,
              x: boss.pos.x,
              y: boss.pos.y,
              z: boss.pos.z,
              cast: boss.castingAbility,
            }
          : null,
      };
    },
    /** Every live entity casting `match` (castId or folded display name), best first. */
    caster(match) {
      for (const e of this.active) if (match(e.castingAbility)) return e;
      return null;
    },
    active: [],
    matches(attack, label) {
      return attack.castId === label || attack.fold === fold(this.castName(label));
    },
    progress(e) {
      return e.castTotal > 0 ? 1 - e.castRemaining / e.castTotal : 1;
    },
    check() {
      if (this.bossId === null || this.frozen) return;
      const boss = world.entities.get(this.bossId);
      // Every non-player cast in progress, the boss first (a hydra head, a jaguar or a
      // goadsmith can carry the boss's attack bar too).
      this.active = [];
      if (boss && !boss.dead && boss.castingAbility) this.active.push(boss);
      for (const e of world.entities.values()) {
        if (e === boss || e.dead || !e.castingAbility || e.kind === 'player') continue;
        this.active.push(e);
      }
      for (const e of this.active)
        if (!this.labels[e.castingAbility])
          this.labels[e.castingAbility] = this.castName(e.castingAbility);
      const ex = this.expected;
      if (ex) {
        const a = { castId: ex.castId, fold: fold(ex.name) };
        const caster =
          ex.castId || ex.ticks === null ? this.caster((l) => this.matches(a, l)) : null;
        if (caster) {
          ex.seen = true;
          if (this.progress(caster) >= ex.fraction) {
            this.expected = null;
            this.freeze(ex.name, 'cast');
          }
          return;
        }
        if (ex.seen && ex.castId) {
          // The bar ended before its fraction (a short cast): catch the impact.
          this.expected = null;
          this.freeze(ex.name, 'cast-end');
          return;
        }
        if (ex.ticks !== null) {
          ex.ticks--;
          if (ex.ticks <= 0) {
            this.expected = null;
            this.freeze(ex.name, 'timed');
          }
        }
        return;
      }
      if (this.pending) {
        this.pending.ticks--;
        if (this.pending.ticks <= 0) {
          this.freeze(this.pending.name, 'impact');
          this.pending = null;
        }
        return;
      }
      for (const a of this.attacks) {
        if (this.done.has(a.name)) continue;
        if (a.castId || a.fold) {
          const caster = this.caster((l) => this.matches(a, l));
          if (caster && this.progress(caster) >= (a.fraction ?? DEFAULT_FRACTION)) {
            this.freeze(a.name, 'cast');
            return;
          }
        }
        if (!a.timer || !boss || boss.dead) continue;
        const now = boss[a.timer];
        const prev = this.prevTimers[a.timer];
        this.prevTimers[a.timer] = now;
        const windup = a.windup ? boss[a.windup] : 0;
        if (windup > 0 && windup < 0.6) {
          this.freeze(a.name, 'windup');
          return;
        }
        if (typeof prev === 'number' && typeof now === 'number' && now > prev + 1 && !windup) {
          this.pending = { name: a.name, ticks: IMPACT_TICKS };
          return;
        }
      }
    },
    freeze(name, how) {
      this.frozen = true;
      this.caught = { name, how, tick: this.ticks };
    },
  };
  world.tick = () => {
    if (probe.frozen) return [];
    const events = realTick();
    probe.ticks++;
    probe.check();
    return events;
  };
  window.__attackProbe = probe;
})();
