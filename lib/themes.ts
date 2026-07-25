export const THEME_STORAGE_KEY = "chessriot:theme";

export const THEMES = [
  {
    id: "classic",
    name: "Classic",
    description: "Ivory and walnut",
    preview: ["#f0d9b5", "#b58863", "#211a17", "#d5a94f"],
    art: null,
  },
  {
    id: "ocean",
    name: "Ocean",
    description: "Cool blue tournament",
    preview: ["#d7eef2", "#4d8195", "#102d3c", "#69d8f2"],
    art: null,
  },
  {
    id: "blockfield",
    name: "Blockfield",
    description: "Voxel grass and stone",
    preview: ["#d4c47f", "#5d8c3d", "#3f5052", "#ffd65a"],
    art: "/themes/blockfield.webp",
  },
  {
    id: "toybox",
    name: "Toybox",
    description: "Bright toy-brick blocks",
    preview: ["#ffe39a", "#e44e3f", "#2767c8", "#53b95a"],
    art: "/themes/toybox.webp",
  },
  {
    id: "arena-pop",
    name: "Arena Pop",
    description: "Punchy competitive color",
    preview: ["#7ee8ff", "#7445c8", "#25164b", "#ffcd3c"],
    art: "/themes/arena-pop.webp",
  },
  {
    id: "high-fantasy",
    name: "High Fantasy",
    description: "Forest and forged bronze",
    preview: ["#d9c690", "#426045", "#18271f", "#c48b42"],
    art: "/themes/high-fantasy.webp",
  },
  {
    id: "arcane-cards",
    name: "Arcane Cards",
    description: "Parchment and spell gold",
    preview: ["#ead7a4", "#7a3544", "#211522", "#d7a84b"],
    art: "/themes/arcane-cards.webp",
  },
  {
    id: "iron-legions",
    name: "Iron Legions",
    description: "Rain-dark medieval armies",
    preview: ["#d8d0c0", "#4b555b", "#171b1d", "#b74b3e"],
    art: "/themes/iron-legions.webp",
  },
  {
    id: "shadow-shogun",
    name: "Shadow Shogun",
    description: "Moonlit castle garden",
    preview: ["#e8e0ce", "#39332f", "#0d1117", "#c04e3f"],
    art: "/themes/shadow-shogun.webp",
  },
  {
    id: "neon-grid",
    name: "Neon Grid",
    description: "Electric midnight",
    preview: ["#a9f8ff", "#1d5675", "#080b18", "#ff4fd8"],
    art: null,
  },
  {
    id: "mono",
    name: "Mono",
    description: "Quiet black and white",
    preview: ["#ececec", "#777777", "#171717", "#ffffff"],
    art: null,
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
