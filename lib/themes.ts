export const THEME_STORAGE_KEY = "chessriot:theme";

export const THEMES = [
  {
    id: "classic",
    name: "Classic",
    description: "Ivory and walnut",
    preview: ["#f0d9b5", "#b58863", "#211a17", "#d5a94f"],
  },
  {
    id: "ocean",
    name: "Ocean",
    description: "Cool blue tournament",
    preview: ["#d7eef2", "#4d8195", "#102d3c", "#69d8f2"],
  },
  {
    id: "blockfield",
    name: "Blockfield",
    description: "Voxel grass and stone",
    preview: ["#d4c47f", "#5d8c3d", "#3f5052", "#ffd65a"],
  },
  {
    id: "toybox",
    name: "Toybox",
    description: "Bright toy-brick blocks",
    preview: ["#ffe39a", "#e44e3f", "#2767c8", "#53b95a"],
  },
  {
    id: "arena-pop",
    name: "Arena Pop",
    description: "Punchy competitive color",
    preview: ["#7ee8ff", "#7445c8", "#25164b", "#ffcd3c"],
  },
  {
    id: "high-fantasy",
    name: "High Fantasy",
    description: "Forest and forged bronze",
    preview: ["#d9c690", "#426045", "#18271f", "#c48b42"],
  },
  {
    id: "arcane-cards",
    name: "Arcane Cards",
    description: "Parchment and spell gold",
    preview: ["#ead7a4", "#7a3544", "#211522", "#d7a84b"],
  },
  {
    id: "neon-grid",
    name: "Neon Grid",
    description: "Electric midnight",
    preview: ["#a9f8ff", "#1d5675", "#080b18", "#ff4fd8"],
  },
  {
    id: "mono",
    name: "Mono",
    description: "Quiet black and white",
    preview: ["#ececec", "#777777", "#171717", "#ffffff"],
  },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

export const DEFAULT_THEME: ThemeId = "blockfield";

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && THEMES.some((theme) => theme.id === value);
}

export function normalizeTheme(value: unknown): ThemeId {
  return isThemeId(value) ? value : DEFAULT_THEME;
}

const allowedThemeIds = JSON.stringify(THEMES.map((theme) => theme.id));

export const THEME_BOOTSTRAP_SCRIPT =
  `(()=>{try{const value=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});` +
  `const allowed=${allowedThemeIds};if(allowed.includes(value))document.documentElement.dataset.theme=value;` +
  "}catch{}})();";
