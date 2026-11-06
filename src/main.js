import { stylesheetLink, ensureStyles, pendingStyles } from "./ui/styles.js";
/**
 * Browser integration and selection ownership. Keep byte ranges here; renderers consume snapshots
 * rather than mutating navigation state.
 * @module main
 * @see docs/architecture.md
 * @see docs/data-selection.md
 */
import * as presetLibrary from "./presets/preset-library.js";
import {
  renameFactor,
  deleteFactor,
  rememberEdit,
  restoreEdit,
} from "./presets/profile-edits.js";
import { inspectionContent } from "./inspection/inspection-content.js";
import { appearanceChannelsFor } from "./recipes/factor-catalog.js";
import { byteFrequencyTable } from "./presets/byte-frequency.js";
import { packedPixels, pixelFormats } from "./presets/packed-pixels.js";
import { findOccurrences, inspectByteContext } from "./analysis/occurrences.js";
import { chooseFile, downloadJSON } from "./ui/browser-files.js";
import * as referenceModels from "./analysis/reference-models.js";
import * as bookmarks from "./presets/bookmarks.js";
import { validateSourceMetadata } from "./data/source-metadata.js";
import { validateDensity } from "./render/density.js";
import { curveTemplate } from "./presets/curve-templates.js";
import { assertProviderBudget } from "./data/provider-budget.js";
import {
  dimensionNames,
  defaultDimension,
  pointGrid,
} from "./recipes/dimensions.js";
import { validateProfile, parseProfile } from "./presets/profiles.js";
import { settingsKey } from "./render/render-identity.js";
import {
  limitedSampleLayout,
  populations,
  recordPopulation,
} from "./data/populations.js";
import { recipeMenu } from "./ui/recipe-menu.js";
import {
  validateDefinitions,
  reference,
  compileRecipes,
  recipeRoots,
} from "./recipes/recipes.js";
import {
  spaces,
  presetConfiguration,
  validateConfiguration,
} from "./recipes/point-configuration.js";
import { defaultAppearance, validateAppearance } from "./recipes/appearance.js";
import { AdaptiveResolution } from "./render/adaptive-resolution.js";
import { RenderEngine } from "./render/render-engine.js";
export {
  byteCharacter,
  hilbertCells,
  entropyShading,
} from "./render/rendering.js";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * Use the browser top layer for dismissal and stacking; a reusable popup should not depend on
 * binary-view state.
 */
export class Popup extends HTMLElement {
  /**
   * Link the shared component stylesheet inside the popover's shadow root.
   */
  constructor() {
    super();
    this.attachShadow({ mode: "open" }).innerHTML = `
			${stylesheetLink}
			<slot></slot>`;
  }

  /**
   * Set popover attributes after construction to respect custom-element construction constraints.
   */
  connectedCallback() {
    ensureStyles(this.getRootNode?.());
    this.setAttribute("popover", "auto");
  }

  /**
   * Measure only after opening, then clamp in viewport coordinates; top-layer positioning is
   * independent of document flow.
   */
  open(x, y) {
    this.style.left = `${x}px`;
    this.style.top = `${y}px`;
    this.showPopover();
    const bounds = this.getBoundingClientRect();
    this.style.left = `${clamp(x, 0, Math.max(0, innerWidth - bounds.width))}px`;
    this.style.top = `${clamp(y, 0, Math.max(0, innerHeight - bounds.height))}px`;
  }

  /**
   * Let native popover dismissal semantics handle the top layer instead of hiding a custom overlay.
   */
  close() {
    this.hidePopover();
  }
}

/** Data-only popup for a clicked mark, sharing native dismissal with other popovers. */
export class PointPopup extends Popup {
  connectedCallback() {
    super.connectedCallback();
    this.setAttribute("role", "dialog");
    this.setAttribute("aria-label", "Point information");
    this.tabIndex = -1;
  }
  show(info, x, y, actions) {
    this.replaceChildren(inspectionContent(info, actions));
    this.open(x, y);
    this.focus();
  }
}

let submenuSerial = 0;

/**
 * Nest native popovers in the DOM so opening a submenu preserves its ancestors in the auto-popover
 * stack.
 * Menu descriptors are transient UI data; recipe expressions remain separate serializable state.
 */
export class ContextMenu extends Popup {
  /**
   * Keep submenu ownership explicit so hover timers and native toggle events cannot leave orphaned
   * popovers.
   */
  constructor() {
    super();
    this.entries = new WeakMap();
    this.addEventListener("keydown", (event) => this.navigate(event));
    this.addEventListener("pointerenter", (event) => {
      if (event.target === this) this.parentMenu?.clearHover();
    });
    this.addEventListener("scroll", () => this.closeChild());
    this.addEventListener("toggle", (event) => {
      if (event.target === this && event.newState === "closed") {
        this.clearHover();
        this.closeChild();
        if (this.parentMenu?.childMenu === this) this.parentMenu.closeChild();
      }
    });
  }

  /**
   * Expose menu semantics while inheriting Popup's native top-layer behavior.
   */
  connectedCallback() {
    super.connectedCallback();
    this.setAttribute("role", "menu");
  }

  /**
   * Cancel delayed opens and close descendants when a parent is rebuilt or removed.
   */
  disconnectedCallback() {
    this.clearHover();
    this.closeChild();
  }

  /**
   * Stop delayed actions from opening a stale submenu after focus or ownership changes.
   */
  clearHover() {
    clearTimeout(this.hoverTimer);
    this.hoverTimer = undefined;
  }

  /**
   * Restrict navigation to this menu's controls; querying descendants alone also finds nested
   * popover items.
   */
  controls() {
    return [
      ...this.querySelectorAll("button:not(:disabled), input:not(:disabled)"),
    ].filter((control) => control.closest("context-menu") === this);
  }

  /**
   * Rebuild from the authoritative current settings instead of retaining action closures with stale
   * captured recipe values.
   */
  set items(items) {
    this.clearHover();
    this.closeChild();
    this.replaceChildren(...items.map((item) => this.createItem(item)));
  }

  /**
   * Translate descriptors to native buttons/inputs. Scalar options use primitive equality;
   * expression menus supply their own descriptors and summary.
   * Numeric edits keep native validity checks and preserve the previous value if state validation
   * rejects them.
   */
  createItem({
    label,
    checked,
    action,
    kind = "radio",
    disabled = false,
    options,
    input,
    value,
    min,
    max,
    step = 1,
    detail: summary,
    items: children,
  }) {
    if (input) {
      const row = document.createElement("label");
      row.className = "thea-menu-row";
      row.textContent = label;
      const field = document.createElement("input");
      field.type = input;
      field.min = min ?? "";
      field.max = max ?? "";
      field.step = step;
      field.disabled = disabled;
      field.className = "thea-menu-field";
      field.setAttribute("aria-label", label);
      field.value = value;
      field.addEventListener("change", () => {
        if (!field.checkValidity()) {
          field.value = value;
          return;
        }
        try {
          action(input === "number" ? Number(field.value) : field.value);
        } catch (error) {
          field.value = value;
          this.dispatchEvent(
            new CustomEvent("data-error", {
              detail: error,
              bubbles: true,
              composed: true,
            }),
          );
        }
      });
      field.addEventListener("focus", () => this.closeChild());
      row.addEventListener("pointerenter", () => {
        this.clearHover();
        this.hoverTimer = setTimeout(() => this.closeChild(), 120);
      });
      row.addEventListener("pointerleave", () => this.clearHover());
      row.append(field);
      return row;
    }
    if (options)
      children = options.map((option) => ({
        label: option.label,
        checked: String(option.value) === String(value),
        action: () => action(option.value),
      }));
    const button = document.createElement("button");
    button.type = "button";
    button.disabled = disabled;
    button.className = "thea-menu-button";
    const mark = document.createElement("span"),
      caption = document.createElement("span");
    mark.textContent = checked ? (kind === "radio" ? "•" : "✓") : "";
    mark.setAttribute("aria-hidden", "true");
    caption.textContent = label;
    button.append(mark, caption);
    if (children) {
      const detail = document.createElement("span"),
        arrow = document.createElement("span");
      const selected = children.every(
        (item) => item.kind !== "checkbox" && typeof item.checked === "boolean",
      )
        ? children.find((item) => item.checked)?.label
        : "";
      detail.textContent = summary || selected || "";
      detail.className = "thea-menu-detail";
      arrow.textContent = "›";
      arrow.setAttribute("aria-hidden", "true");
      button.append(detail, arrow);
      button.setAttribute("aria-haspopup", "menu");
      button.setAttribute("aria-expanded", "false");
      this.entries.set(button, children);
    }
    const highlight = (active) => {
      button.style.background = active ? "Highlight" : "transparent";
      button.style.color = disabled
        ? "GrayText"
        : active
          ? "HighlightText"
          : "inherit";
    };
    highlight(false);
    button.addEventListener("pointerenter", () => {
      if (disabled) return;
      this.clearHover();
      this.parentMenu?.clearHover();
      button.focus();
      this.hoverTimer = setTimeout(() => {
        this.hoverTimer = undefined;
        if (children) this.openChild(button);
        else this.closeChild();
      }, 120);
    });
    button.addEventListener("pointerleave", () => this.clearHover());
    button.addEventListener("focus", () => highlight(true));
    button.addEventListener("blur", () =>
      highlight(button.getAttribute("aria-expanded") === "true"),
    );
    button.setAttribute(
      "role",
      children || checked === undefined ? "menuitem" : `menuitem${kind}`,
    );
    if (!children && checked !== undefined)
      button.setAttribute("aria-checked", String(checked));
    button.addEventListener("click", () => {
      if (disabled) return;
      if (children) {
        this.openChild(button, true);
        return;
      }
      this.closeRoot();
      action();
    });
    return button;
  }

  /**
   * Append descendants before showing them to preserve native stack membership; continue leftward
   * opening near the viewport edge.
   */
  openChild(button, focus = false) {
    this.clearHover();
    if (this.childButton === button && !this.childMenu.matches(":popover-open"))
      this.closeChild();
    if (this.childButton !== button) {
      this.closeChild();
      const submenu = new ContextMenu();
      submenu.parentMenu = this;
      submenu.parentButton = button;
      submenu.id = `context-submenu-${++submenuSerial}`;
      submenu.items = this.entries.get(button);
      this.append(submenu); // DOM nesting preserves the native auto-popover stack.
      this.childMenu = submenu;
      this.childButton = button;
      button.setAttribute("aria-controls", submenu.id);
      const anchor = button.getBoundingClientRect();
      submenu.open(anchor.right - 1, anchor.top - 4, focus);
      const bounds = submenu.getBoundingClientRect();
      const leftFits = anchor.left >= bounds.width,
        rightFits = anchor.right + bounds.width <= innerWidth;
      const left = leftFits && (this.openDirection === "left" || !rightFits);
      submenu.openDirection = left ? "left" : "right";
      if (left) submenu.style.left = `${anchor.left - bounds.width + 1}px`;
      button.style.background = "Highlight";
      button.style.color = "HighlightText";
      button.setAttribute("aria-expanded", "true");
    } else if (focus) this.childMenu.focusItem();
  }

