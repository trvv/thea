/** Shared view pipeline and overview rendering, used identically by the UI and worker. */
export { entropyShading } from "./entropy.js";
import { compileRecipes, recipeRoots } from "./recipes.js";
import { defaultSampleLimit } from "./populations.js";
import { spaces, resolveViewJob } from "./point-configuration.js";
import { requiredFactors } from "./factors.js";
import { renderPoints } from "./point-renderer.js";
import { defaultAppearance } from "./appearance.js";
import { overviewValues } from "./overview.js";
import { fourierCost } from "./fourier.js";

export { byteCharacter } from "./text.js";

export { hilbertCells } from "./hilbert.js";

const grayscaleFrames = new WeakMap();

/**
 * Reuse image storage and delay resizing until replacement pixels are ready; clearing an old canvas
 * before an awaited render was a source of flicker.
 */
export function paintBytes(
  canvas,
  values,
  width = canvas.width,
  height = canvas.height,
) {
  // Resize and draw together, only once the next image is ready.
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const context = canvas.getContext("2d");
  let frame = grayscaleFrames.get(canvas);
  if (!frame || frame.width !== width || frame.height !== height) {
    frame = { width, height, image: context.createImageData(width, height) };
    grayscaleFrames.set(canvas, frame);
  }
  const image = frame.image;
  const count = width * height;
  for (let i = 0, offset = 0; i < count; i++, offset += 4) {
    image.data[offset] =
      image.data[offset + 1] =
      image.data[offset + 2] =
        values[i];
    image.data[offset + 3] = 255;
  }
  context.putImageData(image, 0, 0);
}

// Include preparation and painting in the estimate, rather than just output size.
/**
 * Predict structural work, including arbitrary-length FFT overhead, before deciding which thread
 * owns the job. This is calibration input, not a promised runtime.
 */
export function renderCost(job) {
  if (job.kind === "bar")
    return (job.length ?? job.source.size) + job.width * job.height * 8;
  job = resolveViewJob(job);
  {
    const configuration = job.configuration;
    const appearance =
      job.appearance ||
      defaultAppearance(job.region, job.shaders, job.frequencyOpacity);
    const used = requiredFactors(configuration, appearance, job.shaders);
    const program = compileRecipes(
      recipeRoots(configuration, appearance),
      configuration.recipes,
    );
    const population = configuration.population || "bytes";
    const available =
      population === "bins"
        ? Math.floor(job.length / 2) + 1
        : population === "pairs"
          ? Math.min(65536, job.length)
          : population === "triples"
            ? job.length
            : Math.min(
                job.length,
                job.sampleLayout.columns * job.sampleLayout.rows,
              );
    const samples = Math.min(
      available,
      configuration.sampleLimit === null
        ? Infinity
        : (configuration.sampleLimit ?? defaultSampleLimit),
    );
    const statistics = [
      "entropy",
      "byteCount",
      "pairCount",
      "tripleCount",
      "count",
    ].some((name) => used.has(name));
    const bytes =
      statistics ||
      population === "pairs" ||
      population === "triples" ||
      ["value", "byte1", "byte2", "byte3", "previous"].some((name) =>
        used.has(name),
      );
    return (
      (bytes ? job.length * (used.has("entropy") ? 18 : 2) : 0) +
      samples *
        (24 +
          program.nodes.length * 3 +
          (spaces[configuration.space].length === 3
            ? Math.log2(Math.max(1, samples)) * 2
            : 0)) +
      job.columns * job.rows * (configuration.backend === "webgl" ? 4 : 16) +
      (used.has("phase") || used.has("amplitude") ? fourierCost(job.length) : 0)
    );
  }
}

/** All presets are configuration data; no preset name selects a painter. */
export async function executeRender(
  canvas,
  job,
  cache = {},
  current = () => true,
) {
  if (!current()) return null;
  if (job.kind === "view")
    return renderPoints(canvas, resolveViewJob(job), cache, current);
  const overview = await overviewValues(job, cache, current);
  if (!overview || !current()) return null;
  const started = performance.now();
  paintBytes(canvas, overview.values, job.width, job.height);
  return {
    duration: overview.duration + performance.now() - started,
    work: overview.bytesRead + job.width * job.height * 8,
  };
}
