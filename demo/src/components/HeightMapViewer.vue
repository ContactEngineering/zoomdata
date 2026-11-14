<script setup lang="ts">
/**
 * A zoomable height map with a scale bar, a crosshair and cross-sections
 * through it. Wraps the engine of zoomdata with its default input handling.
 */
import { onBeforeUnmount, onMounted, useTemplateRef, watch } from 'vue';
import {
  CrossSections,
  DefaultController,
  Scalebar,
  ZoomEngine,
  type ReliefOptions,
} from 'zoomdata';
import { NO_DATA_COLOR } from '../colors';
import type { DatasetInfo, Probe, ViewInfo } from '../types';

const props = defineProps<{
  /** Root URL of the pyramid */
  source: string;
  /** Colour palette (32-bit ABGR entries) */
  palette: number[];
  /** Fit the colour range to the values in view instead of to the whole map */
  autoRange: boolean;
  /** Relief shading, or false for none */
  relief: ReliefOptions | false;
  /** Vertical exaggeration of the surface in the tilted view */
  verticalExaggeration: number;
}>();

const emit = defineEmits<{
  ready: [info: DatasetInfo];
  error: [error: Error];
  view: [view: ViewInfo];
  probe: [probe: Probe | null];
  range: [range: [number, number]];
  crosshair: [position: { x: number; y: number } | null];
}>();

const canvas = useTemplateRef<HTMLCanvasElement>('canvas');
const overlay = useTemplateRef<HTMLCanvasElement>('overlay');
const horizontalScan = useTemplateRef<HTMLCanvasElement>('horizontalScan');
const verticalScan = useTemplateRef<HTMLCanvasElement>('verticalScan');
const scaleBar = useTemplateRef<HTMLElement>('scaleBar');
const scaleLabel = useTemplateRef<HTMLElement>('scaleLabel');

// The engine owns WebGL resources and is driven imperatively, so it is kept
// out of Vue's reactivity
let engine: ZoomEngine | null = null;
let controller: DefaultController | null = null;
let sections: CrossSections | null = null;
let scanObserver: ResizeObserver | null = null;
let rangeFrame: number | null = null;
let unmounted = false;

function emitView(): void {
  if (!engine) return;
  const { tileCount, bytes } = engine.cacheStats();
  const level = engine.level;
  const view = engine.view;
  emit('view', {
    scale: view.k,
    rotation: view.rotation,
    tilt: view.tilt,
    level,
    stride: engine.config.geometry.stride(level),
    tiles: tileCount,
    bytes,
    loading: engine.isLoading(),
  });
}

/**
 * Colour range spanning the values in view: the 0.5 to 99.5 percentiles of
 * a grid of samples, read from the tiles in memory
 */
function rangeInView(): [number, number] | null {
  if (!engine) return null;
  const { width, height } = engine.config.geometry;
  const rect = engine.visibleImageRect();
  const x0 = Math.max(0, rect.x0);
  const y0 = Math.max(0, rect.y0);
  const x1 = Math.min(width, rect.x1);
  const y1 = Math.min(height, rect.y1);
  if (x1 <= x0 || y1 <= y0) return null;

  const n = 48;
  const values: number[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = x0 + ((i + 0.5) / n) * (x1 - x0);
      const y = y0 + ((j + 0.5) / n) * (y1 - y0);
      const sample = engine.sampleAt(x, y, engine.level);
      if (sample && Number.isFinite(sample.value)) values.push(sample.value);
    }
  }
  if (values.length < n) return null;
  values.sort((a, b) => a - b);
  const lo = values[Math.floor(0.005 * values.length)];
  const hi = values[Math.ceil(0.995 * values.length) - 1];
  return hi > lo ? [lo, hi] : null;
}

function updateRange(): void {
  if (!engine) return;
  const full = engine.config.colorbarRange;
  const range =
    (props.autoRange ? rangeInView() : null) ??
    (full ? ([full.Minimum, full.Maximum] as [number, number]) : null);
  if (!range) return;
  // Applied in the shader; tile textures stay as they are
  engine.setColorRange(...range);
  emit('range', range);
}

/** Update the colour range once per frame at most */
function scheduleRangeUpdate(): void {
  if (rangeFrame !== null) return;
  rangeFrame = requestAnimationFrame(() => {
    rangeFrame = null;
    updateRange();
  });
}

// Pointer position on the canvas, in CSS pixels
let pointer: { x: number; y: number } | null = null;

function movePointer(event: PointerEvent | null): void {
  if (event && canvas.value) {
    const rect = canvas.value.getBoundingClientRect();
    pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  } else {
    pointer = null;
  }
  probe();
}

/** Report the value under the pointer; also when the view or the tiles change */
function probe(): void {
  if (!engine || !pointer) {
    emit('probe', null);
    return;
  }
  // The point of the surface under the pointer and its value, from the
  // tiles in memory; never triggers a request
  const { x, y, sample } = engine.pick(pointer.x, pointer.y);
  emit(
    'probe',
    sample && { x, y, value: sample.value, level: sample.level, stride: sample.stride },
  );
}

