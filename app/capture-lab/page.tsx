import type { Metadata } from "next";
import { CaptureLab } from "../ui/CaptureLab";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function CaptureLabPage() {
  return <CaptureLab />;
}
