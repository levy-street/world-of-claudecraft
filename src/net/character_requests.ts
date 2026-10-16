// Roster mutations, independent of socket state and account login state.
import type { PlayerClass } from '../sim/types';

type Request = (path: string, body: unknown) => Promise<Record<string, unknown>>;
export class CharacterRequests {
  constructor(
    private readonly post: Request,
    private readonly remove: Request,
  ) {}
  async create(
    name: string,
    cls: PlayerClass,
    skin = 0,
    // The authored modular look, fixed to THIS character at create (its own
    // server column). Optional: absent creates a legacy-rig character. Typed
    // `object` so the render layer's ModularAppearance interface passes
    // without a cast (this module stays out of src/render imports).
    appearance: object | null = null,
    // The creator's helmet toggle, becoming this character's standing helm
    // preference. Defaults to hidden so an authored face is what the player
    // meets in the world.
    helmHidden = true,
  ): Promise<void> {
    await this.post('/api/characters', {
      name,
      class: cls,
      skin,
      helmHidden,
      ...(appearance ? { appearance } : {}),
    });
  }

  // Spend the character's one-shot appearance redesign (characters with no
  // authored look; the server is the eligibility authority and burns the token
  // atomically). `helmHidden` is the editor's helmet toggle, which is the same
  // standing wardrobe choice creation posts, not a preview. Resolves with the
  // normalized stored look.
  async rerollAppearance(
    characterId: number,
    appearance: object,
    helmHidden: boolean,
  ): Promise<Record<string, unknown>> {
    const data = await this.post(`/api/characters/${characterId}/appearance-reroll`, {
      appearance,
      helmHidden,
    });
    return (data.appearance ?? appearance) as Record<string, unknown>;
  }

  async renameCharacter(characterId: number, name: string): Promise<void> {
    await this.post(`/api/characters/${characterId}/rename`, { name });
  }

  async deleteCharacter(characterId: number, name: string): Promise<void> {
    await this.remove(`/api/characters/${characterId}`, { name });
  }

  // Force-disconnect this character's live session (a stale tab, a crash, or
  // another device) so we can enter the world on it. Returns whether a session
  // was actually displaced (false = it was already offline).
  async takeoverCharacter(characterId: number): Promise<boolean> {
    const data = await this.post(`/api/characters/${characterId}/takeover`, {});
    return data.takenOver === true;
  }
}
