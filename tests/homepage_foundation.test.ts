import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";

// db.ts requires DATABASE_URL at import time; set a dummy value before the
// hoisted import runs so the module loads. Queries are spied on the real pool
// (see below), so no actual connection is ever opened.
vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://test/test";
});

import { pool, getAccountsCount } from "../server/db";
import { t, setLanguage, getLanguage } from "../src/ui/i18n";
import { Api } from "../src/net/online";

describe("i18n Translation Foundation", () => {
  beforeEach(() => {
    // Reset to base language
    setLanguage("en");
  });

  it("retrieves English translations by default", () => {
    expect(getLanguage()).toBe("en");
    expect(t("nav.home")).toBe("Home");
    expect(t("stats.playersOnline")).toBe("Players Online");
    expect(t("footer.copyright")).toBe("2026 World of ClaudeCraft");
    expect(t("footer.githubLabel")).toBe("Open Source Project");
    expect(t("nav.highscores")).toBe("High Scores");
    expect(t("nav.wiki")).toBe("Wiki");
    expect(t("nav.news")).toBe("News");
    expect(t("nav.download")).toBe("Download");
    expect(t("nav.loginRegister")).toBe("Login/Register");
    expect(t("highscores.title")).toBe("High Scores Leaderboard");
    expect(t("wiki.title")).toBe("Game Wiki & Guide");
    expect(t("news.title")).toBe("News & Updates");
    expect(t("download.title")).toBe("Download Desktop Launcher");
  });

  it("updates language and retrieves Spanish translations", () => {
    setLanguage("es");
    expect(getLanguage()).toBe("es");
    expect(t("nav.home")).toBe("Inicio");
    expect(t("stats.playersOnline")).toBe("Jugadores en Línea");
    expect(t("footer.copyright")).toBe("2026 World of ClaudeCraft");
    expect(t("footer.githubLabel")).toBe("Proyecto de Código Abierto");
    expect(t("nav.highscores")).toBe("Clasificaciones");
    expect(t("nav.wiki")).toBe("Wiki");
    expect(t("nav.news")).toBe("Noticias");
    expect(t("nav.download")).toBe("Descargar");
    expect(t("nav.loginRegister")).toBe("Iniciar Sesión/Registrarse");
    expect(t("highscores.title")).toBe("Clasificaciones de Puntuación");
    expect(t("wiki.title")).toBe("Wiki y Guía del Juego");
    expect(t("news.title")).toBe("Noticias y Actualizaciones");
    expect(t("download.title")).toBe("Descargar Lanzador de Escritorio");
  });

  it("supports and retrieves translations for all newly added locales", () => {
    const additionalLanguages = [
      { code: "es_ES", play: "Jugar" },
      { code: "fr_FR", play: "Jouer" },
      { code: "fr_CA", play: "Jouer" },
      { code: "en_CA", play: "Play" },
      { code: "it_IT", play: "Gioca" },
      { code: "de_DE", play: "Spielen" },
      { code: "zh_CN", play: "开始游戏" },
      { code: "zh_TW", play: "開始遊戲" },
      { code: "ko_KR", play: "플레이" },
      { code: "ja_JP", play: "プレイ" },
      { code: "pt_BR", play: "Jogar" },
      { code: "ru_RU", play: "Играть" },
    ] as const;

    for (const lang of additionalLanguages) {
      setLanguage(lang.code as any);
      expect(getLanguage()).toBe(lang.code);
      expect(t("nav.play")).toBe(lang.play);
    }
  });

  it("persists language selection in localStorage when available", () => {
    const mockStorage: Record<string, string> = {};
    const originalLocalStorage = global.localStorage;

    // Mock localStorage
    Object.defineProperty(global, "localStorage", {
      value: {
        getItem: (key: string) => mockStorage[key] || null,
        setItem: (key: string, value: string) => {
          mockStorage[key] = value;
        },
      },
      writable: true,
      configurable: true,
    });

    setLanguage("es");
    expect(global.localStorage.getItem("locale")).toBe("es");

    // Restore original localStorage
    if (originalLocalStorage) {
      Object.defineProperty(global, "localStorage", {
        value: originalLocalStorage,
        writable: true,
        configurable: true,
      });
    } else {
      // @ts-ignore
      delete global.localStorage;
    }
  });
});

describe("Database helper getAccountsCount", () => {
  let querySpy: any;

  beforeEach(() => {
    querySpy = vi.spyOn(pool, "query");
  });

  afterEach(() => {
    querySpy.mockRestore();
  });

  it("queries database and returns the integer count", async () => {
    querySpy.mockResolvedValueOnce({
      rows: [{ count: 42 }],
    });

    const count = await getAccountsCount();
    expect(count).toBe(42);
    expect(querySpy).toHaveBeenCalledTimes(1);
    expect(querySpy).toHaveBeenCalledWith("SELECT COUNT(*)::int AS count FROM accounts");
  });

  it("returns 0 when database response is empty", async () => {
    querySpy.mockResolvedValueOnce({
      rows: [],
    });

    const count = await getAccountsCount();
    expect(count).toBe(0);
  });
});

describe("Api.projectStats", () => {
  let fetchSpy: any;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("fetches and returns project stats", async () => {
    const mockStats = {
      accounts_created: 100,
      players_online: 10,
      realm: "Test Realm",
    };

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => mockStats,
    } as Response);

    const api = new Api();
    const stats = await api.projectStats();

    expect(fetchSpy).toHaveBeenCalledWith("/api/project-stats", expect.any(Object));
    expect(stats).toEqual(mockStats);
  });

  it("throws error when request fails", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: "Internal Server Error" }),
    } as Response);

    const api = new Api();
    await expect(api.projectStats()).rejects.toThrow("Internal Server Error");
  });
});
