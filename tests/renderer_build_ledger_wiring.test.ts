// The renderer's PRODUCER side of the CPU build ledger (build_ledger_core is
// write-only telemetry: nothing records into it unless a producer times its
// own build) and the arrival mark: the zone feature builders under
// `zone:features:<name>`, every entity view under `view:<class>`, the lazy
// mount under `view:mount`, the sub-span sink, the per-frame hitch sample
// (the start-of-sync reading and the aligned end-of-sync sample) and the
// perfStats() readouts. Behavior
// runs on the real prototype methods (the renderer_look_pieces_hold.test.ts
// harness); the frame-loop wiring is pinned in the source.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { AssembleOptions } from '../src/render/characters';
import { Renderer } from '../src/render/renderer';
import type { Entity } from '../src/sim/types';

const source = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');

function entity(id: number, kind: Entity['kind'], templateId = 'warrior'): Entity {
  return {
    id,
    kind,
    templateId,
    targetId: null,
    pos: { x: id, y: 0, z: 0 },
    hp: 1,
    maxHp: 1,
    dead: false,
  } as unknown as Entity;
}

interface LedgerRenderer {
  createView(e: Entity, opts?: AssembleOptions): void;
  timedBuild<T>(name: string, build: (seed: number) => T): T;
}

function rendererWithLedger(selfId: number) {
  const record = vi.fn();
  const views = new Map<number, { visual: { modularLook: unknown } | null }>();
  const renderer = Object.create(Renderer.prototype) as Record<string, unknown> & LedgerRenderer;
  renderer.sim = { player: { id: selfId }, cfg: { seed: 4242 } };
  renderer.views = views;
  renderer.buildLedger = { record };
  return { renderer, record, views };
}

describe('createView records one `view:<class>` build per entity view', () => {
  it('names the class from the visual the build left in the view map', () => {
    const { renderer, record, views } = rendererWithLedger(1);
    const composed = entity(2, 'player');
    const rig = entity(3, 'mob', 'forest_wolf');
    const object = entity(4, 'object', 'mailbox');
    const self = entity(1, 'player');
    const buildView = vi.fn((e: Entity) => {
      if (e.id === composed.id) views.set(e.id, { visual: { modularLook: {} } });
      if (e.id === rig.id) views.set(e.id, { visual: { modularLook: null } });
      if (e.id === object.id) views.set(e.id, { visual: null });
      if (e.id === self.id) views.set(e.id, { visual: { modularLook: {} } });
    });
    renderer.buildView = buildView;
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValueOnce(1000).mockReturnValueOnce(1007.5);
    renderer.createView(composed, { deferDecals: true });
    expect(buildView).toHaveBeenCalledWith(composed, { deferDecals: true });
    // the ms is the build's own span, the timestamp its start
    expect(record).toHaveBeenLastCalledWith('view:composed', 7.5, 1000);
    now.mockRestore();
    renderer.createView(rig);
    expect(record).toHaveBeenLastCalledWith('view:rig', expect.any(Number), expect.any(Number));
    renderer.createView(object);
    expect(record).toHaveBeenLastCalledWith('view:object', expect.any(Number), expect.any(Number));
    renderer.createView(self);
    expect(record).toHaveBeenLastCalledWith('view:self', expect.any(Number), expect.any(Number));
    expect(record).toHaveBeenCalledTimes(4);
  });

  it('records nothing when the build left no view (the fail-soft miss is not a build)', () => {
    const { renderer, record } = rendererWithLedger(1);
    renderer.buildView = vi.fn();
    renderer.createView(entity(2, 'mob', 'forest_wolf'));
    expect(record).not.toHaveBeenCalled();
  });
});

describe('timedBuild records one `zone:features:<name>` build with the world seed', () => {
  it('passes the seed, returns the built value, and records the span under the name', () => {
    const { renderer, record } = rendererWithLedger(1);
    const built = { animated: [] };
    const build = vi.fn((_seed: number) => built);
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValueOnce(500).mockReturnValueOnce(512);
    expect(renderer.timedBuild('buildEmberFeatures', build)).toBe(built);
    expect(build).toHaveBeenCalledWith(4242);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith('zone:features:buildEmberFeatures', 12, 500);
    now.mockRestore();
  });
});

