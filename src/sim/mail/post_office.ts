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

import { bagCapacity, canGrantCopies, instancedCountCap } from '../bags';
import { rekeySigner } from '../character_rename';
import {
  HEROIC_MARK_LETTER,
  type LetterDef,
  QUEST_LETTERS,
  WELCOME_LETTER,
} from '../content/letters';
import { ITEMS } from '../data';
import { boundCraftedRecipeIdOnLoad, warnDroppedInstanceKeys } from '../item_instance_load';
import { itemInstancePayloadsEqual } from '../item_instance_merge';
import {
  countMatchingUnlocked,
  grantCopies,
  isTransferLockedInstance,
  publicInstanceView,
  removeMatchingInstance,
  sanitizeEscrowSlot,
} from '../item_instance_transfer';
import { removeVendorSellUnits } from '../items';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import {
  cloneInvSlot,
  dist2d,
  type Entity,
  INTERACT_RANGE,
  type InvSlot,
  type MailResultCode,
} from '../types';

const MAIL_RANGE = INTERACT_RANGE + 2; // you must stand at a raven pillar to tend your post
export const MAIL_POSTAGE = 30; // copper per letter
export const MAIL_MAX_ATTACHMENTS = 3; // item stacks a letter can carry
export const MAIL_DELIVERY_SECONDS = 45; // player mail: the raven's flight
const MAIL_NPC_DELIVERY_SECONDS = 90; // authored letters default delay
const MAIL_EXPIRY_SECONDS = 14 * 24 * 3600; // sim-seconds a read/plain letter lingers
// Sim-seconds an unclaimed player parcel waits before it flies home to its
// sender, and the returned letter's second window before the sweep deletes it.
export const MAIL_ATTACHMENT_EXPIRY_SECONDS = 30 * 24 * 3600;
const MAIL_MAX_PER_RECIPIENT = 100; // stored letters per mailbox (full = refuse new)
export const MAIL_SUBJECT_MAX = 64;
export const MAIL_BODY_MAX = 600;

export type MailKind = 'player' | 'system' | 'npc';

