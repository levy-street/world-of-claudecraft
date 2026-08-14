// Rift run segmentation: one fight per FLOOR (the v1 granularity; rift boss
// pulls stay inside their floor's fight and still get boss-cast synthesis via
// mob tracking). The RiftInstance lifecycle drives everything: open on an
// active instance, roll floors on floorIndex changes, close on the outcome.
import type { RiftFrame } from './contract';
import { OpenFight, type PendingClose } from './fights';
import type { RiftInstanceView, SegmenterHost } from './types';

interface RiftState {
  instanceId: number;
  floorIndex: number;
  fight: OpenFight;
  memberCount: number;
}

export class RiftSegmenter {
  private readonly tracked = new Map<number, RiftState>();

  observe(host: SegmenterHost, tick: number, opened: OpenFight[], closing: PendingClose[]): void {
    if (!host.surfaceEnabled('rift')) return;
    const seen = new Set<number>();
    for (const inst of host.sim.riftInstances) {
      seen.add(inst.instanceId);
      const state = this.tracked.get(inst.instanceId);
      if (state === undefined) {
        if (inst.outcome === 'active') {
          const fight = this.openFloor(host, tick, inst);
          if (fight !== null) opened.push(fight);
        }
        continue;
      }
      if (inst.outcome !== 'active') {
        const outcome =
          inst.outcome === 'won' ? 'clear' : inst.outcome === 'lost' ? 'wipe' : 'abandon';
        closing.push({ fight: state.fight, outcome });
        this.tracked.delete(inst.instanceId);
        continue;
      }
      if (inst.floorIndex !== state.floorIndex) {
        // The completed floor closes as a clear; the next floor opens fresh.
        closing.push({ fight: state.fight, outcome: 'clear' });
        this.tracked.delete(inst.instanceId);
        const fight = this.openFloor(host, tick, inst);
        if (fight !== null) opened.push(fight);
        continue;
      }
      this.lateJoin(host, tick, inst, state);
    }
    for (const [instanceId, state] of this.tracked) {
      if (!seen.has(instanceId)) {
        closing.push({ fight: state.fight, outcome: 'abandon' });
        this.tracked.delete(instanceId);
      }
    }
  }

  private openFloor(host: SegmenterHost, tick: number, inst: RiftInstanceView): OpenFight | null {
    const participants = [...inst.memberIds]
      .map((pid) => host.resolveParticipant(pid))
      .filter((p): p is NonNullable<typeof p> => p !== null);
    if (participants.length === 0) return null;
    const fight = new OpenFight(
      {
        fightId: host.nextFightId(),
        surface: 'rift',
        key: 'rift',
        difficulty: inst.tier,
        segment: 'floor',
        groupType: 'party',
        startedTick: tick,
        rift: this.frame(host, inst),
        participants,
      },
      host.sink,
      host.counters,
    );
    if (inst.bossId !== null) {
      fight.mobIds.add(inst.bossId);
      const boss = host.sim.entities.get(inst.bossId);
      if (boss !== undefined) fight.noteActor(inst.bossId, boss.name);
    }
    this.tracked.set(inst.instanceId, {
      instanceId: inst.instanceId,
      floorIndex: inst.floorIndex,
      fight,
      memberCount: inst.memberIds.size,
    });
    return fight;
  }

  /** Party membership can change mid-run; add new members as late joins. */
  private lateJoin(
    host: SegmenterHost,
    tick: number,
    inst: RiftInstanceView,
    state: RiftState,
  ): void {
    if (inst.memberIds.size === state.memberCount) return;
    for (const pid of inst.memberIds) {
      if (state.fight.hasEntity(pid)) continue;
      const p = host.resolveParticipant(pid);
      if (p !== null) state.fight.addLateJoin(tick, p);
    }
    state.memberCount = inst.memberIds.size;
  }

  private frame(host: SegmenterHost, inst: RiftInstanceView): RiftFrame {
    let portalZone = '';
    if (inst.portalId !== null) {
      for (const portal of host.sim.naturalRiftPortals) {
        if (portal.id === inst.portalId) {
          portalZone = portal.zoneName;
          break;
        }
      }
    }
    return {
      rank: inst.tier ?? 'dev',
      baseLevel: inst.baseLevel,
      floor: inst.floorIndex,
      portalZone,
    };
  }
}
