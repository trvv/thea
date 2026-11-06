/** Packed pixels are ordinary strided records, RGB appearance recipes and grid coordinates. */
import {
  presetConfiguration,
  validateConfiguration,
} from "./point-configuration.js";
import { defaultAppearance, validateAppearance } from "./appearance.js";
import { constant } from "./recipes.js";

export const pixelFormats = {
  gray8: 1,
  rgb24: 3,
  bgr24: 3,
  rgba32: 4,
  bgra32: 4,
  argb32: 4,
  rgb565: 2,
  argb1555: 2,
};

export function packedPixels({
  format = "rgb24",
  width = 256,
  stride = pixelFormats[format],
  origin = 0,
  endian = "little",
} = {}) {
  if (!Object.hasOwn(pixelFormats, format))
    throw new TypeError("Unknown pixel format");
  if (!Number.isSafeInteger(width) || width < 1 || width > 65536)
    throw new RangeError("Pixel width must be 1–65536");
  if (!Number.isSafeInteger(stride) || stride < pixelFormats[format])
    throw new RangeError("Pixel stride must include the complete pixel");
  if (!Number.isSafeInteger(origin) || origin < 0)
    throw new RangeError("Invalid pixel origin");
  if (!["little", "big"].includes(endian))
    throw new TypeError("Unknown byte order");
  const read = (delta) => ({
    op: "byte",
    offset: { op: "add", a: { op: "offset" }, b: constant(delta) },
  });
  const unit = (input, maximum) => ({
    op: "normalize",
    input,
    min: 0,
    max: maximum,
  });
  let red,
    green,
    blue,
    opacity = "none";
  if (["rgb565", "argb1555"].includes(format)) {
    const word = {
      op: "add",
      a: read(endian === "little" ? 0 : 1),
      b: {
        op: "multiply",
        a: read(endian === "little" ? 1 : 0),
        b: constant(256),
      },
    };
    const field = (shift, bits) => {
      const divided = {
        op: "floor",
        input: { op: "divide", a: word, b: constant(2 ** shift) },
      };
      const high = {
        op: "floor",
        input: { op: "divide", a: word, b: constant(2 ** (shift + bits)) },
      };
      return unit(
        {
          op: "subtract",
          a: divided,
          b: { op: "multiply", a: high, b: constant(2 ** bits) },
        },
        2 ** bits - 1,
      );
    };
    red = field(format === "rgb565" ? 11 : 10, 5);
    green = field(5, format === "rgb565" ? 6 : 5);
    blue = field(0, 5);
    if (format === "argb1555") opacity = field(15, 1);
  } else {
    const order = {
      gray8: [0, 0, 0],
      rgb24: [0, 1, 2],
      bgr24: [2, 1, 0],
      rgba32: [0, 1, 2, 3],
      bgra32: [2, 1, 0, 3],
      argb32: [1, 2, 3, 0],
    }[format];
    [red, green, blue] = order
      .slice(0, 3)
      .map((delta) => unit(read(delta), 255));
    if (order.length === 4) opacity = unit(read(order[3]), 255);
  }
  return {
    configuration: validateConfiguration({
      ...presetConfiguration("linear"),
      population: "records",
      recordStride: stride,
      recordOrigin: origin,
      recordWidth: pixelFormats[format],
      sampling: "representative",
      position: ["column", "row", "none"],
      dimensions: { width: { start: 0, end: width, step: 1 } },
    }),
    appearance: validateAppearance("linear", {
      ...defaultAppearance("linear", []),
      colorSpace: "rgb",
      red,
      green,
      blue,
      opacity,
    }),
    shaders: [],
  };
}
