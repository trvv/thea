/**
 * General point path with CPU providers and CPU/WebGL rasterization. Prepared geometry and colors survive camera/quality changes;
 * rasterization still runs for each presented frame.
 * @module point-renderer
 */
import { compileRecipes, recipeRoots } from "./recipes.js";
import { appearanceChannelsFor } from "./factor-catalog.js";
import { compileAppearance, defaultAppearance } from "./appearance.js";
import { compilePosition } from "./point-configuration.js";
import { projectPoints } from "./point-projection.js";
import { paintCPU } from "./point-raster.js";
import { paintWebGL } from "./point-webgl.js";
import { preparationKey, geometryKey, frameKey } from "./render-identity.js";
import { pointFactors } from "./point-factors.js";
import { paintDensity, assertDensityStorage } from "./density.js";
import {
  createProviderDiagnostics,
  retainedProviderStorage,
} from "./provider-diagnostics.js";

// Requested providers yield normalized factors for position and appearance. Prepared points survive camera changes in either renderer thread.
/**
 * Evaluate reachable recipes while preparing points, then keep those points across camera and
 * raster-scale changes. Geometry, appearance, projection/order, and raster storage have separate
 * invalidation boundaries.
 * @returns {Promise<object|null>} Frame metrics, or null after supersession; does not remap the
 *   completed image.
 */
export async function preparePoints(job, cache, current) {
  const diagnostics = createProviderDiagnostics(job);
  let preparationReused = true;
  const config = job.configuration,
    region = job.region;
  const appearance =
    job.appearance ||
    defaultAppearance(region, job.shaders, job.frequencyOpacity);
  const signature = job.preparationKey ?? preparationKey(job);
  let prepared = cache.preparedPoints;
  let geometryReused = true;
  if (
    !prepared ||
    prepared.source !== (job.sourceId ?? job.source) ||
    prepared.signature !== signature
  ) {
    preparationReused = false;
    const coordinatesKey = geometryKey(job);
    const geometry =
      cache.pointGeometry?.source === (job.sourceId ?? job.source) &&
      cache.pointGeometry.signature === coordinatesKey
        ? cache.pointGeometry
        : null;
    geometryReused = Boolean(geometry);
    const roots = recipeRoots(config, appearance);
    if (geometry) for (let i = 0; i < 3; i++) delete roots[`p${i}`];
    const colorKey = preparationKey({
      ...job,
      appearance: { ...appearance, size: "none", shape: "square" },
    });
    const colorsReused =
      geometry &&
      prepared?.source === (job.sourceId ?? job.source) &&
      prepared.colorKey === colorKey;
    if (colorsReused)
      for (const channel of appearanceChannelsFor(appearance))
        if (channel !== "size") delete roots[channel];
    const program = compileRecipes(roots, config.recipes);
    const evaluate = program.createEvaluator();
    const mapped = {
      shape: appearance.shape,
      colorSpace: appearance.colorSpace,
    };
    for (const channel of appearanceChannelsFor(appearance))
      mapped[channel] = program.bindings[channel] ?? "none";
    const style = compileAppearance(mapped);
    let position;
    const xyz = new Float64Array(3);
    let size = 0,
      ordinal = 0,
      positions,
      indices,
      colors,
      sizes,
      labels = [];
    const text =
      job.shaders.includes("hex") || job.shaders.includes("character");
    /** Evaluate into synthetic slots before geometry/color conversion. Copy prepared values now because the provider reuses its input vector for the next sample. */
    const emit = (factors, label, context) => {
      const index = ordinal++;
      if (
        geometry &&
        (size >= geometry.size || geometry.indices[size] !== index)
      )
        return;
      evaluate(factors, context);
      if (!geometry && !position(factors, xyz)) return;
      const p = size * 3;
      if (!geometry) {
        positions[p] = xyz[0];
        positions[p + 1] = xyz[1];
        positions[p + 2] = xyz[2];
        indices[size] = index;
      }
      if (!colorsReused) style.rgba(factors, colors, size * 4);
      sizes[size] = style.size(factors);
      if (text) labels.push(label);
      size++;
    };
    const visit = await pointFactors(
      job,
      appearance,
      cache,
      current,
      program,
      diagnostics,
    );
    if (!visit || !current()) return null;
    positions = geometry?.positions || new Float32Array(visit.count * 3);
    indices = geometry?.indices || new Uint32Array(visit.count);
    colors = colorsReused
      ? prepared.colors
      : new Uint8ClampedArray(visit.count * 4);
    sizes = new Float32Array(visit.count);
    position = compilePosition(
      {
        ...config,
        position: [0, 1, 2].map((i) => program.bindings[`p${i}`] ?? "none"),
      },
      visit.grid.dimensions,
    );
    const evaluationStarted = diagnostics ? performance.now() : 0;
    visit(emit);
    if (diagnostics) {
      diagnostics.evaluation.milliseconds =
        performance.now() - evaluationStarted;
      diagnostics.evaluation.samples = ordinal;
    }
    const world = geometry || {
      source: job.sourceId ?? job.source,
      signature: coordinatesKey,
      positions,
      indices,
      size,
      grid: visit.grid,
    };
    cache.pointGeometry = world;
    prepared = cache.preparedPoints = {
      source: job.sourceId ?? job.source,
      signature,
      colorKey,
      geometry: world,
      positions,
      colors,
      sizes,
      labels,
      size,
      grid: visit.grid,
      shape: style.shape,
      text,
    };
  }
  if (!current()) return null;
  if (diagnostics) {
    diagnostics.preparationReused = preparationReused;
    diagnostics.retained = retainedProviderStorage(cache);
  }
  return { prepared, geometryReused, diagnostics };
}

