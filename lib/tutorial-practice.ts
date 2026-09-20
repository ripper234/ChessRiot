export const TUTORIAL_DESTINATIONS = [
  { square: "a3", column: 1, row: 6 },
  { square: "c3", column: 3, row: 6 },
  { square: "d2", column: 4, row: 7 },
] as const;

export type TutorialDestination = typeof TUTORIAL_DESTINATIONS[number]["square"];
export type TutorialStep = 0 | 1 | 2;

export interface TutorialPracticeState {
  step: TutorialStep;
  selected: boolean;
  movedTo: TutorialDestination | null;
}

export const INITIAL_TUTORIAL_PRACTICE: TutorialPracticeState = {
  step: 0,
  selected: false,
  movedTo: null,
};

export function selectTutorialKnight(
  state: TutorialPracticeState,
): TutorialPracticeState {
  if (state.step !== 0 || state.movedTo) return state;
  return { step: 1, selected: true, movedTo: null };
}

export function moveTutorialKnight(
  state: TutorialPracticeState,
  movedTo: TutorialDestination,
): TutorialPracticeState {
  if (state.step !== 1 || !state.selected || state.movedTo) return state;
  return { ...state, movedTo };
}

export function completeTutorialMove(
  state: TutorialPracticeState,
): TutorialPracticeState {
  if (state.step !== 1 || !state.movedTo) return state;
  return { ...state, step: 2 };
}

export function previousTutorialStep(
  state: TutorialPracticeState,
): TutorialPracticeState {
  if (state.step === 2) return { step: 1, selected: true, movedTo: null };
  if (state.step === 1) return INITIAL_TUTORIAL_PRACTICE;
  return state;
}
