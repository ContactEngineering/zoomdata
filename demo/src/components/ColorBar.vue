<script setup lang="ts">
/** Colour scale with ticks for a palette and a value range */
import { onMounted, useTemplateRef, watch } from 'vue';
import { Colorbar } from 'zoomdata';

const props = defineProps<{
  palette: number[];
  range: [number, number];
  title: string;
}>();

const canvas = useTemplateRef<HTMLCanvasElement>('canvas');
let colorbar: Colorbar | null = null;

onMounted(() => {
  colorbar = new Colorbar({
    canvas: canvas.value!,
    palette: props.palette,
    minValue: props.range[0],
    maxValue: props.range[1],
    title: props.title,
    numTicks: 7,
  });
  colorbar.render();
});

watch(
  () => props.palette,
  (palette) => colorbar?.setPalette(palette),
);
watch(
  () => props.range,
  ([min, max]) => colorbar?.setRange(min, max),
);
</script>

<template>
  <canvas ref="canvas" width="120" height="240" />
</template>
