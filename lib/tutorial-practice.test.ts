import { describe, expect, it } from "vitest";
import {
  completeTutorialMove,
  INITIAL_TUTORIAL_PRACTICE,
  moveTutorialKnight,
  previousTutorialStep,
  selectTutorialKnight,
  TUTORIAL_DESTINATIONS,
} from "./tutorial-practice";

describe("tutorial practice flow", () => {
  it("makes glowing knight destinations actionable immediately", () => {
    const selected = selectTutorialKnight(INITIAL_TUTORIAL_PRACTICE);
    expect(selected).toEqual({ step: 1, selected: true, movedTo: null });
    for (const destination of TUTORIAL_DESTINATIONS) {
      expect(moveTutorialKnight(selected, destination.square).movedTo)
        .toBe(destination.square);
    }
  });

  it("advances only after a destination and resets correctly on Back", () => {
    const selected = selectTutorialKnight(INITIAL_TUTORIAL_PRACTICE);
    expect(completeTutorialMove(selected)).toBe(selected);
    const moved = moveTutorialKnight(selected, "d2");
    expect(completeTutorialMove(moved)).toEqual({
      step: 2,
      selected: true,
      movedTo: "d2",
    });
    expect(previousTutorialStep(completeTutorialMove(moved))).toEqual({
      step: 1,
      selected: true,
      movedTo: null,
    });
    expect(previousTutorialStep(selected)).toEqual(INITIAL_TUTORIAL_PRACTICE);
  });
});
