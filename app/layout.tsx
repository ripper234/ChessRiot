import type { Metadata } from "next";
import "./globals.css";
import "./themes.css";
import "./board.css";
import "./combat.css";
import { THEME_BOOTSTRAP_SCRIPT } from "@/lib/themes";
import { ClientTelemetry } from "./ui/ClientTelemetry";
import { RouteChrome } from "./ui/RouteChrome";

export const metadata: Metadata = {
  title: "ChessRiot | Real chess. Total play.",
  description: "Play bold asynchronous chess with someone you know.",
  referrer: "no-referrer",
  applicationName: "ChessRiot",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/chessriot-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/chessriot-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/chessriot-192.png",
  },
  other: { "codex-preview": "development" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} /></head>
      <body>
        <ClientTelemetry />
        {children}
        <RouteChrome />
      </body>
    </html>
  );
}
