import { redirect } from "next/navigation";
import {
  requireChatGPTUser,
  safeRelativeReturnPath,
} from "@/app/chatgpt-auth";

export const dynamic = "force-dynamic";

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ return_to?: string }>;
}) {
  const parameters = await searchParams;
  const returnTo = safeRelativeReturnPath(parameters.return_to ?? "/");
  await requireChatGPTUser(returnTo);
  redirect(returnTo);
}
