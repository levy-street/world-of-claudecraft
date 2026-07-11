// The Ravenpost: the in-game mail system. A new system module behind SimContext
// (the market.ts shape): this class OWNS the shared mail book, the mail-id
// counter, and the mailbox entity ids; the inventory hub (addItem/removeItem/
// countItem) STAYS on Sim and is consumed through SimContext. Sim keeps thin
// same-named delegates so the server, the IWorld surface, and tests resolve
// unchanged.
//
// Mail is world-scoped and keyed by a stable recipient identity (character id
// string online, entity id offline; the market's sellerKey convention), so a
// letter reaches a character who is offline, and waits across restarts via
// serializeMail/loadMail (a per-realm JSONB world_state row, like the market).
// Player letters travel by raven: a short sim-time delivery delay before the
// letter lands. Attachments (coin + item stacks) are escrowed out of the
// sender's bags at send time and only leave the book through mailTake.
//
// `src/sim`-pure: no DOM/Three/render-ui-game-net imports, no Math.random/
// Date.now (enforced by tests/architecture.test.ts). The post draws NO rng.

import { type LetterDef, QUEST_LETTERS, WELCOME_LETTER } from '../content/letters';
import { ITEMS } from '../data';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { dist2d, type Entity, INTERACT_RANGE, type InvSlot, type MailResultCode } from '../types';

const MAIL_RANGE = INTERACT_RANGE + 2; // you must stand at a raven pillar to tend your post
export const MAIL_POSTAGE = 30; // copper per letter
export const MAIL_MAX_ATTACHMENTS = 3; // item stacks a letter can carry
export const MAIL_DELIVERY_SECONDS = 45; // player mail: the raven's flight
const MAIL_NPC_DELIVERY_SECONDS = 90; // authored letters default delay
const MAIL_EXPIRY_SECONDS = 14 * 24 * 3600; // sim-seconds a read/plain letter lingers
const MAIL_MAX_PER_RECIPIENT = 100; // stored letters per mailbox (full = refuse new)
const MAIL_WIRE_LIMIT = 50; // most letters shipped to one client at a time
export const MAIL_SUBJECT_MAX = 64;
export const MAIL_BODY_MAX = 600;

export type MailKind = 'player' | 'system' | 'npc';

export interface MailMessage {
  id: number;
  recipientKey: string; // stable recipient identity (character id string); market sellerKey convention
  recipientName: string; // display name at send time (rekeyed on rename)
  senderName: string; // display name; player names splice verbatim, letter senders localize by letterId
  kind: MailKind;
  letterId?: string; // authored-letter id: the client localizes subject/body/sender through it
  subject: string;
  body: string;
  copper: number;
  items: InvSlot[];
  deliverAt: number; // sim.time seconds; in the recipient's box once time >= deliverAt
  expiresAt: number; // sim.time seconds; Infinity while attachments remain
  read: boolean;
  // Runtime-only: the arrival event already fired (not serialized; on load a
  // delivered letter is marked announced so a restart never re-toasts it).
  announced: boolean;
}

// Persistable mail state. Durations are stored as seconds-left instead of
// absolute times because sim.time resets to 0 each server boot (the market's
// secondsLeft pattern).
export interface MailSave {
  mail: {
    id: number;
    recipientKey: string;
    recipientName: string;
    senderName: string;
    kind: MailKind;
    letterId?: string;
    subject: string;
    body: string;
    copper: number;
    items: InvSlot[];
    deliverIn: number; // seconds until delivery (0 = already delivered)
    secondsLeft: number; // seconds until expiry; -1 = never expires
    read: boolean;
  }[];
  nextMailId: number;
}

export class PostOffice {
  // One shared book of letters, keyed by stable recipient identity. Read through
  // Sim's thin delegates; internal to this module otherwise.
  mail: MailMessage[] = [];
  private nextMailId = 1;
  // Entity ids of every mailbox object, assigned by the Sim ctor during world
  // placement (the spawn loop stays on Sim). Any raven pillar is a valid place
  // to tend your post.
  mailboxIds: number[] = [];

  // Finding 4 (perf): a maintained count of delivered-and-unread letters per
  // recipientKey (the same key deliveredFor/belongsTo match on). mailUnreadFor
  // reads it in O(1) rather than scanning the whole book once per online session
  // per tick. `undelivered` is the small set of still-in-flight letters, so a
  // delivery transition updates the index at the exact tick the old scan would
  // have counted it. Both are derived state, rebuilt from the book on load and
  // never persisted.
  private unreadIndex = new Map<string, number>();
  private undelivered = new Set<MailMessage>();

