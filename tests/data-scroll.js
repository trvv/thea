import { RenderCanvas } from "./render-canvas.js";
const registry = new Map();
class Node {
  constructor() {
    this.style = {};
    this.children = [];
    this.events = {};
    this.attributes = {};
    this.clientWidth = 800;
    this.clientHeight = 600;
    this.isConnected = false;
  }
  append(...nodes) {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
  }
  remove() {
    if (this.parent)
      this.parent.children = this.parent.children.filter(
        (child) => child !== this,
      );
  }
  replaceChildren(...nodes) {
    this.children = [];
    this.append(...nodes);
  }
  addEventListener(type, handler) {
    this.events[type] = handler;
  }
  dispatchEvent(event) {
    this.events[event.type]?.(event);
  }
  setAttribute(key, value) {
    this.attributes[key] = value;
  }
  focus() {}
  setPointerCapture(id) {
    this.capture = id;
  }
  hasPointerCapture(id) {
    return this.capture === id;
  }
  releasePointerCapture() {
    this.capture = null;
  }
  attachShadow() {
    const root = new Node();
    const cache = new Map();
    root.querySelector = (selector) => {
      if (!cache.has(selector))
        cache.set(
          selector,
          selector === "canvas"
            ? canvas()
            : selector === "data-scroll-view"
              ? new (registry.get(selector))()
              : new Node(),
        );
      return cache.get(selector);
    };
    return (this.shadowRoot = root);
  }
}
const canvas = () => new RenderCanvas();
globalThis.HTMLElement = Node;
globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
};
globalThis.customElements = {
  define: (name, value) => registry.set(name, value),
};
globalThis.document = {
  addEventListener() {},
  createElement: () => new Node(),
};
globalThis.CustomEvent = class {
  constructor(type, options) {
    this.type = type;
    Object.assign(this, options);
  }
};
const { DataScroll } = await import("../main.js");
const source = new Blob([
  Uint8Array.from({ length: 40000 }, (_, i) => i % 251),
]);
const scroll = new DataScroll(source, 100);
scroll.view.isConnected = true;
async function verify() {
  await scroll.view.render();
  let base = 0,
    size = source.size;
  for (let i = 0; i < scroll.levels.length; i++) {
    const level = scroll.levels[i];
    if (
      level.bar.source.size !== size ||
      level.offset < 0 ||
      level.offset + level.length > size ||
      level.base !== base
    )
      throw Error("Invalid nested scope");
    const actual = new Uint8Array(await level.bar.source.arrayBuffer());
    for (const index of [0, Math.floor(actual.length / 2), actual.length - 1])
      if (actual[index] !== (base + index) % 251)
        throw Error("Bar represents incorrect source bytes");
    base += level.offset;
    size = level.length;
  }
  if (
    scroll.offset !== base ||
    scroll.view.offset !== base ||
    scroll.view.length !== size
  )
    throw Error("Visualizer offset mismatch");
  if (
    scroll.view.resolvedSampleLayout.columns *
      scroll.view.resolvedSampleLayout.rows <
    Math.min(scroll.view.length, scroll.view.pointConfiguration.sampleLimit)
  )
    throw Error("Sample grid is too small");
}
if (scroll.barCount !== 2) throw Error("Default count not two");
scroll.seek(5000);
await verify();
scroll.barCount = 3;
await verify();
if (
  scroll.barContainer.children[0] !== scroll.levels[2].bar ||
  scroll.barContainer.children[2] !== scroll.levels[0].bar
)
  throw Error("Bar order reversed");
const [outer, middle, inner] = scroll.levels;
if (!(
  outer.bar.source.size > middle.bar.source.size &&
  middle.bar.source.size > inner.bar.source.size
))
  throw Error("Scopes do not narrow");
outer.bar.events.seek({ detail: 12000 });
await verify();
middle.bar.events.seek({ detail: 500 });
await verify();
inner.bar.events.seek({ detail: 50 });
await verify();
const innerSource = inner.bar.source;
inner.bar.events.keydown({ key: "ArrowRight", preventDefault() {} });
await verify();
if (inner.offset !== 51 || inner.bar.source !== innerSource)
  throw Error("Inner keyboard navigation changed parent scope");
inner.bar.events.keydown({ key: "ArrowLeft", preventDefault() {} });
await verify();
if (inner.offset !== 50)
  throw Error("Inner reverse keyboard navigation failed");
const outerOffset = outer.offset;
scroll.events.wheel({
  deltaY: 1,
  deltaMode: 1,
  preventDefault() {},
  composedPath: () => [outer.bar, scroll],
});
await verify();
if (outer.offset <= outerOffset) throw Error("Wheel did not move targeted bar");

