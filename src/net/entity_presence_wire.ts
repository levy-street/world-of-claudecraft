// Decode of the entity wire's player presence bits (server/entity_presence_wire.ts),
// moved out of the ClientWorld coordinator (monolith ratchet). Every bit is
// sent only while set, so its absence on a record means "off": these are the
// per-record display mirrors, never delta-guarded.
import type { Entity } from '../sim/types';

/** The skill event tells the wire may carry (`stc`). */
const STANCES: ReadonlySet<unknown> = new Set([
  'lunge',
  'guard',
  'open',
  'chant',
  'sever',
  'silenced',
  'brace',
  'hand',
]);

// biome-ignore lint/suspicious/noExplicitAny: mirrors online.ts's own LooseJson wire-record idiom
export function applyEntityPresenceBits(e: Entity, w: any): void {
  e.afk = !!w.ak; // /afk display bit: drives the nameplate tag + social presence dot
  e.pvpFlag = !!w.pvp; // /pvp flag bit: nameplate + target-frame hostility colour
  // King of the Hill bounty (`hbn`; `hb` is the $WOC holder balance): a positive
  // whole Honor value, or nothing.
  if (typeof w.hbn === 'number' && w.hbn > 0) e.hillBounty = w.hbn;
  else delete e.hillBounty;
  // Skill event hearts (`hrt`): a whole count while in a heart fight, else nothing.
  if (typeof w.hrt === 'number' && w.hrt >= 0) e.eventHearts = Math.floor(w.hrt);
  else delete e.eventHearts;
  // The skill event tell (`stc`): a Riposte or Rite of Tongues stance, else nothing.
  if (STANCES.has(w.stc)) e.eventStance = w.stc;
  else delete e.eventStance;
  // The tell's bar fill (`stf`), 0 to 1: a chant or Sever wind-up in progress.
  if (typeof w.stf === 'number' && Number.isFinite(w.stf)) {
    e.eventStanceFill = Math.max(0, Math.min(1, w.stf));
  } else delete e.eventStanceFill;
  // The Common Hand's dealt cast (`sca`): an ability id, only beside a `hand` tell.
  if (typeof w.sca === 'string' && w.sca.length <= 64) e.eventCastId = w.sca;
  else delete e.eventCastId;
  // Footprints in Ash unseen bit (`uns`): only ever on your own record.
  if (w.uns) e.eventUnseen = true;
  else delete e.eventUnseen;
}
