import type { PublicMove } from "@/lib/game-types";

function moveText(move: PublicMove | undefined): string {
  if (!move) return "—";
  const first = `${move.san.includes("x") ? "⚔ " : ""}${move.san}`;
  if (!move.second) return first;
  return `${first} → ${move.second.san.includes("x") ? "⚔ " : ""}${move.second.san}`;
}

export function currentMoveLabel(moves: PublicMove[], currentPly: number): string {
  if (currentPly <= 0) return "Starting position";
  const move = moves.find((candidate) => candidate.ply === currentPly)
    ?? moves[currentPly - 1];
  if (!move) return `Move ${currentPly}`;
  const side = move.color === "w" ? "White" : "Black";
  return `${Math.ceil(move.ply / 2)}. ${side} ${moveText(move)}`;
}

export function MoveHistoryPanel({
  moves,
  currentPly,
}: {
  moves: PublicMove[];
  currentPly: number;
}) {
  const rows = Array.from({ length: Math.ceil(moves.length / 2) }, (_, index) => ({
    number: index + 1,
    white: moves[index * 2],
    black: moves[index * 2 + 1],
  }));

  return (
    <details className="side-card move-history-panel">
      <summary>
        <span><small>MOVE HISTORY</small><strong>{currentMoveLabel(moves, currentPly)}</strong></span>
        <b aria-hidden="true">⌄</b>
      </summary>
      <div className="move-history-table-wrap">
        {rows.length === 0 ? <p>No moves yet. White opens the riot.</p> : (
          <table className="move-history-table">
            <thead><tr><th scope="col">#</th><th scope="col">White</th><th scope="col">Black</th></tr></thead>
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
