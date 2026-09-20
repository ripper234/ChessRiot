import Link from "next/link";

interface BrandProps {
  locale?: "en" | "he";
}

export function Brand({ locale = "en" }: BrandProps = {}) {
  const hebrew = locale === "he";
  return (
    <Link className="brand" href="/" aria-label={hebrew ? "דף הבית של ChessRiot" : "ChessRiot home"}>
      <span className="brand-mark" aria-hidden="true"><span>♛</span></span>
      <span className="brand-copy">
        <span className="brand-name" dir="ltr"><span>Chess</span><b>Riot</b></span>
        <small>{hebrew ? "שחמט אמיתי. משחק מלא." : "REAL CHESS. TOTAL PLAY."}</small>
      </span>
    </Link>
  );
}
