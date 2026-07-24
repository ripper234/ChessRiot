import type { Metadata } from "next";
import "./globals.css";
import { ClientTelemetry } from "./ui/ClientTelemetry";

export const metadata: Metadata = {
  title: "ChessRiot | Real chess. Total play.",
  description: "Play bold asynchronous chess with someone you know.",
  referrer: "no-referrer",
  other: { "codex-preview": "development" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body><ClientTelemetry />{children}</body>
    </html>
  );
}
