/** Coverage-aware accumulation shared by every configuration, independent of presets. */
import { assertProviderBudget } from "./provider-budget.js";

export function validateDensity(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !["all", "front"].includes(value.mode ?? "all")
  )
    throw new TypeError("Unknown density depth policy");
  const result = {
    mode: value.mode ?? "all",
    reference: value.reference ?? "percentile",
    value: value.value ?? 1,
    percentile: value.percentile ?? 0.99,
    exposure: value.exposure ?? 1,
    opacityWeight: value.opacityWeight ?? false,
    budget: value.budget === undefined ? 256 * 1048576 : value.budget,
  };
  if (
    result.budget !== null &&
    (!Number.isSafeInteger(result.budget) || result.budget < 1)
  )
    throw new TypeError("Density budget must be positive bytes or null");
  if (
    !["percentile", "fixed"].includes(result.reference) ||
    typeof result.opacityWeight !== "boolean" ||
    !Number.isFinite(result.percentile) ||
    result.percentile < 0 ||
    result.percentile > 1
  )
    throw new TypeError("Invalid density reference");
  for (const name of ["value", "exposure"])
    if (
      !Number.isFinite(result[name]) ||
      result[name] <= 0 ||
      result[name] > 1000000
    )
      throw new TypeError("Density scale must be positive and at most 1000000");
  return result;
}

function bounds(prepared, projection, index) {
  const q = index * 4;
  return [
    projection.projected[q],
    projection.projected[q + 1],
    (projection.spatial
      ? projection.projected[q + 3]
      : projection.cellWidth / 2) * prepared.sizes[index],
    (projection.spatial
      ? projection.projected[q + 3]
      : projection.cellHeight / 2) * prepared.sizes[index],
  ];
}

function maskAt(shape, bounds, x, y) {
  const [cx, cy, hx, hy] = bounds;
  if (!(hx > 0 && hy > 0)) return 0;
  let mask = 0;
  for (let probe = 0; probe < 4; probe++) {
    const dx = (x + (probe & 1 ? 0.75 : 0.25) - cx) / hx;
    const dy = (y + (probe & 2 ? 0.75 : 0.25) - cy) / hy;
    if (
      shape === "circle"
        ? dx * dx + dy * dy <= 1
        : Math.abs(dx) <= 1 && Math.abs(dy) <= 1
    )
      mask |= 1 << probe;
  }
  return mask;
}
const covered = (mask) =>
  (mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1) + ((mask >> 3) & 1);

export function densityColor(
  count,
  red,
  green,
  blue,
  reference,
  settings,
  out = [],
  offset = 0,
) {
  const scale =
    count && reference
      ? Math.min(
          1,
          Math.log1p(settings.exposure * count) / Math.log1p(reference),
        ) / count
      : 0;
  out[offset] = Math.round(red * scale);
  out[offset + 1] = Math.round(green * scale);
  out[offset + 2] = Math.round(blue * scale);
  out[offset + 3] = 255;
  return out;
}

export function assertDensityStorage(job, width, height, settings) {
  settings = validateDensity(settings);
  const limit = Math.min(
    job.configuration.providerBudget ?? Infinity,
    settings.budget ?? Infinity,
  );
  return assertProviderBudget(
    { configuration: { providerBudget: limit === Infinity ? null : limit } },
    width *
      height *
      (36 +
        (settings.reference === "percentile" ? 8 : 0) +
        (settings.mode === "front" ? 1 : 0)),
    "Density raster storage",
  );
}

