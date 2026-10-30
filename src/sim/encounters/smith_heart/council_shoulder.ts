// The Hammer Council's Shouldered Stone (docs/design/raid/smith_heart.md section
// 7.1), Heroic and Mythic: the Slabwright takes far less damage while another
// living member stands within reach, so one tank holds the Guardian with the
// Seam Singer and the other takes the Slabwright away. The other two have no
// such rule. The aura is the shared 'shield_wall' ward (combat/damage.ts), kept
// only while the rule holds.

import type { Entity } from '../../types';
import { dropAuraById } from '../sunken_bastion/claim';
import { COUNCIL_AURAS, COUNCIL_NAMES, COUNCIL_ROLES, COUNCIL_TUNING as T } from './council_ids';
import { type CouncilScope, living, raidWarn } from './council_scope';

/** A living member other than the Slabwright within reach of it. */
function hasCompany(s: CouncilScope, slab: Entity): boolean {
  for (const r of COUNCIL_ROLES) {
    if (r === 'slabwright') continue;
    const b = s.bodies[r];
    if (!living(b)) continue;
    if (Math.hypot(b.pos.x - slab.pos.x, b.pos.z - slab.pos.z) <= T.shoulderReach) return true;
  }
  return false;
}

/** One tick: the ward on while the Slabwright has company, off when it has none. */
export function stepShoulder(s: CouncilScope): void {
  const slab = s.bodies.slabwright;
  if (!s.rules.slabwrightShoulders || !living(slab)) return;
  const have = slab.auras.some((a) => a.id === COUNCIL_AURAS.shouldered);
  const company = hasCompany(s, slab);
  if (company === have) return;
  if (!company) {
    dropAuraById(slab, COUNCIL_AURAS.shouldered);
    return;
  }
  s.ctx.applyAura(slab, {
    id: COUNCIL_AURAS.shouldered,
    name: COUNCIL_NAMES.shouldered,
    kind: 'shield_wall',
    remaining: 3600,
    duration: 3600,
    permanent: true,
    value: T.shoulderWard,
    stacks: 1,
    sourceId: slab.id,
    school: 'physical',
    undispellable: true,
  });
  if (s.st.clock >= s.st.shoulderWarnAt) {
    s.st.shoulderWarnAt = s.st.clock + T.shoulderWarnGap;
    raidWarn(s, slab, 'shoulder', 'The Slabwright hardens beside its kin: pull it away!');
  }
}
