import Link from "next/link";
import { WHATSAPP_COMMUNITY_URL } from "@/lib/external-links";
import { AnimatedPublicBoard } from "./AnimatedPublicBoard";
import { Brand } from "./Brand";
import { PublicAnalytics } from "./PublicAnalytics";

export function PublicHome() {
  return (
    <main className="public-shell">
      <PublicAnalytics />
      <header className="topbar public-topbar">
        <Brand />
      </header>
      <section className="public-hero">
        <div className="public-copy">
          <p className="public-eyebrow"><span /> CHESS, BUT ALIVE</p>
          <h1>REAL CHESS.<br /><em>TOTAL PLAY.</em></h1>
          <p>
            Play Riot Bot now, or challenge a friend and take your turns when
            you have time. Your game is saved after every move.
          </p>
          <Link className="public-play-button" href="/app">
            PLAY CHESS <span aria-hidden="true">→</span>
          </Link>
          <a
            className="public-community-link"
            href={WHATSAPP_COMMUNITY_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Join the ChessRiot community on WhatsApp (opens in a new tab)"
          >
            JOIN THE COMMUNITY ON WHATSAPP <span aria-hidden="true">↗</span>
          </a>
          <ul aria-label="ChessRiot highlights">
            <li>5 Riot Bot levels</li>
            <li>12 board skins</li>
            <li>Magic Rules by invitation</li>
          </ul>
        </div>
        <div className="public-board-card">
          <AnimatedPublicBoard />
          <p>STANDARD CHESS <span>+</span> OPTIONAL CHAOS</p>
        </div>
      </section>
    </main>
  );
}