  /**
   * Clear ownership before closing because the native toggle event can re-enter this path.
   */
  closeChild() {
    const child = this.childMenu,
      button = this.childButton;
    this.childMenu = this.childButton = null;
    if (child) {
      child.close();
      child.remove();
    }
    if (button) {
      button.setAttribute("aria-expanded", "false");
      button.removeAttribute("aria-controls");
      const focused = this.getRootNode().activeElement === button;
      button.style.background = focused ? "Highlight" : "transparent";
      button.style.color = focused ? "HighlightText" : "inherit";
    }
  }

  /**
   * Closing a parent must also cancel deferred hover actions and its open descendants.
   */
  close() {
    this.clearHover();
    this.closeChild();
    super.close();
  }
  /**
   * Actions close the whole chain before mutating state, then restore focus to the original invoking
   * control.
   */
  closeRoot() {
    let root = this;
    while (root.parentMenu) root = root.parentMenu;
    root.close();
    root.returnFocus?.focus();
  }

  /**
   * Prefer the selected choice, then a button, so opening a menu does not unexpectedly start editing
   * a numeric field.
   */
  focusItem() {
    const controls = this.controls();
    (
      controls.find(
        (control) => control.getAttribute("aria-checked") === "true",
      ) ||
      controls.find((control) => control.tagName === "BUTTON") ||
      controls[0]
    )?.focus();
  }

  /**
   * Remember focus only at the root; child navigation must not replace the original return target.
   */
  open(x, y, focus = true) {
    if (!this.parentMenu) {
      this.returnFocus = this.getRootNode().activeElement;
      this.openDirection = "right";
    }
    super.open(x, y);
    if (focus) this.focusItem();
  }

  /**
   * Keep keyboard events scoped to their owning submenu and leave numeric-input arrow keys to the
   * browser.
   */
  navigate(event) {
    if (event.target.closest("context-menu") !== this) return;
    const controls = this.controls(),
      active = this.getRootNode().activeElement;
    if (
      event.key === "Escape" ||
      (event.key === "ArrowLeft" && this.parentMenu)
    ) {
      event.preventDefault();
      event.stopPropagation();
      if (this.parentMenu) {
        const button = this.parentButton;
        this.parentMenu.closeChild();
        button.focus();
      } else {
        this.close();
        this.returnFocus?.focus();
      }
      return;
    }
    if (event.key === "Tab") {
      this.closeRoot();
      return;
    }
    if (event.target.tagName === "INPUT") return;
    if (
      ["ArrowRight", "Enter", " "].includes(event.key) &&
      this.entries.has(active)
    ) {
      event.preventDefault();
      event.stopPropagation();
      this.openChild(active, true);
      return;
    }
    const index = controls.indexOf(active);
    const next = {
      ArrowDown: (index + 1) % controls.length,
      ArrowUp: (index - 1 + controls.length) % controls.length,
      Home: 0,
      End: controls.length - 1,
    }[event.key];
    if (next === undefined || !controls.length) return;
    event.preventDefault();
    event.stopPropagation();
    this.clearHover();
    this.closeChild();
    controls[next].focus();
  }
}

/**
 * Share canvas lifecycle without wrapping the byte source. Each connected element owns one
 * scheduler and its caches.
 */
class ByteCanvas extends HTMLElement {
  /**
   * Resize observation belongs to the element's displayed box; source-specific work stays in
   * subclasses.
   */
  constructor() {
    super();
    this.attachShadow({ mode: "open" }).innerHTML = `
			${stylesheetLink}
			<canvas></canvas>`;
    this.canvas = this.shadowRoot.querySelector("canvas");
    this.renderer = new RenderEngine(this.canvas);
    this.observer = new ResizeObserver(() => this.render());
  }

  /**
   * Render again on connection because a detached custom element may have had no measurable
   * dimensions.
   */
  connectedCallback() {
    this.observer.observe(this);
    this.render();
  }
  /**
   * Invalidate continuations as well as the observer so late async results cannot revive a removed
   * element.
   */
  disconnectedCallback() {
    this.observer.disconnect();
    this.renderer.cancel();
    this.version = (this.version || 0) + 1;
  }

  /**
   * Choose at least a one-pixel grid before layout stabilizes, avoiding zero-length raster
   * divisions.
   */
  grid(pixelSize) {
    const width = Math.max(1, Math.floor(this.clientWidth / pixelSize));
    const height = Math.max(1, Math.floor(this.clientHeight / pixelSize));
    return { width, height, count: width * height };
  }

  /**
   * Surface renderer failures across shadow boundaries without inserting status or help copy into
   * the visualization.
   */
  failure(error) {
    this.dispatchEvent(
      new CustomEvent("data-error", {
        detail: error,
        bubbles: true,
        composed: true,
      }),
    );
  }
}

/**
 * Own visualization settings and the final root-source window, while DataScroll remains the
 * authority for navigation.
 * Keep sample geometry separate from raster resolution: adaptive quality must not move or resize
 * the selection.
 */
