// Strict decoders for Varkhul's Heroic Anvil meteors and Master's Assembly.
// Every nested row is validated independently so malformed rolling-deploy
// snapshots are dropped rather than partially rendered.

import type { ActiveVarkhulAnvilMeteorWarning } from '../sim/varkhul_anvil_meteors';
import {
  type ActiveVarkhulAssembly,
  type ActiveVarkhulMoltenCore,
  type ActiveVarkhulRune,
  type ActiveVarkhulRuneAssignment,
  VARKHUL_ASSEMBLY_RUNE_COUNT,
  type VarkhulAssemblyPhase,
  type VarkhulAssemblyRuneControl,
} from '../sim/varkhul_assembly';

const PHASES = new Set<VarkhulAssemblyPhase>([
  'idle',
  'adds',
  'cores',
  'convergence',
  'links',
  'stunned',
  'done',
]);

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return finite(value) && Number.isInteger(value) && value >= 0;
}

export function decodeVarkhulAnvilMeteors(value: unknown): ActiveVarkhulAnvilMeteorWarning[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row: unknown): ActiveVarkhulAnvilMeteorWarning[] => {
    if (!row || typeof row !== 'object') return [];
    const meteor = row as Record<string, unknown>;
    if (
      typeof meteor.id !== 'string' ||
      ![meteor.x, meteor.z, meteor.r, meteor.dur, meteor.rem, meteor.lead].every(finite) ||
      (meteor.r as number) <= 0 ||
      (meteor.dur as number) <= 0 ||
      (meteor.rem as number) <= 0 ||
      (meteor.lead as number) < 0
    ) {
      return [];
    }
    return [
      {
        id: meteor.id,
        x: meteor.x as number,
        z: meteor.z as number,
        radius: meteor.r as number,
        duration: meteor.dur as number,
        remaining: Math.min(meteor.rem as number, meteor.dur as number),
        warningLead: Math.min(meteor.lead as number, meteor.dur as number),
      },
    ];
  });
}

function decodeCore(value: unknown): ActiveVarkhulMoltenCore | null {
  if (!value || typeof value !== 'object') return null;
  const core = value as Record<string, unknown>;
  if (
    typeof core.id !== 'string' ||
    !finite(core.x) ||
    !finite(core.z) ||
    !(core.cid === null || nonNegativeInteger(core.cid)) ||
    !(core.del === 0 || core.del === 1)
  ) {
    return null;
  }
  return {
    id: core.id,
    x: core.x,
    z: core.z,
    carrierId: core.cid,
    delivered: core.del === 1,
  };
}

function decodeAssignment(value: unknown): ActiveVarkhulRuneAssignment | null {
  if (!value || typeof value !== 'object') return null;
  const assignment = value as Record<string, unknown>;
  if (
    !nonNegativeInteger(assignment.pid) ||
    !nonNegativeInteger(assignment.sym) ||
    assignment.sym >= VARKHUL_ASSEMBLY_RUNE_COUNT ||
    !(assignment.lock === 0 || assignment.lock === 1)
  ) {
    return null;
  }
  return {
    playerId: assignment.pid,
    symbol: assignment.sym,
    locked: assignment.lock === 1,
  };
}

function decodeRune(value: unknown): ActiveVarkhulRune | null {
  if (!value || typeof value !== 'object') return null;
  const rune = value as Record<string, unknown>;
  if (
    !nonNegativeInteger(rune.sym) ||
    rune.sym >= VARKHUL_ASSEMBLY_RUNE_COUNT ||
    ![rune.x, rune.z, rune.r, rune.ta, rune.ga].every(finite) ||
    (rune.r as number) <= 0 ||
    !(
      rune.ti === undefined ||
      (nonNegativeInteger(rune.ti) && rune.ti < VARKHUL_ASSEMBLY_RUNE_COUNT)
    ) ||
    !(rune.tr === undefined || (finite(rune.tr) && rune.tr > 0)) ||
    !(rune.oa === undefined || finite(rune.oa)) ||
    !(rune.cp === undefined || (finite(rune.cp) && rune.cp >= 0 && rune.cp <= 1)) ||
    !(rune.ap === undefined || (finite(rune.ap) && rune.ap >= 0 && rune.ap <= 1)) ||
    !(rune.c === 0 || rune.c === 1 || rune.c === 2) ||
    !(rune.al === 0 || rune.al === 1) ||
    !(rune.lock === 0 || rune.lock === 1) ||
    !(rune.or === undefined || rune.or === 0 || rune.or === 1)
  ) {
    return null;
  }
  const controls: readonly VarkhulAssemblyRuneControl[] = ['off', 'counterclockwise', 'clockwise'];
  return {
    symbol: rune.sym,
    x: rune.x as number,
    z: rune.z as number,
    radius: rune.r as number,
    trackIndex:
      (rune.ti as number | undefined) ?? (rune.sym as number) % VARKHUL_ASSEMBLY_RUNE_COUNT,
    trackRadius: (rune.tr as number | undefined) ?? (rune.r as number),
    ownerAngle:
      (rune.oa as number | undefined) ??
      Math.PI / VARKHUL_ASSEMBLY_RUNE_COUNT +
        ((rune.sym as number) * Math.PI * 2) / VARKHUL_ASSEMBLY_RUNE_COUNT,
    assignedPlayerId: null,
    orphaned: rune.or === 1,
    locked: rune.lock === 1,
    targetAngle: rune.ta as number,
    glyphAngle: rune.ga as number,
    control: controls[rune.c as number],
    controlProgress:
      (rune.cp as number | undefined) ?? (controls[rune.c as number] === 'off' ? 0 : 1),
    alignmentProgress: (rune.ap as number | undefined) ?? (rune.al === 1 ? 1 : 0),
    aligned: rune.al === 1,
  };
}

