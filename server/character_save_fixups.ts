// The session-position/jail fixups every DURABLE character snapshot must
// carry, applicable to any serialization instant (the autosave's in-thunk
// snapshot, or the marketplace escrow persist's in-job one). A snapshot
// written without these is a real defect, not cosmetics: a jailed player's
// blob would drop the jail flag and position (a moderation escape on the next
// load), and a spectating player's blob would persist the spectator body and
// lose the stowed pet. GameServer.saveCharacter and
// GameServer.serializeCharacterForPersist are the two consumers; nothing else
// may write a character blob from a serialization that skipped this.
import type { CharacterState } from '../src/sim/sim';
import type { ClientSession } from './game';

export function applyCharacterSaveFixups(
  session: Pick<ClientSession, 'spectating' | 'jailVisit' | 'jailed'>,
  s: CharacterState,
  jailSpawn: () => { x: number; z: number },
): CharacterState {
  if (session.spectating) {
    s.pos = {
      x: session.spectating.savedPos.x,
      z: session.spectating.savedPos.z,
    };
    s.pet = session.spectating.stowedPet;
  }
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