/** Keep the drawing buffers of the cross-section plots at their layout size */
function fitScanCanvases(): void {
  for (const c of [horizontalScan.value, verticalScan.value]) {
    if (!c) continue;
    c.width = c.clientWidth;
    c.height = c.clientHeight;
  }
  sections?.redraw();
}

onMounted(async () => {
  let created: ZoomEngine;
  try {
    created = await ZoomEngine.create(canvas.value!, {
      source: props.source,
      colorPalette: props.palette,
      noDataColor: NO_DATA_COLOR,
      relief: props.relief,
      verticalExaggeration: props.verticalExaggeration,
    });
  } catch (err) {
    emit('error', err instanceof Error ? err : new Error(String(err)));
    return;
  }
  if (unmounted) {
    created.dispose();
    return;
  }
  engine = created;

  sections = new CrossSections(engine, {
    overlayCanvas: overlay.value!,
    horizontalCanvas: horizontalScan.value!,
    verticalCanvas: verticalScan.value!,
    // Like the colour range, the profiles show the detail in view
    fitValueAxis: true,
    onChange: (position) => emit('crosshair', position),
  });
  controller = new DefaultController(engine, {
    onDoubleClick: (x, y) => sections?.place(x, y),
  });

  const config = engine.config;
  const scalebar = config.pixelsPerMeter
    ? new Scalebar(scaleBar.value!, scaleLabel.value!, config.pixelsPerMeter.Width)
    : null;

  engine.on('view', (view) => {
    scalebar?.update(view.k);
    emitView();
    probe();
    scheduleRangeUpdate();
  });
  engine.on('tiles', () => {
    emitView();
    probe();
    scheduleRangeUpdate();
  });

  scanObserver = new ResizeObserver(fitScanCanvases);
  scanObserver.observe(horizontalScan.value!);
  scanObserver.observe(verticalScan.value!);

  const { descriptor, geometry } = config;
  emit('ready', {
    width: geometry.width,
    height: geometry.height,
    maxLevel: geometry.maxLevel,
    title: config.colorbarTitle,
    range: config.colorbarRange
      ? [config.colorbarRange.Minimum, config.colorbarRange.Maximum]
      : null,
    pixelsPerMeter: config.pixelsPerMeter?.Width ?? null,
    formatVersion: descriptor.formatVersion,
    downsample: descriptor.downsample,
  });
  scalebar?.update(engine.view.k);
  emitView();
  updateRange();
});

onBeforeUnmount(() => {
  unmounted = true;
  if (rangeFrame !== null) cancelAnimationFrame(rangeFrame);
  scanObserver?.disconnect();
  sections?.dispose();
  controller?.dispose();
  engine?.dispose();
  engine = null;
});

watch(
  () => props.palette,
  (palette) => engine?.setColorPalette(palette),
);
watch(() => props.autoRange, updateRange);
// Applied in the shader, like the colour range
watch(
  () => props.relief,
  (relief) => engine?.setRelief(relief),
);

watch(
  () => props.verticalExaggeration,
  (exaggeration) => engine?.setVerticalExaggeration(exaggeration),
);

defineExpose({
  /** Show the whole map, looking straight down */
  resetView: () => engine?.setView(engine.fitView()),
  /** Turn and tilt the map about the centre of the canvas, in degrees */
  setOrientation: (rotation: number, tilt: number) =>
    engine?.setView(engine.orbitView(rotation, tilt)),
  clearCrosshair: () => sections?.clear(),
});
</script>

<template>
  <div class="viewer">
    <canvas ref="verticalScan" class="scan vertical" />
    <div class="map">
      <canvas
        ref="canvas"
        class="main"
        @pointermove="movePointer"
        @pointerleave="movePointer(null)"
      />
      <canvas ref="overlay" class="overlay" />
      <div class="scalebar">
        <div ref="scaleBar" class="bar" />
        <div ref="scaleLabel" class="label" />
      </div>
    </div>
    <canvas ref="horizontalScan" class="scan horizontal" />
  </div>
</template>

<style scoped>
.viewer {
  display: grid;
  grid-template-columns: 170px minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr) 150px;
  gap: 8px;
  height: 100%;
  min-height: 0;
}

.map {
  position: relative;
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}

/* The engine sizes the drawing buffer to the layout size times the device
   pixel ratio */
.main,
.overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}

.main:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.overlay {
  pointer-events: none;
}

.scan {
  display: block;
  width: 100%;
  height: 100%;
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
}

.scan.vertical {
  grid-row: 1;
  grid-column: 1;
}

.scan.horizontal {
  grid-row: 2;
  grid-column: 2;
}

.scalebar {
  position: absolute;
  left: 12px;
  bottom: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px;
  border-radius: 6px;
  background: rgba(20, 24, 28, 0.6);
  color: white;
  font:
    12px ui-monospace,
    SFMono-Regular,
    Menlo,
    monospace;
  pointer-events: none;
}

.scalebar .bar {
  height: 3px;
  background: white;
}
</style>
