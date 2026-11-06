/** Reusable experiments built entirely from the ordinary serializable recipe operations. */
import { constant } from "./recipes.js";

function positiveInteger(value, maximum, name) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${name} must be an integer from 1 to ${maximum}`);
  }
}

function byteAt(delta) {
  return {
    op: "byte",
    offset: { op: "add", a: { op: "offset" }, b: constant(delta) },
  };
}

function normalize(input, min, max) {
  return { op: "normalize", input, min, max };
}

/** Compare representative bytes at i and i-lag; validity excludes the missing prefix. */
export function byteDifferences({ lag = 1 } = {}) {
  positiveInteger(lag, 1000000, "Lag");
  const difference = { op: "subtract", a: byteAt(0), b: byteAt(-lag) };
  return {
    signed: normalize(difference, -255, 255),
    magnitude: normalize({ op: "abs", input: difference }, 0, 255),
    valid: normalize(
      { op: "subtract", a: { op: "offset" }, b: constant(lag - 1) },
      0,
      1,
    ),
  };
}

/** Plot i, i+lag and optionally i+2*lag; the validity mask excludes the missing tail. */
export function laggedCoordinates({ lag = 1, dimensions = 3 } = {}) {
  if (dimensions !== 2 && dimensions !== 3) {
    throw new RangeError("Dimensions must be 2 or 3");
  }
  // Every literal must remain within the existing recipe parameter limit.
  positiveInteger(lag, Math.floor(1000000 / (dimensions - 1)), "Lag");
  const tail = (dimensions - 1) * lag;
  const position = [0, lag, ...(dimensions === 3 ? [tail] : [])].map((delta) =>
    normalize(byteAt(delta), 0, 255),
  );
  if (dimensions === 2) position.push("none");
  return {
    position,
    valid: normalize(
      {
        op: "subtract",
        a: { op: "subtract", a: { op: "length" }, b: { op: "offset" } },
        b: constant(tail),
      },
      0,
      1,
    ),
  };
}

/** Compare entropy in bit units, retaining the provider's legacy 32-byte quantization. */
export function entropyContrast({ smallWindow = 32, largeWindow = 256 } = {}) {
  positiveInteger(smallWindow, 4096, "Small window");
  positiveInteger(largeWindow, 4096, "Large window");
  if (smallWindow > largeWindow) {
    throw new RangeError("Small window must not exceed large window");
  }
  const bits = (window) => ({
    op: "multiply",
    a: { op: "entropy", offset: { op: "offset" }, window },
    b: constant(Math.min(8, Math.log2(window))),
  });
  const smallBits = bits(smallWindow);
  const largeBits = bits(largeWindow);
  const difference = { op: "subtract", a: smallBits, b: largeBits };
  return {
    small: { op: "divide", a: smallBits, b: constant(8) },
    large: { op: "divide", a: largeBits, b: constant(8) },
    contrast: normalize(difference, -8, 8),
    magnitude: normalize({ op: "abs", input: difference }, 0, 8),
  };
}
