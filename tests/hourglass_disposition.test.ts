import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  groundTelegraphWorld,
  groundTelegraphWireJson,
} from "../server/ground_telegraph_wire";
import { decodeTemporalHourglasses } from "../src/net/ground_telegraph_wire";
import { Sim } from "../src/sim/sim";
import { bareClient } from "./helpers/bare_client";
import { EMPTY_TEST_WORLD } from "./sim_shared";
import { startArenaMatch } from "../src/sim/social/arena";
import { startBgMatch } from "../src/sim/social/battleground";
import { startYumiMatch } from "../src/sim/social/yumi";

function placed() {
  const sim = new Sim({
    seed: 147,
    playerClass: "mage",
    world: EMPTY_TEST_WORLD,
  });
  sim.setPlayerLevel(14);
  expect(sim.setSpec("arcane")).toBe(true);
  sim.tick();
  sim.player.pos = sim.groundPos(700, 0);
  sim.player.prevPos = { ...sim.player.pos };
  sim.player.resource = sim.player.maxResource;
  sim.castAbilityAt("temporal_hourglass", { x: 712, z: 0 });
  sim.tick();
  expect(sim.activeTemporalHourglasses).toHaveLength(1);
  return sim;
}
function rows(sim: Sim, viewerId?: number) {
  const fragment = groundTelegraphWireJson(
    groundTelegraphWorld(sim, 50, 90),
    { x: 712, z: 0 },
    50,
    viewerId,
  );
  return JSON.parse(`{"t":"snap","ents":[]${fragment}}`);
}

describe("Hourglass safety is authored for the actual observer", () => {
  it.each(["2v2", "fiesta", "yumi3", "battleground"] as const)(
    "follows actual %s teams while requiring real eligibility for protection",
    (format) => {
      const sim = new Sim({
        seed: 147,
        playerClass: "mage",
        world: EMPTY_TEST_WORLD,
      });
      const size = format === "battleground" ? 5 : format === "yumi3" ? 3 : 2;
      const allies = [sim.playerId],
        enemies: number[] = [];
      for (let i = 1; i < size; i++)
        allies.push(sim.addPlayer("warrior", `Ally${i}`));
      for (let i = 0; i < size; i++)
        enemies.push(sim.addPlayer("rogue", `Enemy${i}`));
      if (format === "battleground") startBgMatch(sim.ctx, allies, enemies);
      else if (format === "yumi3")
        startYumiMatch(sim.ctx, format, allies, enemies);
      else startArenaMatch(sim.ctx, format, allies, enemies);
      const match =
        format === "battleground"
          ? sim.ctx.bgMatches.get(sim.playerId)
          : sim.ctx.arenaMatches.get(sim.playerId);
      expect(match).toBeDefined();
      for (let i = 0; i < 300 && match!.state !== "active"; i++) sim.tick();
      expect(match!.state).toBe("active");
      expect(sim.temporalHourglassDispositionFor(allies[0], enemies[0])).toBe(
        "hostile",
      );
      expect(sim.temporalHourglassDispositionFor(allies[0], allies[1])).toBe(
        format === "battleground" ? "protective" : "unknown",
      );
      if (format === "battleground") {
        sim.partyLeave(allies[1]);
        expect(sim.temporalHourglassDispositionFor(allies[0], allies[1])).toBe(
          "unknown",
        );
      }
    },
  );

  it("changes a party member from protection to hostile control when a real duel starts", () => {
    const sim = placed(),
      allyId = sim.addPlayer("warrior", "Duel partner");
    const ally = sim.entities.get(allyId)!;
    ally.pos = sim.groundPos(703, 0);
    ally.prevPos = { ...ally.pos };
    sim.partyInvite(allyId, sim.playerId);
    sim.partyAccept(allyId);
    sim.duelRequest(allyId, sim.playerId);
    sim.duelAccept(allyId);
    expect(sim.temporalHourglassDispositionFor(sim.playerId, allyId)).toBe(
      "protective",
    );
    const duel = sim.ctx.duels.get(sim.playerId);
    expect(duel).toBeDefined();
    for (let i = 0; i < 80 && duel!.state !== "active"; i++) sim.tick();
    expect(duel!.state).toBe("active");
    expect(sim.temporalHourglassDispositionFor(sim.playerId, allyId)).toBe(
      "hostile",
    );
  });

  it("matches actual self/party eligibility and remains unknown for unrelated observers or old wire", () => {
    const sim = placed(),
      source = sim.player;
    expect(sim.activeTemporalHourglasses[0]).toMatchObject({
      sourceId: source.id,
      disposition: "protective",
    });
    const allyId = sim.addPlayer("warrior", "Ally");
    sim.partyInvite(allyId, source.id);
    sim.partyAccept(allyId);
    expect(rows(sim, allyId).hourglasses[0].disposition).toBe("protective");
    const outsider = sim.addPlayer("rogue", "Outsider");
    expect(rows(sim, outsider).hourglasses[0].disposition).toBe("unknown");
    expect(rows(sim).hourglasses[0].disposition).toBe("unknown");
    const old = {
      id: "opaque:not-an-owner",
      x: 1,
      z: 2,
      r: 1.75,
      dur: 30,
      rem: 20,
    };
    expect(decodeTemporalHourglasses([old])[0]).toMatchObject({
      sourceId: null,
      disposition: "unknown",
    });
  });

  it("overrides party protection with real jail hostility and respects asymmetric source-to-viewer rules", () => {
    const sim = placed(),
      source = sim.player;
    const allyId = sim.addPlayer("warrior", "Party");
    sim.partyInvite(allyId, source.id);
    sim.partyAccept(allyId);
    const ally = sim.entities.get(allyId)!;
    source.jailed = true;
    ally.jailed = true;
    expect(rows(sim, allyId).hourglasses[0].disposition).toBe("hostile");
    source.jailed = false;
    source.gm = true;
    expect(rows(sim, allyId).hourglasses[0].disposition).toBe("hostile");
    source.gm = false;
    source.jailed = true;
    ally.jailed = false;
    ally.gm = true;
    expect(rows(sim, allyId).hourglasses[0].disposition).toBe("protective");
  });

  it("mirrors the observed player without receiving the hidden owner entity and clears retired traps", () => {
    const sim = placed();
    const target = sim.addPlayer("warrior", "Observed");
    sim.player.jailed = true;
    sim.entities.get(target)!.jailed = true;
    const client = bareClient(target);
    const receiver = client as unknown as {
      applySnapshot(value: unknown): void;
    };
    receiver.applySnapshot(rows(sim, target));
    expect(client.activeTemporalHourglasses[0]).toMatchObject({
      disposition: "hostile",
      radius: 1.75,
      duration: 30,
    });
    receiver.applySnapshot({ t: "snap", ents: [] });
    expect(client.activeTemporalHourglasses).toEqual([]);
    const server = readFileSync(
      new URL("../server/game.ts", import.meta.url),
      "utf8",
    );
    expect(server).toMatch(
      /groundTelegraphWireJson\(telegraphWorld, anchorEntity.pos, aoeBase, anchorEntity.id\)/,
    );
  });
});