outer.bar.events["window-change"]({
  detail: { offset: 10000, length: 900, edge: "bottom" },
});
await verify();
if (middle.length > 900 || inner.length > middle.length)
  throw Error("Descendants not clamped");
const end = inner.offset + inner.length;
inner.bar.events["window-change"]({
  detail: { offset: inner.offset + 2, length: inner.length - 2, edge: "top" },
});
await verify();
if (inner.offset + inner.length !== end)
  throw Error("Inner resize lost anchor");
scroll.seek(Infinity);
await verify();
scroll.seek(-Infinity);
await verify();
scroll.barCount = 1;
await verify();
if (scroll.barContainer.children.length !== 1)
  throw Error("Removed bars remain in DOM");
let menu;
Object.defineProperty(scroll.menu, "items", {
  set(value) {
    menu = value;
  },
});
scroll.menu.open = () => {};
scroll.events.contextmenu({
  preventDefault() {},
  composedPath: () => [scroll.bar, scroll],
});
const bars = () => menu.at(-1).items.find((item) => item.label === "Bars");
if (
  menu.at(-1).label !== "Advanced" ||
  bars().input !== "number" ||
  bars().value !== 1 ||
  bars().min !== 0 ||
  !menu.some((item) => item.label === "Points")
)
  throw Error("Shared menu incorrect");
if (
  menu.some((item) =>
    ["Bars", "Sample Limit", "Footprint", "Backend"].includes(item.label),
  ) ||
  String(menu.at(-1).items.map((item) => item.label)) !==
    "References,Bookmarks,Open File,Comparison View,Undo,Redo,Edit Profile JSON,Bars,Sample Limit,Provider Budget (MiB),Footprint,Backend"
)
  throw Error("Advanced controls are misplaced");
bars().action(2);
await verify();
scroll.view.region = "digraph";
await verify();
if (
  scroll.view.renderer.latest.configuration.population !== "pairs" ||
  scroll.view.length !== scroll.windowSize
)
  throw Error("Digraph layout changed selection");
scroll.events.contextmenu({
  preventDefault() {},
  composedPath: () => [scroll.view, scroll],
});
if (menu.some((item) => item.label === "Cell" || item.label === "Character"))
  throw Error("Digraph has irrelevant controls");
if (
  !menu
    .find((item) => item.label === "Preset")
    .items.find((item) => item.label === "Load")
    .items.some((item) => item.label === "Digraph" && item.checked)
)
  throw Error("Digraph missing from menu");
scroll.view.region = "dft";
await verify();
if (
  scroll.view.renderer.latest.configuration.population !== "bins" ||
  scroll.view.length !== scroll.windowSize
)
  throw Error("DFT layout changed selection");
scroll.events.contextmenu({
  preventDefault() {},
  composedPath: () => [scroll.view, scroll],
});
if (
  !menu
    .find((item) => item.label === "Preset")
    .items.find((item) => item.label === "Load")
    .items.some((item) => item.label === "DFT" && item.checked)
)
  throw Error("DFT missing from menu");
if (menu.some((item) => item.label === "Cell" || item.label === "Character"))
  throw Error("DFT has irrelevant controls");
scroll.view.region = "trigraph";
await verify();
const previousOffset = scroll.offset;
const cachedCounts = scroll.view.renderer.cache.trigraph.counts;
scroll.view.events.pointerdown({
  button: 0,
  pointerId: 1,
  clientX: 100,
  clientY: 100,
  preventDefault() {},
});
const animationFrames = new Map();
let nextFrame = 0;
globalThis.requestAnimationFrame = (callback) => {
  animationFrames.set(++nextFrame, callback);
  return nextFrame;
};
globalThis.cancelAnimationFrame = (id) => animationFrames.delete(id);
const renderVersion = scroll.view.renderer.version;
for (const x of [120, 130, 140])
  scroll.view.events.pointermove({ pointerId: 1, clientX: x, clientY: 80 });
if (
  animationFrames.size !== 1 ||
  scroll.view.renderer.version !== renderVersion
)
  throw Error("Pointer moves were not coalesced to one animation frame");
const [frameId, renderFrame] = animationFrames.entries().next().value;
animationFrames.delete(frameId);
renderFrame();
await verify();
if (
  Math.abs(scroll.view.rotation.yaw + 0.2) > 1e-9 ||
  scroll.offset !== previousOffset
)
  throw Error("Dragging does not rotate cube independently of selection");
if (scroll.view.renderer.cache.trigraph.counts !== cachedCounts)
  throw Error("Rotation rebuilt histogram");
scroll.view.events.pointerup({ pointerId: 1 });
if (scroll.view.rotationDrag || scroll.view.style.cursor !== "grab")
  throw Error("Rotation did not end");