  constructor(private readonly ctx: SimContext) {}

  // Public tick entry: the Sim tick calls this in the end-of-tick system block
  // (after market.update()). Once a second: land due letters, prune expired ones.
  update(): void {
    // Every tick: fold any in-flight letter that has just reached its delivery
    // time into the unread index, so mailUnreadFor stays byte-identical to the
    // former per-call scan at the exact tick (never a per-second lag). Iterates
    // only the small in-flight set, not the whole book, and touches no rng/event
    // stream (the arrival toast keeps its own per-second cadence below).
    this.deliverDue();
    if (this.ctx.tickCount % 20 !== 0) return;
    const now = this.ctx.time;
    for (let i = this.mail.length - 1; i >= 0; i--) {
      const m = this.mail[i];
      if (!m.announced && now >= m.deliverAt) {
        m.announced = true;
        const meta = this.metaByMailKey(m.recipientKey);
        if (meta) {
          this.ctx.emit({
            type: 'mailArrived',
            senderName: m.senderName,
            letterId: m.letterId,
            pid: meta.entityId,
          });
        }
      }
      if (now >= m.expiresAt && m.items.length === 0 && m.copper <= 0) {
        // A delivered-and-unread letter that expires leaves the unread index.
        if (!m.read && now >= m.deliverAt) this.indexDec(m.recipientKey);
        this.undelivered.delete(m);
        this.mail.splice(i, 1);
      }
    }
  }

  private nearMailbox(e: Entity): boolean {
    for (const id of this.mailboxIds) {
      const box = this.ctx.entities.get(id);
      if (box && box.kind === 'object' && dist2d(e.pos, box.pos) <= MAIL_RANGE) return true;
    }
    return false;
  }

  mailKeyFor(meta: PlayerMeta): string {
    return String(meta.characterId ?? meta.entityId);
  }

  // Structured outcome (the lockpick convention: the sim emits data only, the
  // client renders every visible mail string from the code).
  private result(
    pid: number,
    code: MailResultCode,
    extra?: { value?: number; name?: string },
  ): void {
    this.ctx.emit({ type: 'mailResult', code, ...extra, pid });
  }

  private metaByMailKey(key: string): PlayerMeta | null {
    if (!key) return null;
    for (const m of this.ctx.players.values()) {
      if (this.mailKeyFor(m) === key || m.name === key) return m;
    }
    return null;
  }

  private belongsTo(m: MailMessage, meta: PlayerMeta): boolean {
    return m.recipientKey === this.mailKeyFor(meta) || m.recipientKey === meta.name;
  }

  private deliveredFor(meta: PlayerMeta): MailMessage[] {
    const now = this.ctx.time;
    return this.mail.filter((m) => this.belongsTo(m, meta) && now >= m.deliverAt);
  }

  private storedCountFor(key: string, name: string): number {
    return this.mail.reduce(
      (n, m) => n + (m.recipientKey === key || m.recipientKey === name ? 1 : 0),
      0,
    );
  }

  private indexInc(key: string): void {
    this.unreadIndex.set(key, (this.unreadIndex.get(key) ?? 0) + 1);
  }

  private indexDec(key: string): void {
    const next = (this.unreadIndex.get(key) ?? 0) - 1;
    if (next > 0) this.unreadIndex.set(key, next);
    else this.unreadIndex.delete(key);
  }

  // Fold a freshly booked or loaded letter into the unread index and the
  // in-flight set: an already-due letter counts as unread now (unless read); one
  // still on the wing waits in `undelivered` until deliverDue lands it.
  private trackDelivery(m: MailMessage): void {
    if (this.ctx.time >= m.deliverAt) {
      if (!m.read) this.indexInc(m.recipientKey);
    } else {
      this.undelivered.add(m);
    }
  }

  // Per-tick: land any in-flight letter whose delivery time has arrived, moving
  // it from `undelivered` into the unread index. Draws no rng and emits nothing
  // (the arrival toast stays on its own per-second cadence in update()), so it
  // never perturbs the deterministic event/rng stream. Correctness rests on the
  // ordering invariant that update() (which calls this) runs to completion inside
  // tick() before any mail command or mailUnreadFor observes a newly-due letter:
  // tick() invokes no mail mutator mid-loop, and all commands/snapshots run
  // between ticks, so a command's deliveredFor never sees a due-but-unfolded
  // letter that indexDec could turn into a phantom under-count.
  private deliverDue(): void {
    if (this.undelivered.size === 0) return;
    const now = this.ctx.time;
    for (const m of this.undelivered) {
      if (now < m.deliverAt) continue;
      this.undelivered.delete(m);
      if (!m.read) this.indexInc(m.recipientKey);
    }
  }

