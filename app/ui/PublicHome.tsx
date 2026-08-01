import Link from "next/link";
import { WHATSAPP_COMMUNITY_URL } from "@/lib/external-links";
import { AnimatedPublicBoard } from "./AnimatedPublicBoard";
import { Brand } from "./Brand";

export function PublicHome() {
  return (
    <main className="public-shell">
      <header className="topbar public-topbar">
        <Brand />
        <nav className="public-nav" aria-label="ChessRiot">
          <Link className="public-nav-link" href="/demo">90-SEC DEMO</Link>
          <Link className="public-nav-link" href="/privacy">PRIVACY</Link>
        </nav>
      </header>
      <section className="public-hero">
        <div className="public-copy">
          <p className="public-eyebrow"><span /> CHESS, BUT ALIVE</p>
          <h1>REAL CHESS.<br /><em>TOTAL PLAY.</em></h1>
          <p>
            Play Riot Bot or challenge someone you know. Magic Rules are
            brewing on a separate experimental branch.
          </p>
          <Link className="public-play-button" href="/app">
            PLAY CHESS <span aria-hidden="true">→</span>
          </Link>
          <Link className="public-demo-link" href="/demo">
            WATCH THE 90-SECOND DEMO <span aria-hidden="true">▶</span>
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
            <li>Solo or multiplayer</li>
            <li>Three-day turns</li>
            <li>Magic Rules coming soon</li>
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