export interface MailMessage {
  id: number;
  recipientKey: string; // stable recipient identity (character id string); market sellerKey convention
  recipientName: string; // display name at send time (rekeyed on rename)
  senderName: string; // display name; player names splice verbatim, letter senders localize by letterId
  // Stable sender identity (the market sellerKey convention), captured at send
  // time for player mail only. A rename never changes this, unlike senderName,
  // so returnToSender re-keys the flight home by THIS field: the sender's
  // display name can drift after send (a rename between send and expiry), but
  // their stable id never does. Absent on system/npc mail (never returned) and
  // on any letter persisted before this field existed.
  senderKey?: string;
  kind: MailKind;
  letterId?: string; // authored-letter id: the client localizes subject/body/sender through it
  subject: string;
  body: string;
  copper: number;
  items: InvSlot[];
  deliverAt: number; // sim.time seconds; in the recipient's box once time >= deliverAt
  // sim.time seconds. Player parcels ride the attachment window; system and npc
  // parcels hold Infinity while attachments remain (their expiry exemption).
  expiresAt: number;
  read: boolean;
  // The one return-to-sender cycle has run. The sweep's delete arm requires
  // this flag, so attachments are never destroyed without a return flight.
  returned?: boolean;
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
    senderKey?: string;
    kind: MailKind;
    letterId?: string;
    subject: string;
    body: string;
    copper: number;
    items: InvSlot[];
    deliverIn: number; // seconds until delivery (0 = already delivered)
    secondsLeft: number; // seconds until expiry; -1 = never expires
    read: boolean;
    returned?: boolean; // the return cycle has run; absent = false
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
      // Attachment expiry, player mail ONLY: a system/npc parcel holds
      // expiresAt = Infinity, so it can never trip this arm; the kind filter is
      // the belt-and-braces behind that by-construction exemption. An unclaimed
      // parcel first flies home; deletion with attachments aboard requires the
      // returned flag, so no item is ever destroyed without the return cycle
      // having run.
      if (m.kind === 'player' && now >= m.expiresAt && (m.items.length > 0 || m.copper > 0)) {
        if (m.returned) {
          // The one sanctioned destruction: the return flight already happened.
          if (!m.read && now >= m.deliverAt) this.indexDec(m.recipientKey);
          this.undelivered.delete(m);
          this.mail.splice(i, 1);
        } else {
          this.returnToSender(m, now);
        }
        continue;
      }
      if (now >= m.expiresAt && m.items.length === 0 && m.copper <= 0) {
        // A delivered-and-unread letter that expires leaves the unread index.
        if (!m.read && now >= m.deliverAt) this.indexDec(m.recipientKey);
        this.undelivered.delete(m);
        this.mail.splice(i, 1);
      }
    }
  }

  // Expiry return flight: the unclaimed parcel flies home IN PLACE, deliberately
  // not as a send: MAIL_MAX_PER_RECIPIENT is a send-time gate, so a full sender
  // box still holds the returned letter rather than destroying it. Re-keys the
  // letter onto the sender's STABLE id (senderKey, the market sellerKey
  // convention), never their display name: a sender who renames between send
  // and expiry must still be reachable, so a name would silently orphan the
  // parcel (or hand it to whoever later claims the vacated name). Falls back to
  // senderName only for a letter persisted before senderKey existed. Also
  // swaps the names so the letter honestly shows who it came back from, and
  // carries the OLD recipientKey forward as the new senderKey: recipientKey is
  // always stable-id by construction (booked that way, or by a prior return),
  // so a letter that bounces back and forth stays stable-id-keyed on both ends.
  private returnToSender(m: MailMessage, now: number): void {
    // Move the delivered-and-unread contribution out of the old bucket
    // (exactly what the index counts; the rekeyMailOwner shape).
    if (!m.read && now >= m.deliverAt) this.indexDec(m.recipientKey);
    const homeKey = m.senderKey ?? m.senderName;
    const homeName = m.senderName;
    m.senderKey = m.recipientKey;
    m.senderName = m.recipientName;
    m.recipientKey = homeKey;
    m.recipientName = homeName;
    m.returned = true;
    m.read = false;
    // A fresh flight: the normal delivery path lands and announces the return.
    m.announced = false;
    m.deliverAt = now + MAIL_DELIVERY_SECONDS;
    // The second window: one more chance to claim, then the sweep deletes.
    m.expiresAt = now + MAIL_ATTACHMENT_EXPIRY_SECONDS;
    this.trackDelivery(m);
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

  // Whether any letter addressed to this player still carries `itemId` as an
  // attachment, in-flight letters included (a raven on the wing lands in this
  // mailbox and nowhere else). The quest re-grant predicate
  // (quests/quest_item_presence.ts) reads this: an item waiting in the
  // mailbox is recoverable through mailTake, so a re-accept must not mint a
  // duplicate. Pure read, no rng, no mutation.
  mailboxHoldsItem(meta: PlayerMeta, itemId: string): boolean {
    return this.mail.some(
      (m) => this.belongsTo(m, meta) && m.items.some((s) => s.itemId === itemId && s.count > 0),
    );
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
    const instancedWanted: { itemId: string; instance: NonNullable<InvSlot['instance']> }[] = [];
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
      if (s.instance && typeof s.instance === 'object') {
        // Instanced parcels (the #1165 completion): single-copy by design (the
        // qty stepper stays fungible-only), named by payload so a bag reshuffle
        // can never redirect the escrow. A count other than exactly 1 is a
        // malformed request and refuses like any other malformed entry, never
        // silently truncates. Transfer-locked copies (bindOnTrade armed or
        // boundTo bound, the shared market rule) never ride a raven: a
        // bind-on-trade windfall must not be mail-launderable.
        if (count !== 1) return;
        if (isTransferLockedInstance(s.instance)) {
          this.result(meta.entityId, 'noMailBound');
          return;
        }
        instancedWanted.push({ itemId: s.itemId, instance: s.instance });
      } else {
        wanted.set(s.itemId, (wanted.get(s.itemId) ?? 0) + count);
      }
    }
    for (const [itemId, count] of wanted) {
      // Count only the fungible stock for plain entries: a plain attachment is
      // never covered by an instanced copy, exactly as the World Market
      // validates against countFungibleItem.
      if (this.ctx.countFungibleItem(itemId, meta.entityId) < count) {
        this.result(meta.entityId, 'notEnoughItems');
        return;
      }
    }
    // Each instanced entry needs a matching UNLOCKED held copy, counting every
    // entry that names the same payload (byte-equal copies are interchangeable;
    // a stripped-lock forgery simply fails to match and lands here too).
    for (const w of instancedWanted) {
      let need = 0;
      for (const other of instancedWanted) {
        if (other.itemId === w.itemId && itemInstancePayloadsEqual(other.instance, w.instance))
          need += 1;
      }
      if (countMatchingUnlocked(meta, w.itemId, w.instance) < need) {
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
    // Escrow: coin and goods leave the sender now, ride with the raven. An
    // instanced entry escrows the ACTUAL matching copy, whose payload
    // (removeMatchingInstance's contract, never the wire needle) is what the
    // letter carries. A plain entry escrows via removeVendorSellUnits (the
    // trade/market walk) with a `skip` that spares every instanced copy
    // (matching the countFungibleItem check above, so an instanced copy is
    // never consumed as a plain stack member), so the escrow reports each
    // removed unit's plain-stack craftedRecipeId marker (bags.ts
    // InvSlot.craftedRecipeId): otherwise a mailed crafted item lands at the
    // recipient with no marker, laundering the disenchant-gate provenance the
    // same way the trade/market fix closed. A single plain entry can legitimately
    // span two provenance buckets (the market's boundstone_helm case), so it
    // splits into one parcel per bucket rather than merging them.
    meta.copper -= coin + MAIL_POSTAGE;
    const parcels: InvSlot[] = [];
    for (const s of items) {
      if (s.instance && typeof s.instance === 'object') {
        const escrowed = removeMatchingInstance(this.ctx, s.itemId, s.instance, meta.entityId);
        // The craft marker rides alongside the payload: an instanced parcel can
        // be crafted too (a masterwork proc, an enchanted crafted piece), so it
        // is carried rather than assumed absent on this arm.
        if (escrowed?.instance)
          parcels.push({
            itemId: s.itemId,
            count: 1,
            instance: escrowed.instance,
            ...(escrowed.craftedRecipeId === undefined
              ? {}
              : { craftedRecipeId: escrowed.craftedRecipeId }),
          });
      } else {
        const count = Math.floor(s.count);
        const consumed = removeVendorSellUnits(
          this.ctx,
          s.itemId,
          count,
          meta.entityId,
          () => true,
        );
        const byRecipe = new Map<string | undefined, number>();
        for (const unit of consumed) {
          byRecipe.set(unit.craftedRecipeId, (byRecipe.get(unit.craftedRecipeId) ?? 0) + 1);
        }
        for (const [craftedRecipeId, bucketCount] of byRecipe) {
          parcels.push({
            itemId: s.itemId,
            count: bucketCount,
            ...(craftedRecipeId === undefined ? {} : { craftedRecipeId }),
          });
        }
      }
    }
    this.book({
      recipientKey: recipient.key,
      recipientName: recipient.name,
      senderName: meta.name,
      senderKey: this.mailKeyFor(meta),
      kind: 'player',
      subject: cleanSubject,
      body: cleanBody,
      copper: coin,
      items: parcels,
      delaySeconds: MAIL_DELIVERY_SECONDS,
    });
    this.result(meta.entityId, 'sent', { name: recipient.name, value: MAIL_POSTAGE });
    // Only a letter carrying coin or parcels counts; a bare note does not.
    if (coin > 0 || items.length > 0) this.ctx.bumpDeedStat(meta, 'mailAttachmentsSent', 1);
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
    const hadAttachments = m.copper > 0 || m.items.length > 0;
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
      // The shared payload-aware pair (bags.ts canGrantCopies + grantCopies):
      // an instanced parcel needs instanced room and lands through
      // addItemInstance so its payload survives delivery; a plain parcel
      // threads its craftedRecipeId marker through so a mailed crafted item
      // keeps its provenance on arrival, the same as the market fix.
      if (
        canGrantCopies(
          meta.inventory,
          bagCapacity(meta.bags),
          s.itemId,
          s.count,
          s.instance,
          s.craftedRecipeId,
        )
      ) {
        grantCopies(this.ctx, meta.entityId, s.itemId, s.count, s.instance, s.craftedRecipeId);
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
      // Attachments remain: expiresAt is untouched here, so the letter's
      // existing clock keeps running. That is Infinity for system/npc mail
      // (their by-construction exemption, see the book() comment below), but a
      // player parcel's real MAIL_ATTACHMENT_EXPIRY_SECONDS deadline still
      // ticks and can still trip returnToSender. The player is told to make
      // room, exactly as the Merchant's collect does.
      this.ctx.error(meta.entityId, 'Your bags are full.');
      return;
    }
    // Fully emptied: the letter leaves its attachment clock (Infinity for
    // system/npc mail, the attachment window for player parcels, either way a
    // returned letter included) and starts the standard emptied-letter window.
    // Only the take that empties it fires, so a repeat take never extends it.
    if (hadAttachments) m.expiresAt = this.ctx.time + MAIL_EXPIRY_SECONDS;
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

  // Heroic Marks reward hook (awardHeroicMarks): posts a participant's marks when
  // they took the daily lockout but were not at the corpse to loot them (a distant
  // healer, a fallen raider). The letter's attachment carries the exact mark count
  // for this kill. No postage, no proximity gate: the raid already earned it.
  mailHeroicMarks(pid: number, itemId: string, count: number): void {
    const meta = this.ctx.players.get(pid);
    if (!meta || count <= 0) return;
    this.sendLetter(
      this.mailKeyFor(meta),
      meta.name,
      { ...HEROIC_MARK_LETTER, items: [{ itemId, count }] },
      'system',
    );
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
    senderKey?: string;
    kind: MailKind;
    letterId?: string;
    subject: string;
    body: string;
    copper: number;
    items: InvSlot[];
    delaySeconds: number;
  }): void {
    const hasAttachments = opts.copper > 0 || opts.items.length > 0;
    // Player parcels ride the attachment window (one return cycle, then the
    // sweep deletes). System and npc parcels get NO clock at all while loaded:
    // that absence, plus the sweep's kind filter, IS their expiry exemption.
    const expiresAt = hasAttachments
      ? opts.kind === 'player'
        ? this.ctx.time + MAIL_ATTACHMENT_EXPIRY_SECONDS
        : Infinity
      : this.ctx.time + MAIL_EXPIRY_SECONDS;
    const msg: MailMessage = {
      id: this.nextMailId++,
      recipientKey: opts.recipientKey,
      recipientName: opts.recipientName,
      senderName: opts.senderName,
      senderKey: opts.senderKey,
      kind: opts.kind,
      letterId: opts.letterId,
      subject: opts.subject,
      body: opts.body,
      copper: opts.copper,
      items: opts.items,
      deliverAt: this.ctx.time + Math.max(0, opts.delaySeconds),
      expiresAt,
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
    return {
      messages: mine.map((m) => ({
        id: m.id,
        senderName: m.senderName,
        kind: m.kind,
        letterId: m.letterId,
        subject: m.subject,
        body: m.body,
        copper: m.copper,
        // Display projection (publicInstanceView: signer/enchant/rolled only).
        // Deliberately ONE projection for the whole inbox surface, the
        // viewer's own letters included (broader than the other-players
        // rationale the trim was named for): the chip tooltip needs only the
        // enchant line and maker's mark, and the full payload stays in the
        // book and arrives with mailTake.
        items: m.items.map((s) =>
          s.instance ? { ...s, instance: publicInstanceView(s.instance) } : { ...s },
        ),
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
      // A rename (or a deactivated-name reclaim, which is a rename in
      // effect) frees oldName for a stranger, so this character's own
      // pre-senderKey OUTGOING letters get the stable id and the new
      // display name: a later return flight must follow the character, not
      // whoever takes the freed name. Same accepted ambiguity as the purge's
      // stamp (a pre-senderKey letter from a PRIOR holder of oldName is
      // stamped with the wrong id), with a sharper consequence here: this
      // id is LIVE, so a mis-stamped letter is re-attributed and its return
      // flight DELIVERS to this character, where the purge's dead-id stamp
      // merely self-destructs. Accepted because a pre-senderKey letter
      // carries no sender identity to distinguish the two, and the current
      // holder is by far the likelier author.
      if (m.kind === 'player' && m.senderKey === undefined && m.senderName === oldName) {
        m.senderKey = key;
        m.senderName = newName;
        changed = true;
      }
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
      // The escrowed payloads follow their owner through the rename the same
      // way the blob sweep's buyback arm does (the fix-round review): a
      // parcel addressed to this character (incoming holdings and every
      // return flight, which re-addresses to the sender) hands these exact
      // copies back, and a stale signer would detach the original-crafter
      // discount, or after a reclaim name a stranger. Scoped to the
      // recipient arm on purpose: a copy sitting in a STRANGER's parcel is
      // foreign-held, the accepted craftedBy limitation.
      if (m.recipientKey === key) {
        for (const slot of m.items) {
          if (rekeySigner(slot.instance, oldName, newName)) changed = true;
        }
      }
    }
    return changed;
  }

  // Character deletion (R43): the deleted character's mailbox leaves the book,
  // matching the SAME dual keys rekeyMailOwner does (stable character-id key plus
  // a legacy name-keyed letter). Letters addressed here can hold OTHER players'
  // escrowed coin and goods, so the book's standing invariant still rules: an
  // unclaimed player parcel flies home through the ordinary return flight rather
  // than being destroyed, and only letters with nothing at stake are deleted:
  //  - a bare note (no coin, no items), read or not;
  //  - a system/npc parcel, whose attachments were minted by the world and have
  //    no live sender to fly home to (their senderKey is absent by construction);
  //  - a player parcel whose return flight has ALREADY run (the sweep's one
  //    sanctioned destruction, the `returned` flag);
  //  - a player parcel the deleted character sent to themselves, whose home key
  //    is the key being purged: the escrow was theirs alone and there is nowhere
  //    left to return it to.
  // The delete arm mirrors the expiry sweep's exactly, so unreadIndex and the
  // in-flight set stay consistent. The senderName fallback is NOT a rare
  // edge at ship time: senderKey landed in this same release (#2450), so
  // every production letter written before it takes the name path until
  // those letters age out of the book (the attachment expiry windows). Its
  // accepted consequences are #2450's own: a sender who renamed since
  // sending is matched by their stale name, and a pre-senderKey letter TO
  // this character whose senderName equals this character's name reads as
  // self-addressed and is deleted (under unique names that sender is the
  // deleted character or a prior holder of the reclaimed name). While the
  // walk is here anyway, the deleted character's own pre-senderKey OUTGOING
  // letters get their stable id stamped, so an eventual return flight lands
  // on the dead id and self-destructs instead of reaching whoever reclaims
  // the freed display name. Returns whether anything changed.
  purgeMailOwner(characterId: number, name: string): boolean {
    if (!Number.isFinite(characterId)) return false;
    const key = String(characterId);
    const now = this.ctx.time;
    const owns = (k: string): boolean => k === key || (name !== '' && k === name);
    let changed = false;
    for (let i = this.mail.length - 1; i >= 0; i--) {
      const m = this.mail[i];
      // The outgoing stamp (see the header): pre-senderKey PLAYER mail this
      // character sent gets the stable id while the book is being walked.
      // Player-kind only: system/npc mail has no senderKey by construction
      // and never returns, and an authored sender name that happens to match
      // a player name must not be re-attributed. A pre-#2450 letter from a
      // PRIOR holder of this name is stamped with the wrong id, an accepted
      // ambiguity: its eventual return then self-destructs on the dead id
      // instead of reaching whoever holds the name next, the lesser wrong.
      if (
        m.kind === 'player' &&
        m.senderKey === undefined &&
        name !== '' &&
        m.senderName === name
      ) {
        m.senderKey = key;
        changed = true;
      }
      if (!owns(m.recipientKey)) continue;
      changed = true;
      const escrowed = m.copper > 0 || m.items.length > 0;
      // returnToSender's own fallback: the stable sender id, or the display name
      // for a letter persisted before senderKey existed.
      const homeKey = m.senderKey ?? m.senderName;
      if (m.kind === 'player' && escrowed && !m.returned && !owns(homeKey)) {
        // Normalize a legacy name-keyed address to the stable id BEFORE the
        // flight: returnToSender records the outgoing address as the new
        // senderKey, and that field must never hold a reclaimable display
        // name (its own comment promises stable-id by construction). Move
        // the letter's delivered-and-unread contribution with the key (the
        // rekeyMailOwner shape), because returnToSender's own decrement
        // reads the field this walk just overwrote; without the move the
        // name bucket keeps a phantom unread the freed name's next holder
        // reads forever. No CURRENT producer books a name-keyed unreturned
        // player letter (returns set `returned`, sends key by id), so this
        // arm serves blobs loadMail preserves verbatim: legacy defense,
        // same standing as the dual-key purge arms themselves.
        if (m.recipientKey !== key && !m.read && now >= m.deliverAt) {
          this.indexDec(m.recipientKey);
          this.indexInc(key);
        }
        m.recipientKey = key;
        this.returnToSender(m, now);
        continue;
      }
      if (!m.read && now >= m.deliverAt) this.indexDec(m.recipientKey);
      this.undelivered.delete(m);
      this.mail.splice(i, 1);
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
        senderKey: m.senderKey,
        kind: m.kind,
        letterId: m.letterId,
        subject: m.subject,
        body: m.body,
        copper: m.copper,
        // cloneInvSlot, not a shallow spread: an instanced parcel's payload
        // must not alias between the live book and the serialized blob.
        items: m.items.map(cloneInvSlot),
        deliverIn: Math.max(0, Math.round(m.deliverAt - now)),
        secondsLeft: Number.isFinite(m.expiresAt) ? Math.max(0, Math.round(m.expiresAt - now)) : -1,
        read: m.read,
        returned: m.returned,
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
    // One aggregated dev-channel line per BOOK load (the character-load
    // idiom): the escrow bound reports what it dropped without logging per
    // row on a systematically corrupt save.
    const escrowDrops: string[] = [];
    for (const m of save.mail ?? []) {
      if (!m || typeof m.recipientKey !== 'string') continue;
      // Keep letters whose attached item id is no longer in ITEMS (a content
      // edit): dormant, recoverable data, exactly like market listings.
      // sanitizeEscrowSlot preserves an instanced parcel's payload and clamps
      // its count to the identical-payload merge cap (the character-load rule).
      // A plain parcel's craftedRecipeId marker rides alongside it (dropped by
      // sanitizeEscrowSlot, which is instance-only), so a mail restart never
      // strips a crafted item's provenance out of an in-flight attachment.
      const items = (m.items ?? [])
        .filter((s) => s && typeof s.itemId === 'string')
        .map((s) => {
          const slot: InvSlot = {
            ...sanitizeEscrowSlot(s, instancedCountCap(ITEMS[s.itemId], s.instance), escrowDrops),
            ...(typeof s.craftedRecipeId === 'string'
              ? { craftedRecipeId: s.craftedRecipeId }
              : {}),
          };
          // The slot-level marker bound every other persisted marker load
          // takes (bag/buyback/bank; item_instance_load.ts doctrine): a mail
          // row can persist forever with no login to self-heal it, so a bare
          // typeof keep would ride an empty or unbounded marker through every
          // serializeMail. Drop-only, reported on the book's aggregate line.
          boundCraftedRecipeIdOnLoad(slot, escrowDrops, 'mailSlot');
          return slot;
        });
      const kind: MailKind = m.kind === 'player' || m.kind === 'npc' ? m.kind : 'system';
      const recipientName = String(m.recipientName ?? m.recipientKey);
      const senderName = String(m.senderName ?? '?');
      const senderKey = typeof m.senderKey === 'string' ? m.senderKey : undefined;
      const subject = String(m.subject ?? '');
      const body = String(m.body ?? '');
      const retainedItems: InvSlot[] = [];
      const returnedItems: InvSlot[] = [];
      for (const item of items) {
        if (kind === 'player' && ITEMS[item.itemId]?.soulbound) returnedItems.push(item);
        else retainedItems.push(item);
      }
      // Migration for player parcels sent before an item became soulbound.
      // Keyed by the STABLE sender id whenever the row carries one (#2450);
      // the display-name fallback serves only rows persisted before ids
      // existed, and a name key here is reclaim-exposed (system mail with
      // attachments never expires), so the fallback must stay the exception.
      // Mark the return as system mail so a serialize/load round trip never
      // returns it again. Ordinary items and attached coin remain on the
      // original letter.
      if (returnedItems.length > 0) {
        returnedParcels.push({
          recipientKey: senderKey ?? senderName,
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
      // Deploy clock: a save written before the attachment window existed
      // persisted player parcels with the never sentinel. Their window starts
      // at this load, never retroactively. System/npc parcels keep Infinity.
      const expiresAt =
        returnedItems.length > 0 && retainedItems.length === 0 && copper <= 0
          ? Math.min(persistedExpiresAt, this.ctx.time + MAIL_EXPIRY_SECONDS)
          : kind === 'player' &&
              (retainedItems.length > 0 || copper > 0) &&
              !Number.isFinite(persistedExpiresAt)
            ? this.ctx.time + MAIL_ATTACHMENT_EXPIRY_SECONDS
            : persistedExpiresAt;
      this.mail.push({
        id: m.id,
        recipientKey: m.recipientKey,
        recipientName,
        senderName,
        senderKey,
        kind,
        letterId: typeof m.letterId === 'string' ? m.letterId : undefined,
        subject,
        body,
        copper,
        items: retainedItems,
        deliverAt: this.ctx.time + deliverIn,
        expiresAt,
        read: m.read === true,
        returned: m.returned === true,
        // Already-delivered letters never re-toast after a restart.
        announced: deliverIn <= 0,
      });
    }
    warnDroppedInstanceKeys('mail book', escrowDrops);
    const maxId = this.mail.reduce((mx, m) => Math.max(mx, m.id + 1), 1);
    this.nextMailId = Math.max(this.nextMailId, save.nextMailId ?? 1, maxId);
    for (const parcel of returnedParcels) this.book(parcel);
    // The unread index is derived state, never persisted: rebuild it from the
    // freshly loaded book.
    this.rebuildUnreadIndex();
  }
}