scroll.events.contextmenu({
  preventDefault() {},
  composedPath: () => [scroll.view, scroll],
});
if (
  menu.at(-1).label !== "Advanced" ||
  menu[0].label !== "Preset" ||
  menu.some((item) => item.label === "Cell" || item.label === "Character")
)
  throw Error("Trigraph menu ordering/visibility incorrect");
const opacityOption = menu
  .find((item) => item.label === "Points")
  .items.find((item) => item.label === "Opacity");
opacityOption.action("count");
await verify();
if (
  scroll.view.appearance.opacity !== "count" ||
  scroll.view.renderer.latest.appearance.opacity !== "count"
)
  throw Error("Opacity mapping not passed to renderer");
menu
  .find((item) => item.label === "Points")
  .items.find((item) => item.label === "Reset")
  .action();
await verify();
menu.find((item) => item.label === "Space").action("cylinder");
await verify();
if (
  scroll.view.pointConfiguration.space !== "cylinder" ||
  menu.find((item) => item.label === "Position").items[0].label !== "Radius"
)
  throw Error("Space menu did not refresh");
menu
  .find((item) => item.label === "Position")
  .items[0].items[0].action("byte3");
await verify();
if (
  scroll.view.pointConfiguration.position[0] !== "byte3" ||
  scroll.view.renderer.latest.configuration.position[0] !== "byte3"
)
  throw Error("Position mapping not passed to renderer");
if (scroll.view.renderer.cache.trigraph.counts !== cachedCounts)
  throw Error("Space change rebuilt histogram");
menu
  .find((item) => item.label === "Camera")
  .items.find((item) => item.label === "Reset Rotation")
  .action();
await verify();
if (scroll.view.rotation.yaw !== -0.6 || scroll.view.rotation.pitch !== 0.45)
  throw Error("Reset Rotation failed");
scroll.view.scheduleRotationRender();
scroll.view.region = "linear";
await verify();
if (animationFrames.size)
  throw Error("Changing mode retained a scheduled rotation frame");
delete globalThis.requestAnimationFrame;
delete globalThis.cancelAnimationFrame;
scroll.events.contextmenu({
  preventDefault() {},
  composedPath: () => [scroll.view, scroll],
});
if (
  menu[0].label !== "Preset" ||
  !menu.some((item) => item.label === "Space") ||
  !menu.some((item) => item.label === "Position") ||
  !menu.some((item) => item.label === "Points") ||
  menu.some((item) => item.label === "Character")
)
  throw Error("Grid menu ordering/visibility incorrect");
scroll.view.shaders = ["character"];
scroll.events.contextmenu({
  preventDefault() {},
  composedPath: () => [scroll.view, scroll],
});
if (!menu.some((item) => item.label === "Character"))
  throw Error("Character controls missing when relevant");
scroll.view.region = "trigraph";
scroll.view.coordinateSystem = "cylindrical";
scroll.view.axes = [2, 1, 0];
scroll.view.region = "linear";
scroll.view.coordinateSystem = "radial";
scroll.view.setAxis(0, 1);
await verify();
if (String(scroll.view.axes) !== "1,0") throw Error("2D axis swap failed");
scroll.view.region = "trigraph";
await verify();
if (
  scroll.view.coordinateSystem !== "cylindrical" ||
  String(scroll.view.axes) !== "2,1,0"
)
  throw Error("3D coordinate preferences not preserved");
scroll.view.region = "linear";
await verify();
if (
  scroll.view.coordinateSystem !== "radial" ||
  String(scroll.view.axes) !== "1,0"
)
  throw Error("2D coordinate preferences not preserved");
scroll.view.coordinateSystem = "cartesian";
scroll.view.axes = [0, 1];

scroll.view.shaders = ["entropy", "brightness"];
await verify();

scroll.events.contextmenu({
  preventDefault() {},
  composedPath: () => [scroll.view, scroll],
});
if (
  !menu.some((item) => item.label === "Points") ||
  !menu.at(-1).items.some((item) => item.label === "Bars")
)
  throw Error("View menu missing bar count");
bars().action(0);
await verify();
if (
  scroll.barContainer.children.length ||
  scroll.view.offset !== 0 ||
  scroll.view.length !== source.size
)
  throw Error("Zero bars did not show full buffer");
scroll.seek(1000);
await verify();
if (scroll.view.offset !== 0 || scroll.view.length !== source.size)
  throw Error("Navigation narrowed zero-bar view");
scroll.view.clientWidth = 173;
await scroll.view.render();
await verify();
if (scroll.view.length !== source.size)
  throw Error("Resize narrowed zero-bar view");
scroll.barCount = 2;
await verify();
if (scroll.view.length === source.size)
  throw Error("Bars did not restore selection");
