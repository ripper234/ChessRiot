import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Brand } from "@/app/ui/Brand";
import {
  requireChatGPTUser,
  safeRelativeReturnPath,
} from "@/app/chatgpt-auth";
import { verifiedAccountFromHeaders } from "@/lib/account-auth";
import { turnstileSiteKey } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ return_to?: string; failed?: string }>;
}) {
  const parameters = await searchParams;
  const returnTo = safeRelativeReturnPath(parameters.return_to ?? "/");
  await requireChatGPTUser(`/verify?return_to=${encodeURIComponent(returnTo)}`);
  if (await verifiedAccountFromHeaders(await headers())) redirect(returnTo);
  const siteKey = turnstileSiteKey();

  return (
    <main className="account-shell">
      <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />
      <header className="topbar"><Brand /></header>
      <section className="account-stage">
        <form className="voxel-card account-card" action="/api/auth/captcha" method="post">
          <span className="card-kicker">ACCOUNT SECURITY</span>
          <h1>One quick human check</h1>
          <p>This protects ChessRiot from bots and keeps games tied to your account.</p>
          <input type="hidden" name="returnTo" value={returnTo} />
          {siteKey ? (
            <div
              className="cf-turnstile"
              data-sitekey={siteKey}
              data-action="chessriot_login"
              data-theme="dark"
            />
          ) : (
            <p className="form-error" role="alert">Human verification is not configured.</p>
          )}
          {parameters.failed ? (
            <p className="form-error" role="alert">That check expired or failed. Please try again.</p>
          ) : null}
          <button className="primary-button" disabled={!siteKey}>CONTINUE  →</button>
          <Link className="account-exit" href="/signout-with-chatgpt?return_to=%2F">
            Use another account
          </Link>
        </form>
      </section>
    </main>
  );
}
