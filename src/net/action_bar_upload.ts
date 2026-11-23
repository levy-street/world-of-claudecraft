// The debounced, deduped upload of one action-bar layout profile, split out of
// ClientWorld (src/net/online.ts) so the coalescing rule is a unit a Vitest
// drives directly. The controller has already written the localStorage mirror
// by the time save() runs; this pushes the server copy so the arrangement
// restores on the player's other devices of the same surface. Rapid drags
// coalesce to the last layout, and an upload whose serialized form matches the
// last DELIVERED send is skipped, so a re-save during login (or an unchanged
// bar) never amplifies wire/db writes. flush() sends a pending save NOW: the
// debounce timer calls it, and so do session end, page backgrounding, and the
// reconnect handshake, so the final sub-debounce edit reaches the server before
// the socket goes away instead of being stranded.
//
// A save the socket REFUSES (the transport closed inside the debounce window, a
// backgrounded phone whose socket already died) stays pending and goes out on
// the next flush; it is never recorded as delivered. Recording it was the
// defect behind the "my mount slot vanished" report: the dedupe then refused to
// re-send that layout for the rest of the session, and at the next login the
// server's older copy won over the local mirror by design, so the edit was
// gone (abilities auto-place back onto a regenerated bar, item slots do not).

import {
  type ActionBarLayout,
  type ActionBarLayoutProfile,
  type ActionBarLayoutSave,
  actionBarLayoutIsEmpty,
  sanitizeActionBarLayout,
} from '../world_api/action_bar';

export const ACTION_BAR_SAVE_DEBOUNCE_MS = 1500;

// The `save_hotbar_layout` client command: the profile being arranged plus its
// full layout. A type literal (not an interface) so it satisfies the command
// sender's index signature.
export type ActionBarSaveCommand = {
  cmd: 'save_hotbar_layout';
  profile: ActionBarLayoutProfile;
  layout: ActionBarLayout;
};

/** Hands one save to the socket. Returns false when the frame could not be
 *  sent (the transport is not open), in which case the save stays pending. */
export type ActionBarSaveSender = (command: ActionBarSaveCommand) => boolean;

interface PendingSave extends ActionBarLayoutSave {
  json: string;
}

export class ActionBarLayoutUploader {
  private timer: ReturnType<typeof setTimeout> | null = null;
  // One pending save and one last-delivered form PER PROFILE: a surface switch
  // inside the debounce window (edit the desktop bar, flip to touch, edit there)
  // must send both edits, never let the second profile's save replace the first.
  // lastJson is the dedupe key and holds only forms the socket ACCEPTED, so the
  // same edit is sent again once the socket is back rather than treated as done.
  private readonly lastJson = new Map<ActionBarLayoutProfile, string>();
  private readonly pending = new Map<ActionBarLayoutProfile, PendingSave>();

  constructor(private readonly send: ActionBarSaveSender) {}

  /** Queue one profile's layout; a malformed or empty layout is dropped without
   *  a send (an empty server copy would win over a real fallback profile). */
  save(profile: ActionBarLayoutProfile, layout: ActionBarLayout): void {
    const clean = sanitizeActionBarLayout(layout);
    if (!clean || actionBarLayoutIsEmpty(clean)) return;
    const json = JSON.stringify(clean);
    if (this.lastJson.get(profile) === json) {
      // Back to what the server already holds (an edit undone inside the
      // window): nothing to send, and a queued intermediate must not go out.
      this.pending.delete(profile);
      return;
    }
    this.pending.set(profile, { profile, layout: clean, json });
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), ACTION_BAR_SAVE_DEBOUNCE_MS);
  }

  /** Send every pending save immediately, oldest profile first. A save the
   *  socket refuses stays pending for the next flush; a no-op when nothing is
   *  pending. */
  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    for (const save of [...this.pending.values()]) {
      const sent = this.send({
        cmd: 'save_hotbar_layout',
        profile: save.profile,
        layout: save.layout,
      });
      if (!sent) continue;
      this.pending.delete(save.profile);
      this.lastJson.set(save.profile, save.json);
    }
  }
}
