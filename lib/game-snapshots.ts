export function shouldAcceptGameSnapshot(currentVersion: number, incomingVersion: number): boolean {
  return incomingVersion > currentVersion;
}