export class DataScrollView extends ByteCanvas {
  /**
   * Coalesce camera drags and accept timing feedback only for the source, mapping, dimensions, and
   * quality still on screen.
   */
  constructor() {
    super();
    this.rotation = { yaw: -0.6, pitch: 0.45 };
    this.resolution = new AdaptiveResolution();
    this.renderer.onFrame = ({ job, duration, dimensions }) => {
      this.closeInspection();
      if (
        dimensions &&
        job.source === this.source &&
        job.offset === this.offset &&
        job.length === this.length &&
        settingsKey(job) ===
          settingsKey({
            ...job,
            ...this.renderSettings(),
            sampleLayout: this.resolvedSampleLayout,
          })
      ) {
        this.dimensionFrame = {
          source: job.source,
          offset: job.offset,
          length: job.length,
          key: JSON.stringify(job.configuration),
          values: dimensions,
        };
      }
      if (
        !this.spatial ||
        !job.interacting ||
        job.source !== this.source ||
        job.width !== this.clientWidth ||
        job.height !== this.clientHeight ||
        job.scale !== (globalThis.devicePixelRatio || 1) ||
        settingsKey(job) !==
          settingsKey({
            ...job,
            ...this.renderSettings(),
            sampleLayout: this.resolvedSampleLayout,
          })
      )
        return;
      if (this.resolution.record(duration, job.resolutionScale))
        this.scheduleRotationRender();
    };
    this.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.composedPath?.().includes(this.inspector))
        return;
      this.suppressInspectionClick = false;
      this.closeInspection();
      this.focus();
      if (!this.spatial) return;
      event.preventDefault();
      this.setPointerCapture(event.pointerId);
      this.rotationDrag = {
        x: event.clientX,
        y: event.clientY,
        ...this.rotation,
      };
      this.style.cursor = "grabbing";
    });
    this.addEventListener("pointermove", (event) => {
      if (!this.rotationDrag || !this.hasPointerCapture(event.pointerId))
        return;
      const drag = this.rotationDrag;
      if (
        Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 4 &&
        !this.suppressInspectionClick
      )
        return;
      this.suppressInspectionClick = true;
      this.noteMovement();
      this.rotation = {
        yaw: drag.yaw + (event.clientX - drag.x) * 0.01,
        pitch: clamp(
          drag.pitch + (event.clientY - drag.y) * 0.01,
          -Math.PI / 2,
          Math.PI / 2,
        ),
      };
      this.scheduleRotationRender();
    });
    const stopRotation = () => {
      this.rotationDrag = null;
      this.style.cursor = this.spatial ? "grab" : "";
    };
    this.addEventListener("pointerup", (event) => {
      if (this.hasPointerCapture(event.pointerId))
        this.releasePointerCapture(event.pointerId);
      stopRotation();
    });
    this.addEventListener("pointercancel", () => {
      this.suppressInspectionClick = true;
      stopRotation();
    });
    this.addEventListener("lostpointercapture", stopRotation);
    this.addEventListener("click", (event) => {
      if (
        event.button !== 0 ||
        this.suppressInspectionClick ||
        event.composedPath?.().includes(this.inspector)
      )
        return;
      this.inspectAt(event.clientX, event.clientY);
    });
    this.addEventListener("keydown", (event) => {
      if (
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        !this.source ||
        event.composedPath?.().includes(this.inspector)
      )
        return;
      const columns = this.navigationColumns;
      const steps = {
        ArrowLeft: -1,
        ArrowRight: 1,
        ArrowUp: -columns,
        ArrowDown: columns,
        PageUp: -this.length,
        PageDown: this.length,
        Home: -Infinity,
        End: Infinity,
      };
      if (!(event.key in steps)) return;
      event.preventDefault();
      this.dispatchEvent(
        new CustomEvent("seek", { detail: this.offset + steps[event.key] }),
      );
    });
  }

  /** Inspect raster coordinates from the currently displayed frame, independent of DPR/quality. */
  async inspectAt(clientX, clientY) {
    this.closeInspection();
    const job = this.renderer.presentedJob;
    const version = this.inspectionVersion,
      bounds = this.canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    try {
      const info = await this.renderer.inspect(
        ((clientX - bounds.left) * this.canvas.width) / bounds.width,
        ((clientY - bounds.top) * this.canvas.height) / bounds.height,
      );
      if (!info || version !== this.inspectionVersion || !this.isConnected)
        return;
      if (!this.inspector) {
        this.inspector = new PointPopup();
        this.inspector.addEventListener("keydown", (event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            this.closeInspection();
            this.focus();
          }
        });
        this.shadowRoot.append(this.inspector);
      }
      const origin = info.point.byteCorrespondence || info.point;
      const recordWidth = info.point.record?.width ?? 1;
      const recordBytes = origin.context?.bytes.slice(
        origin.context.byteIndex,
        origin.context.byteIndex + Math.min(32, recordWidth),
      );
      const pattern =
        info.point.population === "bins"
          ? undefined
          : info.point.tuple ||
            (recordBytes?.length === recordWidth
              ? recordBytes
              : origin.context
                ? [origin.context.bytes[origin.context.byteIndex]]
                : undefined);
      let cursor = origin.sourceOffset;
      const current = () =>
        version === this.inspectionVersion &&
        this.isConnected &&
        this.source === job.source &&
        this.renderer.presentedJob === job;
      const actions = pattern
        ? {
            occurrence: async (direction) => {
              try {
                const result = await findOccurrences(
                  job.source,
                  {
                    pattern,
                    start: info.point.selection.start,
                    end: info.point.selection.endExclusive,
                    after: cursor,
                    direction,
                    limit: 1,
                    wrap: true,
                  },
                  current,
                );
                if (!current() || !result?.matches.length) return;
                cursor = result.matches[0].start;
                const context = await inspectByteContext(
                  job.source,
                  cursor,
                  {},
                  current,
                );
                if (!current()) return;
                info.navigation = {
                  sourceRange: result.matches[0],
                  pattern,
                  context,
                };
                this.inspector.show(info, clientX, clientY, actions);
                const selected = new CustomEvent("address-select", {
                  detail: {
                    source: job.source,
                    sourceOffset: cursor,
                    length: pattern.length,
                    frame: this.renderer.presented,
                    relationship: "pattern occurrence",
                  },
                  bubbles: true,
                  composed: true,
                  cancelable: true,
                });
                this.dispatchEvent(selected);
                if (!selected.defaultPrevented)
                  this.dispatchEvent(
                    new CustomEvent("seek", { detail: cursor }),
                  );
              } catch (error) {
                if (current()) this.failure(error);
              }
            },
          }
        : undefined;
      this.inspector.show(info, clientX, clientY, actions);
    } catch (error) {
      if (version === this.inspectionVersion) this.failure(error);
    }
  }
  closeInspection() {
    this.inspectionVersion = (this.inspectionVersion || 0) + 1;
    this.renderer.cancelInspection();
    if (this.inspector?.matches?.(":popover-open")) this.inspector.close();
  }

  /**
   * Only 3D spaces participate in adaptive quality; an idle timer restores full detail after motion
   * stops.
   */
  noteMovement() {
    if (!this.spatial || !this.pointConfiguration.adaptiveResolution) return;
    this.resolution.touch();
    clearTimeout(this.resolutionTimer);
    this.resolutionTimer = setTimeout(() => {
      this.resolutionTimer = undefined;
      if (this.resolution.settle() && this.isConnected && this.spatial) {
        this.cancelRotationRender();
        this.render();
      }
    }, 180);
  }

  /**
   * New sources/configurations invalidate the feedback history as well as any pending settle timer.
   */
  resetResolution() {
    clearTimeout(this.resolutionTimer);
    this.resolutionTimer = undefined;
    this.resolution.settle();
  }

  /**
   * Collapse pointer bursts into one frame without inventing an additional render queue.
   */
  scheduleRotationRender() {
    if (typeof requestAnimationFrame !== "function") {
      this.render();
      return;
    }
    if (this.rotationFrame !== undefined) return;
    this.rotationFrame = requestAnimationFrame(() => {
      this.rotationFrame = undefined;
      if (this.isConnected && this.spatial) this.render();
    });
  }

  /**
   * Prevent a queued camera frame from rendering after mode changes or disconnection.
   */
  cancelRotationRender() {
    if (this.rotationFrame !== undefined)
      globalThis.cancelAnimationFrame?.(this.rotationFrame);
    this.rotationFrame = undefined;
  }

  /**
   * Stop quality timers and pointer-drag work before the base canvas destroys its worker.
   */
  disconnectedCallback() {
    this.closeInspection();
    this.resetResolution();
    this.cancelRotationRender();
    this.rotationDrag = null;
    super.disconnectedCallback();
  }

  /**
   * Make the view a keyboard target without adding a separate navigation widget.
   */
  connectedCallback() {
    this.tabIndex = 0;
    super.connectedCallback();
  }

  /**
   * Return compatibility flags with entropy and brightness enabled by default; character and hex are
   * mutually exclusive overlays.
   */
  get shaders() {
    return [...(this._shaders || ["entropy", "brightness"])];
  }

  /**
   * Preserve character/hex exclusivity and clear stale color overrides when compatibility flags change.
   */
  set shaders(shaders) {
    if (
      !Array.isArray(shaders) ||
      shaders.some(
        (shader) =>
          !["entropy", "brightness", "character", "hex"].includes(shader),
      )
    ) {
      throw new TypeError("Unknown cell shader");
    }
    if (
      ["entropy", "brightness"].some(
        (shader) => shaders.includes(shader) !== this.shaders.includes(shader),
      )
    ) {
      if (this._appearances) delete this._appearances[this.region];
    }
    const label = shaders.findLast(
      (shader) => shader === "character" || shader === "hex",
    );
    this._shaders = [
      ...new Set(
        shaders.filter(
          (shader) =>
            !["character", "hex"].includes(shader) || shader === label,
        ),
      ),
    ];
    this.render();
  }

  /**
   * Resolve preset defaults lazily; all configurations use the same renderer.
   */
  get pointConfiguration() {
    return structuredClone(
      this._pointConfiguration ||
        presetConfiguration(this.region, {
          coordinateSystem: this.coordinateSystem,
          axes: this.axes,
          recipes: this._recipes || {},
        }),
    );
  }
  /**
   * Validate geometry, named definitions, and appearance together; reset interaction state only
   * after validation succeeds.
   */
  set pointConfiguration(value) {
    const configuration = validateConfiguration({
      ...value,
      recipes: value.recipes ?? this._recipes,
    });
    validateAppearance(
      this.region,
      this.effectiveAppearance,
      configuration.recipes,
    );
    pointGrid(configuration, this.length || 1, this.resolvedSampleLayout);
    this._recipes = configuration.recipes;
    this._pointConfiguration = configuration;
    this.resetResolution();
    this.cancelRotationRender();
    this.rotationDrag = null;
    this.style.touchAction = this.spatial ? "none" : "";
    this.style.cursor = this.spatial ? "grab" : "";
    this.configurationChanged();
  }
  /** Reconcile geometry without changing the committed byte range. */
  configurationChanged() {
    const version = this.version;
    if (this.windowLayout)
      this.dispatchEvent(
        new CustomEvent("layout-change", { detail: { length: this.length } }),
      );
    if (this.version === version) this.render();
  }

  /**
   * Validate the entire definition set to catch indirect cycles; unused definitions remain lazy.
   */
  setFactor(name, expression) {
    if (typeof name !== "string" || !name.trim() || name.length > 64)
      throw new TypeError("Invalid factor name");
    const definitions = validateDefinitions({
      ...this.pointConfiguration.recipes,
      [name]: expression,
    });
    if (this._pointConfiguration)
      this.pointConfiguration = {
        ...this.pointConfiguration,
        recipes: definitions,
      };
    else this._recipes = definitions;
  }

  renameFactor(from, to) {
    this.importProfile(renameFactor(this.exportProfile(), from, to));
  }

  deleteFactor(name) {
    this.importProfile(deleteFactor(this.exportProfile(), name));
  }

  get editHistory() {
    return (this._editHistory ||= { past: [], future: [] });
  }

  restoreEdit(direction) {
    const profile = restoreEdit(
      this.editHistory,
      this.exportProfile(),
      direction,
    );
    if (profile) this.importProfile(profile);
  }

  /**
   * Use requested length, not the already-snapped result: recomputing from the result can select a
   * different grid and cause rounding oscillation.
   */
  get resolvedSampleLayout() {
    const layout = this.sampleLayout(
      this.windowLayout ? this.requestedLength : this.length || 1,
      this.windowLayout?.limit ?? this.source?.size ?? 1,
    );
    return limitedSampleLayout(layout, this.pointConfiguration);
  }
  /**
   * Byte row steps follow the placement grid; other populations navigate the source sample grid.
   */
  get dimensionRanges() {
    const configuration = this.pointConfiguration,
      frame = this.dimensionFrame;
    if (
      frame?.source === this.source &&
      frame.offset === this.offset &&
      frame.length === this.length &&
      frame.key === JSON.stringify(configuration)
    )
      return structuredClone(frame.values);
    const count =
      configuration.population === "records"
        ? recordPopulation({ length: this.length || 0, configuration }).count
        : configuration.population === "bins"
          ? Math.floor((this.length || 0) / 2) + 1
          : this.length || 1;
    return pointGrid(configuration, count, this.resolvedSampleLayout)
      .dimensions;
  }

  get navigationGrid() {
    const configuration = this.pointConfiguration;
    if (configuration.population === "records") {
      const records = recordPopulation({
        length: this.length || 0,
        configuration,
      });
      const grid = pointGrid(
        configuration,
        records.count,
        this.resolvedSampleLayout,
      );
      return { columns: grid.columns * records.stride, rows: grid.rows };
    }
    return configuration?.population === "bytes"
      ? pointGrid(configuration, this.length, this.resolvedSampleLayout)
      : this.resolvedSampleLayout;
  }
  get navigationColumns() {
    return this.navigationGrid.columns;
  }
  get navigationRows() {
    return this.navigationGrid.rows;
  }

  /**
   * Determine rotation and quality behavior from the chosen space, not from the historical trigraph
   * preset name.
   */
  get spatial() {
    return spaces[this.pointConfiguration.space].length === 3;
  }
  /**
   * Reset a complete visualization profile while retaining named recipes; it is different from the
   * compatibility region setter.
   */
  applyPreset(region) {
    presetConfiguration(region);
    this._pointConfiguration = undefined;
    this._appearances = {};
    this._coordinateSystems = {};
    this._axisMappings = {};
    this._shaders = ["entropy", "brightness"];
    this._frequencyOpacity = false;
    this.rotation = { yaw: -0.6, pitch: 0.45 };
    this.region = region;
  }

  /**
   * An absent override uses the preset appearance defaults.
   */
  get appearance() {
    return structuredClone(this._appearances?.[this.region]);
  }
  /**
   * Validate appearance against current named factors before rendering.
   */
  set appearance(value) {
    const appearance = value
      ? validateAppearance(this.region, value, this.pointConfiguration.recipes)
      : undefined;
    (this._appearances ||= {})[this.region] = appearance;
    this.render();
  }
  /**
   * Give menus concrete defaults without storing a redundant override or changing renderer
   * selection.
   */
  get effectiveAppearance() {
    return (
      this.appearance ||
      defaultAppearance(this.region, this.shaders, this.frequencyOpacity)
    );
  }

  /**
   * Keep SP visibility independent from NUL visibility, since real binaries commonly contain both.
   */
  get blankSpaces() {
    return this._blankSpaces || false;
  }
  /**
   * Repaint text only; changing blank glyphs must not change source ranges.
   */
  set blankSpaces(value) {
    this._blankSpaces = Boolean(value);
    this.render();
  }

  /**
   * Default NUL to a blank because large zero-filled regions otherwise become visually dominated by
   * repeated control pictures.
   */
  get blankNulls() {
    return this._blankNulls ?? true;
  }
  /**
   * Treat glyph visibility as rendering state so stale character frames are not mistaken for current
   * ones.
   */
  set blankNulls(value) {
    this._blankNulls = Boolean(value);
    this.render();
  }

  /**
   * The default is single-byte ASCII, not UTF-8 decoding of the selected buffer.
   */
  get encoding() {
    return this._encoding || "ascii";
  }
  /**
   * Limit overlays to supported single-byte interpretations so byte-to-cell correspondence stays
   * unambiguous.
   */
  set encoding(value) {
    if (!["ascii-overbar", "ascii", "cp437", "latin1"].includes(value))
      throw new TypeError("Unknown character encoding");
    this._encoding = value;
    this.render();
  }

  /**
   * Retain the occurrence-opacity compatibility flag; recipes express opacity as a
   * mapping.
   */
  get frequencyOpacity() {
    return this._frequencyOpacity || false;
  }
  /**
   * Discard trigraph appearance overrides so the compatibility switch actually changes its
   * preset default.
   */
  set frequencyOpacity(value) {
    this._frequencyOpacity = Boolean(value);
    if (this._appearances) delete this._appearances.trigraph;
    this.render();
  }

  /**
   * Keep compatibility coordinate choices per preset; raw recipe views instead use
   * pointConfiguration.space.
   */
  get coordinateSystem() {
    return this._coordinateSystems?.[this.region] || "cartesian";
  }
  /**
   * Validate dimensions of the legacy transform API rather than silently treating radial and 3D
   * spaces interchangeably.
   */
  set coordinateSystem(value) {
    const allowed = ["trigraph", "hilbert3d"].includes(this.region)
      ? ["cartesian", "cylindrical", "spherical"]
      : ["cartesian", "radial"];
    if (!allowed.includes(value))
      throw new TypeError("Unknown coordinate system");
    (this._coordinateSystems ||= {})[this.region] = value;
    this.render();
  }

  /**
   * Compatibility axis permutations belong to each preset; they are distinct from general scalar
   * position recipes.
   */
  get axes() {
    return [
      ...(this._axisMappings?.[this.region] ||
        (["trigraph", "hilbert3d"].includes(this.region) ? [0, 1, 2] : [0, 1])),
    ];
  }
  /**
   * Require a permutation for legacy image/tuple remapping. General recipes intentionally permit
   * repeated factors and constants.
   */
  set axes(value) {
    const count = ["trigraph", "hilbert3d"].includes(this.region) ? 3 : 2;
    if (
      !Array.isArray(value) ||
      value.length !== count ||
      new Set(value).size !== count ||
      value.some((axis) => !Number.isInteger(axis) || axis < 0 || axis >= count)
    )
      throw new TypeError("Expected an axis permutation");
    (this._axisMappings ||= {})[this.region] = [...value];
    this.render();
  }

  /**
   * Swap an existing legacy dimension instead of duplicating it, preserving the inverse-mapping
   * permutation invariant.
   */
  setAxis(index, dimension) {
    const axes = [...this.axes],
      other = axes.indexOf(dimension);
    if (other < 0 || index < 0 || index >= axes.length)
      throw new TypeError("Unknown axis");
    [axes[index], axes[other]] = [axes[other], axes[index]];
    this.axes = axes;
  }

  /**
   * Use linear as the initial preset without allocating settings eagerly.
   */
  get region() {
    return this._region || "linear";
  }

  /**
   * Exit raw geometry and cancel stale camera work when using the compatibility preset API; use
   * applyPreset to reset all defaults.
   */
  set region(region) {
    if (
      ![
        "linear",
        "hilbert",
        "hilbert3d",
        "digraph",
        "dft",
        "trigraph",
      ].includes(region)
    )
      throw new TypeError("Unknown region layout");
    this._region = region;
    this._pointConfiguration = undefined;
    this.resetResolution();
    this.cancelRotationRender();
    this.rotationDrag = null;
    this.style.touchAction = this.spatial ? "none" : "";
    this.style.cursor = this.spatial ? "grab" : "";
    this.render();
  }

  /**
   * Keep raster dimensions separate from the selected byte interval and placement grid.
   */
  layout(requestedLength, size = this.source?.size ?? requestedLength) {
    const sample = this.sampleLayout(requestedLength, size);
    const scale = globalThis.devicePixelRatio || 1;
    return {
      columns: Math.max(1, Math.round(this.clientWidth * scale)),
      rows: Math.max(1, Math.round(this.clientHeight * scale)),
      length: sample.length,
    };
  }

  /**
   * Choose a sample budget from source length and display aspect, preserving every selected byte.
   * Coordinate recipes determine the placement grid independently.
   */
  sampleLayout(requestedLength, size = this.source?.size ?? requestedLength) {
    const length = Math.min(size, Math.max(1, Math.round(requestedLength)));

    const aspect = this.shaders.includes("hex")
      ? 1.2
      : this.shaders.includes("character")
        ? 0.6
        : 1;
    const ratio =
      Math.max(1, this.clientWidth) / (Math.max(1, this.clientHeight) * aspect);
    const columns = clamp(
      Math.round(Math.sqrt(length * ratio)),
      1,
      Math.max(1, length),
    );
    const rows = Math.max(1, Math.ceil(length / columns));
    return { columns, rows, aspect: ratio, length };
  }

  /**
   * Receive an authoritative window from DataScroll and avoid work when neither source, selected
   * range, nor raster layout changed.
   * Offsets here are root-Blob-relative; the separate requestedLength remains the unsnapped
   * navigation request.
   */
  setWindow(source, offset, length, layout) {
    const sourceChanged = this.source !== source;
    const moved = this.offset !== offset || this.length !== length;
    const resized =
      !this.windowLayout ||
      !layout ||
      ["columns", "rows", "length", "limit"].some(
        (key) => layout[key] !== this.windowLayout[key],
      );
    if (sourceChanged) this.resetResolution();
    else if (moved) this.noteMovement();
    Object.assign(this, { source, offset, length, windowLayout: layout });
    if (sourceChanged || moved || resized) this.render();
  }

  /** Return an owned, versioned profile; source/ranges belong to the host session. */
  exportProfile() {
    return validateProfile({
      version: 3,
      ...this.renderSettings(),
      recipes: this._recipes || {},
      rotation: this.rotation,
    });
  }

  /** Validate everything before replacing state; an invalid import is atomic. */
  importProfile(value) {
    const profile =
      typeof value === "string" ? parseProfile(value) : validateProfile(value);
    this._region = profile.region;
    this._recipes = profile.recipes;
    this._pointConfiguration = profile.configuration;
    this._appearances = { [profile.region]: profile.appearance };
    this._shaders = profile.shaders;
    this._frequencyOpacity = profile.frequencyOpacity;
    this._coordinateSystems = { [profile.region]: profile.coordinateSystem };
    this._axisMappings = { [profile.region]: profile.axes };
    this._encoding = profile.encoding;
    this._blankSpaces = profile.blankSpaces;
    this._blankNulls = profile.blankNulls;
    this.rotation = profile.rotation;
    this.resetResolution();
    this.cancelRotationRender();
    this.rotationDrag = null;
    this.style.touchAction = this.spatial ? "none" : "";
    this.style.cursor = this.spatial ? "grab" : "";
    if (this._pointConfiguration) this.configurationChanged();
    else this.render();
  }

  renderSettings() {
    return {
      configuration: this.pointConfiguration,
      region: this.region,
      shaders: this.shaders,
      appearance: this.appearance,
      frequencyOpacity: this.frequencyOpacity,
      coordinateSystem: this.coordinateSystem,
      axes: this.axes,
      encoding: this.encoding,
      blankSpaces: this.blankSpaces,
      blankNulls: this.blankNulls,
    };
  }

  /**
   * Negotiate layout changes with DataScroll before dispatching a job. Keep sampleLayout independent of raster quality
   * while scaling only raster dimensions and particle footprints during motion.
   */
  async render() {
    this.closeInspection();
    const version = (this.version = (this.version || 0) + 1);
    if (!this.source || !this.isConnected) return;
    const styles = pendingStyles(this);
    if (styles) {
      await styles;
      if (version !== this.version || !this.isConnected) return;
    }
    const layout = this.windowLayout
      ? this.layout(this.requestedLength, this.windowLayout.limit)
      : this.layout(this.length);
    if (
      this.windowLayout &&
      ["columns", "rows", "length"].some(
        (key) => layout[key] !== this.windowLayout[key],
      )
    ) {
      this.dispatchEvent(new CustomEvent("layout-change"));
      return;
    }
    const { columns, rows } = layout;
    const resolutionScale =
      this.spatial &&
      this.pointConfiguration.adaptiveResolution &&
      this.resolution.moving
        ? this.resolution.scale
        : 1;
    try {
      const program = compileRecipes(
        recipeRoots(this.pointConfiguration, this.effectiveAppearance),
        this.pointConfiguration.recipes,
      );
      const referenceIDs = (program.providers.analysis || [])
        .filter((request) => request.family === "reference")
        .map((request) => request.modelID);
      const rendered = await this.renderer.render({
        kind: "view",
        progressive: true,
        source: this.source,
        offset: this.offset,
        length: this.length,
        columns: Math.max(1, Math.round(columns * resolutionScale)),
        rows: Math.max(1, Math.round(rows * resolutionScale)),
        resolutionScale,
        pointScale: (globalThis.devicePixelRatio || 1) * resolutionScale,
        interacting: this.spatial && this.resolution.moving,
        ...this.renderSettings(),
        sampleLayout: this.resolvedSampleLayout,
        rotation: this.rotation,
        width: this.clientWidth,
        height: this.clientHeight,
        scale: globalThis.devicePixelRatio || 1,
        referenceModels: referenceModels.resolveModels(referenceIDs),
        sourceMetadata: this.sourceMetadata,
      });
      if (rendered && version === this.version)
        Object.assign(this, { columns, rows });
    } catch (error) {
      if (version === this.version) this.failure(error);
    }
  }
}