  // Rebuild the unread index + in-flight set from the current book (used after a
  // deserialize/load so neither is ever persisted).
  private rebuildUnreadIndex(): void {
    this.unreadIndex.clear();
    this.undelivered.clear();
    for (const m of this.mail) this.trackDelivery(m);
  }

  mailUnreadFor(pid: number): number {
    // Runs on every snapshot for every player (the mailU self field). Reads the
    // maintained unread index in O(1) instead of scanning the whole book: each
    // letter is counted under its recipientKey bucket, and belongsTo matches a
    // player by EITHER their mail key OR their name, so we sum both buckets
    // (guarding a double count when the name equals the key). Byte-identical to
    // the former linear scan.
    const meta = this.ctx.players.get(pid);
    if (!meta) return 0;
    const key = this.mailKeyFor(meta);
    let unread = this.unreadIndex.get(key) ?? 0;
    if (meta.name !== key) unread += this.unreadIndex.get(meta.name) ?? 0;
    return unread;
  }

  // Offline/IWorld send path: resolve the recipient among live players (the
  // offline world has no directory beyond them). The server instead resolves
  // the name against the character database and calls mailSendResolved.
  mailSend(
    to: string,
    subject: string,
    body: string,
    copper: number,
    items: InvSlot[],
    pid?: number,
  ): void {
    const r = this.ctx.resolve(pid);
    if (!r) return;
    const name = to.trim();
    if (!name) {
      this.result(r.meta.entityId, 'needRecipient');
      return;
    }
    let recipient: PlayerMeta | null = null;
    for (const m of this.ctx.players.values()) {
      if (m.name.toLowerCase() === name.toLowerCase()) {
        recipient = m;
        break;
      }
    }
    if (!recipient) {
      this.result(r.meta.entityId, 'noRecipient');
      return;
    }
    this.mailSendResolved(
      { key: this.mailKeyFor(recipient), name: recipient.name },
      subject,
      body,
      copper,
      items,
      pid,
    );
  }

  // Authoritative send: the recipient identity is already resolved (live player
  // offline, character row online). Validates proximity, escrow and postage,
  // then books the letter onto the raven.
  mailSendResolved(
    recipient: { key: string; name: string },
    subject: string,
    body: string,
    copper: number,
    items: InvSlot[],
    pid?: number,
  ): void {
    const r = this.ctx.resolve(pid);
    if (!r) return;
    const { meta, e: p } = r;
    if (p.dead) return;
    if (!this.nearMailbox(p)) {
      this.result(meta.entityId, 'tooFar');
      return;
    }
    const cleanSubject = subject.trim().slice(0, MAIL_SUBJECT_MAX);
    const cleanBody = body.trim().slice(0, MAIL_BODY_MAX);
    const coin = Math.floor(copper);
    if (!Number.isFinite(coin) || coin < 0) return;
    if (items.length > MAIL_MAX_ATTACHMENTS) {
      this.result(meta.entityId, 'tooManyParcels', { value: MAIL_MAX_ATTACHMENTS });
      return;
    }
    const wanted = new Map<string, number>();
    for (const s of items) {
      const def = ITEMS[s.itemId];
      const count = Math.floor(s.count);
      if (!def || !Number.isFinite(count) || count < 1) return;
      if (def.soulbound) {
        this.result(meta.entityId, 'noMailSoulbound');
        return;
      }
      if (def.kind === 'quest' || def.noMarketList) {
        this.result(meta.entityId, 'noMailQuestItems');
        return;
      }
      wanted.set(s.itemId, (wanted.get(s.itemId) ?? 0) + count);
    }
    for (const [itemId, count] of wanted) {
      // Count only the fungible stock (#1165): an instanced copy (signer/charges/
      // rolled/boundTo) is never swept into a letter, exactly as the World Market
      // validates against countFungibleItem. A player whose only copies are
      // instanced gets notEnoughItems, just like on the market.
      if (this.ctx.countFungibleItem(itemId, meta.entityId) < count) {
        this.result(meta.entityId, 'notEnoughItems');
        return;
      }
    }
    if (meta.copper < coin + MAIL_POSTAGE) {
      this.result(meta.entityId, 'cantAffordPostage');
      return;
    }
    if (this.storedCountFor(recipient.key, recipient.name) >= MAIL_MAX_PER_RECIPIENT) {
      this.result(meta.entityId, 'recipientBoxFull');
      return;
    }
    // Escrow: coin and goods leave the sender now, ride with the raven. Remove
    // the fungible stock only (#1165), matching the countFungibleItem check above
    // so an instanced copy can never be consumed as a plain stack member and come
    // back later as a generic copy.
    meta.copper -= coin + MAIL_POSTAGE;
    for (const s of items)
      this.ctx.removeFungibleItem(s.itemId, Math.floor(s.count), meta.entityId);
    this.book({
      recipientKey: recipient.key,
      recipientName: recipient.name,
      senderName: meta.name,
      kind: 'player',
      subject: cleanSubject,
      body: cleanBody,
      copper: coin,
      items: items.map((s) => ({ itemId: s.itemId, count: Math.floor(s.count) })),
      delaySeconds: MAIL_DELIVERY_SECONDS,
    });
    this.result(meta.entityId, 'sent', { name: recipient.name, value: MAIL_POSTAGE });
  }

