import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { GameFinisher } from "@/lib/game-finishers";
import { CheckmateFinisher } from "./CheckmateFinisher";
import { ResignationFinisher } from "./ResignationFinisher";

const FINISHER: GameFinisher = {
  type: "checkmate",
  winner: "w",
  loser: "b",
  attackingPiece: "q",
  attackingFrom: "h5",
  attackingTo: "f7",
  losingKingSquare: "e8",
};

describe("game finisher locale", () => {
  it("keeps English defaults and renders protected Hebrew on request", () => {
    expect(renderToStaticMarkup(<CheckmateFinisher finisher={FINISHER} />))
      .toContain("CHECKMATE");
    expect(renderToStaticMarkup(<ResignationFinisher color="b" />))
      .toContain("SURRENDER");

    const checkmate = renderToStaticMarkup(
      <CheckmateFinisher finisher={FINISHER} locale="he" />,
    );
    const resignation = renderToStaticMarkup(
      <ResignationFinisher color="b" locale="he" />,
    );
    expect(checkmate).toContain('lang="he"');
    expect(checkmate).toContain('dir="rtl"');
    expect(checkmate).toContain("<strong>מט</strong>");
    expect(checkmate).not.toContain("CHECKMATE");
    expect(resignation).toContain("<strong>כניעה</strong>");
    expect(resignation).not.toContain("SURRENDER");
  });
});
