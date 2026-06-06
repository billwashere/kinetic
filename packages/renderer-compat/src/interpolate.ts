/**
 * interpolate.ts
 *
 * Pure function — no React, no DOM, no Playwright. Easy to unit-test.
 * API matches Remotion's interpolate(), including N-point input ranges and
 * per-side extrapolation modes.
 */

export interface InterpolateOptions {
  extrapolateLeft?: 'clamp' | 'extend' | 'identity';
  extrapolateRight?: 'clamp' | 'extend' | 'identity';
  easing?: (t: number) => number;
}

/**
 * Linearly interpolates a value across one or more input/output range pairs.
 *
 * Examples:
 *   interpolate(5,  [0, 10],     [0, 100])                       // → 50
 *   interpolate(15, [0, 10],     [0, 100], { extrapolateRight: 'clamp' })  // → 100
 *   interpolate(15, [0, 10],     [0, 100], { extrapolateRight: 'extend' }) // → 150
 *   interpolate(7,  [0, 5, 10],  [0, 100, 0])                    // → 60  (descending half)
 *
 * @throws if inputRange and outputRange differ in length, are < 2, or
 *         inputRange is not strictly increasing.
 */
export function interpolate(
  value: number,
  inputRange: readonly number[],
  outputRange: readonly number[],
  options: InterpolateOptions = {},
): number {
  if (inputRange.length < 2 || outputRange.length < 2) {
    throw new Error('interpolate: inputRange and outputRange must each have at least 2 elements');
  }
  if (inputRange.length !== outputRange.length) {
    throw new Error(
      `interpolate: inputRange (length ${inputRange.length}) and outputRange (length ${outputRange.length}) must be the same length`,
    );
  }
  for (let i = 1; i < inputRange.length; i++) {
    if (inputRange[i] <= inputRange[i - 1]) {
      throw new Error(
        `interpolate: inputRange must be strictly monotonically increasing — got [${inputRange.join(', ')}]`,
      );
    }
  }

  const extrapolateLeft = options.extrapolateLeft ?? 'extend';
  const extrapolateRight = options.extrapolateRight ?? 'extend';

  // Below first point — extrapolate left
  if (value < inputRange[0]) {
    if (extrapolateLeft === 'identity') return value;
    if (extrapolateLeft === 'clamp') return outputRange[0];
    return interpolateSegment(value, inputRange[0], inputRange[1], outputRange[0], outputRange[1], options.easing);
  }

  // Above last point — extrapolate right
  const last = inputRange.length - 1;
  if (value > inputRange[last]) {
    if (extrapolateRight === 'identity') return value;
    if (extrapolateRight === 'clamp') return outputRange[last];
    return interpolateSegment(
      value,
      inputRange[last - 1],
      inputRange[last],
      outputRange[last - 1],
      outputRange[last],
      options.easing,
    );
  }

  // Find the segment containing `value`
  for (let i = 0; i < last; i++) {
    if (value >= inputRange[i] && value <= inputRange[i + 1]) {
      return interpolateSegment(
        value,
        inputRange[i],
        inputRange[i + 1],
        outputRange[i],
        outputRange[i + 1],
        options.easing,
      );
    }
  }

  // Should be unreachable given the bounds checks above
  return outputRange[last];
}

function interpolateSegment(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
  easing?: (t: number) => number,
): number {
  if (inMax === inMin) return outMin;
  let t = (value - inMin) / (inMax - inMin);
  if (easing) t = easing(t);
  return outMin + t * (outMax - outMin);
}
