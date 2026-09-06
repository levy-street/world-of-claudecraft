// The shader warm audit's host: does the GLSL a gate dry-assembles at its
// creation match the GLSL three links later, when the queue admits the
// piece? The worker warm-up will hand exactly those sources to a worker and
// hold the link until the worker resolved them, so a source that drifts
// between announcement and link is a link that waited for nothing and then
// paid cold. The classes and their meaning: shader_warm_audit_core.ts.
//
// Two halves. The announcement runs at gate creation (compile_gate_pieces.ts
// hands every piece's representative here before the queue sees the piece),
// through the same arms the link will use (program_sources.ts). The
// observation rides the live-program watch's own readouts
// (live_program_watch.ts), so the renderer gains no per-frame call site (its
// one hook is the out-of-band burst below, the census's): every program three
// minted since the last readout has its shader sources read back
// (`getShaderSource` returns the string the page handed `shaderSource`, held
// on the shader wrapper in Chromium, Firefox and WebKit alike, so it does not
// wait on a link in flight) and hashed against the announcement under its
// key. Mints before the reveal are classed apart: the boot lane links them
// under the curtain, where nothing waits on a worker.
//
// Off unless the page asked for performance evidence (`?perf` or
// `?perfTrace=1`, the flags the ledger and the beacon use). Under the flags
// the audit is NOT free, and it says so: the announcement runs three's
// assembly (its regex passes, on the order of a millisecond per program) on
// the frame that creates the gate, the link-time re-check runs it again
// inside the budgeted compile unit, and the observation hashes the sources
// it reads back. Every one of those costs is accumulated in `selfCostMs`, so
// a capture taken under the flags can subtract what the audit itself added
// to the frame and to the compile units the budget learns from. Each half
// is fail-soft: a throw counts as a failure and never reaches the gate.

import type * as THREE from 'three';
import { type CompileArmHost, setCompileArmObserver } from './compile_arms';
import { collectRootProgramSources, type ProgramSourceEntry } from './program_sources';
import {
  createShaderWarmAudit,
  expectProgramSource,
  observeMintedProgram,
  programSourceHash,
  type ShaderWarmAuditSummary,
  shaderWarmAuditSummary,
} from './shader_warm_audit_core';

/** The fields the observation reads off three's WebGLProgram. */
export interface MintedProgramEntry {
  id?: number;
  cacheKey?: string;
  name?: string;
  vertexShader?: unknown;
  fragmentShader?: unknown;
}

/** The renderer slice the observation sweeps: the live program list and the
 *  context that reads a shader's source back. */
export interface ShaderWarmAuditHost {
  info?: { programs?: MintedProgramEntry[] | null } | null;
  getContext?(): unknown;
}

interface ShaderSourceGl {
  getShaderSource(shader: unknown): string | null;
}

/** A key the link's own dry pass produced that no announcement carried: the
 *  state moved between the gate's creation and its link. */
export interface ShaderWarmAuditMovedKey {
  name: string;
  label: string;
  cacheKey: string;
}

/** What the audit itself cost, so a capture can subtract it. */
export interface ShaderWarmAuditSelfCost {
  /** Dry assembly at gate creation, on the requesting frame. */
  announceMs: number;
  /** The link-time re-check, inside the budgeted compile unit. */
  recheckMs: number;
  /** Source read-back and hashing, around the frame's render. */
  sweepMs: number;
}

/**
 * Local-only: this block never rides the perf beacon (perf_reporter.ts builds
 * its payload field by field), it is read by the probes on the machine.
 *
 * Two readings to keep in mind. A program released, evicted past the
 * retention limit and acquired again mints anew under a key that was linked
 * when its gate was announced (so never announced): it lands in `unexpected`
 * with no producer at fault. And a program minted and destroyed between two
 * sweeps is never seen, so `matched` and `unexpected` undercount by what
 * such churn hides; the observation quota carries a burst over later sweeps
 * rather than dropping it, and `backlogDropped` says when even that was not
 * enough. And a capture taken under `?diagnostics` runs the scene census: its
 * links are charged to `outOfBand`, so `unexpected` still reads as the gates'
 * own escapes.
 */
