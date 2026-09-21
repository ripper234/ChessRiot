/** Isolate user-authored text inside a plain-text sentence without changing it. */
export function isolateText(value: string): string {
  return `\u2068${value}\u2069`;
}