describe('the ledger producers and the arrival mark are wired in the renderer (source pin)', () => {
  it('times the zone feature builders through timedBuild', () => {
    expect(source).toContain(
      "this.emberFeatures = this.timedBuild('buildEmberFeatures', buildEmberFeatures);",
    );
    expect(source).toContain(
      "this.realmFlora = this.timedBuild('buildRealmFlora', buildRealmFlora);",
    );
    expect(source).toContain("this.frostSky = this.timedBuild('buildFrostSky', buildFrostSky);");
    // every timedBuild call names a feature builder; a bare builder call
    // beside them would be an untimed zone step
    const timed = source.match(/this\.timedBuild\('(build\w+)', (build\w+)\)/g) ?? [];
    expect(timed.length).toBeGreaterThanOrEqual(12);
    for (const call of timed) {
      const [, name, fn] = /this\.timedBuild\('(build\w+)', (build\w+)\)/.exec(call) ?? [];
      expect(name).toBe(fn);
    }
    expect(source).toContain(
      'this.buildLedger.record(`zone:features:${name}`, performance.now() - started, started);',
    );
  });

  it('records every entity view under its class and the lazy mount under view:mount', () => {
    const create = source.slice(
      source.indexOf('private createView(e: Entity, opts?: AssembleOptions): void {'),
      source.indexOf('private buildView(e: Entity, opts?: AssembleOptions): void {'),
    );
    expect(create).toContain('const started = performance.now();');
    expect(create).toContain('this.buildView(e, opts);');
    expect(create).toContain('const kind = viewBuildClass(e, this.sim.player.id, view.visual);');
    expect(create).toContain(
      'this.buildLedger.record(`view:${kind}`, performance.now() - started, started);',
    );
    expect(source).toContain(
      "this.buildLedger.record('view:mount', performance.now() - mountStarted, mountStarted);",
    );
    expect(source).toContain(
      'const mountStarted = performance.now();\n          v.mountVisual = createMountVisual(mountSpec.visualKey);',
    );
  });

  it('routes the view-part sub-spans into the ledger from the constructor', () => {
    expect(source).toContain('setBuildSpanSink(this.buildLedger.record);');
  });

  it('reads the ledger spend and the counters at the TOP of sync, then opens the ledger frame', () => {
    // The start reading (hitch_frame_align_core atStart) comes before any view
    // creation and before the ledger frame turns over, so what it reads is the
    // previous callback plus the gap: the span this callback's dt measures.
    const syncAt = source.indexOf('  sync(\n    alpha: number,');
    expect(syncAt).toBeGreaterThan(-1);
    const prologue = source.slice(syncAt, source.indexOf('this.createRequiredViews(p,', syncAt));
    expect(prologue).toContain(
      '    if (this.hitchLogEnabled) {\n' +
        '      const spend = this.buildLedger.frameSpend();\n' +
        '      this.hitchAligner.atStart(\n' +
        '        this.webgl.info.programs?.length ?? 0,\n' +
        '        this.webgl.info.memory.textures,\n' +
        '        spend.zoneMs,\n' +
        '        spend.viewMs,\n' +
        '      );\n' +
        '    }\n' +
        '    this.buildLedger.beginFrame();',
    );
    // one ledger frame boundary in the whole renderer, in the sync prologue
    expect(source.match(/this\.buildLedger\.beginFrame\(\);/g)).toHaveLength(1);
    expect(source.indexOf('this.buildLedger.beginFrame();')).toBeGreaterThan(syncAt);
  });

  it('closes the callback with the aligned sample: its own outcome, the heap and dt through the aligner', () => {
    expect(source).toContain(
      '      const sample = this.hitchAligner.atEnd(\n' +
        '        afterSubmit,\n' +
        '        Math.min(250, Math.max(0, dt * 1000)),\n' +
        '        framePhaseMs.submit,\n' +
        '        createdViews,\n' +
        '        framePhaseMs.total,\n' +
        '        usedJsHeapMb(),\n' +
        '      );\n' +
        '      if (this.hitchSkipNextFrame) this.hitchSkipNextFrame = false;\n' +
        '      else if (sample) this.hitchTracker.frame(sample);',
    );
    // the tracker is fed the aligner's output only, never a raw end-of-frame read
    expect(source.match(/this\.hitchTracker\.frame\(/g)).toHaveLength(1);
    expect(source).not.toContain('sample.programs = this.webgl.info.programs');
    // switching the log off resets both, so a later switch-on baselines afresh
    expect(source).toContain('      this.hitchTracker.reset();\n      this.hitchAligner.reset();');
  });

  it('marks a teleport arrival from the player position and the candidate count each frame', () => {
    expect(source).toContain(
      "import { arrivalCoverActive, noteArrivalIfTeleported } from './arrival_cover';",
    );
    expect(source).toContain(
      'noteArrivalIfTeleported(p.pos.x, p.pos.z, this.viewCandidates.length);',
    );
    expect(source.match(/noteArrivalIfTeleported\(/g)).toHaveLength(1);
  });

  it('serves the ledger snapshot and the zone streaming stats through perfStats()', () => {
    const start = source.indexOf('perfStats(): RendererPerfStats {');
    const stats = source.slice(start, source.indexOf('\n  }', start));
    expect(stats).toContain('buildLedger: this.buildLedger.snapshot(),');
    expect(stats).toContain('zoneStreaming: this.zoneStreamingStats(),');
  });
});