export async function renderPoints(canvas, job, cache, current) {
  const started = performance.now(),
    result = await preparePoints(job, cache, current);
  if (!result || !current()) return null;
  const { prepared, geometryReused, diagnostics } = result,
    config = job.configuration;
  const preparation = performance.now() - started;
  const { columns: width, rows: height } = job;
  const appearance =
    job.appearance ||
    defaultAppearance(job.region, job.shaders, job.frequencyOpacity);
  if (appearance.density)
    assertDensityStorage(job, width, height, appearance.density);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const context = canvas.getContext("2d"),
    scratch = (cache.pointRaster ||= {});
  if (!appearance.density) delete scratch.density;
  const projection = projectPoints(prepared, job, scratch);
  const { projected, order, spatial, cellWidth, cellHeight } = projection;
  const rasterStarted = performance.now();
  const density = appearance.density
    ? paintDensity(
        context,
        prepared,
        projection,
        scratch,
        appearance.density,
        job,
      )
    : undefined;
  const accelerated =
    !density &&
    config.backend === "webgl" &&
    paintWebGL(cache, context, prepared, projected, order, projection);
  cache.pointBackend = accelerated ? "webgl" : "cpu";
  if (!accelerated && !density)
    paintCPU(context, prepared, projection, scratch);
  if (prepared.text) {
    context.textAlign = "center";
    context.textBaseline = "middle";
    for (let n = 0; n < prepared.size; n++) {
      const i = order ? order[n] : n,
        q = i * 4,
        size =
          (spatial ? projected[q + 3] * 2 : Math.min(cellWidth, cellHeight)) *
          prepared.sizes[i];
      if (!(size > 0)) continue;
      context.font = `${(size * 0.75) / (job.shaders.includes("hex") ? 1.2 : 1)}px monospace`;
      context.fillStyle =
        prepared.colors[q] * 0.299 +
          prepared.colors[q + 1] * 0.587 +
          prepared.colors[q + 2] * 0.114 >
        128
          ? "black"
          : "white";
      context.fillText(prepared.labels[i], projected[q], projected[q + 1]);
    }
  }
  cache.pointFrame = {
    key: frameKey(job),
    source: job.sourceId ?? job.source,
    prepared,
    projection,
    density,
  };
  return {
    duration: performance.now() - started,
    dimensions: prepared.grid.dimensions,
    ...(density ? { density } : {}),
    ...(diagnostics ? { diagnostics } : {}),
    timings: {
      preparation,
      projection: projection.projection || 0,
      sorting: projection.sorting || 0,
      rasterization: performance.now() - rasterStarted,
    },
    reused: { geometry: geometryReused, projection: projection.reused },
  };
}
