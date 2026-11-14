<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef } from 'vue';
import { Palettes, supportsWebGL2 } from 'zoomdata';
import ColorBar from './components/ColorBar.vue';
import HeightMapViewer from './components/HeightMapViewer.vue';
import { NO_DATA_CSS } from './colors';
import type { Dataset, DatasetInfo, Probe, ViewInfo } from './types';

const PALETTES = {
  inferno: 'Inferno',
  viridis: 'Viridis',
  magma: 'Magma',
  plasma: 'Plasma',
  grayscale: 'Greyscale',
} as const;
type PaletteName = keyof typeof PALETTES;

const webgl2 = supportsWebGL2();

const datasets = ref<Dataset[]>([]);
const selected = ref<string | null>(null);
const loaded = ref(false);
const paletteName = ref<PaletteName>('inferno');
const autoRange = ref(true);

const info = ref<DatasetInfo | null>(null);
const view = ref<ViewInfo | null>(null);
const probe = ref<Probe | null>(null);
const range = ref<[number, number] | null>(null);
const crosshair = ref<{ x: number; y: number } | null>(null);
const error = ref<string | null>(null);

const viewer = useTemplateRef('viewer');

const dataset = computed(() => datasets.value.find((d) => d.name === selected.value) ?? null);
const palette = computed(() => Palettes[paletteName.value](256));

onMounted(async () => {
  // ?data=<root URL of a pyramid> shows any pyramid
  const custom = new URLSearchParams(location.search).get('data');
  if (custom) {
    datasets.value.push({ name: 'custom', title: custom, url: custom });
  }
  try {
    // Written by make_demo_data.py; absent until it has run
    const response = await fetch(`${import.meta.env.BASE_URL}data/datasets.json`);
    if (response.ok) datasets.value.push(...((await response.json()) as Dataset[]));
  } catch {
    // No demo data yet
  }
  selected.value = datasets.value[0]?.name ?? null;
  loaded.value = true;
});

function select(): void {
  info.value = view.value = probe.value = range.value = crosshair.value = error.value = null;
}

/** Position in data points as a physical length */
function length(points: number): string {
  const ppm = info.value?.pixelsPerMeter;
  return ppm ? `${((points / ppm) * 1e6).toFixed(3)} µm` : `${points.toFixed(1)} px`;
}

const magnification = computed(() => {
  const k = view.value?.scale;
  if (!k) return '–';
  return k >= 1
    ? `${k.toFixed(k < 10 ? 1 : 0)} screen px per data point`
    : `${(1 / k).toFixed(1)} data points per screen px`;
});

const resolution = computed(() => {
  if (!view.value || !info.value) return '–';
  const { level, stride } = view.value;
  const what =
    stride === 1
      ? 'measured values'
      : `${info.value.downsample === 'nearest' ? 'every' : 'mean of'} ${stride} × ${stride} points`;
  return `level ${level} of ${info.value.maxLevel}: ${what}`;
});

const memory = computed(() =>
  view.value ? `${view.value.tiles} tiles, ${(view.value.bytes / 2 ** 20).toFixed(1)} MiB` : '–',
);

const probeText = computed(() => {
  const p = probe.value;
  if (!p) return null;
  return {
    value: Number.isNaN(p.value) ? 'no data' : p.value.toFixed(5),
    position: `${length(p.x)}, ${length(p.y)}`,
    source: p.stride === 1 ? 'measured value' : `mean of ${p.stride} × ${p.stride} points`,
  };
});
</script>

