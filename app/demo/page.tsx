import Link from "next/link";
import { DEMO_VIDEO_NARRATION } from "@/lib/demo-video";
import { Brand } from "../ui/Brand";
import { DemoPlayer } from "../ui/DemoPlayer";

export const metadata = {
  title: "90-second demo | ChessRiot",
  description: "See Ron and Omri keep one private chess match moving across a real day.",
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
          <h1>ChessRiot in 90 seconds</h1>
          <p>One family, one private match, and a game that survives real life.</p>
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
            The narration voice is synthetic. The walkthrough uses real
            ChessRiot interface captures.
          </p>
        </div>
      </section>
    </main>
  );
}