export function paintDensity(
  context,
  prepared,
  projection,
  scratch,
  settings,
  job,
) {
  settings = validateDensity(settings);
  const { width, height, order } = projection;
  const length = width * height;
  assertDensityStorage(job, width, height, settings);
  let data = scratch.density;
  if (!data || data.width !== width || data.height !== height)
    data = scratch.density = {
      width,
      height,
      count: new Float64Array(length),
      red: new Float64Array(length),
      green: new Float64Array(length),
      blue: new Float64Array(length),

      image: context.createImageData(width, height),
    };
  data.sorted =
    settings.reference === "percentile"
      ? data.sorted || new Float64Array(length)
      : null;
  data.covered =
    settings.mode === "front" ? data.covered || new Uint8Array(length) : null;
  for (const name of ["count", "red", "green", "blue"]) data[name].fill(0);
  data.covered?.fill(0);
  for (let n = prepared.size - 1; n >= 0; n--) {
    const i = order ? order[n] : n;
    const q = i * 4;
    if (!prepared.colors[q + 3]) continue;
    const bounds = [
      projection.projected[q],
      projection.projected[q + 1],
      (projection.spatial
        ? projection.projected[q + 3]
        : projection.cellWidth / 2) * prepared.sizes[i],
      (projection.spatial
        ? projection.projected[q + 3]
        : projection.cellHeight / 2) * prepared.sizes[i],
    ];
    const [cx, cy, hx, hy] = bounds;
    const lowX = Math.max(0, Math.floor(cx - hx)),
      highX = Math.min(width - 1, Math.ceil(cx + hx));
    const lowY = Math.max(0, Math.floor(cy - hy)),
      highY = Math.min(height - 1, Math.ceil(cy + hy));
    for (let y = lowY; y <= highY; y++)
      for (let x = lowX; x <= highX; x++) {
        const pixel = y * width + x;
        let mask = maskAt(prepared.shape, bounds, x, y);
        if (settings.mode === "front") {
          mask &= ~data.covered[pixel];
          data.covered[pixel] |= mask;
        }
        if (!mask) continue;
        const weight =
          (covered(mask) / 4) *
          (settings.opacityWeight ? prepared.colors[q + 3] / 255 : 1);
        data.count[pixel] += weight;
        data.red[pixel] += weight * prepared.colors[q];
        data.green[pixel] += weight * prepared.colors[q + 1];
        data.blue[pixel] += weight * prepared.colors[q + 2];
      }
  }
  let occupied = 0;
  for (const count of data.count)
    if (count > 0) {
      if (settings.reference === "percentile") data.sorted[occupied] = count;
      occupied++;
    }
  if (settings.reference === "percentile" && occupied)
    data.sorted.subarray(0, occupied).sort();
  const reference =
    settings.reference === "fixed"
      ? settings.value
      : occupied
        ? data.sorted[
            Math.max(0, Math.ceil(settings.percentile * occupied) - 1)
          ]
        : 0;
  for (let i = 0; i < length; i++)
    densityColor(
      data.count[i],
      data.red[i],
      data.green[i],
      data.blue[i],
      reference,
      settings,
      data.image.data,
      i * 4,
    );
  context.putImageData(data.image, 0, 0);
  return { ...settings, referenceValue: reference, occupiedPixels: occupied };
}

/** Explain one pixel without retaining per-pixel contributor lists. */
export function inspectDensity(
  prepared,
  projection,
  x,
  y,
  settings,
  reference,
) {
  settings = validateDensity(settings);
  x = Math.floor(x);
  y = Math.floor(y);
  let count = 0,
    red = 0,
    green = 0,
    blue = 0,
    ownership = 0,
    contributors = 0;
  const examples = [];
  for (let n = prepared.size - 1; n >= 0; n--) {
    const i = projection.order ? projection.order[n] : n;
    const q = i * 4;
    if (!prepared.colors[q + 3]) continue;
    let mask = maskAt(prepared.shape, bounds(prepared, projection, i), x, y);
    if (settings.mode === "front") {
      mask &= ~ownership;
      ownership |= mask;
    }
    if (!mask) continue;
    const weight =
      (covered(mask) / 4) *
      (settings.opacityWeight ? prepared.colors[q + 3] / 255 : 1);
    count += weight;
    red += weight * prepared.colors[q];
    green += weight * prepared.colors[q + 1];
    blue += weight * prepared.colors[q + 2];
    contributors++;
    if (examples.length < 32) examples.push(prepared.geometry.indices[i]);
  }
  return {
    mode: settings.mode,
    opacityWeight: settings.opacityWeight,
    coverageWeightedCount: count,
    contributorCount: contributors,
    contributorSampleOrdinals: examples,
    contributorExamplesTruncated: contributors > examples.length,
    reference,
    exposure: settings.exposure,
    pixel: { x, y },
    rgba:
      reference === undefined
        ? undefined
        : densityColor(count, red, green, blue, reference, settings),
  };
}
