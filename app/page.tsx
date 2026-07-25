import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Brand } from "./ui/Brand";
import { CreateGame } from "./ui/CreateGame";
import {
  chatGPTSignInPath,
  getChatGPTUser,
} from "./chatgpt-auth";
import { verifiedAccountFromHeaders } from "@/lib/account-auth";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getChatGPTUser();
  if (!user) {
    return (
      <main className="account-shell">
        <header className="topbar"><Brand /></header>
        <section className="account-stage">
          <div className="voxel-card account-card">
            <span className="card-kicker">PLAY SECURELY</span>
            <h1>Your board is waiting</h1>
            <p>Sign in and your games stay with your account.</p>
            <Link className="primary-button" href={chatGPTSignInPath("/")}>
              SIGN IN TO PLAY  →
            </Link>
            <Link className="account-exit" href="/changelog">See what&apos;s new</Link>
          </div>
        </section>
      </main>
    );
  }
  const account = await verifiedAccountFromHeaders(await headers());
  if (!account) redirect("/verify?return_to=%2F");
  return <CreateGame displayName={account.displayName} />;
}
