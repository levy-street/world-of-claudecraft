import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';
import { chatBubbleStyle } from '../src/ui/chat_bubble_style';

const repoRoot = join(__dirname, '..');

function chatEvents(events: SimEvent[]): Extract<SimEvent, { type: 'chat' }>[] {
  return events.filter((e): e is Extract<SimEvent, { type: 'chat' }> => e.type === 'chat');
}

function teleport(sim: Sim, pid: number, x: number, z: number) {
  const e = sim.entities.get(pid)!;
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

describe('chatBubbleStyle: which channels bubble and how', () => {
  it('tints the border (not the text) for party, matching the chat-log palette', () => {
    // The bubble background is near-white, so the channel colours the BORDER only
    // and keeps the dark text (legibility). This hex is the same one the chat log
    // uses for party, so line and bubble match.
    expect(chatBubbleStyle('party')).toEqual({ border: '#7fd4ff' });
    // No `yell` treatment and, crucially, no text recolour for the party bubble.
    expect(chatBubbleStyle('party')?.yell).toBeUndefined();
  });

  it('keeps say/yell/emote on their existing treatment (byte-identical visuals)', () => {
    // say and emote get the plain default bubble: no border override, no yell.
    expect(chatBubbleStyle('say')).toEqual({});
    expect(chatBubbleStyle('emote')).toEqual({});
    // yell keeps its bespoke `.yell` class (bold, red border) and no inline border.
    expect(chatBubbleStyle('yell')).toEqual({ yell: true });
    expect(chatBubbleStyle('yell')?.border).toBeUndefined();
  });

  it('never bubbles the noisy, private, or no-anchor channels', () => {
    // general/world/lfg/whisper/roll are too noisy or private. guild/officer are
    // server social broadcasts that carry no speaker id, so there is no entity to
    // anchor a bubble to today; bubbling them is a server/wire follow-up.
    for (const ch of ['general', 'world', 'lfg', 'whisper', 'roll', 'guild', 'officer']) {
      expect(chatBubbleStyle(ch)).toBeNull();
    }
  });

  it('returns null for an unknown or future channel', () => {
    expect(chatBubbleStyle('trade')).toBeNull();
    expect(chatBubbleStyle('')).toBeNull();
  });
});

describe('party chat carries a client-usable bubble anchor without a sim change', () => {
  it('emits fromPid equal to the speaker entity id (the client bubble anchor)', () => {
    // party chat events do NOT carry entityId, but their fromPid IS the speaker's
    // entity id (its emit sets fromPid = the player entity). The HUD gate anchors
    // the party bubble on `entityId ?? fromPid`, so party bubbles with no sim or
    // wire change. This pins that the anchor field is actually populated.
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    teleport(sim, a, 0, -40);
    teleport(sim, b, 2, -40);
    sim.tick();
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    sim.tick();

    sim.chat('/p forming up', a);
    const msgs = chatEvents(sim.tick());
    const party = msgs.filter((m) => m.channel === 'party');
    expect(party.length).toBeGreaterThan(0);
    // fromPid names the speaker entity a; entityId stays unset (no sim change).
    expect(party.every((m) => m.fromPid === a)).toBe(true);
    expect(party.every((m) => m.entityId === undefined)).toBe(true);
  });
});

describe('the HUD bubble gate wires the pure style module', () => {
  const hudSrc = readFileSync(join(repoRoot, 'src/ui/hud.ts'), 'utf8');
  const rendererSrc = readFileSync(join(repoRoot, 'src/render/renderer.ts'), 'utf8');

  it('routes the bubble decision through chatBubbleStyle and the entityId/fromPid anchor', () => {
    expect(hudSrc).toContain('chatBubbleStyle(ev.channel)');
    expect(hudSrc).toContain('ev.entityId ?? ev.fromPid');
    // The old say/yell/emote-only literal gate is gone, so party/guild/officer
    // now flow through the shared decision.
    expect(hudSrc).not.toContain(
      "ev.channel === 'say' || ev.channel === 'yell' || ev.channel === 'emote'",
    );
  });

  it('applies the channel border tint inline in the renderer', () => {
    expect(rendererSrc).toContain('s.border');
    expect(rendererSrc).toContain('borderColor');
  });
});
