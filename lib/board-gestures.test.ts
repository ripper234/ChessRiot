import { describe, expect, it, vi } from "vitest";
import { createBoardPinchGuard } from "./board-gestures";

describe("board pinch gestures", () => {
  it("cancels a drag on a second finger and rejects every residual move", () => {
    let drag: string | null = "e2";
    const cancel = vi.fn(() => { drag = null; });
    const guard = createBoardPinchGuard(cancel);
    guard.onPointerDown({ pointerType: "touch", isPrimary: true });
    expect(guard.blocksMoves()).toBe(false);
    expect(drag).toBe("e2");
    guard.onPointerDown({ pointerType: "touch", isPrimary: false });
    expect(cancel).toHaveBeenCalledOnce();
    expect(drag).toBeNull();
    for (let click = 0; click < 3; click += 1) expect(guard.blocksMoves()).toBe(true);
    guard.onPointerDown({ pointerType: "touch", isPrimary: true });
    expect(guard.blocksMoves()).toBe(false);
  });

  it("resumes keyboard play after zoom without an extra discarded keystroke", () => {
    const guard = createBoardPinchGuard(vi.fn());
    guard.onPointerDown({ pointerType: "touch", isPrimary: false });
    guard.resumeWithKeyboard();
    expect(guard.blocksMoves()).toBe(false);
  });

  it("leaves ordinary mouse and pen moves alone", () => {
    const cancel = vi.fn();
    const guard = createBoardPinchGuard(cancel);
    for (const pointerType of ["mouse", "pen"]) {
      guard.onPointerDown({ pointerType, isPrimary: true });
      expect(guard.blocksMoves()).toBe(false);
    }
    expect(cancel).not.toHaveBeenCalled();
  });
});
