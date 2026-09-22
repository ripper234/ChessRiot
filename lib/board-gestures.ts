/** Keep native multi-touch gestures separate from piece selection and moves. */
export function createBoardPinchGuard(cancelDrag: () => void) {
  let pinching = false;
  return {
    onPointerDown(event: Pick<PointerEvent, "isPrimary" | "pointerType">) {
      if (event.isPrimary) {
        pinching = false;
      } else if (event.pointerType === "touch") {
        pinching = true;
        cancelDrag();
      }
    },
    blocksMoves: () => pinching,
    resumeWithKeyboard: () => { pinching = false; },
  };
}
