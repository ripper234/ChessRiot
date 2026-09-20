import type { Color } from "@/lib/game-types";
import { ChessPiece } from "./ChessPiece";

export function ResignationFinisher({
  color,
  locale = "en",
}: {
  color: Color;
  locale?: "en" | "he";
}) {
  return (
    <div
      className="resignation-finisher"
      lang={locale}
      dir={locale === "he" ? "rtl" : "ltr"}
      aria-hidden="true"
    >
      <div className={`resignation-king piece-${color}`}>
        <ChessPiece type="k" color={color} />
        <span className="white-flag"><i /></span>
      </div>
      <strong>{locale === "he" ? "כניעה" : "SURRENDER"}</strong>
    </div>
  );
}
