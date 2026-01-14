/**
 * Demo application for ZoomData
 */

import { ZoomData, Palettes, inferno, viridis, magma, plasma, grayscale } from '../src/index';

// Configuration - points to examples directory served by cors_server.py
const DATA_URL = 'http://localhost:8000/examples/synthetic_square/';

// Available colormaps
const COLORMAPS: Record<string, (n: number) => number[]> = {
  inferno,
  viridis,
  magma,
  plasma,
  grayscale,
};

// Current palette
let currentPalette = Palettes.inferno(256);

// Create color bar visualization
function renderColorBar(palette: number[]): void {
  const colorBar = document.getElementById('colorBar');
  if (!colorBar) return;

  colorBar.innerHTML = '';

  // Sample colors from palette
  const numSamples = Math.min(palette.length, 50);
  const step = Math.floor(palette.length / numSamples);

  for (let i = 0; i < palette.length; i += step) {
    const color = palette[i];
    const div = document.createElement('div');

    // Convert 32-bit RGBA to CSS color (little-endian: 0xAABBGGRR)
    const r = color & 0xff;
    const g = (color >> 8) & 0xff;
    const b = (color >> 16) & 0xff;
    div.style.backgroundColor = `rgb(${r}, ${g}, ${b})`;

    colorBar.appendChild(div);
  }
}

// Show error message
function showError(message: string): void {
  const errorDiv = document.getElementById('error');
  if (errorDiv) {
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
  }
}

// Hide error message
function hideError(): void {
  const errorDiv = document.getElementById('error');
  if (errorDiv) {
    errorDiv.style.display = 'none';
  }
}

// Update zoom level display
function updateZoomDisplay(level: number, maxLevel: number): void {
  const zoomValue = document.getElementById('zoomValue');
  if (zoomValue) {
    zoomValue.textContent = `${level.toFixed(2)} / ${maxLevel}`;
  }
}

// Main initialization
async function init(): Promise<void> {
  // Create ZoomData instance
  // Note: NetCDF data is pre-normalized to [0, 1] range
  // The dzdata.json ColorbarRange is for display labels only
  const zoomData = new ZoomData({
    rootUrl: DATA_URL,
    colorPalette: currentPalette,
    minValue: 0.0,
    maxValue: 1.0,
    zoomLevelIncrement: 0.1,
  });

  // Set up error handler
  zoomData.onError = (error) => {
    showError(`Failed to load data: ${error.message}`);
  };

  // Set up zoom change handler
  zoomData.onZoomChange = (level) => {
    updateZoomDisplay(level, zoomData.getMaxZoomLevel());
  };

  // Render initial color bar
  renderColorBar(currentPalette);

  // Set up colormap selector
  const colormapSelect = document.getElementById('colormapSelect') as HTMLSelectElement | null;
  if (colormapSelect) {
    colormapSelect.addEventListener('change', () => {
      const colormapName = colormapSelect.value;
      const colormapFn = COLORMAPS[colormapName];
      if (colormapFn) {
        currentPalette = colormapFn(256);
        zoomData.setColorPalette(currentPalette);
        renderColorBar(currentPalette);
      }
    });
  }

  // Set up reset button
  const resetBtn = document.getElementById('resetBtn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      zoomData.resetView();
      updateZoomDisplay(zoomData.getZoomLevel(), zoomData.getMaxZoomLevel());
    });
  }

  // Start rendering
  try {
    hideError();
    await zoomData.start('zoomCanvas');
    updateZoomDisplay(zoomData.getZoomLevel(), zoomData.getMaxZoomLevel());
  } catch (error) {
    // Error is already shown via onError callback
    console.error('Failed to start ZoomData:', error);
  }
}

// Run on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
