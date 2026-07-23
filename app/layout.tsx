import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ChessRiot | Blocky async chess",
  description: "Play a bold, blocky chess game with someone you know.",
  referrer: "no-referrer",
  other: { "codex-preview": "development" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