<template>
  <div class="app">
    <header>
      <h1>zoomdata</h1>
      <p>Zoomable height maps with exact values, drawn from a tile pyramid</p>
    </header>

    <p v-if="!webgl2" class="notice">This browser does not support WebGL2.</p>

    <div v-else-if="loaded && !dataset" class="notice">
      <p>There is no demo data yet. Create it with</p>
      <p><code>python demo/make_demo_data.py</code></p>
      <p>
        and reload this page, or show any pyramid with
        <code>?data=&lt;root URL&gt;</code>.
      </p>
    </div>

    <main v-else-if="dataset">
      <section class="stage">
        <p v-if="error" class="notice">Failed to load {{ dataset.url }}: {{ error }}</p>
        <HeightMapViewer
          v-else
          ref="viewer"
          :key="dataset.url"
          :source="dataset.url"
          :palette="palette"
          :auto-range="autoRange"
          @ready="info = $event"
          @error="error = $event.message"
          @view="view = $event"
          @probe="probe = $event"
          @range="range = $event"
          @crosshair="crosshair = $event"
        />
        <p class="hint">
          Scroll or pinch to zoom · drag to pan · double-click for cross-sections · keys + − ← ↑ → ↓
          0
        </p>
      </section>

      <aside>
        <div class="group">
          <label for="dataset">Dataset</label>
          <select id="dataset" v-model="selected" @change="select">
            <option v-for="d in datasets" :key="d.name" :value="d.name">{{ d.title }}</option>
          </select>
          <p v-if="dataset.description" class="note">{{ dataset.description }}</p>
          <p v-if="info" class="note">
            {{ info.width }} × {{ info.height }} points, tile format {{ info.formatVersion }}
          </p>
        </div>

        <div class="group">
          <label for="palette">Colour scale</label>
          <select id="palette" v-model="paletteName">
            <option v-for="(title, name) in PALETTES" :key="name" :value="name">{{ title }}</option>
          </select>
          <label class="check">
            <input v-model="autoRange" type="checkbox" />
            Fit to the values in view
          </label>
          <ColorBar
            v-if="info && range"
            :palette="palette"
            :range="range"
            :title="info.title"
            class="colorbar"
          />
          <p class="note legend"><span class="swatch" /> no data</p>
        </div>

        <div class="group">
          <label>Under the pointer</label>
          <dl v-if="probeText && info">
            <dt>{{ info.title }}</dt>
            <dd class="value">{{ probeText.value }}</dd>
            <dt>Position</dt>
            <dd>{{ probeText.position }}</dd>
            <dt>Read from</dt>
            <dd>{{ probeText.source }}</dd>
          </dl>
          <p v-else class="note">Move the pointer over the map.</p>
        </div>

        <div class="group">
          <label>View</label>
          <dl>
            <dt>Magnification</dt>
            <dd>{{ magnification }}</dd>
            <dt>Drawn</dt>
            <dd>{{ resolution }}</dd>
            <dt>In memory</dt>
            <dd>{{ memory }}<span v-if="view?.loading"> · loading…</span></dd>
            <template v-if="crosshair">
              <dt>Crosshair</dt>
              <dd>{{ length(crosshair.x) }}, {{ length(crosshair.y) }}</dd>
            </template>
          </dl>
          <div class="buttons">
            <button @click="viewer?.resetView()">Show all</button>
            <button :disabled="!crosshair" @click="viewer?.clearCrosshair()">
              Clear crosshair
            </button>
          </div>
        </div>
      </aside>
    </main>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  padding: 16px 20px;
  gap: 12px;
}

header {
  display: flex;
  align-items: baseline;
  gap: 16px;
}

h1 {
  margin: 0;
  font-size: 22px;
}

header p {
  margin: 0;
  color: var(--muted);
}

main {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
  gap: 16px;
}

.stage {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 12px;
  background: var(--panel);
  border-radius: 8px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
}

.stage > :first-child {
  flex: 1;
}

.hint {
  margin: 8px 0 0;
  font-size: 13px;
  color: var(--muted);
}

aside {
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
}

.group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  background: var(--panel);
  border-radius: 8px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
}

.group > label:first-child {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
}

.check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
}

.note {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
}

.colorbar {
  align-self: center;
}

.legend {
  display: flex;
  align-items: center;
  gap: 8px;
}

.swatch {
  width: 14px;
  height: 14px;
  border-radius: 3px;
  background: v-bind(NO_DATA_CSS);
}

dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 12px;
  margin: 0;
  font-size: 13px;
}

dt {
  color: var(--muted);
}

dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
}

dd.value {
  font-weight: 600;
}

.buttons {
  display: flex;
  gap: 8px;
}

.notice {
  padding: 16px;
  background: var(--panel);
  border-radius: 8px;
  border: 1px solid var(--border);
}

@media (max-width: 900px) {
  .app {
    height: auto;
  }

  main {
    grid-template-columns: 1fr;
  }

  .stage {
    height: 75vh;
  }
}
</style>