/**
 * Render an overview of one parent scope and emit selection intents in that scope's local byte
 * coordinates.
 * Cursor movement should stay synchronous even when overview pixels are computed in a worker.
 */
export class DataScrollBar extends ByteCanvas {
  /**
   * Use pointer capture for drag continuity and distinguish click-latched autoscroll from
   * middle-button dragging.
   */
  constructor() {
    super();
    this.cursor = document.createElement("div");
    this.cursor.className = "thea-selection";
    this.shadowRoot.append(this.cursor);
    this.addEventListener("pointerdown", (event) => {
      if (this.auto) {
        event.preventDefault();
        this.stopAuto();
        return;
      }
      if (![0, 1].includes(event.button) || !this.source?.size) return;
      if (event.button === 1) {
        event.preventDefault();
        this.startAuto(event);
        return;
      }
      event.preventDefault();
      this.setPointerCapture(event.pointerId);
      this.focus();
      const edge = this.edgeAt(event.clientY);
      const cursor = this.cursor.getBoundingClientRect();
      if (
        !edge &&
        (event.clientY < cursor.top || event.clientY > cursor.bottom)
      )
        this.seekAt(event);
      this.drag = {
        edge,
        y: event.clientY,
        start: this.offset,
        end: this.offset + this.length,
      };
    });
    this.addEventListener("pointermove", (event) => {
      if (this.auto) return;
      if (this.hasPointerCapture(event.pointerId)) this.dragAt(event);
      else
        this.style.cursor = this.edgeAt(event.clientY) ? "ns-resize" : "grab";
    });
    this.addEventListener("auxclick", (event) => {
      if (event.button === 1) event.preventDefault();
    });
    this.addEventListener("pointerup", (event) => {
      if (this.auto?.pointerId === event.pointerId) {
        if (this.auto.moved) this.stopAuto();
        else {
          this.auto.latched = true;
          if (this.hasPointerCapture(event.pointerId))
            this.releasePointerCapture(event.pointerId);
        }
        return;
      }
      if (this.hasPointerCapture(event.pointerId))
        this.releasePointerCapture(event.pointerId);
      this.drag = null;
    });
    this.addEventListener("pointercancel", () => {
      this.drag = null;
      this.stopAuto();
    });
    this.addEventListener("lostpointercapture", () => {
      this.drag = null;
      if (this.auto && !this.auto.latched) this.stopAuto();
    });
    this.addEventListener("keydown", (event) => {
      const steps = {
        ArrowLeft: -1,
        ArrowRight: 1,
        ArrowUp: -1,
        ArrowDown: 1,
        PageUp: -this.length,
        PageDown: this.length,
        Home: -Infinity,
        End: Infinity,
      };
      if (!(event.key in steps)) return;
      event.preventDefault();
      this.seek(this.offset + steps[event.key]);
    });
  }