scroll.barCount = 0;
await verify();
scroll.view.region = "hilbert";
await verify();
if (scroll.view.length !== source.size || scroll.view.offset !== 0)
  throw Error("Hilbert narrowed zero-bar buffer");
scroll.view.region = "linear";
await verify();
for (const invalid of [-1, 1.5, NaN]) {
  let rejected = false;
  try {
    scroll.barCount = invalid;
  } catch {
    rejected = true;
  }
  if (!rejected) throw Error("Invalid bar count accepted");
}
// Raw geometry must preserve nested selection and use sample columns for navigation.
scroll.barCount = 1;
scroll.view.applyPreset("linear");
await verify();
scroll.events.contextmenu({
  preventDefault() {},
  composedPath: () => [scroll.view, scroll],
});
menu.find((item) => item.label === "Space").action("cube");
await verify();
if (!scroll.view.spatial || "group" in scroll.view.pointConfiguration)
  throw Error("Bytes cannot use a cube");
const beforeArrow = scroll.offset,
  step = scroll.view.navigationColumns;
scroll.view.events.keydown({ key: "ArrowDown", preventDefault() {} });
await verify();
if (scroll.offset !== beforeArrow + step)
  throw Error("Raw geometry navigation used raster width");
scroll.events.contextmenu({
  preventDefault() {},
  composedPath: () => [scroll.view, scroll],
});
const available = menu
  .find((item) => item.label === "Points")
  .items.find((item) => item.label === "Hue")
  .items[0].items.map((item) => item.label);
if (
  String(available) !==
  String(
    menu
      .find((item) => item.label === "Position")
      .items[0].items[0].items[0].items.map((item) => item.label),
  )
)
  throw Error("Position and appearance factor pools differ");
if (menu.some((item) => item.label === "Data"))
  throw Error("Data grouping selector remains");
menu
  .find((item) => item.label === "Points")
  .items.find((item) => item.label === "Hue")
  .action("phase");
await verify();
if (scroll.view.appearance.hue !== "phase")
  throw Error("Spectral appearance factor unavailable");
menu.find((item) => item.label === "Space").action("square");
await verify();
if (scroll.view.spatial || scroll.view.appearance.hue !== "phase")
  throw Error("Triples cannot use a square");
menu
  .find((item) => item.label === "Preset")
  .items.find((item) => item.label === "Load")
  .items.find((item) => item.label === "Linear")
  .action();
await verify();
if (
  scroll.view._pointConfiguration ||
  scroll.view.appearance ||
  scroll.view.region !== "linear"
)
  throw Error("Preset did not restore profile defaults");
const pipeline = {
  op: "normalize",
  input: {
    op: "byte",
    offset: { op: "add", a: { op: "offset" }, b: { op: "constant", value: 1 } },
  },
  min: 0,
  max: 255,
};
scroll.view.setFactor("Neighbor", pipeline);
scroll.events.contextmenu({
  preventDefault() {},
  composedPath: () => [scroll.view, scroll],
});
menu
  .find((item) => item.label === "Points")
  .items.find((item) => item.label === "Hue")
  .items.find((item) => item.label === "Source")
  .items.find((item) => item.label === "Saved Factors")
  .items.find((item) => item.label === "Neighbor")
  .action();
await verify();
if (
  scroll.view.appearance.hue.op !== "ref" ||
  scroll.view.renderer.latest.configuration.recipes.Neighbor.op !== "normalize"
)
  throw Error("Named recipe did not reach renderer");
const cachedRecipe = scroll.view.renderer.cache.preparedPoints;
scroll.view.setFactor("Neighbor", { op: "invert", input: pipeline });
await verify();
if (scroll.view.renderer.cache.preparedPoints === cachedRecipe)
  throw Error("Editing a named recipe reused stale points");
let cycleRejected = false;
try {
  scroll.view.setFactor("Neighbor", { op: "ref", name: "Neighbor" });
} catch {
  cycleRejected = true;
}
if (!cycleRejected) throw Error("Named recipe cycle accepted");
scroll.view.applyPreset("linear");
await verify();
if (
  !scroll.view.pointConfiguration.recipes.Neighbor ||
  scroll.view._pointConfiguration
)
  throw Error("Preset lost custom factor definitions");
scroll.barCount = 0;
await verify();

scroll.source = new Blob([new Uint8Array(1031)]);
await scroll.view.render();
if (scroll.view.length !== 1031 || scroll.view.offset !== 0)
  throw Error("New source not fully displayed without bars");
scroll.source = new Blob();
if (
  scroll.view.length !== 0 ||
  scroll.levels.some((level) => level.length !== 0 || level.offset !== 0)
)
  throw Error("Empty source failed");
