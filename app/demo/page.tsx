import Link from "next/link";
import { DEMO_VIDEO_NARRATION } from "@/lib/demo-video";
import { Brand } from "../ui/Brand";
import { DemoPlayer } from "../ui/DemoPlayer";

export const metadata = {
  title: "90-second demo | ChessRiot",
  description: "See ChessRiot Solo and private multiplayer play in 90 seconds.",
};

export default function DemoPage() {
  return (
    <main className="demo-shell">
      <header className="topbar demo-topbar">
        <Brand />
        <nav className="public-nav" aria-label="ChessRiot">
          <Link className="public-nav-link" href="/">HOME</Link>
          <Link className="public-nav-link" href="/changelog">WHAT&apos;S NEW</Link>
        </nav>
      </header>
      <section className="demo-page">
        <div className="demo-heading">
          <p className="public-eyebrow"><span /> SEE CHESSRIOT IN ACTION</p>
          <h1>90 SECONDS.<br /><em>YOUR MOVE.</em></h1>
          <p>
            Riot Bot, original themes, private asynchronous matches, replay,
            and a first look at Magic Rules.
          </p>
        </div>
        <DemoPlayer />
        <details className="demo-transcript">
          <summary>READ VIDEO TRANSCRIPT</summary>
          <div>
            {DEMO_VIDEO_NARRATION.split("\n\n").map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
        </details>
        <div className="demo-actions">
          <Link className="public-play-button" href="/app">
            PLAY CHESS <span aria-hidden="true">→</span>
          </Link>
          <p>
            The narration voice is AI-generated. The walkthrough uses real
            ChessRiot interface captures.
          </p>
        </div>
      </section>
    </main>
  );
}