  /**
   * Own touch gestures and expose scrollbar semantics without relying on the browser's document
   * scrolling.
   */
  connectedCallback() {
    this.style.touchAction = "none";
    this.tabIndex = 0;
    this.setAttribute("role", "scrollbar");
    this.setAttribute("aria-label", "Binary window");
    this.setAttribute("aria-orientation", "vertical");
    super.connectedCallback();
  }

  /**
   * End autoscroll before destroying the canvas so global listeners cannot keep the removed bar
   * alive.
   */
  disconnectedCallback() {
    this.stopAuto();
    super.disconnectedCallback();
  }

  /**
   * Capture the original edge/window anchor once; later frames integrate velocity rather than
   * repeatedly rebasing a resize.
   */
  startAuto(event) {
    this.focus();
    this.setPointerCapture(event.pointerId);
    this.auto = {
      pointerId: event.pointerId,
      origin: event.clientY,
      y: event.clientY,
      edge: this.edgeAt(event.clientY),
      remainder: 0,
      moved: false,
      start: this.offset,
      end: this.offset + this.length,
      travel: 0,
      controller: new AbortController(),
    };
    this.style.cursor = "ns-resize";
    const { signal } = this.auto.controller;
    window.addEventListener(
      "pointermove",
      (event) => {
        if (event.pointerId !== this.auto.pointerId) return;
        this.auto.y = event.clientY;
        if (Math.abs(event.clientY - this.auto.origin) > 4)
          this.auto.moved = true;
      },
      { signal },
    );
    window.addEventListener(
      "pointerdown",
      (event) => {
        if (!event.composedPath().includes(this)) this.stopAuto();
      },
      { signal, capture: true },
    );
    window.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          this.stopAuto();
        }
      },
      { signal },
    );
    window.addEventListener("blur", () => this.stopAuto(), { signal });
    this.auto.frame = requestAnimationFrame((time) => this.tickAuto(time));
  }

  /**
   * Integrate elapsed time with a dead zone and fractional-byte remainder. Cap resumed-tab elapsed
   * time to prevent large jumps.
   */
  tickAuto(time) {
    const auto = this.auto;
    if (!auto) return;
    const elapsed =
      auto.time === undefined ? 0 : Math.min(100, time - auto.time) / 1000;
    auto.time = time;
    const distance = auto.y - auto.origin;
    const speed = Math.sign(distance) * Math.max(0, Math.abs(distance) - 4);
    const height = this.getBoundingClientRect().height;
    if (height && this.source?.size) {
      auto.remainder += ((speed * this.source.size) / height) * elapsed;
      const delta = Math.trunc(auto.remainder);
      auto.remainder -= delta;
      if (delta && auto.edge) {
        const min =
          auto.edge === "top" ? -auto.start : auto.start + 1 - auto.end;
        const max =
          auto.edge === "top"
            ? auto.end - 1 - auto.start
            : this.source.size - auto.end;
        auto.travel = clamp(auto.travel + delta, min, max);
        this.moveWindow(auto.travel, auto.edge, auto.start, auto.end);
      } else if (delta) this.moveWindow(delta, null);
    }
    if (this.auto === auto)
      auto.frame = requestAnimationFrame((next) => this.tickAuto(next));
  }

  /**
   * Abort all window-level listeners together and cancel the frame before releasing pointer capture.
   */
  stopAuto() {
    const auto = this.auto;
    if (!auto) return;
    this.auto = null;
    cancelAnimationFrame(auto.frame);
    auto.controller.abort();
    if (this.hasPointerCapture(auto.pointerId))
      this.releasePointerCapture(auto.pointerId);
    this.style.cursor = "";
  }

  /**
   * Separate the displayed parent Blob from its root-source identity. Moving the cursor must not
   * rerender the unchanged overview.
   * The optional scope supplies root Blob/offset for page-cache reuse; cursor offset stays local.
   */
  setWindow(source, offset, length, scope) {
    const changed = this.source !== source;
    if (changed) this.stopAuto();
    Object.assign(this, { source, offset, length, scope });
    if (this.isConnected) this.updateCursor();
    if (changed) this.render();
  }

  /**
   * Emit clamped local intent; DataScroll must reconcile descendants and selection snapping before
   * committing a window.
   */
  seek(offset) {
    if (!this.source) return;
    this.dispatchEvent(
      new CustomEvent("seek", {
        detail: clamp(
          Math.round(offset),
          0,
          Math.max(0, this.source.size - this.length),
        ),
      }),
    );
  }

  /**
   * Center a click on the selector rather than making every click snap its top edge to the pointer.
   */
  seekAt(event) {
    if (!this.source) return;
    const bounds = this.getBoundingClientRect();
    this.seek(
      ((event.clientY - bounds.top) / bounds.height) * this.source.size -
        this.length / 2,
    );
  }

  /**
   * Keep edge hit areas usable for small selections while separating the two resize handles.
   */
  edgeAt(y) {
    const bounds = this.cursor.getBoundingClientRect();
    const top = Math.abs(y - bounds.top);
    const bottom = Math.abs(y - bounds.bottom);
    if (Math.min(top, bottom) > 6) return null;
    return top <= bottom ? "top" : "bottom";
  }

  /**
   * Measure travel from the drag's initial window to avoid compounding layout snapping into pointer
   * drift.
   */
  dragAt(event) {
    if (!this.drag || !this.source?.size) return;
    const height = this.getBoundingClientRect().height;
    if (!height) return;
    const delta = Math.round(
      ((event.clientY - this.drag.y) / height) * this.source.size,
    );
    const { edge, start, end } = this.drag;
    this.moveWindow(delta, edge, start, end);
  }

  /**
   * Hold the opposite resize edge fixed and carry edge identity to DataScroll, where snapping may
   * change the final selected length.
   */
  moveWindow(
    delta,
    edge,
    start = this.offset,
    end = this.offset + this.length,
  ) {
    if (!edge) {
      this.seek(start + delta);
      return;
    }
    const offset = edge === "top" ? clamp(start + delta, 0, end - 1) : start;
    const limit =
      edge === "bottom" ? clamp(end + delta, start + 1, this.source.size) : end;
    this.dispatchEvent(
      new CustomEvent("window-change", {
        detail: { offset, length: limit - offset, edge },
      }),
    );
  }

  /**
   * Update both visual and accessibility ranges immediately from committed state, independent of
   * overview rendering latency.
   */
  updateCursor() {
    const size = this.source?.size || 1;
    this.cursor.style.top = `${(100 * (this.offset || 0)) / size}%`;
    this.cursor.style.height = `${100 * Math.min(1, (this.length || 0) / size)}%`;
    this.setAttribute("aria-valuemin", "0");
    this.setAttribute("aria-valuemax", String(Math.max(0, size - this.length)));
    this.setAttribute("aria-valuenow", String(this.offset || 0));
  }

  /**
   * Ask the renderer for the root-source scope rather than keying every nested Blob slice as a new
   * source.
   */
  async render() {
    const version = (this.version = (this.version || 0) + 1);
    if (!this.source || !this.isConnected) return;
    const styles = pendingStyles(this);
    if (styles) {
      await styles;
      if (version !== this.version || !this.isConnected) return;
    }
    const { width, height } = this.grid(1);
    try {
      const rendered = await this.renderer.render({
        kind: "bar",
        source: this.scope?.source || this.source,
        offset: this.scope?.offset || 0,
        length: this.source.size,
        width,
        height,
      });
      if (rendered && version === this.version) this.updateCursor();
    } catch (error) {
      if (version === this.version) this.failure(error);
    }
  }
}

/**
 * Coordinate nested selection levels and the one authoritative root Blob. Levels are stored
 * widest-to-narrowest but displayed in reverse order.
 * @see docs/data-selection.md
 */