console.log(
  "Nested bar checks pass: default count, visual order, narrowing scopes, exact source bytes, movement, resizing, anchored edge, clamping, add/remove, shared menu, zero-bar full buffer, resize, invalid counts, empty source.",
);

// Profiles survive JSON and validate atomically; public settings are owned snapshots.
const profileView = scroll.view;
profileView.applyPreset("trigraph");
profileView.appearance = {
  ...profileView.effectiveAppearance,
  lightness: { op: "factor", name: "tripleCount" },
};
if (profileView.pointConfiguration.population !== "triples")
  throw Error("Recipe promotion discarded tuple population");
profileView.pointConfiguration = {
  ...profileView.pointConfiguration,
  sampleLimit: 17,
};
profileView.setFactor("Neighbor", { op: "byte", offset: { op: "offset" } });
const profile = profileView.exportProfile(),
  json = JSON.stringify(profile);
profileView.applyPreset("dft");
profileView.importProfile(json);
if (JSON.stringify(profileView.exportProfile()) !== json)
  throw Error("Profile JSON round trip differs");
for (const patch of [
  { version: 99 },
  { rotation: { yaw: NaN, pitch: 0 } },
  { configuration: { ...profile.configuration, sampleLimit: 0 } },
  { recipes: { bad: { op: "ref", name: "bad" } } },
  { axes: [0, 0, 0] },
]) {
  let rejected = false;
  try {
    profileView.importProfile({ ...profile, ...patch });
  } catch {
    rejected = true;
  }
  if (!rejected || JSON.stringify(profileView.exportProfile()) !== json)
    throw Error("Invalid profile was accepted or mutated state");
}
const snapshot = profileView.pointConfiguration;
snapshot.recipes.Neighbor = { op: "constant", value: 0 };
snapshot.position[0] = "none";
const appearanceSnapshot = profileView.appearance;
appearanceSnapshot.lightness = "none";
const shadersSnapshot = profileView.shaders;
shadersSnapshot.push("hex");
if (JSON.stringify(profileView.exportProfile()) !== json)
  throw Error("Public getter exposed mutable state");
console.log(
  "Profile checks pass: durable JSON, population preservation, atomic rejection, owned configuration/appearance/flags.",
);

// Dimensions parameterize each axis directly, with no Layout or hidden position override.
const ranged = new DataScroll(source, 101);
ranged.view.isConnected = true;
await ranged.view.render();
const selected = [ranged.view.offset, ranged.view.length];
if (
  ranged
    .contextItems()
    .some((item) => item.label === "Layout" || item.label === "Grid")
)
  throw Error("Layout/Grid overrides remain");
ranged
  .contextItems()
  .find((item) => item.label === "Space")
  .action("cube");
await ranged.view.render();
let axes = ranged
  .contextItems()
  .find((item) => item.label === "Position").items;
if (String(axes.map((axis) => axis.label)) !== "Width,Height,Depth")
  throw Error("Cartesian dimension names incorrect");
axes[0].items.find((item) => item.label === "End").action(4);
axes = ranged.contextItems().find((item) => item.label === "Position").items;
axes[1].items.find((item) => item.label === "End").action(3);
await ranged.view.render();
const resolved = ranged.view.renderer.cache.preparedPoints.grid;
if (resolved.columns !== 4 || resolved.rows !== 3)
  throw Error("Range cell counts were not applied");
if (String([ranged.view.offset, ranged.view.length]) !== String(selected))
  throw Error("Range edits changed selected bytes");
if (
  !ranged.view.pointConfiguration.dimensions.width.fit ||
  !ranged.view.pointConfiguration.dimensions.height.fit
)
  throw Error("Fit must default on");
axes = ranged.contextItems().find((item) => item.label === "Position").items;
axes[0].items.find((item) => item.label === "Fit").action();
await ranged.view.render();
if (
  ranged.view.pointConfiguration.dimensions.width.fit ||
  !ranged.view.pointConfiguration.dimensions.height.fit
)
  throw Error("Fit flags are not independent");
axes = ranged.contextItems().find((item) => item.label === "Position").items;
axes[0].items.find((item) => item.label === "Range Mode").action("truncate");
await ranged.view.render();
if (
  ranged.view.pointConfiguration.dimensions.width.mode !== "truncate" ||
  ranged.view.pointConfiguration.dimensions.height.mode !== "scale"
)
  throw Error("Range modes are not independent");
axes = ranged.contextItems().find((item) => item.label === "Position").items;
axes[0].items.find((item) => item.label === "Reset Range").action();
await ranged.view.render();
if (
  !ranged.view.pointConfiguration.dimensions.width.fit ||
  ranged.view.pointConfiguration.dimensions.width.end !== null
)
  throw Error("Range reset failed");
