import Link from "next/link";
import { Brand } from "./Brand";

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
            Play Riot Bot or challenge someone you know. Add optional Magic
            Rules when ordinary chess is not unruly enough.
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
            <li>Optional Magic Rules</li>
          </ul>
        </div>
        <div className="public-board-card" aria-hidden="true">
          <div className="public-board">
            <span>♜</span><span>♞</span><span>♝</span><span>♛</span>
            <span>♚</span><span>♝</span><span>♞</span><span>♜</span>
            <i /><i /><i /><i /><i /><i /><i /><i />
            <i /><i /><i /><i /><i /><i /><i /><i />
            <i /><i /><i /><i /><i /><i /><i /><i />
            <i /><i /><i /><i /><i /><i /><i /><i />
            <b>♟</b><b>♟</b><b>♟</b><b>♟</b>
            <b>♟</b><b>♟</b><b>♟</b><b>♟</b>
            <strong>♜</strong><strong>♞</strong><strong>♝</strong><strong>♛</strong>
            <strong>♚</strong><strong>♝</strong><strong>♞</strong><strong>♜</strong>
          </div>
          <p>STANDARD CHESS <span>+</span> OPTIONAL CHAOS</p>
        </div>
      </section>
    </main>
  );
}
