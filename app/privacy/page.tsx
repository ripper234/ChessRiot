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
      <header className="topbar">
        <Brand />
        <nav className="legal-nav" aria-label="Legal pages">
          <Link className="home-link" href="/terms">TERMS</Link>
          <Link className="home-link" href="/">HOME</Link>
        </nav>
      </header>
      <article className="privacy-card">
        <p className="eyebrow"><span /> LAST UPDATED AUGUST 4, 2026</p>
        <h1>PRIVACY</h1>
        <p>
          ChessRiot stores the information needed to run your account and games:
          your chosen permanent username, display name, game and move history, and
          limited operational events used to keep the service reliable.
        </p>
        <h2>What we collect</h2>
        <ul>
          <li>Display names, game settings, moves, results, reactions, and feedback you submit.</li>
          <li>Hashed identifiers for private game access, rate limiting, and operational diagnostics.</li>
          <li>
            Push-notification subscription data only when you explicitly enable notifications
            on a device. It is used for friend requests, turn alerts, and occasional service or test messages, never marketing.
          </li>
          <li>A pseudonymous account ID, Google profile display name, and the unique username you choose.</li>
          <li>Personal invite codes, referral attribution, friend connections, and your non-cash credit ledger, including starter, referral, Magic use, and World creator entries. Creator analytics are exported only as per-World totals; another player’s private game identifiers and timestamps are not disclosed.</li>
          <li>Magic World codes, canonical rules, lineage, game counts, and creator attribution. Raw Magic descriptions are not published with Worlds.</li>
        </ul>
        <h2>Google sign-in</h2>
        <p>
          Google sign-in is required to play and lets your full game history
          follow you across devices. ChessRiot requests only OpenID, email, and profile access. We verify
          your Google account identifier, verified-email status, and profile
          name during sign-in. ChessRiot stores a one-way pseudonymous account
          ID and your display name. It does not store your raw Google account
          identifier, Google access token, refresh token, or email address.
        </p>
        <p>
          A secure, HTTP-only session cookie keeps you signed in for up to one
          year. Successful activity extends that one-year window, unless you
          sign out, delete the account, or the cookie is removed. A separate
          short-lived cookie protects the sign-in transaction. Google processes
          the sign-in under its own privacy terms.
        </p>
        <h2>How we use it</h2>
        <p>
          We use this data to run ChessRiot, synchronize authorized games,
          deliver requested alerts, prevent abuse, answer feedback, and diagnose
          failures. We do not sell personal information or use it for targeted advertising.
        </p>
        <p>
          Privacy-safe product and reliability metrics may include a one-way account
          hash. These operational events exclude usernames, emails, game secrets, and
          raw account IDs. Events stop contributing to metrics after 30 days and are
          physically removed during the next service request after that cutoff.
        </p>
        <p>
          When you open a personal player-invite link, ChessRiot uses that signed
          sign-in path to connect you with the inviter. A referral reward is
          recorded only for a newly created account that completes username
          onboarding. Existing accounts can connect through the same link but do
          not generate another reward.
        </p>
        <h2>Sharing and AI</h2>
        <p>
          Service providers may process data only to host and operate ChessRiot.
          Optional owner-triggered demo narration can send prepared narration
          text to OpenAI. Private seat tokens and raw game secrets are not sent
          for narration. Operational LLM health checks send only a fixed test
          marker and no player or game data.
        </p>
        <h2>Your choices</h2>
        <p>
          You can disable music, effects, coaching, celebrations, or push
          alerts. Signed-in players can use the <Link href="/privacy-center">Privacy &amp; Data center</Link> to
          download their account data, manage blocked players, or permanently
          delete their account after recent Google verification.
        </p>
        <p>
          Account deletion removes the profile, social connections, active access,
          referrals, credit balance, and game membership. Creator attribution is
          removed from Worlds, while immutable World rules and finished game boards
          may remain as anonymized records so results cannot be rewritten. A minimal tombstone
          reserves the deleted username and prevents the same Google identity from
          silently recreating the account.
        </p>
        <p>
          If an account is part of an abuse report, a restricted moderation copy
          may make the involved usernames, category, and submitted note available
          to administrators for no more than 90 days. Expired copies are hidden at
          the cutoff and physically removed during the next service request.
        </p>
        <p className="privacy-contact">
          For a private data question, use the in-app feedback form. Never post
          an invitation token or other game credential
          in a public GitHub issue.
        </p>
        <p>See also the <Link href="/terms">ChessRiot Terms</Link>.</p>
      </article>
    </main>
  );
}