  // Take everything attached to one letter: coin into the purse, parcels into
  // the bags. The letter itself stays until deleted.
  mailTake(mailId: number, pid?: number): void {
    const r = this.ctx.resolve(pid);
    if (!r) return;
    const { meta, e: p } = r;
    if (p.dead) return; // same silent dead-gate as mailSendResolved above
    if (!this.nearMailbox(p)) {
      this.result(meta.entityId, 'tooFar');
      return;
    }
    const m = this.deliveredFor(meta).find((x) => x.id === mailId);
    if (!m) {
      this.result(meta.entityId, 'letterGone');
      return;
    }
    // Coin is never capacity-gated: it always lands in the purse.
    if (m.copper > 0) {
      meta.copper += m.copper;
      this.result(meta.entityId, 'collected', { value: m.copper });
      m.copper = 0;
    }
    // Parcels respect bag capacity (#1354, the market-collect rule): a stack that
    // does not fit stays ATTACHED to the letter for a later take, never destroyed
    // and never force-added past the bag budget. canAddItem is checked per stack
    // against the live inventory, so cumulative capacity is honoured.
    const kept: InvSlot[] = [];
    for (const s of m.items) {
      if (this.ctx.canAddItem(s.itemId, s.count, meta.entityId)) {
        this.ctx.addItem(s.itemId, s.count, meta.entityId);
      } else {
        kept.push(s);
      }
    }
    m.items = kept;
    // Tending the letter marks it read (drops it from the unread index once).
    if (!m.read) {
      this.indexDec(m.recipientKey);
      m.read = true;
    }
    if (kept.length > 0) {
      // Attachments remain: the expiry clock stays paused (Infinity) and the
      // player is told to make room, exactly as the Merchant's collect does.
      this.ctx.error(meta.entityId, 'Your bags are full.');
      return;
    }
    // Fully emptied: start the expiry clock if it never had one.
    if (!Number.isFinite(m.expiresAt)) m.expiresAt = this.ctx.time + MAIL_EXPIRY_SECONDS;
  }

  mailDelete(mailId: number, pid?: number): void {
    const r = this.ctx.resolve(pid);
    if (!r) return;
    const { meta, e: p } = r;
    if (p.dead) return; // same silent dead-gate as mailSendResolved above
    if (!this.nearMailbox(p)) {
      this.result(meta.entityId, 'tooFar');
      return;
    }
    const idx = this.mail.findIndex(
      (x) => x.id === mailId && this.belongsTo(x, meta) && this.ctx.time >= x.deliverAt,
    );
    if (idx < 0) {
      this.result(meta.entityId, 'letterGone');
      return;
    }
    const m = this.mail[idx];
    if (m.items.length > 0 || m.copper > 0) {
      this.result(meta.entityId, 'takeParcelsFirst');
      return;
    }
    // A delivered-and-unread letter deleted before it is read leaves the index.
    if (!m.read) this.indexDec(m.recipientKey);
    this.mail.splice(idx, 1);
  }

  mailMarkRead(mailId: number, pid?: number): void {
    const r = this.ctx.resolve(pid);
    if (!r) return;
    const m = this.deliveredFor(r.meta).find((x) => x.id === mailId);
    if (m && !m.read) {
      this.indexDec(m.recipientKey);
      m.read = true;
    }
  }