export class DataScroll extends HTMLElement {
  /**
   * Keep one shared menu for bar/view settings and route wheel/seek intents through the same
   * reconciliation path.
   */
  constructor(source, windowSize = 1024) {
    super();
    this.attachShadow({ mode: "open" }).innerHTML = `
			${stylesheetLink}
			<data-scroll-view></data-scroll-view><div class="bars"></div>`;
    this.view = this.shadowRoot.querySelector("data-scroll-view");
    this.barContainer = this.shadowRoot.querySelector(".bars");
    this.levels = [];
    this.windowSize = windowSize;
    this.offset = 0;
    this.barCount = 2;
    this.menu = new ContextMenu();
    this.shadowRoot.append(this.menu);
    this.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      this.activeView = event.composedPath?.().includes(this.comparisonView)
        ? this.comparisonView
        : this.view;
      this.refreshMenu();
      this.menu.open(event.clientX, event.clientY);
    });
    this.view.addEventListener("seek", (event) => this.seek(event.detail));
    this.view.addEventListener("layout-change", (event) => {
      if (
        Number.isSafeInteger(event?.detail?.length) &&
        event.detail.length >= 0
      )
        this.windowSize = event.detail.length;
      this.seek(this.offset);
    });
    this.wheelRows = 0;
    this.addEventListener(
      "wheel",
      (event) => {
        if (
          event.ctrlKey ||
          !event.deltaY ||
          !this.source ||
          event.composedPath().includes(this.menu)
        )
          return;
        event.preventDefault();
        const rows = this.view.navigationRows || 1;
        const delta =
          event.deltaMode === 1
            ? event.deltaY
            : event.deltaMode === 2
              ? event.deltaY * rows
              : event.deltaY / Math.max(1, this.view.clientHeight / rows);
        this.wheelRows += delta;
        const step = Math.trunc(this.wheelRows);
        this.wheelRows -= step;
        if (step) {
          const level = this.levels.find((level) =>
            event.composedPath().includes(level.bar),
          );
          if (level)
            level.bar.seek(level.offset + step * this.view.navigationColumns);
          else this.seek(this.offset + step * this.view.navigationColumns);
        }
      },
      { passive: false },
    );
    this.restorePreset();
    if (source) this.source = source;
  }

  /**
   * Rebuild captured actions after configuration edits so submenu closures use current expressions
   * and definitions.
   */
  refreshMenu() {
    const wrap = (items) =>
      items.map((item) => {
        const next = { ...item };
        if (item.items) next.items = wrap(item.items);
        if (item.action && !item.historyAction)
          next.action = (...args) => {
            const editedView = this.editingView;
            const before = editedView.exportProfile();
            const result = item.action(...args);
            const record = () => {
              const changed = rememberEdit(
                editedView.editHistory,
                before,
                editedView.exportProfile(),
              );
              if (changed) this.refreshMenu();
            };
            if (result?.then)
              return result.then((value) => {
                record();
                return value;
              });
            record();
            return result;
          };
        return next;
      });
    this.menu.items = wrap(this.contextItems());
  }

  get editingView() {
    return this.activeView || this.view;
  }

  toggleComparison() {
    if (this.comparisonView) {
      this.comparisonView.remove();
      this.comparisonView = undefined;
      this.activeView = this.view;
      this.style.gridTemplateColumns = "";
      this.barContainer.style.gridColumn = "";
      return;
    }
    const comparison = (this.comparisonView = new DataScrollView());
    comparison.className = "comparison";
    comparison.style.gridColumn = "2";
    comparison.style.gridRow = "1";
    comparison.importProfile(this.view.exportProfile());
    comparison.addEventListener("seek", (event) => this.seek(event.detail));
    comparison.addEventListener("layout-change", () => this.syncComparison());
    this.style.gridTemplateColumns = "minmax(0, 1fr) minmax(0, 1fr) auto";
    this.barContainer.style.gridColumn = "3";
    this.shadowRoot.append(comparison);
    this.syncComparison();
  }

  syncComparison() {
    const comparison = this.comparisonView;
    if (!comparison || !this.source) return;
    const length = this.view.length;
    comparison.wholeBuffer = this.view.wholeBuffer;
    comparison.requestedLength = length;
    comparison.sourceMetadata = this.view.sourceMetadata;
    comparison.setWindow(this.source, this.view.offset, length, {
      ...comparison.layout(length, length),
      length,
      limit: length,
    });
  }

  /** Resolve snapshots through the same validated profile API used by JSON import. */
  presetSnapshot() {
    const profile = this.editingView.exportProfile();
    profile.appearance = validateAppearance(
      profile.region,
      this.editingView.effectiveAppearance,
      profile.recipes,
    );
    return { profile, barCount: this.barCount };
  }
  applySavedPreset(entry) {
    if (this.barCount !== entry.barCount) this.barCount = entry.barCount;
    this.editingView.importProfile(entry.profile);
    this.savedPresetId = entry.id;
  }
  restorePreset() {
    try {
      const library = presetLibrary.readLibrary(),
        entry = library.presets.find((entry) => entry.id === library.selected);
      if (entry) this.applySavedPreset(entry);
      else if (library.selected?.startsWith("builtin:")) {
        const name = library.selected.slice(8);
        if (name === "byte-frequency") this.applyTemplate(byteFrequencyTable());
        else if (["hcurve", "morton2d", "morton3d"].includes(name))
          this.applyTemplate(curveTemplate(name));
        else if (name.startsWith("pixels-"))
          this.applyTemplate(packedPixels({ format: name.slice(7) }));
        else this.editingView.applyPreset(name);
      }
    } catch (error) {
      this.presetStorageError = error;
    }
  }
  savePreset(name, id) {
    const entry = presetLibrary.savePreset({
      id,
      name,
      ...this.presetSnapshot(),
    });
    this.savedPresetId = entry.id;
    return entry;
  }
  loadPreset(id) {
    const entry = presetLibrary.selectPreset(id);
    this.applySavedPreset(entry);
  }
  async presetAction(action) {
    try {
      await action();
      this.refreshMenu();
    } catch (error) {
      this.dispatchEvent(
        new CustomEvent("data-error", {
          detail: error,
          bubbles: true,
          composed: true,
        }),
      );
      globalThis.alert?.(error.message);
    }
  }
  async copyPreset(value) {
    const json = presetLibrary.serializePreset(value);
    try {
      if (globalThis.navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(json);
        return;
      }
    } catch {}
    if (globalThis.prompt) globalThis.prompt("Preset JSON", json);
    else throw new Error("Copying preset JSON is unavailable.");
  }
  applyTemplate(template) {
    const recipes = this.editingView.pointConfiguration.recipes;
    this.editingView.applyPreset("linear");
    this.editingView.pointConfiguration = {
      ...template.configuration,
      recipes,
    };
    this.editingView.shaders = template.shaders;
    this.editingView.appearance = template.appearance;
    this.savedPresetId = undefined;
  }
  presetItems() {
    let library;
    try {
      library = presetLibrary.readLibrary();
      this.presetStorageError = undefined;
    } catch (error) {
      this.presetStorageError = error;
      library = { presets: [] };
    }
    const snapshot = library.presets.length ? this.presetSnapshot() : undefined;
    const action = (callback) => () => this.presetAction(callback);
    const name = (message, suggested, save) => {
      const value = globalThis.prompt?.(message, suggested);
      if (value === null || value === undefined) return;
      return save(value);
    };
    const unusedName = (base) => {
      const names = new Set(library.presets.map((entry) => entry.name));
      base = base.slice(0, 80);
      let candidate = base,
        index = 2;
      while (names.has(candidate)) {
        const suffix = ` ${index++}`;
        candidate = base.slice(0, 80 - suffix.length) + suffix;
      }
      return candidate;
    };
    const matches = (entry) =>
      entry.id === this.savedPresetId &&
      entry.barCount === snapshot.barCount &&
      JSON.stringify(entry.profile) === JSON.stringify(snapshot.profile);
    return [
      {
        label: "Load",
        items: [
          ...[
            "linear",
            "hilbert",
            "hilbert3d",
            "digraph",
            "dft",
            "trigraph",
          ].map((region) => ({
            label: {
              linear: "Linear",
              hilbert: "Hilbert",
              hilbert3d: "Hilbert 3D",
              digraph: "Digraph",
              dft: "DFT",
              trigraph: "Trigraph",
            }[region],
            checked:
              !this.editingView._pointConfiguration &&
              this.editingView.region === region,
            action: action(() => {
              this.editingView.applyPreset(region);
              this.savedPresetId = undefined;
              presetLibrary.selectPreset(`builtin:${region}`);
            }),
          })),
          {
            label: "Byte Frequency",
            action: action(() => {
              this.applyTemplate(byteFrequencyTable());
              presetLibrary.selectPreset("builtin:byte-frequency");
            }),
          },
          ...[
            ["hcurve", "H-Curve"],
            ["morton2d", "Morton"],
            ["morton3d", "Morton 3D"],
          ].map(([name, label]) => ({
            label,
            action: action(() => {
              this.applyTemplate(curveTemplate(name));
              presetLibrary.selectPreset(`builtin:${name}`);
            }),
          })),
          {
            label: "Packed Pixels",
            items: Object.keys(pixelFormats).map((format) => ({
              label: format.toUpperCase(),
              action: action(() => {
                this.applyTemplate(packedPixels({ format }));
                presetLibrary.selectPreset(`builtin:pixels-${format}`);
              }),
            })),
          },
          {
            label: "Saved",
            disabled: library.presets.length === 0,
            items: library.presets.map((entry) => ({
              label: entry.name,
              checked: matches(entry),
              action: action(() => this.loadPreset(entry.id)),
            })),
          },
        ],
      },
      {
        label: "Manage",
        disabled: library.presets.length === 0,
        items: library.presets.map((entry) => ({
          label: entry.name,
          checked: matches(entry),
          items: [
            {
              label: "Update",
              action: action(() => this.savePreset(entry.name, entry.id)),
            },
            {
              label: "Duplicate",
              action: action(() =>
                name("Preset name", unusedName(`${entry.name} Copy`), (value) =>
                  presetLibrary.duplicatePreset(entry.id, value),
                ),
              ),
            },
            {
              label: "Rename",
              action: action(() =>
                name("Preset name", entry.name, (value) =>
                  presetLibrary.renamePreset(entry.id, value),
                ),
              ),
            },
            {
              label: "Copy JSON",
              action: action(() =>
                this.copyPreset(presetLibrary.getPreset(entry.id)),
              ),
            },
            {
              label: "Delete",
              action: action(() => {
                presetLibrary.deletePreset(entry.id);
                if (this.savedPresetId === entry.id)
                  this.savedPresetId = undefined;
              }),
            },
          ],
        })),
      },
      {
        label: "Save As",
        action: action(() =>
          name("Preset name", unusedName("Custom Preset"), (value) =>
            this.savePreset(value),
          ),
        ),
      },
      {
        label: "Copy JSON",
        action: action(() =>
          this.copyPreset({
            name:
              library.presets.find((entry) => entry.id === this.savedPresetId)
                ?.name || "Custom Preset",
            ...this.presetSnapshot(),
          }),
        ),
      },
      {
        label: "Import JSON",
        action: action(() => {
          const json = globalThis.prompt?.("Preset JSON");
          if (json === null || json === undefined) return;
          const value = presetLibrary.parsePreset(json);
          return name("Preset name", unusedName(value.name), (name) => {
            const entry = presetLibrary.savePreset({ ...value, name });
            this.applySavedPreset(entry);
          });
        }),
      },
      {
        label: "Import File",
        action: action(async () => {
          const file = await chooseFile(".json,application/json");
          if (!file) return;
          if (file.size > 4 * 1048576)
            throw new RangeError("Preset JSON exceeds 4 MiB");
          const value = presetLibrary.parsePreset(await file.text());
          return name("Preset name", unusedName(value.name), (name) => {
            const entry = presetLibrary.savePreset({ ...value, name });
            this.applySavedPreset(entry);
          });
        }),
      },
      {
        label: "Export File",
        action: action(() => {
          const name =
            library.presets.find((entry) => entry.id === this.savedPresetId)
              ?.name || "Custom Preset";
          downloadJSON(
            name,
            presetLibrary.serializePreset({ name, ...this.presetSnapshot() }),
          );
        }),
      },
    ];
  }

  referenceItems() {
    const view = this.editingView;
    let models = [];
    try {
      models = referenceModels.readLibrary().models;
    } catch {}
    const train = (order) =>
      this.presetAction(async () => {
        const name = globalThis.prompt?.("Reference name");
        if (name === null || name === undefined) return;
        const { source, offset, length } = view;
        if (!source) throw new Error("No source is loaded");
        assertProviderBudget(
          { configuration: view.pointConfiguration },
          Math.min(length, 65536) + 256 ** order * 64,
          "Reference training",
        );
        const current = () =>
          view.source === source &&
          view.offset === offset &&
          view.length === length;
        const model = await referenceModels.trainReferenceSource(
          {
            source,
            start: offset,
            end: offset + length,
            name,
            order,
            provenance: {
              sourceRange: { start: offset, endExclusive: offset + length },
            },
          },
          current,
        );
        if (model) referenceModels.saveModel(model);
      });
    const use = (model, kind) => {
      const expression = {
        op: "analysis",
        family: "reference",
        modelID: model.id,
        kind,
        window: 32,
        offset: { op: "offset" },
      };
      view.appearance = {
        ...view.effectiveAppearance,
        colorSpace: "hsl",
        [kind === "coverage" ? "lightness" : "hue"]:
          kind === "surprise"
            ? { op: "normalize", input: expression, min: 0, max: 16 }
            : expression,
      };
      this.refreshMenu();
    };
    return [
      {
        label: "Train Selection",
        items: [
          { label: "Bytes", historyAction: true, action: () => train(1) },
          { label: "Pairs", historyAction: true, action: () => train(2) },
        ],
      },
      ...models.map((model) => ({
        label: model.name,
        items: [
          { label: "Surprise Hue", action: () => use(model, "surprise") },
          { label: "Coverage Lightness", action: () => use(model, "coverage") },
          {
            label: "Rename",
            action: () =>
              this.presetAction(() => {
                const name = globalThis.prompt?.("Reference name", model.name);
                if (name !== null && name !== undefined)
                  referenceModels.renameModel(model.id, name);
              }),
          },
          {
            label: "Export File",
            action: () =>
              downloadJSON(model.name, referenceModels.serializeModel(model)),
          },
          {
            label: "Delete",
            action: () =>
              this.presetAction(() => referenceModels.deleteModel(model.id)),
          },
        ],
      })),
      {
        label: "Import File",
        action: () =>
          this.presetAction(async () => {
            const file = await chooseFile(".json,application/json");
            if (file && file.size > referenceModels.defaultLibraryBudget)
              throw new RangeError(
                "Reference artifact exceeds its JSON budget",
              );
            if (file)
              referenceModels.saveModel(
                referenceModels.parseModel(await file.text()),
              );
          }),
      },
    ];
  }

  bookmarkItems() {
    let entries = [];
    try {
      entries = bookmarks.readBookmarks();
    } catch {}
    return [
      {
        label: "Save Range",
        action: () =>
          this.presetAction(() => {
            const name = globalThis.prompt?.("Bookmark name");
            if (name !== null && name !== undefined)
              bookmarks.saveBookmark({
                name,
                source: this.sourceIdentity,
                offset: this.view.offset,
                length: this.view.length,
              });
          }),
      },
      ...entries.map((entry) => ({
        label: entry.name,
        items: [
          {
            label: "Load",
            disabled: entry.source !== this.sourceIdentity,
            action: () =>
              this.presetAction(() =>
                this.selectRange(entry.offset, entry.length),
              ),
          },
          {
            label: "Rename",
            action: () =>
              this.presetAction(() => {
                const name = globalThis.prompt?.("Bookmark name", entry.name);
                if (name !== null && name !== undefined)
                  bookmarks.saveBookmark({ ...entry, name });
              }),
          },
          {
            label: "Delete",
            action: () =>
              this.presetAction(() => bookmarks.deleteBookmark(entry.id)),
          },
        ],
      })),
    ];
  }

  selectRange(offset, length) {
    if (
      !this.source ||
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length < 1 ||
      offset + length > this.source.size
    )
      throw new RangeError("Range lies outside the loaded source");
    this.windowSize = length;
    this.exactSelectionLength = length;
    if (!this.barCount) this.barCount = 1;
    this.resetLevels(offset);
  }

  setSourceMetadata(value) {
    if (!this.source) throw new Error("No source is loaded");
    const metadata = validateSourceMetadata(value, this.source.size);
    this.view.sourceMetadata = metadata;
    if (this.comparisonView) this.comparisonView.sourceMetadata = metadata;
    this.view.render();
    this.comparisonView?.render();
  }

  /**
   * Derive menu descriptors from state rather than storing UI selections separately from
   * visualization settings.
   */
  contextItems() {
    const view = this.editingView,
      config = view.pointConfiguration;
    const ranges = view.dimensionRanges;
    const definitions = config.recipes || {};
    const save = (expression) => {
      const name = globalThis.prompt?.("Factor name");
      if (name?.trim()) {
        view.setFactor(name.trim(), expression);
        this.refreshMenu();
      }
    };
    const edit = (label, value, action) =>
      recipeMenu(label, value, definitions, action, save);
    const change = (patch) => {
      view.pointConfiguration = { ...view.pointConfiguration, ...patch };
      this.refreshMenu();
    };
    const choose = (label, value, options, action) => ({
      label,
      value,
      options,
      action,
    });
    const options = (values) =>
      values.map((value) => ({
        value,
        label: value[0].toUpperCase() + value.slice(1),
      }));
    const dimensionItems = (index) => {
      const name = dimensionNames[index],
        range = config.dimensions[name],
        resolved = ranges[name];
      const update = (patch) =>
        change({
          dimensions: { ...config.dimensions, [name]: { ...range, ...patch } },
        });
      return [
        ...["start", "end", "step"].map((field) => ({
          label:
            field[0].toUpperCase() +
            field.slice(1) +
            (resolved.unit ? " (°)" : ""),
          input: "number",
          step: "any",
          value: resolved[field],
          action: (value) => update({ [field]: value }),
        })),
        choose(
          "Range Mode",
          range.mode,
          [
            { value: "scale", label: "Scale" },
            { value: "truncate", label: "Truncate" },
          ],
          (mode) => update({ mode }),
        ),
        {
          label: "Fit",
          kind: "checkbox",
          checked: range.fit,
          action: () => update({ fit: !range.fit }),
        },
        { label: "Reset Range", action: () => update(defaultDimension()) },
      ];
    };
    const text = view.shaders.includes("hex")
      ? "hex"
      : view.shaders.includes("character")
        ? "character"
        : "none";
    return [
      { label: "Preset", items: this.presetItems() },
      choose(
        "Population",
        config.population,
        options(populations),
        (population) => change({ population }),
      ),
      choose("Space", config.space, options(Object.keys(spaces)), (space) =>
        change({ space }),
      ),
      {
        label: "Position",
        items: spaces[config.space].map((label, index) => ({
          label,
          items: [
            edit("Factor", config.position[index], (factor) => {
              const position = [...config.position];
              position[index] = factor;
              change({ position });
            }),
            ...dimensionItems(index),
            {
              label: "Invert",
              kind: "checkbox",
              checked: config.inverted[index],
              action: () => {
                const inverted = [...config.inverted];
                inverted[index] = !inverted[index];
                change({ inverted });
              },
            },
          ],
        })),
      },
      {
        label: "Points",
        items: [
          {
            label: "Accumulation",
            items: [
              {
                label: "Enabled",
                checked: !!view.effectiveAppearance.density,
                action: () => {
                  view.appearance = {
                    ...view.effectiveAppearance,
                    density: view.effectiveAppearance.density
                      ? undefined
                      : validateDensity({}),
                  };
                  this.refreshMenu();
                },
              },
              ...(view.effectiveAppearance.density
                ? (() => {
                    const density = view.effectiveAppearance.density;
                    const update = (patch) => {
                      view.appearance = {
                        ...view.effectiveAppearance,
                        density: { ...density, ...patch },
                      };
                      this.refreshMenu();
                    };
                    return [
                      choose(
                        "Depth",
                        density.mode,
                        [
                          { value: "all", label: "All Contributions" },
                          { value: "front", label: "Front Layer" },
                        ],
                        (mode) => update({ mode }),
                      ),
                      choose(
                        "Reference",
                        density.reference,
                        [
                          { value: "percentile", label: "Percentile" },
                          { value: "fixed", label: "Fixed" },
                        ],
                        (reference) => update({ reference }),
                      ),
                      ...[
                        ["value", "Reference Value", Number.MIN_VALUE, 1000000],
                        ["percentile", "Percentile", 0, 1],
                        ["exposure", "Exposure", Number.MIN_VALUE, 1000000],
                      ].map(([key, label, min, max]) => ({
                        label,
                        input: "number",
                        min,
                        max,
                        step: "any",
                        value: density[key],
                        action: (value) => update({ [key]: value }),
                      })),
                      {
                        label: "Weight by Opacity",
                        checked: density.opacityWeight,
                        action: () =>
                          update({ opacityWeight: !density.opacityWeight }),
                      },
                      {
                        label: "Memory Budget (MiB)",
                        input: "number",
                        min: 0,
                        step: 1,
                        value: (density.budget ?? 0) / 1048576,
                        action: (value) =>
                          update({ budget: value ? value * 1048576 : null }),
                      },
                    ];
                  })()
                : []),
            ],
          },
          choose(
            "Color Space",
            view.effectiveAppearance.colorSpace ?? "hsl",
            [
              { value: "hsl", label: "HSL" },
              { value: "rgb", label: "RGB" },
            ],
            (colorSpace) => {
              view.appearance = {
                ...view.effectiveAppearance,
                colorSpace,
                ...(colorSpace === "rgb"
                  ? {
                      red: view.effectiveAppearance.red ?? "value",
                      green: view.effectiveAppearance.green ?? "value",
                      blue: view.effectiveAppearance.blue ?? "value",
                    }
                  : {}),
              };
              this.refreshMenu();
            },
          ),
          ...appearanceChannelsFor(view.effectiveAppearance).map((channel) =>
            edit(
              channel[0].toUpperCase() + channel.slice(1),
              view.effectiveAppearance[channel],
              (value) => {
                view.appearance = {
                  ...view.effectiveAppearance,
                  [channel]: value,
                };
                this.refreshMenu();
              },
            ),
          ),
          choose(
            "Shape",
            view.effectiveAppearance.shape,
            options(["square", "circle"]),
            (shape) => {
              view.appearance = { ...view.effectiveAppearance, shape };
              this.refreshMenu();
            },
          ),
          choose(
            "Text",
            text,
            [
              { value: "none", label: "None" },
              { value: "character", label: "Character" },
              { value: "hex", label: "Hex" },
            ],
            (value) => {
              view.shaders = [
                ...view.shaders.filter(
                  (shader) => !["character", "hex"].includes(shader),
                ),
                ...(value === "none" ? [] : [value]),
              ];
              this.refreshMenu();
            },
          ),
          {
            label: "Reset",
            action: () => {
              view.appearance = undefined;
              this.refreshMenu();
            },
          },
        ],
      },
      {
        label: "Factors",
        items: [
          { label: "New Factor", action: () => save("value") },
          ...Object.entries(definitions).map(([name, expression]) => {
            const menu = recipeMenu(
              name,
              expression,
              definitions,
              (next) => {
                view.setFactor(
                  name,
                  next === "none" ? { op: "constant", value: 0 } : next,
                );
                this.refreshMenu();
              },
              save,
            );
            menu.items.push(
              {
                label: "Rename",
                action: () =>
                  this.presetAction(() => {
                    const next = globalThis.prompt?.("Factor name", name);
                    if (next !== null && next !== undefined)
                      view.renameFactor(name, next.trim());
                  }),
              },
              {
                label: "Delete",
                action: () => this.presetAction(() => view.deleteFactor(name)),
              },
            );
            return menu;
          }),
        ],
      },
      ...(text === "character"
        ? [
            {
              label: "Character",
              items: [
                choose(
                  "Encoding",
                  view.encoding,
                  [
                    { value: "ascii", label: "ASCII" },
                    { value: "ascii-overbar", label: "ASCII + Overbar" },
                    { value: "cp437", label: "CP437" },
                    { value: "latin1", label: "Latin-1" },
                  ],
                  (value) => {
                    view.encoding = value;
                  },
                ),
                ...["blankSpaces", "blankNulls"].map((option) => ({
                  label:
                    option === "blankSpaces" ? "Blank Spaces" : "Blank Nulls",
                  kind: "checkbox",
                  checked: view[option],
                  action: () => {
                    view[option] = !view[option];
                  },
                })),
              ],
            },
          ]
        : []),
      ...(view.spatial
        ? [
            {
              label: "Camera",
              items: [
                {
                  label: "Reset Rotation",
                  action: () => {
                    view.rotation = { yaw: -0.6, pitch: 0.45 };
                    view.render();
                  },
                },
              ],
            },
          ]
        : []),
      {
        label: "Advanced",
        items: [
          {
            label: "Source Metadata",
            items: [
              {
                label: "Import File",
                action: () =>
                  this.presetAction(async () => {
                    const source = this.source;
                    if (!source) throw new Error("No source is loaded");
                    const file = await chooseFile(".json,application/json");
                    if (!file) return;
                    if (file.size > 16 * 1048576)
                      throw new RangeError("Source metadata exceeds 16 MiB");
                    const value = JSON.parse(await file.text());
                    if (this.source === source) this.setSourceMetadata(value);
                  }),
              },
              {
                label: "Edit JSON",
                action: () =>
                  this.presetAction(() => {
                    const json = globalThis.prompt?.(
                      "Source metadata JSON",
                      JSON.stringify(
                        this.view.sourceMetadata || {
                          segments: [],
                          annotations: [],
                        },
                        null,
                        2,
                      ),
                    );
                    if (json !== null && json !== undefined)
                      this.setSourceMetadata(JSON.parse(json));
                  }),
              },
              {
                label: "Clear",
                disabled: !this.view.sourceMetadata,
                action: () => {
                  this.setSourceMetadata({ segments: [], annotations: [] });
                  this.refreshMenu();
                },
              },
            ],
          },
          { label: "References", items: this.referenceItems() },
          { label: "Bookmarks", items: this.bookmarkItems() },
          {
            label: "Open File",
            action: () =>
              this.presetAction(async () => {
                const file = await chooseFile();
                if (file) this.source = file;
              }),
          },
          {
            label: "Comparison View",
            checked: !!this.comparisonView,
            action: () => {
              this.toggleComparison();
              this.refreshMenu();
            },
          },
          {
            label: "Undo",
            disabled: !view.editHistory.past.length,
            historyAction: true,
            action: () => {
              view.restoreEdit("undo");
              this.refreshMenu();
            },
          },
          {
            label: "Redo",
            disabled: !view.editHistory.future.length,
            historyAction: true,
            action: () => {
              view.restoreEdit("redo");
              this.refreshMenu();
            },
          },
          {
            label: "Edit Profile JSON",
            action: () =>
              this.presetAction(() => {
                const json = globalThis.prompt?.(
                  "Profile JSON",
                  JSON.stringify(view.exportProfile(), null, 2),
                );
                if (json !== null && json !== undefined)
                  view.importProfile(json);
              }),
          },
          {
            label: "Bars",
            input: "number",
            min: 0,
            value: this.barCount,
            action: (value) => {
              this.barCount = value;
            },
          },
          {
            label: "Sample Limit",
            input: "number",
            min: 1,
            max: 16777216,
            value: config.sampleLimit ?? 262144,
            action: (sampleLimit) => change({ sampleLimit }),
          },
          {
            label: "Provider Budget (MiB)",
            input: "number",
            min: 0,
            step: 1,
            value: (config.providerBudget ?? 0) / 1048576,
            action: (value) =>
              change({ providerBudget: value ? value * 1048576 : null }),
          },
          ...(["pairs", "triples", "symbols"].includes(config.population)
            ? [
                choose(
                  "Tuple Representative",
                  config.tupleRepresentative ?? "first",
                  options(["first", "last"]),
                  (tupleRepresentative) => change({ tupleRepresentative }),
                ),
              ]
            : []),
          ...(config.population === "records"
            ? ["recordStride", "recordOrigin", "recordWidth"].map(
                (parameter) => ({
                  label: {
                    recordStride: "Record Stride",
                    recordOrigin: "Record Origin",
                    recordWidth: "Record Width",
                  }[parameter],
                  input: "number",
                  min: parameter === "recordOrigin" ? 0 : 1,
                  step: 1,
                  value:
                    config[parameter] ?? (parameter === "recordOrigin" ? 0 : 1),
                  action: (value) => change({ [parameter]: value }),
                }),
              )
            : []),
          choose(
            "Footprint",
            config.footprint,
            options(["grid", "point"]),
            (footprint) => change({ footprint }),
          ),
          {
            label: "GPU Execution",
            items: ["gpuProjection", "gpuRecipes"].map((flag) => ({
              label: flag === "gpuProjection" ? "Projection" : "Recipes",
              checked: config[flag],
              action: () => change({ [flag]: !config[flag] }),
            })),
          },
          {
            label: "Adaptive Resolution",
            checked: config.adaptiveResolution,
            action: () =>
              change({ adaptiveResolution: !config.adaptiveResolution }),
          },
          choose(
            "Backend",
            config.backend,
            [
              { value: "cpu", label: "CPU" },
              { value: "webgl", label: "WebGL" },
            ],
            (backend) => change({ backend }),
          ),
        ],
      },
    ];
  }

  /**
   * Use level count as the source of truth; zero means a whole-buffer view rather than an invisible
   * active selector.
   */
  get barCount() {
    return this.levels.length;
  }

  /**
   * Rebuild scope controllers in widest-to-narrowest order and reverse only their DOM presentation.
   * Stop obsolete autoscroll sessions before replacing bars.
   */
  set barCount(count) {
    if (!Number.isSafeInteger(count) || count < 0)
      throw new RangeError("Bar count must be a non-negative integer");
    for (const level of this.levels) {
      level.bar.stopAuto();
      level.bar.remove();
    }
    this.levels = Array.from({ length: count }, (_, index) => {
      const bar = new DataScrollBar();
      const level = { bar, offset: 0, requested: this.windowSize };
      bar.addEventListener("seek", (event) => {
        level.offset = event.detail;
        this.updateLevels();
      });
      bar.addEventListener("window-change", (event) => {
        level.requested = event.detail.length;
        level.offset = event.detail.offset;
        if (index === this.levels.length - 1) {
          this.windowSize = level.requested;
          this.exactSelectionLength = undefined;
        }
        this.wheelRows = 0;
        this.updateLevels(
          level,
          event.detail.edge === "top"
            ? event.detail.offset + event.detail.length
            : undefined,
        );
      });
      return level;
    });
    this.bar = this.levels.at(-1)?.bar;
    this.barContainer.append(
      ...this.levels.map((level) => level.bar).reverse(),
    );
    if (this.source) this.resetLevels(this.offset);
  }

  /**
   * Use immutable Blob slicing for random access and reset offsets when the source changes; do not
   * add a redundant ByteSource wrapper.
   */
  set source(source) {
    this._source = source instanceof Blob ? source : new Blob([source]);
    this.sourceIdentity = bookmarks.sourceIdentity(this._source);
    this.exactSelectionLength = undefined;
    this.view.sourceMetadata = undefined;
    if (this.comparisonView) this.comparisonView.sourceMetadata = undefined;
    for (const level of this.levels) level.bar.stopAuto();
    this.resetLevels(0);
  }

  /**
   * Keep one root Blob identity for stable renderer caches across changing nested slices.
   */
  get source() {
    return this._source;
  }

  /**
   * Seed progressively narrower scopes around an absolute offset, then let normal reconciliation
   * apply final layout constraints.
   */
  resetLevels(offset) {
    let base = 0,
      size = this.source.size;
    this.levels.forEach((level, index) => {
      level.requested =
        index === this.levels.length - 1
          ? this.windowSize
          : Math.min(size, Math.max(this.windowSize, Math.ceil(size / 4)));
      const length = Math.min(size, level.requested);
      level.offset = clamp(offset - base, 0, size - length);
      base += level.offset;
      size = length;
    });
    this.updateLevels();
  }

  /**
   * Reconcile parents before children so every local window remains inside its feeding scope.
   * Convert to root coordinates only at the view boundary.
   * anchorEnd preserves a top-resize's far edge while linear row snapping changes the resulting
   * length.
   */
  updateLevels(changed, anchorEnd) {
    if (!this.source) return;
    this.view.wholeBuffer = this.levels.length === 0;
    if (this.view.wholeBuffer) {
      this.offset = 0;
      const layout = {
        ...this.view.layout(this.source.size, this.source.size),
        limit: this.source.size,
      };
      this.view.requestedLength = this.source.size;
      this.view.setWindow(this.source, 0, this.source.size, layout);
      this.syncComparison();
      return;
    }
    let source = this.source,
      base = 0;
    this.levels.forEach((level, index) => {
      const inner = index === this.levels.length - 1;
      const limit = Math.min(
        source.size,
        level === changed ? (anchorEnd ?? source.size) : source.size,
      );
      const layout = inner
        ? {
            ...this.view.layout(
              this.windowSize,
              Math.min(limit, this.exactSelectionLength ?? limit),
            ),
            limit: Math.min(limit, this.exactSelectionLength ?? limit),
          }
        : null;
      const length = inner
        ? layout.length
        : Math.min(source.size, Math.max(1, Math.round(level.requested)));
      if (level === changed && anchorEnd !== undefined)
        level.offset = anchorEnd - length;
      level.offset = clamp(Math.round(level.offset), 0, source.size - length);
      level.base = base;
      level.length = length;
      level.bar.setWindow(source, level.offset, length, {
        source: this.source,
        offset: base,
      });
      if (inner) {
        this.offset = base + level.offset;
        this.view.requestedLength = this.windowSize;
        this.view.setWindow(this.source, this.offset, length, layout);
      } else {
        if (
          level.sliceSource !== source ||
          level.sliceOffset !== level.offset ||
          level.sliceLength !== length
        ) {
          level.sliceSource = source;
          level.sliceOffset = level.offset;
          level.sliceLength = length;
          level.slice = source.slice(level.offset, level.offset + length);
        }
        base += level.offset;
        source = level.slice;
      }
    });
    this.syncComparison();
  }

  /**
   * Accept root-source-relative view navigation and translate it into the innermost bar's local
   * coordinates. With zero bars, preserve the whole source.
   */
  seek(offset, anchorEnd) {
    if (!this.source) return;
    const level = this.levels.at(-1);
    if (!level) {
      this.updateLevels();
      return;
    }
    level.offset = offset - (level.base || 0);
    this.updateLevels(
      level,
      anchorEnd === undefined ? undefined : anchorEnd - (level.base || 0),
    );
  }
}

customElements.define("ui-popup", Popup);
customElements.define("context-menu", ContextMenu);
customElements.define("point-popup", PointPopup);
customElements.define("data-scroll-view", DataScrollView);
customElements.define("data-scroll-bar", DataScrollBar);
customElements.define("data-scroll", DataScroll);
