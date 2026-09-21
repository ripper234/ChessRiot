import hebrew from "./he.json";
export type Locale = "en" | "he";
const catalog: Record<string, string> = hebrew;
export function translate(locale: Locale, message: string, values: Record<string, unknown> = {}): string {
  const text = locale === "he" ? catalog[message] ?? message : message;
  return text.replace(/\$\{([^}]+)\}/g, (original, name) => Object.hasOwn(values, name) ? String(values[name]) : original);
}
