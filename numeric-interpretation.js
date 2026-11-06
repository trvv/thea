/** Native fixed-width numeric interpretations, with normalization before visual f32 rounding. */
export const numericFormats = {
  uint16: { width: 2, getter: "getUint16", min: 0, max: 65535 },
  int16: { width: 2, getter: "getInt16", min: -32768, max: 32767 },
  uint32: { width: 4, getter: "getUint32", min: 0, max: 4294967295 },
  int32: { width: 4, getter: "getInt32", min: -2147483648, max: 2147483647 },
  float32: { width: 4, getter: "getFloat32" },
};
export const numericKinds = [
  "normalized",
  "valid",
  "finite",
  "nan",
  "infinite",
  "negativeZero",
  "sign",
  "exponent",
  "fraction",
];

export function numericParameters(expression) {
  const format = expression.format ?? "uint16";
  const definition = numericFormats[format];
  const endian = expression.endian ?? "little";
  const kind = expression.kind ?? "normalized";
  if (!Object.hasOwn(numericFormats, format))
    throw new TypeError("Unknown numeric format");
  if (endian !== "little" && endian !== "big")
    throw new TypeError("Unknown byte order");
  if (!numericKinds.includes(kind))
    throw new TypeError("Unknown numeric projection");
  if (["exponent", "fraction"].includes(kind) && format !== "float32")
    throw new TypeError("Exponent and fraction require float32");
  const parameters = { format, endian, kind };
  if (kind === "normalized") {
    parameters.min = expression.min ?? definition.min;
    parameters.max = expression.max ?? definition.max;
    if (
      !Number.isFinite(parameters.min) ||
      !Number.isFinite(parameters.max) ||
      !(parameters.max > parameters.min) ||
      !Number.isFinite(parameters.max - parameters.min)
    )
      throw new TypeError(
        "Numeric normalization requires finite increasing bounds",
      );
  }
  return parameters;
}

/** Complete selected span availability; callers retain their existing byte-zero-fill contract. */
export function spanAvailable(index, width, length) {
  index = Math.floor(index);
  return Number.isSafeInteger(index) && index >= 0 && index <= length - width;
}

const views = new WeakMap();
function byteView(bytes) {
  let view = views.get(bytes);
  if (!view) {
    view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    views.set(bytes, view);
  }
  return view;
}

function decode(bytes, index, parameters) {
  const definition = numericFormats[parameters.format];
  const view = byteView(bytes);
  const little = parameters.endian === "little";
  return {
    value: view[definition.getter](index, little),
    bits:
      definition.width === 2
        ? view.getUint16(index, little)
        : view.getUint32(index, little),
  };
}

/** Scalar hot path: no result metadata is allocated for rendered marks. */
export function numericResult(bytes, index, parameters) {
  index = Math.floor(index);
  const definition = numericFormats[parameters.format];
  if (!spanAvailable(index, definition.width, bytes.length)) return 0;
  if (parameters.kind === "valid") return 1;
  const view = byteView(bytes);
  const little = parameters.endian === "little";
  const value = view[definition.getter](index, little);
  switch (parameters.kind) {
    case "finite":
      return Number.isFinite(value) ? 1 : 0;
    case "nan":
      return Number.isNaN(value) ? 1 : 0;
    case "infinite":
      return value === Infinity || value === -Infinity ? 1 : 0;
    case "negativeZero":
      return Object.is(value, -0) ? 1 : 0;
    case "sign":
      return parameters.format === "float32"
        ? view.getUint32(index, little) >>> 31
        : value < 0
          ? 1
          : 0;
    case "exponent":
      return ((view.getUint32(index, little) >>> 23) & 255) / 255;
    case "fraction":
      return (view.getUint32(index, little) & 0x7fffff) / 0x7fffff;
    default:
      return Number.isFinite(value)
        ? Math.max(
            0,
            Math.min(
              1,
              (value - parameters.min) / (parameters.max - parameters.min),
            ),
          )
        : 0;
  }
}

/** On-demand raw provenance retains integer precision and identifies special floating values. */
export function interpretNumber(bytes, index, parameters) {
  index = Math.floor(index);
  const { width } = numericFormats[parameters.format];
  const valid = spanAvailable(index, width, bytes.length);
  if (!valid)
    return {
      ...parameters,
      width,
      valid: false,
      boundary: "incomplete span outside selection",
    };
  const { value, bits } = decode(bytes, index, parameters);
  return {
    ...parameters,
    width,
    valid: true,
    bytes: [...bytes.subarray(index, index + width)],
    rawValue: Object.is(value, -0)
      ? "-0"
      : Number.isFinite(value)
        ? value
        : String(value),
    rawBits: `0x${bits
      .toString(16)
      .padStart(width * 2, "0")
      .toUpperCase()}`,
    finite: Number.isFinite(value),
    nan: Number.isNaN(value),
    infinite: value === Infinity || value === -Infinity,
    negativeZero: Object.is(value, -0),
    result: numericResult(bytes, index, parameters),
  };
}
