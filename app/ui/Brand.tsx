import Link from "next/link";

export function Brand() {
  return (
    <Link className="brand" href="/" aria-label="ChessRiot home">
      <span className="brand-mark" aria-hidden="true"><span>♛</span></span>
      <span className="brand-copy">
        <span className="brand-name"><span>Chess</span><b>Riot</b></span>
        <small>REAL CHESS. TOTAL PLAY.</small>
      </span>
    </Link>
  );
}
