import { describe, expect, it } from "vitest";
import {
  analyzeGreatMove,
  analyzeMoveRisk,
  readChessCoachPreference,
  readTacticalCelebrationsPreference,
} from "./chess-coach";

describe("chess coach", () => {
  it("is enabled by default", () => {
    expect(readChessCoachPreference({ getItem: () => null })).toBe(true);
    expect(readTacticalCelebrationsPreference({ getItem: () => null })).toBe(true);
  });

  it("warns when a bishop is left for a pawn", () => {
    const warning = analyzeMoveRisk(
      "4k3/3p4/8/8/8/1B6/8/4K3 w - - 0 1",
      { from: "b3", to: "e6", expectedVersion: 1, piece: "b" },
    );
    expect(warning?.explanation).toContain("bishop on e6");
    expect(warning?.explanation).toContain("pawn");
  });

  it("values the enemy attacker rather than the recapturing piece", () => {
    const warning = analyzeMoveRisk(
      "4k3/3p4/8/8/8/1B6/4Q3/4K3 w - - 0 1",
      { from: "b3", to: "e6", expectedVersion: 1, piece: "b" },
    );
    expect(warning?.explanation).toContain("bishop on e6");
    expect(warning?.explanation).toContain("pawn");
  });

  it("does not interrupt a quiet developing move", () => {
    expect(analyzeMoveRisk(
      "4k3/8/8/8/8/8/4B3/4K3 w - - 0 1",
      { from: "e2", to: "f3", expectedVersion: 1, piece: "b" },
    )).toBeNull();
  });

  it("does not warn about an even exchange", () => {
    expect(analyzeMoveRisk(
      "4k3/8/3p4/4b3/3B4/8/8/4K3 w - - 0 1",
      { from: "d4", to: "e5", expectedVersion: 1, piece: "b" },
    )).toBeNull();
  });

  it("recognizes a rook won for a pawn when the promoted queen is captured", () => {
    expect(analyzeMoveRisk(
      "rk6/1P6/8/8/8/8/8/4K3 w - - 0 1",
      { from: "b7", to: "a8", promotion: "q", expectedVersion: 1, piece: "p" },
    )).toBeNull();
  });

  it("counts a captured underpromotion as a one-pawn loss", () => {
    expect(analyzeMoveRisk(
      "1k6/P7/8/8/8/8/8/4K3 w - - 0 1",
      { from: "a7", to: "a8", promotion: "n", expectedVersion: 1, piece: "p" },
    )).toBeNull();
  });

  it("warns when a pawn promotes while capturing the undefended rook", () => {
    expect(analyzeMoveRisk(
      "k7/8/8/8/8/8/K6p/4R1q1 w - - 0 1",
      { from: "e1", to: "g1", expectedVersion: 1, piece: "r" },
    )?.explanation).toContain("rook on g1");
  });

  it("credits the full promoted piece when the bishop can take it back", () => {
    expect(analyzeMoveRisk(
      "k7/8/8/8/8/8/K4B1p/4R1q1 w - - 0 1",
      { from: "e1", to: "g1", expectedVersion: 1, piece: "r" },
    )).toBeNull();
  });

  it("credits the best promotion available on the player's recapture", () => {
    expect(analyzeMoveRisk(
      "1r5k/1P6/8/8/8/8/Q7/4K3 w - - 0 1",
      { from: "a2", to: "a8", expectedVersion: 1, piece: "q" },
    )).toBeNull();
  });

  it("celebrates clear forks and strong material wins", () => {
    expect(analyzeGreatMove(
      "k2q3r/8/8/4N3/8/8/8/4K3 w - - 0 1",
      { from: "e5", to: "f7", expectedVersion: 1, piece: "n" },
    )).toMatchObject({ kind: "fork" });
    expect(analyzeGreatMove(
      "4k3/8/8/3q4/4P3/8/8/4K3 w - - 0 1",
      { from: "e4", to: "d5", expectedVersion: 1, piece: "p" },
    )).toMatchObject({ kind: "material" });
  });

  it("recognizes a check plus a valuable attacked piece as a fork", () => {
    expect(analyzeGreatMove(
      "3r3k/8/8/4N3/8/8/8/4K3 w - - 0 1",
      { from: "e5", to: "f7", expectedVersion: 1, piece: "n" },
    )).toMatchObject({ kind: "fork" });
  });
});
