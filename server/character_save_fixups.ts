// The session-position/jail fixups every DURABLE character snapshot must
// carry, applicable to any serialization instant (the autosave's in-thunk
// snapshot, or the marketplace escrow persist's in-job one). A snapshot
// written without these is a real defect, not cosmetics: a jailed player's
// blob would drop the jail flag and position (a moderation escape on the next
// load), and a jail-visiting moderator's blob would persist the visitor spot
// and lose the stowed pet. (A spectating moderator needs no fixup: /spectate
// leaves the body where it stands, server/spectate_body.ts.)
// GameServer.saveCharacter and
// GameServer.serializeCharacterForPersist are the two consumers; nothing else
// may write a character blob from a serialization that skipped this.
import type { CharacterState } from '../src/sim/sim';
import type { ClientSession } from './game';

export function applyCharacterSaveFixups(
  session: Pick<ClientSession, 'jailVisit' | 'jailed'>,
  s: CharacterState,
  jailSpawn: () => { x: number; z: number },
): CharacterState {
  if (session.jailVisit) {
    s.pos = {
      x: session.jailVisit.savedPos.x,
      z: session.jailVisit.savedPos.z,
    };
    s.facing = session.jailVisit.savedFacing;
    s.pet = session.jailVisit.stowedPet;
  }
  if (session.jailed) {
    const jailPos = jailSpawn();
    s.pos = { x: jailPos.x, z: jailPos.z };
    s.jail = session.jailed;
    s.dead = false;
    s.ghost = false;
    s.corpsePos = null;
    s.hp = Math.max(1, s.hp);
  } else {
    delete s.jail;
  }
  return s;
}