ranged.view.applyPreset("hilbert");
await ranged.view.render();
if (
  ranged.view.renderer.latest.configuration.position[0].input.op !==
    "hilbert" ||
  "layout" in ranged.view.pointConfiguration
)
  throw Error("Hilbert preset is not explicit coordinates");
const beforeEdit = ranged.view.pointConfiguration.position[0];
ranged
  .contextItems()
  .find((item) => item.label === "Position")
  .items[0].items[0].action("value");
await ranged.view.render();
if (
  ranged.view.pointConfiguration.position[0] !== "value" ||
  beforeEdit.input.op !== "hilbert"
)
  throw Error("Axis mapping was overridden");
console.log(
  "Dimension controls pass: no Layout override, width/height/depth, ranges, independent Fit, selection preservation, explicit Hilbert preset.",
);

ranged
  .contextItems()
  .find((item) => item.label === "Preset")
  .items.find((item) => item.label === "Load")
  .items.find((item) => item.label === "Hilbert 3D")
  .action();
await ranged.view.render();
if (
  ranged.view.region !== "hilbert3d" ||
  !ranged.view.spatial ||
  ranged.view.style.cursor !== "grab"
)
  throw Error("Hilbert 3D preset did not activate rotation");
if (
  ranged.view.effectiveAppearance.lightness !== "value" ||
  ranged.view.pointConfiguration.population !== "bytes"
)
  throw Error("Hilbert 3D preset did not retain byte shading");
if (
  ranged.view.renderer.latest.configuration.position[2].input.op !== "hilbert3d"
)
  throw Error("Hilbert 3D preset did not reach the renderer");
const cubeProfile = JSON.stringify(ranged.view.exportProfile());
ranged.view.applyPreset("linear");
ranged.view.importProfile(cubeProfile);
if (
  JSON.stringify(ranged.view.exportProfile()) !== cubeProfile ||
  ranged.view.axes.length !== 3
)
  throw Error("Hilbert 3D profile round trip differs");

// Every preset shades hue with entropy; editing the shorthand creates a durable shared recipe.
for (const preset of [
  "linear",
  "hilbert",
  "hilbert3d",
  "digraph",
  "dft",
  "trigraph",
]) {
  ranged.view.applyPreset(preset);
  await ranged.view.render();
  if (ranged.view.effectiveAppearance.hue !== "entropy")
    throw Error(`${preset} lacks entropy hue`);
  const hue = ranged
    .contextItems()
    .find((item) => item.label === "Points")
    .items.find((item) => item.label === "Hue");
  const window = hue.items.find((item) => item.label === "Window");
  if (window.value !== 32) throw Error("Default entropy window changed");
  window.action(64);
  await ranged.view.render();
  if (!ranged.view.renderer.cache.recipeEntropy.values.has(64))
    throw Error("Shading window did not reach provider");
  const saved = JSON.stringify(ranged.view.exportProfile());
  ranged.view.applyPreset("linear");
  ranged.view.importProfile(saved);
  if (ranged.view.effectiveAppearance.hue.window !== 64)
    throw Error("Entropy window lost in profile");
}

// Clicking a 3D mark inspects it; a camera drag must not also open the inspector.
ranged.view.applyPreset("hilbert3d");
await ranged.view.render();
let inspections = 0;
ranged.view.inspectAt = () => inspections++;
ranged.view.events.pointerdown({
  button: 0,
  pointerId: 9,
  clientX: 10,
  clientY: 10,
  preventDefault() {},
});
ranged.view.events.pointermove({ pointerId: 9, clientX: 30, clientY: 20 });
ranged.view.events.pointerup({ pointerId: 9 });
ranged.view.events.click({ button: 0, clientX: 30, clientY: 20 });
if (inspections !== 0) throw Error("Camera drag opened inspection");
ranged.view.events.pointerdown({
  button: 0,
  pointerId: 10,
  clientX: 10,
  clientY: 10,
  preventDefault() {},
});
ranged.view.events.pointermove({ pointerId: 10, clientX: 11, clientY: 11 });
ranged.view.events.pointerup({ pointerId: 10 });
ranged.view.events.click({ button: 0, clientX: 11, clientY: 11 });
if (inspections !== 1) throw Error("Stationary 3D click did not inspect");