  // Authored letters (system + NPC): no proximity, no postage, delivery after
  // the letter's own delay. Never refuses: a full mailbox still receives the
  // authored letter (it is bounded content, not player spam).
  sendLetter(recipientKey: string, recipientName: string, letter: LetterDef, kind: MailKind): void {
    this.book({
      recipientKey,
      recipientName,
      senderName: letter.senderName,
      kind,
      letterId: letter.letterId,
      subject: letter.subject,
      body: letter.body,
      copper: Math.max(0, Math.floor(letter.copper ?? 0)),
      items: (letter.items ?? []).map((s) => ({ ...s })),
      delaySeconds: letter.delaySeconds ?? MAIL_NPC_DELIVERY_SECONDS,
    });
  }

  // The one-time service letter; the caller flips meta.mailWelcomed.
  sendWelcome(meta: PlayerMeta): void {
    this.sendLetter(this.mailKeyFor(meta), meta.name, WELCOME_LETTER, 'system');
  }

  // Quest turn-in hook (turnInQuestCore): quests with an authored letter have
  // their giver write to the player a little while later.
  queueQuestLetter(questId: string, pid: number): void {
    const letter = QUEST_LETTERS[questId];
    if (!letter) return;
    const meta = this.ctx.players.get(pid);
    if (!meta) return;
    this.sendLetter(this.mailKeyFor(meta), meta.name, letter, 'npc');
  }

  private book(opts: {
    recipientKey: string;
    recipientName: string;
    senderName: string;
    kind: MailKind;
    letterId?: string;
    subject: string;
    body: string;
    copper: number;
    items: InvSlot[];
    delaySeconds: number;
  }): void {
    const hasAttachments = opts.copper > 0 || opts.items.length > 0;
    const msg: MailMessage = {
      id: this.nextMailId++,
      recipientKey: opts.recipientKey,
      recipientName: opts.recipientName,
      senderName: opts.senderName,
      kind: opts.kind,
      letterId: opts.letterId,
      subject: opts.subject,
      body: opts.body,
      copper: opts.copper,
      items: opts.items,
      deliverAt: this.ctx.time + Math.max(0, opts.delaySeconds),
      expiresAt: hasAttachments ? Infinity : this.ctx.time + MAIL_EXPIRY_SECONDS,
      read: false,
      announced: false,
    };
    this.mail.push(msg);
    this.trackDelivery(msg);
  }

  mailInfoFor(pid: number): import('../../world_api').MailInfo | null {
    const meta = this.ctx.players.get(pid);
    const e = this.ctx.entities.get(pid);
    if (!meta || !e) return null;
    // The post is a place you visit: only stream it while standing at a raven
    // pillar, which also bounds the per-snapshot wire cost.
    if (!this.nearMailbox(e)) return null;
    const mine = this.deliveredFor(meta).sort((a, b) => b.deliverAt - a.deliverAt || b.id - a.id);
    const wired = mine.slice(0, MAIL_WIRE_LIMIT);
    return {
      messages: wired.map((m) => ({
        id: m.id,
        senderName: m.senderName,
        kind: m.kind,
        letterId: m.letterId,
        subject: m.subject,
        body: m.body,
        copper: m.copper,
        items: m.items.map((s) => ({ ...s })),
        read: m.read,
      })),
      totalCount: mine.length,
      unread: mine.reduce((n, m) => n + (m.read ? 0 : 1), 0),
      postage: MAIL_POSTAGE,
      maxAttachments: MAIL_MAX_ATTACHMENTS,
      deliverySeconds: MAIL_DELIVERY_SECONDS,
    };
  }

  // Rename support (the market's rekeyMarketSeller shape): fold any name-keyed
  // letters onto the stable character-id key and refresh the display name.
  rekeyMailOwner(characterId: number, oldName: string, newName: string): boolean {
    if (!Number.isFinite(characterId)) return false;
    const key = String(characterId);
    let changed = false;
    for (const m of this.mail) {
      if (m.recipientKey === key || m.recipientKey === oldName || m.recipientKey === newName) {
        if (m.recipientKey !== key || m.recipientName !== newName) changed = true;
        const oldKey = m.recipientKey;
        // Move this letter's unread contribution from its old key bucket to the
        // stable id key when the key actually changes (delivered-and-unread only,
        // matching exactly what the index counts).
        if (oldKey !== key && !m.read && this.ctx.time >= m.deliverAt) {
          this.indexDec(oldKey);
          this.indexInc(key);
        }
        m.recipientKey = key;
        m.recipientName = newName;
      }
    }
    return changed;
  }

