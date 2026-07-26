// Pure target-of-target view for the compact fourth UnitFramePainter instance.
// Entity selection, health state, hostility, and self identity stay DOM and i18n
// free. The Hud supplies localized strings and the portrait identity at the edge.

import type { Entity } from '../sim/types';
import { type UnitFrameView, unitFrameView } from './unit_frame';

export type TargetOfTargetAccent = 'self' | 'hostile' | 'player' | 'friendly';

type TargetReference = Pick<Entity, 'kind' | 'targetId' | 'aggroTargetId'>;

export type TargetOfTargetSubject = Pick<
  Entity,
  'id' | 'kind' | 'templateId' | 'hostile' | 'dead' | 'hp' | 'maxHp'
>;

export interface TargetOfTargetText {
  name: string;
  accessibleLabel: string;
  portraitKey: string;
}

export interface TargetOfTargetView {
  entityId: number | null;
  frame: UnitFrameView;
  accent: TargetOfTargetAccent;
  classId: string;
  accessibleLabel: string;
  isSelf: boolean;
}

const ABSENT_FRAME = unitFrameView({
  present: false,
  hpFrac: 0,
  hpText: '',
  resourceKind: 'none',
  resFrac: 0,
  resText: '',
  levelText: null,
  name: '',
  portraitKey: '',
  absorb: null,
  dead: false,
  outOfRange: false,
});

const ABSENT_VIEW: TargetOfTargetView = {
  entityId: null,
  frame: ABSENT_FRAME,
  accent: 'friendly',
  classId: '',
  accessibleLabel: '',
  isSelf: false,
};

export function targetOfTargetId(target: TargetReference): number | null {
  return target.kind === 'player' ? target.targetId : target.aggroTargetId;
}

export function targetOfTargetEntityId(target: TargetReference | null | undefined): number | null {
  if (!target || target.kind === 'object') return null;
  return targetOfTargetId(target);
}

export function targetOfTargetSubject<T extends TargetOfTargetSubject>(
  target: TargetReference | null | undefined,
  findEntity: (id: number) => T | undefined,
): T | null {
  const id = targetOfTargetEntityId(target);
  if (id === null) return null;
  const subject = findEntity(id);
  return subject && subject.kind !== 'object' ? subject : null;
}

export function targetOfTargetView(
  subject: TargetOfTargetSubject | null | undefined,
  playerId: number,
  text: TargetOfTargetText | null,
): TargetOfTargetView {
  if (!subject || subject.kind === 'object' || !text) return ABSENT_VIEW;
  const hpFrac = Math.max(0, Math.min(1, subject.hp / Math.max(1, subject.maxHp)));
  const isSelf = subject.id === playerId;
  const dead = subject.dead || hpFrac <= 0;
  const accent: TargetOfTargetAccent = isSelf
    ? 'self'
    : subject.hostile
      ? 'hostile'
      : subject.kind === 'player'
        ? 'player'
        : 'friendly';

  return {
    entityId: subject.id,
    frame: unitFrameView({
      present: true,
      hpFrac,
      hpText: '',
      resourceKind: 'none',
      resFrac: 0,
      resText: '',
      levelText: null,
      name: text.name,
      portraitKey: text.portraitKey,
      absorb: null,
      dead,
      outOfRange: false,
    }),
    accent,
    classId: subject.templateId,
    accessibleLabel: text.accessibleLabel,
    isSelf,
  };
}
