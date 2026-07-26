// Development-only HUD matrix state. Activated with ?hudqa=3, ?hudqa=5, or
// ?hudqa=10 in an offline session so responsive screenshots exercise the real
// Sim -> Hud -> painter path instead of hand-built mock markup.

import type { Sim } from '../sim/sim';
import { type Aura, type Entity, xpForLevel } from '../sim/types';

export interface HudVisualQaHost {
  update(dt?: number): void;
  closeAll(): void;
}

export interface HudVisualQaResult {
  partySize: 3 | 5 | 10;
  raid: boolean;
  targetId: number | null;
  targetOfTargetId: number | null;
}

export function hudVisualQaPartySize(search: string): 3 | 5 | 10 | null {
  const raw = new URLSearchParams(search).get('hudqa');
  return raw === '3' ? 3 : raw === '5' ? 5 : raw === '10' ? 10 : null;
}

/** Whether a visual-QA capture should retain the desktop HUD at a touch viewport. */
export function hudVisualQaDesktop(search: string): boolean {
  return new URLSearchParams(search).has('hudqaDesktop');
}

/** Seed a stable, populated mobile HUD state for human screenshot review. */
export function applyHudVisualQaScenario(
  sim: Sim,
  hud: HudVisualQaHost,
  partySize: 3 | 5 | 10,
): HudVisualQaResult {
  document.body.classList.add('game-active', 'hud-visual-qa');

  sim.setPlayerLevel(19);
  sim.xp = Math.round(xpForLevel(19) * 0.33);
  const player = sim.player;
  player.maxHp = 1200;
  player.hp = 792; // 66%: visibly damaged without entering the danger state.

  const roster = [
    ['Brightoak', 'druid'],
    ['Dawnshield', 'paladin'],
    ['Stormcaller', 'shaman'],
    ['Nightblade', 'rogue'],
    ['Emberlyn', 'mage'],
    ['Gravesong', 'warlock'],
    ['Ironward', 'warrior'],
    ['Moonarrow', 'hunter'],
    ['Lightwell', 'priest'],
  ] as const;
  const memberIds = roster.slice(0, partySize - 1).map(([name, cls], index) => {
    const pid = sim.addPlayer(cls, name);
    sim.setPlayerLevel(19, pid);
    const member = sim.entities.get(pid);
    if (member) {
      member.maxHp = 1000;
      member.hp = [910, 670, 430, 780, 240, 860, 550, 720, 360][index] ?? 750;
      member.pos = {
        x: player.pos.x + (index % 3) * 1.5 - 1.5,
        y: player.pos.y,
        z: player.pos.z + 2 + Math.floor(index / 3) * 1.5,
      };
      member.prevPos = { ...member.pos };
    }
    return pid;
  });

  // A normal party caps at five. Build that supported shape first, convert it,
  // then add group two for the ten-player raid screenshot.
  for (const pid of memberIds.slice(0, 4)) {
    sim.partyInvite(pid);
    sim.partyAccept(pid);
  }
  if (partySize === 10) {
    sim.convertPartyToRaid();
    for (const pid of memberIds.slice(4)) {
      sim.partyInvite(pid);
      sim.partyAccept(pid);
    }
  }

  let targetId: number | null = null;
  for (const entity of sim.entities.values()) {
    if (entity.kind !== 'mob' || !entity.hostile || entity.dead) continue;
    targetId = entity.id;
    entity.maxHp = 900;
    entity.hp = 297; // 33%: exercises the target danger treatment.
    entity.aggroTargetId = memberIds[0] ?? player.id;
    break;
  }
  sim.targetEntity(targetId);

  // The offline boot sequence performs one late state reconciliation after this
  // hook. Re-install the presentation auras after it as well, using stable ids so
  // the helper never duplicates a live effect.
  const installVisualAuras = (): void => {
    const ensureAura = (entity: Entity | undefined, aura: Aura): void => {
      if (entity && !entity.auras.some((candidate) => candidate.id === aura.id)) {
        entity.auras.push(aura);
      }
    };
    ensureAura(player, {
      id: 'battle_shout',
      name: 'Battle Shout',
      kind: 'buff_ap_pct',
      remaining: 90,
      duration: 120,
      value: 10,
      sourceId: player.id,
      school: 'physical',
    });
    ensureAura(player, {
      id: 'demoralizing_shout',
      name: 'Demoralized',
      kind: 'debuff_ap',
      remaining: 90,
      duration: 120,
      value: 10,
      sourceId: player.id,
      school: 'physical',
    });
    const firstMember = sim.entities.get(memberIds[0] ?? -1);
    ensureAura(firstMember, {
      id: 'power_word_shield',
      name: 'Power Word: Shield',
      kind: 'absorb',
      remaining: 90,
      duration: 120,
      value: 180,
      sourceId: player.id,
      school: 'holy',
    });
    ensureAura(firstMember, {
      id: 'deep_wounds',
      name: 'Deep Wounds',
      kind: 'dot',
      remaining: 90,
      duration: 120,
      value: 15,
      sourceId: player.id,
      school: 'physical',
    });
    ensureAura(sim.entities.get(memberIds[1] ?? -1), {
      id: 'renew',
      name: 'Renew',
      kind: 'hot',
      remaining: 90,
      duration: 120,
      value: 24,
      sourceId: player.id,
      school: 'holy',
    });
    ensureAura(sim.entities.get(memberIds[2] ?? -1), {
      id: 'rend',
      name: 'Rend',
      kind: 'dot',
      remaining: 90,
      duration: 120,
      value: 18,
      sourceId: player.id,
      school: 'physical',
    });
    const target = targetId === null ? undefined : sim.entities.get(targetId);
    ensureAura(target, {
      id: 'hamstring',
      name: 'Hamstring',
      kind: 'slow',
      remaining: 4.4,
      duration: 10,
      value: 0.5,
      sourceId: player.id,
      school: 'physical',
    });
    ensureAura(target, {
      id: 'sunder_armor',
      name: 'Sunder Armor',
      kind: 'sunder',
      remaining: 21,
      duration: 30,
      value: 2,
      stacks: 3,
      sourceId: player.id,
      school: 'physical',
    });
  };
  installVisualAuras();

  // The screenshot matrix is visual-only: discard invite/log chatter and keep
  // pop-up panels from obscuring the persistent HUD under review.
  sim.events.length = 0;
  // closeAll intentionally dismisses only the topmost window in normal play;
  // drain the stack for an unobscured visual-regression capture.
  for (let attempts = 0; attempts < 20 && hud.closeAll(); attempts += 1) {
    // no-op
  }
  hud.update(0.05);
  // Party creation can enqueue its loot-settings window after the immediate HUD
  // paint. Drain that deferred panel too so every matrix URL is capture-ready.
  window.setTimeout(() => {
    installVisualAuras();
    for (let attempts = 0; attempts < 20 && hud.closeAll(); attempts += 1) {
      // no-op
    }
    hud.update(0.05);
  }, 250);
  window.dispatchEvent(new Event('resize'));

  return {
    partySize,
    raid: sim.partyInfo?.raid ?? false,
    targetId,
    targetOfTargetId: memberIds[0] ?? player.id,
  };
}
