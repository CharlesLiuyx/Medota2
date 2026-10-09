/** WheelEvent uses pixels, lines or pages. Trackpad pinch is emitted with ctrlKey. */
export function wheelPixels(
  event: { deltaX: number; deltaY: number; deltaMode: number },
  viewport: { width: number; height: number },
) {
  const xUnit =
    event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.width : 1;
  const yUnit =
    event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.height : 1;
  return { x: event.deltaX * xUnit, y: event.deltaY * yUnit };
}

/** Time-based gain is independent of event frequency and resets on reversal or a pause. */
export function createPinchAcceleration() {
  let started = 0,
    previous = -Infinity,
    direction = 0;
  return {
    reset() {
      previous = -Infinity;
      direction = 0;
    },
    gain(delta: number, now: number) {
      if (!Number.isFinite(delta) || delta === 0) return 1;
      const next = Math.sign(delta);
      if (next !== direction || now - previous > 180 || now < previous)
        started = now;
      direction = next;
      previous = now;
      return 1 + Math.min(1.5, Math.max(0, now - started) / 500);
    },
  };
}
