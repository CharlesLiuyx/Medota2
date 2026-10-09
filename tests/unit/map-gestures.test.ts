import { expect, it } from "vitest";
import { createPinchAcceleration, wheelPixels } from "@/domain/map/gestures";

it("normalizes both scroll axes and accelerates a continuous pinch independently of event rate", () => {
  const viewport = { width: 800, height: 600 };
  expect(
    wheelPixels({ deltaX: 2, deltaY: -3, deltaMode: 0 }, viewport),
  ).toEqual({ x: 2, y: -3 });
  expect(
    wheelPixels({ deltaX: 2, deltaY: -3, deltaMode: 1 }, viewport),
  ).toEqual({ x: 32, y: -48 });
  expect(
    wheelPixels({ deltaX: 1, deltaY: -1, deltaMode: 2 }, viewport),
  ).toEqual({ x: 800, y: -600 });
  const slow = createPinchAcceleration(),
    fast = createPinchAcceleration();
  expect(slow.gain(-1, 0)).toBe(1);
  fast.gain(-1, 0);
  for (let time = 50; time <= 750; time += 50) fast.gain(-1, time);
  for (let time = 150; time <= 750; time += 150) slow.gain(-1, time);
  expect(slow.gain(-1, 750)).toBe(2.5);
  expect(fast.gain(-1, 750)).toBe(2.5);
  expect(slow.gain(1, 760)).toBe(1); // Reverse: immediately fine control.
  expect(fast.gain(-1, 950)).toBe(1); // Pause: a new gesture.
  fast.reset();
  expect(fast.gain(-1, 960)).toBe(1);
});