function uniqueRows(rows: readonly { playerId?: number; symbol: number }[]): boolean {
  const symbols = new Set<number>();
  const players = new Set<number>();
  for (const row of rows) {
    if (symbols.has(row.symbol)) return false;
    symbols.add(row.symbol);
    if (row.playerId === undefined) continue;
    if (players.has(row.playerId)) return false;
    players.add(row.playerId);
  }
  return true;
}

function decodeForgeBeam(value: unknown): ActiveVarkhulAssembly['forgeBeams'][number] | null {
  if (!value || typeof value !== 'object') return null;
  const beam = value as Record<string, unknown>;
  if (
    !(beam.i === 0 || beam.i === 1) ||
    ![beam.cx, beam.cz, beam.ix, beam.iz].every(finite) ||
    !(beam.a === undefined || beam.a === 0 || beam.a === 1) ||
    !(beam.w === undefined || beam.w === 0 || beam.w === 1) ||
    !(beam.bid === null || nonNegativeInteger(beam.bid))
  ) {
    return null;
  }
  return {
    index: beam.i,
    columnX: beam.cx as number,
    columnZ: beam.cz as number,
    impactX: beam.ix as number,
    impactZ: beam.iz as number,
    active: beam.a === undefined ? true : beam.a === 1,
    warning: beam.w === 1,
    blocked: beam.bid !== null,
    blockerId: beam.bid as number | null,
  };
}

function decodeInterceptBeam(value: unknown): ActiveVarkhulAssembly['interceptBeam'] | undefined {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object') return undefined;
  const beam = value as Record<string, unknown>;
  if (
    !nonNegativeInteger(beam.sid) ||
    !nonNegativeInteger(beam.tid) ||
    !(beam.bid === null || nonNegativeInteger(beam.bid)) ||
    ![beam.sx, beam.sz, beam.tx, beam.tz, beam.w, beam.dur, beam.rem].every(finite) ||
    !(beam.bx === null || finite(beam.bx)) ||
    !(beam.bz === null || finite(beam.bz)) ||
    (beam.bid !== null && (beam.bx === null || beam.bz === null)) ||
    (beam.bid === null && (beam.bx !== null || beam.bz !== null)) ||
    beam.sid === beam.tid ||
    beam.bid === beam.tid ||
    beam.bid === beam.sid ||
    (beam.w as number) <= 0 ||
    (beam.w as number) > 5 ||
    (beam.dur as number) <= 0 ||
    (beam.dur as number) > 15 ||
    (beam.rem as number) <= 0 ||
    (beam.rem as number) > (beam.dur as number)
  ) {
    return undefined;
  }
  return {
    sourceId: beam.sid as number,
    targetId: beam.tid as number,
    blockerId: beam.bid as number | null,
    sourceX: beam.sx as number,
    sourceZ: beam.sz as number,
    targetX: beam.tx as number,
    targetZ: beam.tz as number,
    blockerX: beam.bx as number | null,
    blockerZ: beam.bz as number | null,
    width: beam.w as number,
    duration: beam.dur as number,
    remaining: beam.rem as number,
  };
}

