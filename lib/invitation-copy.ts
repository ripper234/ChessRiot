export interface ClipboardWriter {
  writeText(text: string): Promise<void>;
}

export async function copyInvitationLink(
  inviteUrl: string,
  clipboard: ClipboardWriter | undefined,
): Promise<boolean> {
  if (!inviteUrl || !clipboard) return false;
  try {
    await clipboard.writeText(inviteUrl);
    return true;
  } catch {
    return false;
  }
}
