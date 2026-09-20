import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/app/ui/Brand";

export const metadata: Metadata = {
  title: "Terms | ChessRiot",
  description: "Terms for using ChessRiot accounts, games, and community features.",
};

export default function TermsPage() {
  return (
    <main className="privacy-shell">
      <header className="topbar">
        <Brand />
        <nav className="legal-nav" aria-label="Legal pages">
          <Link className="home-link" href="/privacy">PRIVACY</Link>
          <Link className="home-link" href="/">HOME</Link>
        </nav>
      </header>
      <article className="privacy-card">
        <p className="eyebrow"><span /> LAST UPDATED AUGUST 3, 2026</p>
        <h1>TERMS</h1>
        <p>
          These terms apply when you use ChessRiot. By playing, creating an
          account session, or submitting content, you agree to use the service
          fairly and lawfully.
        </p>
        <h2>Playing ChessRiot</h2>
        <ul>
          <li>You must sign in with a registered Google account and choose a unique username before playing.</li>
          <li>Your username is permanent, must follow the displayed safety rules, and cannot be changed after you confirm it.</li>
          <li>Private game invitation links are credentials. Keep them private and share them only with the intended player.</li>
          <li>Personal player-invite links may be shared. A qualifying new player creates one referral reward and an automatic friend connection.</li>
          <li>You are responsible for actions taken through links or account sessions under your control.</li>
          <li>Do not automate abuse, interfere with games, probe other players&apos; private data, or disrupt the service.</li>
        </ul>
        <h2>Accounts and content</h2>
        <p>
          Google sign-in associates every game you create or join with a pseudonymous
          ChessRiot account and automatically saves it in your history. You may submit a username,
          reactions, and feedback, but you must not submit unlawful, abusive,
          infringing, or deceptive content. ChessRiot may remove content or
          restrict access when reasonably necessary to protect players or the
          service.
        </p>
        <h2>ChessRiot credits and Magic Worlds</h2>
        <p>
          Credits are promotional, non-transferable in-product units with no
          cash value. A new account receives 10 starter credits. Applying Magic
          to reserve a Magic game costs one credit. A qualifying new-player
          referral awards the inviter 10 credits, and a World creator currently
          earns one credit after each five paid games in which the paying account
          makes a legal move. Rates may change as the system develops. ChessRiot may
          withhold or reverse credits tied to self-referral, duplicate accounts,
          automation, deception, spam Worlds, or other abuse.
        </p>
        <p>
          World codes identify immutable canonical rule sets. Equivalent rule
          descriptions may resolve to the same World and do not create a new
          ownership claim. World codes and lineage are public game content, not
          access credentials or financial assets.
        </p>
        <h2>Game availability</h2>
        <p>
          ChessRiot is evolving. Features, rules, bot behavior, availability,
          and saved data may change. Maintenance, security incidents, provider
          outages, or software defects may interrupt a game. Do not rely on the
          service for prizes, wagering, professional rankings, or other
          high-stakes decisions.
        </p>
        <h2>Fair use and ownership</h2>
        <p>
          ChessRiot&apos;s software, branding, art, and interface remain with their
          respective owners and licensors. You retain rights in content you
          submit and grant ChessRiot permission to process it only as needed to
          operate, secure, and improve the service.
        </p>
        <h2>Service provided as available</h2>
        <p>
          To the extent allowed by law, ChessRiot is provided as available,
          without a promise that it will be uninterrupted or error-free. These
          terms do not limit rights that cannot legally be waived.
        </p>
        <p className="privacy-contact">
          For a private account, data, or terms question, use the in-app
          feedback form. Never include a private seat link or invitation token
          in a public report.
        </p>
        <p>See how data is handled in the <Link href="/privacy">Privacy Policy</Link>.</p>
      </article>
    </main>
  );
}
