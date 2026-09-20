"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAccountSession } from "./AccountGate";
import { Brand } from "./Brand";

interface WorldSummary {
  code: string;
  displayCode: string;
  labels: string[];
  creatorUsername: string | null;
  createdAt: string;
  gamesPlayed: number;
}

interface WorldDetails extends WorldSummary {
  parents: string[];
  children: string[];
}

interface WorldMapPayload {
  nodes?: WorldSummary[];
  edges?: Array<{ parentCode: string; childCode: string }>;
  worlds?: WorldSummary[];
  world?: WorldDetails;
  error?: { message?: unknown };
}

type WorldView = "map" | "popular" | "new" | "mine";

function worldNodeRadius(gamesPlayed: number): number {
  return Math.max(22, Math.min(58, 22 + 7 * Math.log2(gamesPlayed + 1)));
}

function worldEdgeCoordinates(
  parent: { x: number; y: number; radius: number },
  child: { x: number; y: number; radius: number },
) {
  const dx = child.x - parent.x;
  const dy = child.y - parent.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return null;
  const unitX = dx / distance;
  const unitY = dy / distance;
  return {
    x1: parent.x + unitX * (parent.radius + 2),
    y1: parent.y + unitY * (parent.radius + 2),
    x2: child.x - unitX * (child.radius + 2),
    y2: child.y - unitY * (child.radius + 2),
  };
}

function WorldShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="worlds-shell">
      <header className="topbar worlds-topbar">
        <Brand />
        <nav aria-label="World navigation">
          <Link href="/">HOME</Link>
          <Link className="primary-button" href="/app">NEW GAME</Link>
        </nav>
      </header>
      {children}
    </main>
  );
}