  // Persist every letter; durations survive the boot-time clock reset as
  // seconds-left (the market pattern).
  serializeMail(): MailSave {
    const now = this.ctx.time;
    return {
      mail: this.mail.map((m) => ({
        id: m.id,
        recipientKey: m.recipientKey,
        recipientName: m.recipientName,
        senderName: m.senderName,
        kind: m.kind,
        letterId: m.letterId,
        subject: m.subject,
        body: m.body,
        copper: m.copper,
        items: m.items.map((s) => ({ ...s })),
        deliverIn: Math.max(0, Math.round(m.deliverAt - now)),
        secondsLeft: Number.isFinite(m.expiresAt) ? Math.max(0, Math.round(m.expiresAt - now)) : -1,
        read: m.read,
      })),
      nextMailId: this.nextMailId,
    };
  }

  loadMail(save: MailSave | null | undefined): void {
    if (!save) return;
    const returnedParcels: {
      recipientKey: string;
      recipientName: string;
      senderName: string;
      kind: MailKind;
      subject: string;
      body: string;
      copper: number;
      items: InvSlot[];
      delaySeconds: number;
    }[] = [];
    for (const m of save.mail ?? []) {
      if (!m || typeof m.recipientKey !== 'string') continue;
      // Keep letters whose attached item id is no longer in ITEMS (a content
      // edit): dormant, recoverable data, exactly like market listings.
      const items = (m.items ?? [])
        .filter((s) => s && typeof s.itemId === 'string')
        .map((s) => ({ itemId: s.itemId, count: Math.max(1, s.count | 0) }));
      const kind: MailKind = m.kind === 'player' || m.kind === 'npc' ? m.kind : 'system';
      const recipientName = String(m.recipientName ?? m.recipientKey);
      const senderName = String(m.senderName ?? '?');
      const subject = String(m.subject ?? '');
      const body = String(m.body ?? '');
      const retainedItems: InvSlot[] = [];
      const returnedItems: InvSlot[] = [];
      for (const item of items) {
        if (kind === 'player' && ITEMS[item.itemId]?.soulbound) returnedItems.push(item);
        else retainedItems.push(item);
      }
      // Migration for player parcels sent before an item became soulbound. The
      // persisted model has no stable sender key, so return only the newly bound
      // stacks to the senderName-keyed mailbox. Mark the return as system mail so
      // a serialize/load round trip never returns it again. Ordinary items and
      // attached coin remain on the original letter.
      if (returnedItems.length > 0) {
        returnedParcels.push({
          recipientKey: senderName,
          recipientName: senderName,
          senderName: recipientName,
          kind: 'system',
          subject,
          body,
          copper: 0,
          items: returnedItems,
          delaySeconds: 0,
        });
      }
      const deliverIn = Number.isFinite(m.deliverIn) ? Math.max(0, m.deliverIn) : 0;
      const copper = Math.max(0, Math.floor(m.copper) || 0);
      const persistedExpiresAt =
        m.secondsLeft === -1 || !Number.isFinite(m.secondsLeft)
          ? Infinity
          : this.ctx.time + Math.max(0, m.secondsLeft);
      this.mail.push({
        id: m.id,
        recipientKey: m.recipientKey,
        recipientName,
        senderName,
        kind,
        letterId: typeof m.letterId === 'string' ? m.letterId : undefined,
        subject,
        body,
        copper,
        items: retainedItems,
        deliverAt: this.ctx.time + deliverIn,
        expiresAt:
          returnedItems.length > 0 && retainedItems.length === 0 && copper <= 0
            ? Math.min(persistedExpiresAt, this.ctx.time + MAIL_EXPIRY_SECONDS)
            : persistedExpiresAt,
        read: m.read === true,
        // Already-delivered letters never re-toast after a restart.
        announced: deliverIn <= 0,
      });
    }
    const maxId = this.mail.reduce((mx, m) => Math.max(mx, m.id + 1), 1);
    this.nextMailId = Math.max(this.nextMailId, save.nextMailId ?? 1, maxId);
    for (const parcel of returnedParcels) this.book(parcel);
    // The unread index is derived state, never persisted: rebuild it from the
    // freshly loaded book.
    this.rebuildUnreadIndex();
  }
}
