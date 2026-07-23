import Link from "next/link";

export function Brand() {
  return (
    <Link className="brand" href="/" aria-label="ChessRiot home">
      <span className="brand-cube" aria-hidden="true">♞</span>
      <span>CHESS<span>RIOT</span></span>
    </Link>
  );
}
