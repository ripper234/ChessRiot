import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/app/ui/Brand";

export const metadata: Metadata = {
  title: "Privacy | ChessRiot",
  description: "How ChessRiot handles game, account, feedback, and operational data.",
};

export default function PrivacyPage() {
  return (
    <main className="privacy-shell">
      <header className="topbar"><Brand /><Link className="home-link" href="/">HOME</Link></header>
      <article className="privacy-card">
        <p className="eyebrow"><span /> LAST UPDATED AUGUST 1, 2026</p>
        <h1>PRIVACY</h1>
        <p>
          ChessRiot stores the information needed to run your games: your chosen
          display name, game and move history, private seat access records, and
          limited operational events used to keep the service reliable.
        </p>
        <h2>What we collect</h2>
        <ul>
          <li>Display names, game settings, moves, results, reactions, and feedback you submit.</li>
          <li>Hashed identifiers for private game access, rate limiting, and operational diagnostics.</li>
          <li>Push-notification subscription data only when you explicitly enable turn alerts.</li>
          <li>Basic account profile information, such as name and email, if you choose Google sign-in after it becomes available.</li>
        </ul>
        <h2>How we use it</h2>
        <p>
          We use this data to run ChessRiot, synchronize authorized games,
          deliver requested alerts, prevent abuse, answer feedback, and diagnose
          failures. We do not sell personal information or use it for targeted advertising.
        </p>
        <h2>Sharing and AI</h2>
        <p>
          Service providers may process data only to host and operate ChessRiot.
          Optional owner-triggered demo narration can send prepared narration
          text to OpenAI. Private seat tokens and raw game secrets are not sent
          for narration.
        </p>
        <h2>Your choices</h2>
        <p>
          You can play as a guest, disable music, effects, coaching, celebrations,
          and push alerts, or ask for deletion through the in-app feedback form.
          Include the relevant game IDs; we may ask you to verify control of the
          corresponding private seat link before changing game data.
        </p>
        <p className="privacy-contact">
          For a private data question or deletion request, use the in-app
          feedback form. Never post a private seat link, invitation token, or
          other game credential in a public GitHub issue.
        </p>
      </article>
    </main>
  );
}
