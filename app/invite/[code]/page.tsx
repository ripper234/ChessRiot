import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ReferralInvite } from "@/app/ui/ReferralInvite";
import { getReferralPreview, REFERRAL_CREDITS } from "@/lib/referrals";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ReferralInvitePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const preview = await getReferralPreview(code);
  if (!preview) notFound();
  return <ReferralInvite
    code={preview.code}
    inviterUsername={preview.username}
    creditsPerSignup={REFERRAL_CREDITS}
  />;
}
