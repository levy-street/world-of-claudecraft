type Prev = [never, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

type Join<K, P> = K extends string | number
  ? P extends string | number
    ? `${K}${"" extends P ? "" : "."}${P}`
    : never
  : never;

export type Leaves<T, D extends number = 5> = [D] extends [never]
  ? never
  : T extends object
  ? { [K in keyof T]-?: Join<K, Leaves<T[K], Prev[D]>> }[keyof T]
  : "";

export const en = {
  nav: {
    home: "Home",
    play: "Play",
    stats: "Statistics",
    about: "About",
  },
  stats: {
    title: "Realm Status",
    accountsCreated: "Accounts Created",
    playersOnline: "Players Online",
    realmName: "Realm Name",
  },
  footer: {
    copyright: "2026 World of Claudecraft",
    githubLink: "https://github.com/levy-street/world-of-claudecraft",
    githubLabel: "Open Source Project",
    terms: "Terms of Service",
    privacy: "Privacy Policy",
  },
  comingSoon: {
    placeholder: "Coming Soon...",
  },
};

export const es: typeof en = {
  nav: {
    home: "Inicio",
    play: "Jugar",
    stats: "Estadísticas",
    about: "Acerca de",
  },
  stats: {
    title: "Estado del Reino",
    accountsCreated: "Cuentas Creadas",
    playersOnline: "Jugadores en Línea",
    realmName: "Nombre del Reino",
  },
  footer: {
    copyright: "2026 World of Claudecraft",
    githubLink: "https://github.com/levy-street/world-of-claudecraft",
    githubLabel: "Proyecto de Código Abierto",
    terms: "Términos de Servicio",
    privacy: "Política de Privacidad",
  },
  comingSoon: {
    placeholder: "Próximamente...",
  },
};

const translations = { en, es };

let currentLanguage: "en" | "es" = "en";

// Initialize language from localStorage if available (browser environments)
if (typeof localStorage !== "undefined") {
  const saved = localStorage.getItem("locale");
  if (saved === "en" || saved === "es") {
    currentLanguage = saved;
  }
}

export function getLanguage(): "en" | "es" {
  return currentLanguage;
}

export function setLanguage(lang: "en" | "es"): void {
  currentLanguage = lang;
  if (typeof localStorage !== "undefined") {
    localStorage.setItem("locale", lang);
  }
}

export function t(key: Leaves<typeof en>): string {
  const parts = key.split(".");
  let current: any = translations[currentLanguage];
  for (const part of parts) {
    if (current && typeof current === "object") {
      current = current[part];
    } else {
      return key;
    }
  }
  return typeof current === "string" ? current : key;
}