// Saved presets persist complete view snapshots, while the source stays session-owned.
const originalStorage = Object.getOwnPropertyDescriptor(
  globalThis,
  "localStorage",
);
const originalPrompt = globalThis.prompt;
const originalAlert = globalThis.alert;
const storedPresets = new Map();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem(key) {
      return storedPresets.get(key) ?? null;
    },
    setItem(key, value) {
      storedPresets.set(key, value);
    },
  },
});
const prompts = [];
const storageAlerts = [];
globalThis.prompt = () => prompts.shift() ?? null;
globalThis.alert = (message) => storageAlerts.push(message);
try {
  const { storageKey, readLibrary } = await import("../preset-library.js");
  const persistent = new DataScroll(source, 101);
  persistent.view.isConnected = true;
  persistent.barCount = 3;
  persistent.view.applyPreset("hilbert3d");
  persistent.view.setFactor("Neighbor", {
    op: "byte",
    offset: { op: "offset" },
  });
  persistent.view.appearance = {
    ...persistent.view.effectiveAppearance,
    hue: { op: "entropy", offset: { op: "offset" }, window: 64 },
  };
  const savedSnapshot = persistent.presetSnapshot();
  const presetMenu = () =>
    persistent.contextItems().find((item) => item.label === "Preset").items;
  const savedEntries = () =>
    presetMenu().find((item) => item.label === "Manage").items;
  const loadMenu = () =>
    presetMenu().find((item) => item.label === "Load").items;
  const savedCommand = (name, command) =>
    command === "Load"
      ? loadMenu()
          .find((item) => item.label === "Saved")
          .items.find((item) => item.label === name)
      : savedEntries()
          .find((entry) => entry.label === name)
          .items.find((item) => item.label === command);
  if (
    presetMenu().some(
      (item) => item.label === "Linear" || item.label === "Hilbert 3D",
    )
  ) {
    throw Error("Built-in presets remain at the top of the preset menu");
  }
  prompts.push("My Cube");
  await presetMenu()
    .find((item) => item.label === "Save As")
    .action();
  if (
    !savedEntries().find((entry) => entry.label === "My Cube" && entry.checked)
  ) {
    throw Error("New saved preset is not selected");
  }
  const serialized = storedPresets.get(storageKey);
  if (
    !serialized ||
    serialized.includes('"source"') ||
    serialized.includes('"windowSize"')
  ) {
    throw Error("Preset did not persist or included session source state");
  }
  const restored = new DataScroll(source, 101);
  if (
    JSON.stringify(restored.presetSnapshot()) !== JSON.stringify(savedSnapshot)
  ) {
    throw Error("Reloaded host did not restore the saved view and bar count");
  }
  persistent.view.applyPreset("linear");
  persistent.barCount = 1;
  await savedCommand("My Cube", "Load").action();
  if (
    JSON.stringify(persistent.presetSnapshot()) !==
    JSON.stringify(savedSnapshot)
  ) {
    throw Error("Load lost saved recipes, appearance, geometry, or bar count");
  }
  persistent.view.appearance = {
    ...persistent.view.effectiveAppearance,
    hue: "value",
  };
  if (savedEntries().find((entry) => entry.label === "My Cube").checked) {
    throw Error("An unsaved edit still matched the stored preset");
  }
  await savedCommand("My Cube", "Update").action();
  if (readLibrary().presets[0].profile.appearance.hue !== "value") {
    throw Error("Update did not save current settings");
  }
  prompts.push("Cube Copy");
  await savedCommand("My Cube", "Duplicate").action();
  prompts.push("Renamed Copy");
  await savedCommand("Cube Copy", "Rename").action();
  if (!savedEntries().some((entry) => entry.label === "Renamed Copy")) {
    throw Error("Duplicate/rename did not refresh the preset menu");
  }
  const beforeCollision = storedPresets.get(storageKey);
  prompts.push("My Cube");
  await savedCommand("Renamed Copy", "Rename").action();
  if (
    storedPresets.get(storageKey) !== beforeCollision ||
    storageAlerts.length !== 1
  ) {
    throw Error("Name collision overwrote a saved preset or failed silently");
  }
  let copied;
  persistent.copyPreset = async (value) => {
    copied = value;
  };
  await savedCommand("My Cube", "Copy JSON").action();
  if (copied.name !== "My Cube" || copied.profile.appearance.hue !== "value") {
    throw Error("Copy JSON used unsaved or unrelated data");
  }
  prompts.push(
    JSON.stringify({
      version: 1,
      name: "Imported",
      profile: copied.profile,
      barCount: 0,
    }),
    "Imported",
  );
  await presetMenu()
    .find((item) => item.label === "Import JSON")
    .action();
  if (
    persistent.barCount !== 0 ||
    persistent.savedPresetId !== readLibrary().selected
  ) {
    throw Error("Import did not create and load the copied preset");
  }
  await savedCommand("Imported", "Delete").action();
  if (
    persistent.barCount !== 0 ||
    readLibrary().presets.some((entry) => entry.name === "Imported")
  ) {
    throw Error("Deleting changed the live view or retained the stored preset");
  }
  await loadMenu()
    .find((item) => item.label === "Digraph")
    .action();
  const builtinRestored = new DataScroll(source, 101);
  if (builtinRestored.view.region !== "digraph") {
    throw Error("The last selected built-in preset was not restored");
  }
  const beforeCancel = storedPresets.get(storageKey);
  prompts.push(null);
  await presetMenu()
    .find((item) => item.label === "Save As")
    .action();
  if (storedPresets.get(storageKey) !== beforeCancel)
    throw Error("Canceled save changed storage");
} finally {
  if (originalStorage)
    Object.defineProperty(globalThis, "localStorage", originalStorage);
  else delete globalThis.localStorage;
  globalThis.prompt = originalPrompt;
  globalThis.alert = originalAlert;
}
console.log(
  "Preset menu checks pass: save/load/update/duplicate/rename/delete/import/copy, collision errors, cancellation, snapshots, and startup restoration.",
);

