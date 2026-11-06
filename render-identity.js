/** Shared cache/presentation boundaries. Camera is deliberately absent. */
export function settingsKey(job) {
  return JSON.stringify([
    job.kind,
    job.region,
    job.configuration,
    job.sampleLayout,
    job.appearance,
    job.shaders,
    job.encoding,
    job.blankSpaces,
    job.blankNulls,
    job.frequencyOpacity,
    job.coordinateSystem,
    job.axes,
    job.referenceModels?.map((model) => [model.id, model.revision]),
  ]);
}

export function preparationKey(job) {
  const appearance = job.appearance ? { ...job.appearance } : undefined;
  if (appearance) delete appearance.density;
  const configuration = job.configuration
    ? { ...job.configuration }
    : undefined;
  if (configuration) {
    delete configuration.backend;
    delete configuration.adaptiveResolution;
    delete configuration.footprint;
  }
  return JSON.stringify([
    job.sourceId,
    job.offset,
    job.length,
    settingsKey({ ...job, configuration, appearance }),
  ]);
}

export function presentationKey(job) {
  return JSON.stringify([
    settingsKey(job),
    job.sourceId,
    job.columns,
    job.rows,
    job.width,
    job.height,
    job.scale,
    job.pointScale,
  ]);
}

/** Color, shape, size, encoding, backend, and footprint do not alter world coordinates. */
export function geometryKey(job) {
  const { backend, footprint, adaptiveResolution, ...configuration } =
    job.configuration;
  return JSON.stringify([
    job.sourceId,
    job.offset,
    job.length,
    job.region,
    configuration,
    job.sampleLayout,
    job.shaders.some((flag) => flag === "character" || flag === "hex"),
  ]);
}

/** Exact displayed frame, including selection and camera, for on-demand inspection. */
export const frameKey = (job) =>
  JSON.stringify([preparationKey(job), presentationKey(job), job.rotation]);