export interface ShaderWarmAuditSnapshot extends ShaderWarmAuditSummary {
  enabled: boolean;
  /** The dry compile is reachable (the three patch is in). */
  dryCompile: boolean;
  armed: boolean;
  /** Announced roots whose colour arm ran a link, by announcement label. */
  linkedLabels: string[];
  /** Keys that appeared at link time without an announcement. */
  keysMovedAtLink: number;
  movedSamples: ShaderWarmAuditMovedKey[];
  /** Announcements or re-checks that threw (counted, never rethrown). */
  failures: number;
  selfCostMs: ShaderWarmAuditSelfCost;
  /** Minted programs waiting for a later sweep's quota. */
  backlog: number;
  backlogDropped: number;
}

/** A parked mint and what the renderer was doing when it appeared. */
interface ParkedProgram {
  program: MintedProgramEntry;
  /** Minted inside an out-of-band burst (the scene census). */
  outOfBand: boolean;
}

const LINKED_LABEL_LIMIT = 512;
const MOVED_SAMPLE_LIMIT = 64;
/** Programs classed per sweep: a reveal that settles thirty programs in one
 *  frame is spread over a few frames instead of hashing them all at once. */
export const SHADER_WARM_AUDIT_SWEEP_QUOTA = 8;
const BACKLOG_LIMIT = 512;

function flagRequested(search: string): boolean {
  const params = new URLSearchParams(search);
  return params.has('perf') || params.get('perfTrace') === '1';
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : 0;
}

const state = {
  enabled: typeof location !== 'undefined' && flagRequested(location.search),
  armed: false,
  dryCompile: false,
  audit: createShaderWarmAudit(),
  /** three mints program ids monotonically, so everything at or below this
   *  id has been seen (classed, or parked in the backlog). */
  maxId: -1,
  backlog: [] as ParkedProgram[],
  backlogDropped: 0,
  /** The arms host of the LATEST announcement, so a renderer rebuilt after a
   *  graphics change is the one the re-check runs against. */
  armHost: null as CompileArmHost | null,
  observerInstalled: false,
  announcedRoots: new WeakSet<object>(),
  linkedLabels: new Set<string>(),
  keysMovedAtLink: 0,
  movedSamples: [] as ShaderWarmAuditMovedKey[],
  failures: 0,
  selfCostMs: { announceMs: 0, recheckMs: 0, sweepMs: 0 } as ShaderWarmAuditSelfCost,
};

/** The announcement: every program `root` would link, dry-assembled now,
 *  under the gate's own arms. A no-op without the flags or the patch; a
 *  throw is counted and swallowed, the gate never sees it. */
export function expectRootProgramSources(
  host: CompileArmHost,
  root: THREE.Object3D,
  atMs: number = now(),
  includeOffscreenVariant = false,
): number {
  if (!state.enabled) return 0;
  const started = now();
  let sources: ProgramSourceEntry[] = [];
  try {
    sources = collectRootProgramSources(host, root, includeOffscreenVariant);
  } catch {
    state.failures++;
  }
  state.selfCostMs.announceMs += now() - started;
  return announceProgramSources(host, root, sources, atMs);
}

/** The announcement for sources a caller already dry-assembled (the warm
 *  gate, shader_warm_gate.ts, assembles once for the worker and the audit
 *  alike). Same bookkeeping as expectRootProgramSources, no second dry pass. */
export function announceProgramSources(
  host: CompileArmHost,
  root: THREE.Object3D,
  sources: readonly ProgramSourceEntry[],
  atMs: number = now(),
): number {
  if (!state.enabled) return 0;
  const started = now();
  state.armHost = host;
  if (!state.observerInstalled) {
    state.observerInstalled = true;
    setCompileArmObserver(onArmLink);
  }
  state.announcedRoots.add(root);
  let announced = 0;
  try {
    if (sources.length > 0) state.dryCompile = true;
    const label = announcementLabel(root);
    for (const source of sources) {
      const verdict = expectProgramSource(
        state.audit,
        {
          cacheKey: source.cacheKey,
          name: source.name,
          hash: programSourceHash(source.vertex, source.fragment),
          hashSansName: programSourceHash(
            stripShaderName(source.vertex),
            stripShaderName(source.fragment),
          ),
        },
        label,
        atMs,
      );
      if (verdict === 'announced') announced++;
    }
  } catch {
    state.failures++;
  }
  state.selfCostMs.announceMs += now() - started;
  return announced;
}

