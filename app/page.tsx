import { headers } from "next/headers";
import { CreateGame } from "./ui/CreateGame";
import { PublicHome } from "./ui/PublicHome";

export const dynamic = "force-dynamic";

function isAppHostname(host: string | null): boolean {
  const hostname = host?.split(":", 1)[0]?.toLowerCase() ?? "";
  return hostname.startsWith("app.");
}

export default async function HomePage() {
  if (isAppHostname((await headers()).get("host"))) {
    return <CreateGame />;
  }
  return <PublicHome />;
}
