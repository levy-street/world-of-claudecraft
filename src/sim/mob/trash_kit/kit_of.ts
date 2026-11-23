// The kit a mob fights with: a dev-lent kit (Entity.devTrashKit, only
// `/dev trashkit demo` and the suites set it) stands in for its template's.
// Every engine reader resolves a mob's kit through this one helper, so a
// dev-lent piece behaves exactly as a template's would. Pure leaf.

import { MOBS } from '../../data';
import type { Entity, TrashKitDef } from '../../types';

export function kitOf(mob: Entity): TrashKitDef | undefined {
  return mob.devTrashKit ?? MOBS[mob.templateId]?.trashKit;
}