export function decodeVarkhulAssemblies(value: unknown): ActiveVarkhulAssembly[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row: unknown): ActiveVarkhulAssembly[] => {
    if (!row || typeof row !== 'object') return [];
    const assembly = row as Record<string, unknown>;
    if (
      !nonNegativeInteger(assembly.bossId) ||
      !(assembly.hc === undefined || assembly.hc === 0 || assembly.hc === 1) ||
      typeof assembly.phase !== 'string' ||
      !PHASES.has(assembly.phase as VarkhulAssemblyPhase) ||
      ![
        assembly.fx,
        assembly.fz,
        assembly.hp,
        assembly.mhp,
        assembly.oh,
        assembly.bw,
        assembly.mr,
        assembly.win,
        assembly.rem,
      ].every(finite) ||
      !(assembly.bm === undefined || (nonNegativeInteger(assembly.bm) && assembly.bm <= 3)) ||
      (assembly.hp as number) < 0 ||
      (assembly.mhp as number) <= 0 ||
      (assembly.oh as number) < 0 ||
      (assembly.oh as number) > 1 ||
      (assembly.bw as number) < 0 ||
      (assembly.mr as number) < 0 ||
      (assembly.win as number) < 0 ||
      (assembly.rem as number) < 0 ||
      !(assembly.aw === undefined || nonNegativeInteger(assembly.aw)) ||
      !(assembly.aws === undefined || nonNegativeInteger(assembly.aws)) ||
      !(assembly.ar === undefined || nonNegativeInteger(assembly.ar)) ||
      ((assembly.aw as number | undefined) ?? 0) > ((assembly.aws as number | undefined) ?? 0) ||
      !nonNegativeInteger(assembly.round) ||
      !nonNegativeInteger(assembly.rounds) ||
      (assembly.rounds as number) <= 0 ||
      !Array.isArray(assembly.cores) ||
      !Array.isArray(assembly.beams) ||
      !Array.isArray(assembly.assign) ||
      !Array.isArray(assembly.runes)
    ) {
      return [];
    }
    const cores = assembly.cores.map(decodeCore);
    const beams = assembly.beams.map(decodeForgeBeam);
    const interceptBeam = decodeInterceptBeam(assembly.ib);
    const assignments = assembly.assign.map(decodeAssignment);
    const runes = assembly.runes.map(decodeRune);
    if (
      cores.includes(null) ||
      beams.includes(null) ||
      assignments.includes(null) ||
      runes.includes(null) ||
      interceptBeam === undefined
    ) {
      return [];
    }
    const decodedAssignments = assignments as ActiveVarkhulRuneAssignment[];
    const decodedRunes = runes as ActiveVarkhulRune[];
    if (
      (interceptBeam !== null && interceptBeam.sourceId !== assembly.bossId) ||
      !uniqueRows(decodedAssignments) ||
      !uniqueRows(decodedRunes) ||
      decodedAssignments.length > VARKHUL_ASSEMBLY_RUNE_COUNT ||
      decodedRunes.length > VARKHUL_ASSEMBLY_RUNE_COUNT ||
      (assembly.bm === undefined &&
        assembly.phase === 'links' &&
        decodedRunes.length !== VARKHUL_ASSEMBLY_RUNE_COUNT)
    ) {
      return [];
    }
    const decodedBeams = beams as ActiveVarkhulAssembly['forgeBeams'];
    const beamIndexes = new Set(decodedBeams.map((beam) => beam.index));
    if (
      decodedBeams.length > 2 ||
      beamIndexes.size !== decodedBeams.length ||
      (decodedBeams.length !== 0 && decodedBeams.length !== 2) ||
      (assembly.bm === undefined && assembly.phase !== 'links' && decodedBeams.length !== 0)
    ) {
      return [];
    }
    const assignmentBySymbol = new Map(
      decodedAssignments.map((assignment) => [assignment.symbol, assignment]),
    );
    for (const rune of decodedRunes) {
      const assignment = assignmentBySymbol.get(rune.symbol);
      rune.assignedPlayerId = assignment?.playerId ?? null;
      if (rune.locked !== (assignment?.locked ?? false)) return [];
    }
    return [
      {
        bossId: assembly.bossId,
        difficulty:
          assembly.hc === 1 || (assembly.hc === undefined && (assembly.rounds as number) > 1)
            ? 'heroic'
            : 'normal',
        phase: assembly.phase as VarkhulAssemblyPhase,
        forgeX: assembly.fx as number,
        forgeZ: assembly.fz as number,
        forgeHp: Math.min(assembly.hp as number, assembly.mhp as number),
        forgeMaxHp: assembly.mhp as number,
        forgeOverheat: assembly.oh as number,
        forgeBeamActiveMask:
          (assembly.bm as number | undefined) ?? (assembly.phase === 'links' ? 3 : 0),
        forgeBeamWarmupRemaining: assembly.bw as number,
        forgeMeltdownRemaining: assembly.mr as number,
        addWave: (assembly.aw as number | undefined) ?? 0,
        addWaves: (assembly.aws as number | undefined) ?? 0,
        addsRemaining: (assembly.ar as number | undefined) ?? 0,
        forgeBeams: decodedBeams,
        interceptBeam,
        cores: cores as ActiveVarkhulMoltenCore[],
        deliveryWindowRemaining: assembly.win as number,
        assignments: decodedAssignments,
        runes: decodedRunes,
        round: assembly.round,
        rounds: assembly.rounds,
        remaining: assembly.rem as number,
      },
    ];
  });
}
