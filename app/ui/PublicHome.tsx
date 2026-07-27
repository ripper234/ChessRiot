import Link from "next/link";
import type { PieceSymbol } from "chess.js";
import type { Color } from "@/lib/game-types";
import { Brand } from "./Brand";
import { ChessPiece } from "./ChessPiece";

const BACK_RANK: PieceSymbol[] = ["r", "n", "b", "q", "k", "b", "n", "r"];
const PUBLIC_POSITION: Array<{ type: PieceSymbol; color: Color } | null> = [
  ...BACK_RANK.map((type) => ({ type, color: "b" as const })),
  ...Array.from({ length: 8 }, () => ({ type: "p" as const, color: "b" as const })),
  ...Array.from({ length: 32 }, () => null),
  ...Array.from({ length: 8 }, () => ({ type: "p" as const, color: "w" as const })),
  ...BACK_RANK.map((type) => ({ type, color: "w" as const })),
];

export function PublicHome() {
  return (
    <main className="public-shell">
      <header className="topbar public-topbar">
        <Brand />
        <nav className="public-nav" aria-label="ChessRiot">
          <Link className="public-nav-link" href="/demo">90-SEC DEMO</Link>
          <Link className="public-nav-link" href="/changelog">WHAT&apos;S NEW</Link>
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
          <ul aria-label="ChessRiot highlights">
            <li>Solo or multiplayer</li>
            <li>Three-day turns</li>
            <li>Magic Rules coming soon</li>
          </ul>
        </div>
        <div className="public-board-card" aria-hidden="true">
          <div className="public-board">
            {PUBLIC_POSITION.map((piece, index) => (
              <span key={index}>
                {piece ? <ChessPiece type={piece.type} color={piece.color} /> : null}
              </span>
            ))}
          </div>
          <p>STANDARD CHESS <span>+</span> OPTIONAL CHAOS</p>
        </div>
      </section>
    </main>
  );
}
