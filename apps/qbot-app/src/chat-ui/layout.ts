/** Distance past which the jump button appears. The list itself sticks only within a few pixels. */
export const JUMP_TO_BOTTOM_DISTANCE = 48;

export function distanceFromBottom(contentHeight: number, viewportHeight: number, scrollY: number): number {
  return contentHeight - viewportHeight - scrollY;
}

export function showJumpToBottom(distance: number, threshold = JUMP_TO_BOTTOM_DISTANCE): boolean {
  return distance > threshold;
}

/**
 * How far a flex column must pad its bottom so its border sits on the keyboard top.
 * Padding lives inside the border box, so applying it does not move `frameBottom`
 * and the result does not oscillate. A resized window whose bottom already meets
 * the keyboard returns 0.
 */
export function keyboardCover(frameBottom: number, keyboardTop: number): number {
  return Math.max(0, Math.round(frameBottom - keyboardTop));
}
