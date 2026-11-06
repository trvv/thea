/** Per-axis ranges. Counts follow half-open ranges; Fit maps each range onto its full axis. */
import { spaces } from "./spaces.js";
export const dimensionNames = ["width", "height", "depth"];
const byteSources = new Set(["value", "byte1", "byte2", "byte3", "previous"]);
const rangeCount = (span, step) => {
  const q = span / step;
  return Math.ceil(q - Number.EPSILON * Math.max(1, Math.abs(q)) * 4);
};
export const defaultDimension = () => ({
  start: null,
  end: null,
  step: null,
  fit: true,
  mode: "scale",
});

export function validateDimensions(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Invalid dimensions");
  return Object.fromEntries(
    dimensionNames.map((name) => {
      const input = value[name] ?? {},
        axis = { ...defaultDimension(), ...input };
      if (!input || typeof input !== "object" || Array.isArray(input))
        throw new TypeError("Invalid dimension range");
      for (const field of ["start", "end", "step"])
        if (
          axis[field] !== null &&
          (typeof axis[field] !== "number" ||
            !Number.isFinite(axis[field]) ||
            Math.abs(axis[field]) > 1e9)
        )
          throw new TypeError("Invalid dimension range");
      if (
        (axis.step !== null && axis.step <= 0) ||
        (axis.start !== null && axis.end !== null && axis.end <= axis.start) ||
        typeof axis.fit !== "boolean" ||
        !["scale", "truncate"].includes(axis.mode)
      )
        throw new TypeError("Invalid dimension range");
      return [
        name,
        {
          start: axis.start,
          end: axis.end,
          step: axis.step,
          fit: axis.fit,
          mode: axis.mode,
        },
      ];
    }),
  );
}

function coordinateCount(mapping, count, fallback, definitions, depth = 0) {
  if (depth > 32) return fallback;
  if (mapping?.op === "ref")
    return coordinateCount(
      definitions?.[mapping.name],
      count,
      fallback,
      definitions,
      depth + 1,
    );
  const factor =
    typeof mapping === "string"
      ? mapping
      : mapping?.op === "factor"
        ? mapping.name
        : undefined;
  if (byteSources.has(factor)) return 256;
  if (
    mapping?.op === "component" &&
    ["hilbert", "hilbert3d", "hcurve", "morton"].includes(mapping.input?.op)
  ) {
    const dimensions =
      mapping.input.op === "morton"
        ? (mapping.input.dimensions ?? 2)
        : mapping.input.op === "hilbert3d"
          ? 3
          : 2;
    return (
      2 **
      (mapping.input.order ||
        Math.min(
          dimensions === 3 ? 10 : 15,
          Math.ceil(Math.log2(Math.max(1, count)) / dimensions),
        ))
    );
  }
  return fallback;
}