export function WorldBrowser() {
  const [view, setView] = useState<WorldView>("map");
  const [nodes, setNodes] = useState<WorldSummary[]>([]);
  const [edges, setEdges] = useState<WorldMapPayload["edges"]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    const url = view === "map" ? "/api/worlds?view=map" : `/api/worlds?scope=${view}`;
    void fetch(url, { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => {
        const payload = await response.json() as WorldMapPayload;
        if (!response.ok) {
          throw new Error(typeof payload.error?.message === "string"
            ? payload.error.message
            : "Worlds could not be loaded.");
        }
        if (cancelled) return;
        setNodes(payload.nodes ?? payload.worlds ?? []);
        setEdges(payload.edges ?? []);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Worlds could not be loaded.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [view]);

  const positions = useMemo(() => {
    const visible = nodes;
    const centerX = 450;
    const centerY = 260;
    const ringX = 340;
    const ringY = 190;
    return new Map(visible.map((world, index) => {
      const angle = visible.length === 1 ? 0 : (index / visible.length) * Math.PI * 2 - Math.PI / 2;
      const lane = index % 3 === 0 ? 0.72 : 1;
      return [world.code, {
        world,
        x: centerX + Math.cos(angle) * ringX * lane,
        y: centerY + Math.sin(angle) * ringY * lane,
        radius: worldNodeRadius(world.gamesPlayed),
      }] as const;
    }));
  }, [nodes]);
  const visibleEdges = useMemo(() => (edges ?? []).filter((edge) =>
    positions.has(edge.parentCode) && positions.has(edge.childCode)), [edges, positions]);

  return (
    <WorldShell>
      <section className="worlds-stage">
        <div className="worlds-heading">
          <div><p>MAGIC CHESS MULTIVERSE</p><h1>Worlds</h1></div>
          <p>Every code is one immutable rule set. Equivalent phrases and languages lead to the same World.</p>
        </div>
        <nav className="world-tabs" aria-label="World views">
          {(["map", "popular", "new", "mine"] as WorldView[]).map((option) => (
            <button
              type="button"
              key={option}
              aria-pressed={view === option}
              onClick={() => setView(option)}
            >{option.toUpperCase()}</button>
          ))}
        </nav>
        {loading ? <p className="world-state" role="status">LOADING WORLDS…</p> : error ? (
          <p className="world-state form-error" role="alert">{error}</p>
        ) : !nodes.length ? (
          <div className="world-state"><strong>NO WORLDS YET</strong><p>Apply your first Magic Rule to create one.</p><Link className="primary-button" href="/app">CREATE A WORLD</Link></div>
        ) : view === "map" ? (
          <>
            <div className="world-map-wrap">
              <svg
                className="world-map"
                viewBox="0 0 900 520"
                role="group"
                aria-labelledby="world-map-title world-map-description"
              >
                <title id="world-map-title">Connected Magic Worlds</title>
                <desc id="world-map-description">Arrows run from parent Worlds to their forks. Larger Worlds have more played games.</desc>
                <defs><marker id="world-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" /></marker></defs>
                {visibleEdges.map((edge) => {
                  const parent = positions.get(edge.parentCode);
                  const child = positions.get(edge.childCode);
                  if (!parent || !child) return null;
                  const coordinates = worldEdgeCoordinates(parent, child);
                  return coordinates ? (
                    <line key={`${edge.parentCode}:${edge.childCode}`} {...coordinates} markerEnd="url(#world-arrow)" />
                  ) : null;
                })}
                {[...positions.values()].map(({ world, x, y, radius }) => (
                  <a href={`/worlds/${world.code}`} key={world.code} aria-label={`${world.displayCode}, ${world.gamesPlayed} played games`}>
                    <circle cx={x} cy={y} r={radius} />
                    <text x={x} y={y - 2}>{world.displayCode.slice(0, 8)}</text>
                    <text className="world-node-games" x={x} y={y + 13}>{world.gamesPlayed} games</text>
                  </a>
                ))}
              </svg>
            </div>
            <p className="world-map-key">Parent → fork · Node size follows games with at least one human move</p>
            <section className="world-connection-list" aria-labelledby="world-connection-list-title">
              <h2 id="world-connection-list-title">MAP CONNECTIONS</h2>
              {visibleEdges.length ? (
                <ul>
                  {visibleEdges.map((edge) => {
                    const parent = positions.get(edge.parentCode)?.world;
                    const child = positions.get(edge.childCode)?.world;
                    return parent && child ? (
                      <li key={`${edge.parentCode}:${edge.childCode}`}>
                        <Link href={`/worlds/${parent.code}`}>{parent.displayCode}</Link>
                        <span>forked into</span>
                        <Link href={`/worlds/${child.code}`}>{child.displayCode}</Link>
                      </li>
                    ) : null;
                  })}
                </ul>
              ) : <p>No forks connect the Worlds shown on this map yet.</p>}
            </section>
          </>
        ) : null}
        <div className="world-list" aria-label="World list">
          {nodes.map((world) => (
            <Link className="world-list-card" href={`/worlds/${world.code}`} key={world.code}>
              <span className="world-list-orb" style={{ width: worldNodeRadius(world.gamesPlayed), height: worldNodeRadius(world.gamesPlayed) }} aria-hidden="true">✦</span>
              <div><strong>{world.displayCode}</strong><small>{world.labels.join(" · ")}</small></div>
              <span>{world.gamesPlayed} PLAYED<br />{world.creatorUsername ? `@${world.creatorUsername}` : "FORMER PLAYER"}</span>
            </Link>
          ))}
        </div>
      </section>
    </WorldShell>
  );
}

export function WorldDetail({ code }: { code: string }) {
  const account = useAccountSession();
  const [world, setWorld] = useState<WorldDetails | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [requestStatus, setRequestStatus] = useState<"none" | "pending">(
    account.featureRequests.magicRules === "pending" ? "pending" : "none",
  );
  const [requestBusy, setRequestBusy] = useState(false);
  const [requestMessage, setRequestMessage] = useState("");
  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/worlds/${encodeURIComponent(code)}`, {
      cache: "no-store",
      credentials: "same-origin",
    }).then(async (response) => {
      const payload = await response.json() as WorldMapPayload;
      if (!response.ok || !payload.world) {
        throw new Error(typeof payload.error?.message === "string" ? payload.error.message : "World not found.");
      }
      if (!cancelled) setWorld(payload.world);
    }).catch((caught) => {
      if (!cancelled) setError(caught instanceof Error ? caught.message : "World not found.");
    });
    return () => { cancelled = true; };
  }, [code]);

  async function copyCode() {
    if (!world) return;
    setCopyError("");
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(world.code);
      setCopied(true);
    } catch {
      setCopied(false);
      setCopyError("Could not copy automatically. Select the full code above and copy it manually.");
    }
  }

  async function requestMagicAccess() {
    setRequestBusy(true);
    setRequestMessage("");
    try {
      const response = await fetch("/api/me/feature-access", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ feature: "magic_rules" }),
      });
      const payload = await response.json() as {
        status?: unknown;
        error?: { message?: unknown };
      };
      if (!response.ok || (payload.status !== "pending" && payload.status !== "enabled")) {
        throw new Error(typeof payload.error?.message === "string"
          ? payload.error.message
          : "Could not send the request.");
      }
      if (payload.status === "enabled") {
        window.location.reload();
        return;
      }
      setRequestStatus("pending");
      setRequestMessage("Request sent. Play and Fork will unlock here after you are invited.");
    } catch (caught) {
      setRequestMessage(caught instanceof Error ? caught.message : "Could not send the request.");
    } finally {
      setRequestBusy(false);
    }
  }

  return (
    <WorldShell>
      <section className="world-detail-stage">
        {error ? <p className="world-state form-error" role="alert">{error}</p> : !world ? (
          <p className="world-state" role="status">OPENING WORLD…</p>
        ) : (
          <>
            <Link className="world-back" href="/worlds">← ALL WORLDS</Link>
            <div className="world-detail-grid">
              <article className="world-detail-card">
                <span className="world-detail-orb" aria-hidden="true">✦</span>
                <p>MAGIC WORLD</p>
                <h1>{world.displayCode}</h1>
                <code>{world.code}</code>
                <button type="button" onClick={() => void copyCode()}>{copied ? "COPIED ✓" : "COPY CODE"}</button>
                {copyError ? <p className="world-copy-message" role="alert">{copyError}</p> : null}
                <dl>
                  <div><dt>CREATOR</dt><dd>{world.creatorUsername ? `@${world.creatorUsername}` : "Former player"}</dd></div>
                  <div><dt>PLAYED GAMES</dt><dd>{world.gamesPlayed}</dd></div>
                  <div><dt>CREATED</dt><dd>{new Date(world.createdAt).toLocaleDateString()}</dd></div>
                </dl>
              </article>
              <aside className="world-rules-card">
                <p>CANONICAL RULES</p>
                <h2>This World plays differently.</h2>
                <ul>{world.labels.map((label) => <li key={label}>{label}</li>)}</ul>
                {account.features.magicRules ? (
                  <div className="world-actions">
                    <Link className="primary-button" href={`/app?world=${encodeURIComponent(world.code)}`}>PLAY HERE · 1 CREDIT</Link>
                    <Link className="secondary-button" href={`/app?fork=${encodeURIComponent(world.code)}`}>FORK WORLD</Link>
                  </div>
                ) : (
                  <div className="world-access-card">
                    <strong>{requestStatus === "pending" ? "ACCESS REQUESTED" : "MAGIC ACCESS REQUIRED"}</strong>
                    <p>{requestStatus === "pending"
                      ? "The ChessRiot team will review your request. Play and Fork will unlock here if you are invited."
                      : "Ask for an invitation to play in this World or fork its rules."}</p>
                    {requestStatus === "pending" ? null : (
                      <button type="button" disabled={requestBusy} onClick={() => void requestMagicAccess()}>
                        {requestBusy ? "SENDING…" : "REQUEST MAGIC ACCESS"}
                      </button>
                    )}
                    {requestMessage ? <p role="status">{requestMessage}</p> : null}
                  </div>
                )}
              </aside>
            </div>
            <section className="world-lineage">
              <h2>CONNECTIONS</h2>
              <div>
                <article><strong>PARENTS</strong>{world.parents.length ? world.parents.map((parent) => <Link href={`/worlds/${parent}`} key={parent}>{parent}</Link>) : <span>Origin World</span>}</article>
                <article><strong>FORKS</strong>{world.children.length ? world.children.map((child) => <Link href={`/worlds/${child}`} key={child}>{child}</Link>) : <span>No forks yet</span>}</article>
              </div>
            </section>
          </>
        )}
      </section>
    </WorldShell>
  );
}