/** The root's name, or its type plus its own material names when it is a
 *  bare carrier (a gate over one mesh is named by what it wears). */
function announcementLabel(root: THREE.Object3D): string {
  if (root.name) return root.name;
  const material = (root as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
  if (!material) return root.type;
  const names = (Array.isArray(material) ? material : [material])
    .map((item) => item.name)
    .filter((name) => name.length > 0);
  return names.length > 0 ? `${root.type}(${names.join('|')})` : root.type;
}

/** The link-time re-check: when an arm links an announced root, the same dry
 *  pass runs again at that instant, and every key it yields that no
 *  announcement carried is a key that MOVED between the gate's creation and
 *  its link (a light census, a render target, a texture slot, a hook). The
 *  colour arm alone: the shadow arm's twins ride the same dry pass. */
function onArmLink(root: THREE.Object3D, arm: 'color' | 'shadow'): void {
  if (arm !== 'color' || !state.armHost || !state.announcedRoots.has(root)) return;
  const started = now();
  try {
    const label = announcementLabel(root);
    if (state.linkedLabels.size < LINKED_LABEL_LIMIT) state.linkedLabels.add(label);
    for (const source of collectRootProgramSources(state.armHost, root)) {
      if (state.audit.expected.has(source.cacheKey)) continue;
      state.keysMovedAtLink++;
      if (state.movedSamples.length < MOVED_SAMPLE_LIMIT) {
        state.movedSamples.push({ name: source.name, label, cacheKey: source.cacheKey });
      }
    }
  } catch {
    state.failures++;
  }
  state.selfCostMs.recheckMs += now() - started;
}

const SHADER_NAME_LINE = /^#define SHADER_NAME .*$/gm;

/** The text without three's `#define SHADER_NAME <material name>` lines, the
 *  one part of the GLSL three's cache key does not carry. */
export function stripShaderName(glsl: string): string {
  return glsl.replace(SHADER_NAME_LINE, '');
}

function sourceOf(gl: ShaderSourceGl, shader: unknown): string {
  if (!shader) return '';
  try {
    return gl.getShaderSource(shader) ?? '';
  } catch {
    return '';
  }
}

/** Read one minted program back and class it. The name-stripped hash is
 *  computed only when the plain hash disagrees with an announcement: that is
 *  the one branch that consults it, and two more whole-string passes per
 *  program would otherwise ride every frame that minted one. */
function classMintedProgram(gl: ShaderSourceGl, parked: ParkedProgram): void {
  const program = parked.program;
  const cacheKey = program.cacheKey ?? '';
  const vertex = sourceOf(gl, program.vertexShader);
  const fragment = sourceOf(gl, program.fragmentShader);
  const hash = programSourceHash(vertex, fragment);
  const expectation = state.audit.expected.get(cacheKey);
  const hashSansName =
    expectation && expectation.hash !== hash
      ? programSourceHash(stripShaderName(vertex), stripShaderName(fragment))
      : undefined;
  observeMintedProgram(
    state.audit,
    // The fragment source rides along for attribution only: three names a
    // program after `material.name` alone, so a procedural pass that sets none
    // arrives here with an empty name and no announcing gate, and its own
    // uniforms plus its key's hook tail are what name it (the core's
    // `describeMintedProgram`). Nothing keeps the string.
    { cacheKey, name: program.name ?? '', hash, hashSansName, fragment },
    state.armed,
    parked.outOfBand,
  );
}

/** Park every program minted since the last readout, oldest first, and
 *  advance the mark. Returns how many were parked. */
function parkNewPrograms(programs: readonly MintedProgramEntry[], outOfBand: boolean): number {
  let maxId = state.maxId;
  let parked = 0;
  for (const program of programs) {
    const id = typeof program.id === 'number' ? program.id : -1;
    if (id <= state.maxId) continue;
    if (id > maxId) maxId = id;
    if (state.backlog.length >= BACKLOG_LIMIT) {
      state.backlogDropped++;
      continue;
    }
    state.backlog.push({ program, outOfBand });
    parked++;
  }
  state.maxId = maxId;
  return parked;
}

/**
 * An out-of-band burst BRACKET: `begin` before its first render, `end` once
 * it is over. What is unseen at the begin was minted before the burst and
 * keeps its own class; what is unseen at the end is the burst's own, not a
 * gate's escape.
 *
 * Both ends are needed because the burst runs in its own task, not inside a
 * frame: a gate's compileAsync prologue that minted programs between the last
 * present and the census's start would otherwise be found unseen at the end
 * and charged to the census, which is exactly the escape the audit exists to
 * name. The signal is the one the draw-stats exclusion already rides (the
 * census host's `discardOutOfBand`, `renderer.discardOutOfBandDraws`),
 * extended to the audit at the same hooks. Only the census comes here, never
 * the prewarm passes that share the draw-stats seam: their links ARE the
 * announced ones the audit exists to match. Returns how many mints this end
 * of the bracket parked.
 */
export function noteShaderWarmAuditOutOfBand(
  webgl: ShaderWarmAuditHost,
  phase: 'begin' | 'end' = 'end',
): number {
  if (!state.enabled) return 0;
  const programs = webgl.info?.programs;
  if (!programs) return 0;
  const started = now();
  const parked = parkNewPrograms(programs, phase === 'end');
  state.selfCostMs.sweepMs += now() - started;
  return parked;
}

/**
 * The observation: park every program minted since the last sweep, then
 * class up to `quota` of the parked ones, oldest first. The list is walked
 * whole, one id compare per entry: a length compare would miss a mint that
 * landed in the same interval as an eviction (the retention patch swaps the
 * last entry into the freed slot, so the length holds while the set moved).
 * A few hundred compares per frame, under the perf flags only. Returns how
 * many programs were classed.
 */
export function sweepShaderWarmAudit(
  webgl: ShaderWarmAuditHost,
  quota: number = SHADER_WARM_AUDIT_SWEEP_QUOTA,
): number {
  if (!state.enabled) return 0;
  const programs = webgl.info?.programs;
  if (!programs) return 0;
  const started = now();
  parkNewPrograms(programs, false);
  let classed = 0;
  if (state.backlog.length > 0) {
    const gl = webgl.getContext?.() as ShaderSourceGl | undefined;
    if (gl && typeof gl.getShaderSource === 'function') {
      const take = Math.min(quota, state.backlog.length);
      for (let i = 0; i < take; i++) classMintedProgram(gl, state.backlog[i]);
      state.backlog.splice(0, take);
      classed = take;
    }
  }
  state.selfCostMs.sweepMs += now() - started;
  return classed;
}

/** The reveal: from here a mint counts as live. Whatever was minted before
 *  is classed first, whole, as boot work. */
export function armShaderWarmAudit(webgl: ShaderWarmAuditHost): void {
  if (!state.enabled) return;
  sweepShaderWarmAudit(webgl, Number.POSITIVE_INFINITY);
  state.armed = true;
}

/** The renderer is going away: let go of its arms and stop listening to the
 *  links. The counts stay for the readout; the next renderer's first
 *  announcement binds its own arms. */
export function disposeShaderWarmAudit(): void {
  state.armHost = null;
  state.announcedRoots = new WeakSet<object>();
  if (state.observerInstalled) {
    state.observerInstalled = false;
    setCompileArmObserver(null);
  }
}

export function shaderWarmAuditEnabled(): boolean {
  return state.enabled;
}

export function shaderWarmAuditSnapshot(): ShaderWarmAuditSnapshot {
  return {
    enabled: state.enabled,
    dryCompile: state.dryCompile,
    armed: state.armed,
    ...shaderWarmAuditSummary(state.audit),
    linkedLabels: [...state.linkedLabels],
    keysMovedAtLink: state.keysMovedAtLink,
    movedSamples: state.movedSamples.slice(),
    failures: state.failures,
    selfCostMs: { ...state.selfCostMs },
    backlog: state.backlog.length,
    backlogDropped: state.backlogDropped,
  };
}

export function resetShaderWarmAuditForTest(search = ''): void {
  disposeShaderWarmAudit();
  state.enabled = flagRequested(search);
  state.armed = false;
  state.dryCompile = false;
  state.audit = createShaderWarmAudit();
  state.maxId = -1;
  state.backlog = [];
  state.backlogDropped = 0;
  state.linkedLabels.clear();
  state.keysMovedAtLink = 0;
  state.movedSamples = [];
  state.failures = 0;
  state.selfCostMs = { announceMs: 0, recheckMs: 0, sweepMs: 0 };
}
