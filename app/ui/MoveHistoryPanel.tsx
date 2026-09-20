import type { PublicMove } from "@/lib/game-types";

function moveText(move: PublicMove | undefined): string {
  if (!move) return "—";
  const continuation = move.continuation?.length
    ? move.continuation
    : move.second ? [move.second] : [];
  return [move, ...continuation]
    .map((leg) => `${leg.san.includes("x") ? "⚔ " : ""}${leg.san}`)
    .join(" → ");
}

type HistoryLocale = "en" | "he";

export function currentMoveLabel(
  moves: PublicMove[],
  currentPly: number,
  locale: HistoryLocale = "en",
): string {
  const summary = currentMoveSummary(moves, currentPly, locale);
  return summary.notation ? `${summary.label} ${summary.notation}` : summary.label;
}

function currentMoveSummary(
  moves: PublicMove[],
  currentPly: number,
  locale: HistoryLocale,
): { label: string; notation: string | null } {
  const hebrew = locale === "he";
  if (currentPly <= 0) return {
    label: hebrew ? "עמדת פתיחה" : "Starting position",
    notation: null,
  };
  const move = moves.find((candidate) => candidate.ply === currentPly)
    ?? moves[currentPly - 1];
  if (!move) return {
    label: hebrew ? `מהלך ${currentPly}` : `Move ${currentPly}`,
    notation: null,
  };
  const side = move.color === "w"
    ? hebrew ? "לבן" : "White"
    : hebrew ? "שחור" : "Black";
  return {
    label: `${Math.ceil(move.ply / 2)}. ${side}`,
    notation: moveText(move),
  };
}

export function MoveHistoryPanel({
  moves,
  currentPly,
  locale = "en",
}: {
  moves: PublicMove[];
  currentPly: number;
  locale?: HistoryLocale;
}) {
  const hebrew = locale === "he";
  const rows = Array.from({ length: Math.ceil(moves.length / 2) }, (_, index) => ({
    number: index + 1,
    white: moves[index * 2],
    black: moves[index * 2 + 1],
  }));
  const current = currentMoveSummary(moves, currentPly, locale);

  return (
    <details className="side-card move-history-panel" dir={hebrew ? "rtl" : "ltr"}>
      <summary>
        <span><small>{hebrew ? "היסטוריית מהלכים" : "MOVE HISTORY"}</small><strong>
          <bdi dir={hebrew ? "rtl" : "ltr"}>{current.label}</bdi>
          {current.notation ? <> <bdi dir="ltr">{current.notation}</bdi></> : null}
        </strong></span>
        <b aria-hidden="true">⌄</b>
      </summary>
      <div className="move-history-table-wrap" dir="ltr">
        {rows.length === 0 ? <p dir={hebrew ? "rtl" : "ltr"}>{hebrew ? "עדיין אין מהלכים. לבן פותח." : "No moves yet. White opens the riot."}</p> : (
          <table className="move-history-table">
            <thead><tr><th scope="col">#</th><th scope="col">{hebrew ? "לבן" : "White"}</th><th scope="col">{hebrew ? "שחור" : "Black"}</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.number}>
                  <th scope="row">{row.number}</th>
                  <td data-current={row.white?.ply === currentPly}>{moveText(row.white)}</td>
                  <td data-current={row.black?.ply === currentPly}>{moveText(row.black)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </details>
  );
}
