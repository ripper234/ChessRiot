export function requiredTextError(value: string, message: string): string {
  return value.trim() ? "" : message;
}

export function clearRequiredTextError(value: string, currentError: string): string {
  return currentError && value.trim() ? "" : currentError;
}
