import { describe, it, expect } from "vitest";
import { localizeServerText, tServer } from "../src/ui/server_i18n";
import { ensureLocaleLoaded, setLanguage, supportedLanguages } from "../src/ui/i18n";

// Messages the authoritative server emits as plain English; the client must
// re-render them in the active locale (friends/guild/world/who/moderation).
describe("server-sent message localization", () => {
  const samples: string[] = [
    "Mira added to friends.",
    "Your friends list is full.",
    "No character named 'Zzz' exists.",
    "Bob has joined the guild.",
    "Bob is now Officer.",
    "Bob is already Guild Master.",
    "You found the guild <Knights>! You are its Guild Master.",
    "You have been removed from <Knights>.",
    "Mira has been removed from the guild by Bob.",
    "Mira has entered World of ClaudeCraft.",
    "Bob has left the world. (disconnected)",
    "Who: 3 players online on Stormforge.",
    "Who: 1 player online on Stormforge.",
    "...and 5 more.",
    "Server restart in 10 minutes.",
    "Server restart in 5 minutes.",
    "Server restart in 2 minutes.",
    "Server restart in 1 minute.",
    "Server restart in 30 seconds.",
    "Server restart in 10 seconds.",
    "Server restarting now.",
  ];

  it("recognizes and localizes every sample in every non-English locale", async () => {
    for (const lang of supportedLanguages) {
      // The /who header now resolves through the main catalog's CLDR plural keys
      // (tPlural), so its locale slice must be resident - exactly as the app does
      // (the HUD bootstrap awaits ensureLocaleLoaded before any server text paints).
      await ensureLocaleLoaded(lang);
      setLanguage(lang);
      for (const s of samples) {
        const out = localizeServerText(s);
        expect(out, `${lang}: "${s}" should be recognized`).not.toBeNull();
        if (lang !== "en" && lang !== "en_CA") {
          expect(out, `${lang}: "${s}" should not stay English`).not.toBe(s);
        }
      }
    }
    setLanguage("en");
  });

  it("preserves player names, guild names and counts verbatim", () => {
    for (const lang of supportedLanguages) {
      setLanguage(lang);
      expect(localizeServerText("Mira added to friends.")).toContain("Mira");
      expect(localizeServerText("You have been removed from <Knights>.")).toContain("Knights");
      expect(localizeServerText("...and 5 more.")).toContain("5");
      // /who row localizes class + zone but keeps the player name and level number
      const who = localizeServerText("Carl - level 12 warrior - Eastbrook Vale")!;
      expect(who).toContain("Carl");
      expect(who).toContain("12");
    }
    setLanguage("en");
  });

  it("returns null for text that is not a server message", () => {
    setLanguage("es");
    expect(localizeServerText("This is an ordinary chat line.")).toBeNull();
    expect(localizeServerText("")).toBeNull();
    setLanguage("en");
  });

  it("keeps every interpolation placeholder intact across all locales", () => {
    const keys = [
      "friends.added", "guild.alreadyRank", "guild.newMaster", "world.left",
      "who.header", "who.row", "who.more",
    ];
    const expected: Record<string, string> = {
      "friends.added": "name",
      "guild.alreadyRank": "name,rank",
      "guild.newMaster": "guild,name",
      "world.left": "name,reason",
      "who.header": "count,realm",
      "who.row": "className,level,name,status,zone",
      "who.more": "count",
    };
    for (const lang of supportedLanguages) {
      setLanguage(lang);
      for (const key of keys) {
        const raw = tServer(key); // no params -> placeholders survive verbatim
        const found = [...raw.matchAll(/\{([A-Za-z]+)\}/g)].map((m) => m[1]).sort().join(",");
        expect(found, `${lang}.${key} placeholders`).toBe(expected[key]);
      }
    }
    setLanguage("en");
  });
});

// Concrete round-trips for the chat-moderation RULES (the strings the server emits at
// runtime after substituting the count). Pinned to es + de_DE so a RULE that stops
// matching, stops interpolating, or loses a dialect bites with an exact mismatch.
describe("chat-moderation strings round-trip through localizeServerText", () => {
  const cases: { input: string; es: string; de: string }[] = [
    {
      input: "You are muted from chat for 5 more minutes.",
      es: "Estás silenciado en el chat durante 5 minutos más.",
      de: "Ihr seid noch 5 Minuten lang vom Chat stummgeschaltet.",
    },
    {
      input: "You are muted from chat for 1 more minute.",
      es: "Estás silenciado en el chat durante 1 minuto más.",
      de: "Ihr seid noch 1 Minute lang vom Chat stummgeschaltet.",
    },
    {
      input: "That language isn't allowed here. You're muted for 5 minutes.",
      es: "Ese lenguaje no está permitido aquí. Estás silenciado durante 5 minutos.",
      de: "Diese Sprache ist hier nicht erlaubt. Ihr seid für 5 Minuten stummgeschaltet.",
    },
    {
      input: "Chat is on cooldown for 5s.",
      es: "El chat está en recarga durante 5s.",
      de: "Chat hat noch 5s Abklingzeit.",
    },
  ];

  it("renders the exact localized form in es and de_DE", () => {
    for (const c of cases) {
      setLanguage("es");
      expect(localizeServerText(c.input), `es: ${c.input}`).toBe(c.es);
      setLanguage("de_DE");
      expect(localizeServerText(c.input), `de_DE: ${c.input}`).toBe(c.de);
    }
    setLanguage("en");
  });

  it("recognizes but does not alter the English source under en / en_CA", () => {
    for (const c of cases) {
      for (const lang of ["en", "en_CA"] as const) {
        setLanguage(lang);
        expect(localizeServerText(c.input), `${lang}: ${c.input}`).toBe(c.input);
      }
    }
    setLanguage("en");
  });
});

// localizeServerDuration is module-private; exercise it through the filter-mute RULE
// whose build() calls it. These duration strings are exactly what server/game.ts's
// formatDuration emits ("1 minute" / "5 minutes" / "1 hour" / "3 days").
describe("localizeServerDuration maps formatDuration output (via the filter-mute RULE)", () => {
  const cases: { duration: string; es: string }[] = [
    { duration: "1 minute", es: "1 minuto" },
    { duration: "5 minutes", es: "5 minutos" },
    { duration: "1 hour", es: "1 hora" },
    { duration: "3 days", es: "3 días" },
  ];

  it("localizes each duration unit inside the filter-mute notice (es)", () => {
    setLanguage("es");
    for (const c of cases) {
      const input = `You are muted and can't chat for another ${c.duration}.`;
      expect(localizeServerText(input), `es duration ${c.duration}`)
        .toBe(`Estás silenciado y no puedes chatear durante ${c.es} más.`);
    }
    setLanguage("en");
  });
});