// Real menu descriptors record profile edits, while bar/source navigation remains outside history.
const editor = new DataScroll(source, 101);
let editorMenu;
Object.defineProperty(editor.menu, "items", {
  set(value) {
    editorMenu = value;
  },
});
const advancedEdit = (label) =>
  editorMenu
    .find((item) => item.label === "Advanced")
    .items.find((item) => item.label === label);
editor.refreshMenu();
const originalLimit = editor.view.pointConfiguration.sampleLimit;
advancedEdit("Sample Limit").action(64);
if (editor.view.editHistory.past.length !== 1)
  throw Error("Menu edit was not recorded");
if (advancedEdit("Undo").disabled) throw Error("Undo state did not refresh");
advancedEdit("Undo").action();
if (editor.view.pointConfiguration.sampleLimit !== originalLimit)
  throw Error("Undo did not restore settings");
advancedEdit("Redo").action();
if (editor.view.pointConfiguration.sampleLimit !== 64)
  throw Error("Redo did not restore settings");
const historyCount = editor.view.editHistory.past.length;
advancedEdit("Bars").action(0);
if (editor.view.editHistory.past.length !== historyCount)
  throw Error("Navigation entered profile history");
editor.view.setFactor("Old", "value");
editor.view.renameFactor("Old", "New");
if (!Object.hasOwn(editor.view.pointConfiguration.recipes, "New"))
  throw Error("Factor rename failed");
editor.view.deleteFactor("New");
console.log(
  "Profile menu editing passes: bounded undo/redo, factor rename/delete and navigation isolation.",
);

// One host owns selection; the comparison owns an independent profile/camera.
editor.toggleComparison();
const comparison = editor.comparisonView;
if (
  comparison.source !== editor.source ||
  comparison.offset !== editor.view.offset ||
  comparison.length !== editor.view.length
)
  throw Error("Comparison selection is not linked");
const primaryProfile = JSON.stringify(editor.view.exportProfile());
comparison.applyPreset("hilbert3d");
if (JSON.stringify(editor.view.exportProfile()) !== primaryProfile)
  throw Error("Comparison changed primary settings");
editor.barCount = 2;
editor.seek(1234);
if (
  comparison.offset !== editor.view.offset ||
  comparison.length !== editor.view.length
)
  throw Error("Comparison seek drifted");
editor.activeView = comparison;
editor.applyTemplate(
  (await import("../byte-frequency.js")).byteFrequencyTable(),
);
if (
  comparison.pointConfiguration.population !== "symbols" ||
  editor.view.pointConfiguration.population === "symbols"
)
  throw Error("Template did not target active view");
editor.source = new Blob([new Uint8Array(5000)]);
if (
  comparison.source !== editor.source ||
  comparison.length !== editor.view.length
)
  throw Error("Comparison source replacement drifted");
editor.toggleComparison();
if (editor.comparisonView || editor.editingView !== editor.view)
  throw Error("Comparison removal retained ownership");
console.log(
  "Comparison views pass: shared source/selection, independent profiles, active-view edits, source replacement and cleanup.",
);

editor.view.applyPreset("linear");
editor.selectRange(123, 65);
if (editor.view.offset !== 123 || editor.view.length !== 65)
  throw Error("Bookmarked range did not preserve exact bytes");
editor.setSourceMetadata({
  segments: [{ start: 100, endExclusive: 200, address: "0x1000" }],
});
if (editor.view.sourceMetadata.segments[0].address !== "0x1000")
  throw Error("Source metadata not attached");
editor.source = new Blob([new Uint8Array(1000)]);
if (editor.view.sourceMetadata || editor.exactSelectionLength !== undefined)
  throw Error("New source retained annotations/bookmark scope");
console.log(
  "Source ranges/annotations pass: exact restored intervals and source-bound metadata cleanup.",
);
