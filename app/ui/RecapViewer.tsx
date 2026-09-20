"use client";

import { Chess } from "chess.js";
import Link from "next/link";
import { useMemo, useState } from "react";
import { isDarkSquare, orientedBoardSquares } from "@/lib/game-presentation";
import { buildReplayFrames, replayFrameLabel } from "@/lib/game-replay";
import type { PublicGameRecap } from "@/lib/game-recaps";
import type { Termination } from "@/lib/game-types";
import { gameVariant } from "@/lib/game-variants";
import { Brand } from "./Brand";
import { ChessPiece } from "./ChessPiece";
import { MoveHistoryPanel } from "./MoveHistoryPanel";

const RESULT_LABELS: Record<Termination, string> = {
  checkmate: "Checkmate",
  resignation: "Resignation",
  stalemate: "Stalemate",
  insufficient_material: "Insufficient material",
  threefold_repetition: "Threefold repetition",
  fivefold_repetition: "Fivefold repetition",
  fifty_move: "Fifty-move rule",
  seventy_five_move: "Seventy-five-move rule",
  cancelled: "Game cancelled",
  timeout: "Time expired",
  draw: "Draw",
};

function recapHeading(recap: PublicGameRecap): string {
  if (recap.outcome.winner === "w") return `${recap.players.white} won`;
  if (recap.outcome.winner === "b") return `${recap.players.black} won`;
  return recap.outcome.reason === "cancelled" ? "Game cancelled" : "Game drawn";
}

export function RecapViewer({ recap }: { recap: PublicGameRecap }) {
  const frames = useMemo(
    () => buildReplayFrames(recap.moves, recap.initialFen),
    [recap.initialFen, recap.moves],
  );
  const [cursor, setCursor] = useState(frames.length - 1);
  const [shareMessage, setShareMessage] = useState("");
  const frame = frames[cursor];
  const chess = useMemo(() => new Chess(frame.fen), [frame.fen]);
  const squares = useMemo(() => orientedBoardSquares("w"), []);
  const variant = gameVariant(recap.variantId);

  async function shareRecap() {
    setShareMessage("");
    const data = {
      title: `${recap.players.white} vs ${recap.players.black} on ChessRiot`,
      text: `Replay this ChessRiot match: ${recapHeading(recap)}.`,
      url: window.location.href,
    };
    try {
      if (typeof navigator.share === "function") {
        await navigator.share(data);
        setShareMessage("Recap shared.");
        return;
      }
      await navigator.clipboard.writeText(window.location.href);
      setShareMessage("Recap link copied.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setShareMessage("Copy this page address to share the recap.");
    }
  }

  return (
    <main className="game-shell recap-shell">
      <header className="topbar recap-topbar">
        <Brand />
        <Link className="home-link" href="/">PLAY CHESS</Link>
      </header>
      <section className="recap-layout">
        <div className="recap-heading">
          <p>SHARED MATCH RECAP</p>
          <h1>{recapHeading(recap)}</h1>
          <div className="recap-meta">
            <span>{RESULT_LABELS[recap.outcome.reason]}</span>
            <span>{variant.name}</span>
            <span>{recap.mode === "solo" ? `Riot Bot level ${recap.aiDifficulty ?? "?"}` : "Multiplayer"}</span>
            {recap.magic ? <span>Magic Rules</span> : null}
            {recap.world ? <Link href={`/worlds/${recap.world.code}`}>World {recap.world.displayCode}</Link> : null}
          </div>
        </div>

        <div className="recap-content">
          <section className="recap-board-column" aria-label="Replay board">
            <div className="recap-players">
              <strong>{recap.players.white}</strong><span>VS</span><strong>{recap.players.black}</strong>
            </div>
            <p className="recap-frame-label" role="status" aria-live="polite">
              {replayFrameLabel(frame)}
            </p>
            <div className="board-wrap recap-board-wrap">
              <div className="chessboard recap-board" role="grid" aria-label={`Read-only replay board, ${replayFrameLabel(frame)}`}>
                {squares.map((square, index) => {
                  const piece = chess.get(square);
                  const highlighted = frame.from === square || frame.to === square;
                  return (
                    <span
                      className={`square ${isDarkSquare(square) ? "dark-square" : "light-square"}${highlighted ? " last-move" : ""}`}
                      role="gridcell"
                      aria-label={`${square}${piece ? ` ${piece.color === "w" ? "white" : "black"} piece` : " empty"}`}
                      key={square}
                    >
                      {index % 8 === 0 ? <span className="rank-label">{square[1]}</span> : null}
                      {index >= 56 ? <span className="file-label">{square[0]}</span> : null}
                      {piece ? <span className={`piece piece-${piece.color}`}><ChessPiece type={piece.type} color={piece.color} /></span> : null}
                    </span>
                  );
                })}
              </div>
            </div>
            <div className="recap-controls" role="group" aria-label="Replay controls">
              <button type="button" onClick={() => setCursor(0)} disabled={cursor === 0}>START</button>
              <button type="button" onClick={() => setCursor((value) => Math.max(0, value - 1))} disabled={cursor === 0}>BACK</button>
              <span>{cursor} / {frames.length - 1}</span>
              <button type="button" onClick={() => setCursor((value) => Math.min(frames.length - 1, value + 1))} disabled={cursor === frames.length - 1}>NEXT</button>
              <button type="button" onClick={() => setCursor(frames.length - 1)} disabled={cursor === frames.length - 1}>FINAL</button>
            </div>
          </section>

          <aside className="recap-details">
            <MoveHistoryPanel moves={recap.moves} currentPly={cursor} />
            <section className="recap-share-card">
              <h2>Share this replay</h2>
              <p>Anyone with this link can see the player names and moves. They cannot join or change the game.</p>
              <button className="secondary-button" type="button" onClick={() => void shareRecap()}>SHARE RECAP LINK</button>
              {shareMessage ? <small role="status">{shareMessage}</small> : null}
            </section>
          </aside>
        </div>
      </section>
    </main>
  );
}
