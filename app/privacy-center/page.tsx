import type { Metadata } from "next";
import { AccountGate } from "@/app/ui/AccountGate";
import { PrivacyCenter } from "@/app/ui/PrivacyCenter";

export const metadata: Metadata = {
  title: "Privacy & Data | ChessRiot",
  description: "Download your ChessRiot data, manage blocked players, or delete your account.",
};

export default function PrivacyCenterPage() {
  return <AccountGate><PrivacyCenter /></AccountGate>;
}