export function resolveDimensions(configuration, pointCount, sampleLayout) {
  const count = Math.max(
    1,
    Math.min(
      pointCount || 1,
      configuration.sampleLimit === null
        ? Infinity
        : (configuration.sampleLimit ?? 262144),
    ),
  );
  const spatial = spaces[configuration.space].length === 3;
  const aspect =
    sampleLayout.aspect ?? sampleLayout.columns / sampleLayout.rows;
  const first = Math.max(
    1,
    Math.ceil(spatial ? Math.cbrt(count) : Math.sqrt(count * aspect)),
  );
  const second = Math.max(
    1,
    Math.ceil(spatial ? Math.sqrt(count / first) : count / first),
  );
  const third = spatial ? Math.max(1, Math.ceil(count / (first * second))) : 1;
  const channels = spaces[configuration.space];
  const defaults = [first, second, third];
  const preferred = defaults.map((fallback, index) =>
    coordinateCount(
      configuration.position[index],
      pointCount,
      0,
      configuration.recipes,
    ),
  );
  const solve = (input) => {
    const sizes = [...input];
    let remaining = count;
    for (let index = 0; index < channels.length; index++)
      if (sizes[index]) remaining /= sizes[index];
    let left = sizes.slice(0, channels.length).filter((value) => !value).length;
    for (let index = 0; index < channels.length; index++)
      if (!sizes[index]) {
        sizes[index] = Math.max(
          1,
          Math.min(
            Math.ceil(remaining),
            Math.ceil(
              left === 2 && !spatial
                ? Math.sqrt(remaining * aspect)
                : remaining ** (1 / left),
            ),
          ),
        );
        remaining /= sizes[index];
        left--;
      }
    if (!spatial) sizes[2] = 1;
    return sizes;
  };
  const naturalSizes = solve(preferred),
    requested = [...preferred];
  for (let index = 0; index < channels.length; index++) {
    const settings = configuration.dimensions?.[dimensionNames[index]];
    if (
      settings?.mode === "truncate" &&
      (settings.start != null || settings.end != null || settings.step != null)
    ) {
      const channel = channels[index],
        span = /Angle|Azimuth/.test(channel)
          ? 360
          : /Inclination/.test(channel)
            ? 180
            : channel === "Radius"
              ? 1
              : naturalSizes[index];
      requested[index] = Math.max(
        1,
        rangeCount(span, settings.step ?? span / naturalSizes[index]),
      );
    } else if (
      settings?.end != null &&
      !/Radius|Angle|Azimuth|Inclination/.test(channels[index])
    )
      requested[index] = Math.max(
        1,
        rangeCount(settings.end - (settings.start ?? 0), settings.step ?? 1),
      );
  }
  const sizes = solve(requested);
  const result = {};
  for (let index = 0; index < 3; index++) {
    const name = dimensionNames[index],
      channel = channels[index] || "Depth";
    const settings = {
      ...defaultDimension(),
      ...configuration.dimensions?.[name],
    };
    const explicit =
      settings.start !== null ||
      settings.end !== null ||
      settings.step !== null;
    const levels = Math.min(
      65536,
      (explicit ? naturalSizes[index] : sizes[index]) || defaults[index],
    );
    const angular = /Angle|Azimuth|Inclination/.test(channel),
      radial = channel === "Radius";
    const naturalStart = 0,
      naturalEnd = angular
        ? /Inclination/.test(channel)
          ? 180
          : 360
        : radial
          ? 1
          : levels;
    const start = settings.start ?? naturalStart,
      end = settings.end ?? naturalEnd,
      step = settings.step ?? (naturalEnd - naturalStart) / levels;
    if (!(end > start && step > 0))
      throw new RangeError(
        "Dimension end must exceed start and step must be positive",
      );
    const cells = rangeCount(end - start, step);
    if (!Number.isSafeInteger(cells) || cells < 1 || cells > 65536)
      throw new RangeError("A dimension must contain 1–65536 cells");
    const samples =
      settings.mode === "truncate"
        ? rangeCount(naturalEnd - naturalStart, step)
        : cells;
    if (!Number.isSafeInteger(samples) || samples < 1 || samples > 65536)
      throw new RangeError("A dimension must sample 1–65536 cells");
    result[name] = {
      start,
      end,
      step,
      fit: settings.fit,
      mode: settings.mode,
      count: cells,
      samples,
      naturalStart,
      naturalEnd,
      unit: angular ? "°" : "",
    };
  }
  return result;
}

export function pointGrid(configuration, count, sampleLayout) {
  const dimensions = resolveDimensions(configuration, count, sampleLayout);
  return {
    columns: dimensions.width.samples,
    rows: dimensions.height.samples,
    slices:
      spaces[configuration.space].length === 3 ? dimensions.depth.samples : 1,
    dimensions,
  };
}

function cellCenter(index, axis) {
  const start = axis.mode === "truncate" ? axis.naturalStart : axis.start,
    end = axis.mode === "truncate" ? axis.naturalEnd : axis.end;
  const span = end - start,
    low = index * axis.step,
    high = Math.min(span, low + axis.step);
  return (low + high) / (2 * span);
}
export function gridCoordinates(index, grid, out) {
  const { columns, rows, dimensions } = grid;
  out[0] = cellCenter(index % columns, dimensions.width);
  out[1] = cellCenter(Math.floor(index / columns) % rows, dimensions.height);
  out[2] =
    grid.slices === 1
      ? 0.5
      : cellCenter(
          Math.floor(index / (columns * rows)) % grid.slices,
          dimensions.depth,
        );
  return out;
}

/** Scale remaps all values; Truncate selects the natural-domain window. Fit is independent. */
export function dimensionCoordinate(value, axis) {
  if (!axis || (axis.mode === "scale" && axis.fit)) return value;
  const naturalSpan = axis.naturalEnd - axis.naturalStart;
  const physical =
    axis.mode === "truncate"
      ? axis.naturalStart + value * naturalSpan
      : axis.start + value * (axis.end - axis.start);
  if (
    axis.mode === "truncate" &&
    (physical < axis.start || physical > axis.end)
  )
    return NaN;
  return axis.fit
    ? (physical - axis.start) / (axis.end - axis.start)
    : (physical - axis.naturalStart) / naturalSpan;
}

export function dimensionCellSize(axis) {
  return (
    axis.step /
    (axis.fit ? axis.end - axis.start : axis.naturalEnd - axis.naturalStart)
  );
}
