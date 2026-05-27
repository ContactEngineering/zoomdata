/**
 * Demo application for ZoomData
 */

import {
  ZoomData,
  Palettes,
  inferno,
  viridis,
  magma,
  plasma,
  grayscale,
  Colorbar,
} from "../src/index";

import { Scalebar } from "../src/Scalebar";
// Configuration - points to examples directory served by cors_server.py
const DATA_URL = "http://localhost:8000/examples/synthetic_square4/";

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

let scalebar: Scalebar | null = null;
let colorbar: Colorbar | null = null;

// Show error message
function showError(message: string): void {
  const errorDiv = document.getElementById("error");
  if (errorDiv) {
    errorDiv.textContent = message;
    errorDiv.style.display = "block";
  }
}

// Hide error message
function hideError(): void {
  const errorDiv = document.getElementById("error");
  if (errorDiv) {
    errorDiv.style.display = "none";
  }
}

// Update zoom level display
function updateZoomDisplay(level: number, maxLevel: number): void {
  const zoomValue = document.getElementById("zoomValue");
  if (zoomValue) {
    zoomValue.textContent = `${level.toFixed(2)} / ${maxLevel}`;
  }
}

// Update crosshair position readout in the controls panel
function updateCrosshairInfo(
  imageX: number,
  imageY: number,
  ppmW: number,
  ppmH: number,
): void {
  const el = document.getElementById("crosshairInfo");
  if (!el) return;
  // Convert image pixels tophysical µm
  const xUm = ((imageX / ppmW) * 1e6).toFixed(2);
  const yUm = ((imageY / ppmH) * 1e6).toFixed(2);
  el.textContent = `x: ${xUm} µm   y: ${yUm} µm`;

  // Show the clear button once a crosshair has been placed
  const clearBtn = document.getElementById("clearCrosshairBtn");
  if (clearBtn) clearBtn.style.display = "inline-block";
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

    // Updating the scalebar on every zoom change
    const canvas = document.getElementById("zoomCanvas") as HTMLCanvasElement;
    if (scalebar && canvas) {
      scalebar.update(canvas.width, level);
    }
  };

  // Set up crosshair change handler  updates the coordinate readout
  zoomData.onCrosshairChange = (imageX, imageY) => {
    updateCrosshairInfo(
      imageX,
      imageY,
      zoomData.getPixelsPerMeterWidth(),
      zoomData.getPixelsPerMeterHeight(),
    );
  };

  // Set up colormap selector
  const colormapSelect = document.getElementById(
    "colormapSelect",
  ) as HTMLSelectElement | null;
  if (colormapSelect) {
    colormapSelect.addEventListener("change", () => {
      const colormapName = colormapSelect.value;
      const colormapFn = COLORMAPS[colormapName];
      if (colormapFn) {
        currentPalette = colormapFn(256);
        zoomData.setColorPalette(currentPalette);
        colorbar?.setPalette(currentPalette);
      }
    });
  }

  // Set up reset button
  const resetBtn = document.getElementById("resetBtn");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      zoomData.resetView();
      updateZoomDisplay(zoomData.getZoomLevel(), zoomData.getMaxZoomLevel());

      // updating the scalebar after reset also
      const canvas = document.getElementById("zoomCanvas") as HTMLCanvasElement;
      if (scalebar && canvas) {
        scalebar.update(canvas.width, zoomData.getZoomLevel());
      }
    });
  }

  // Set up clear crosshair button
  const clearCrosshairBtn = document.getElementById("clearCrosshairBtn");
  if (clearCrosshairBtn) {
    clearCrosshairBtn.addEventListener("click", () => {
      zoomData.clearCrosshair();
      const el = document.getElementById("crosshairInfo");
      if (el) el.textContent = "—";
      clearCrosshairBtn.style.display = "none";
    });
  }

  // Start rendering
  try {
    hideError();
    await zoomData.start("zoomCanvas", "hScanCanvas", "vScanCanvas");
    updateZoomDisplay(zoomData.getZoomLevel(), zoomData.getMaxZoomLevel());

    // console.log('maxZoomLevel:', zoomData.getMaxZoomLevel());
    // console.log('imageWidth:', zoomData.getImageWidth());
    // console.log('physicalWidth:', 1.0);

    // initializing the scalebar

    scalebar = new Scalebar(
      "scalebar-bar",
      "scalebar-label",
      zoomData.getPixelsPerMeterWidth(), // physical width in meters
      zoomData.getPixelsPerMeterHeight(), // physical height in meters
      zoomData.getImageWidth(), // full res pixel width
      zoomData.getMaxZoomLevel(), // max zoom level
    );

    // Initial scalebar render
    const canvas = document.getElementById("zoomCanvas") as HTMLCanvasElement;
    // console.log('canvas.width:', canvas.width);
    // console.log('canvas.offsetWidth:', canvas.offsetWidth);
    scalebar.update(canvas.width, zoomData.getZoomLevel());

    const DISPLAY_MIN = zoomData.getMinColorBarRange();
    const DISPLAY_MAX = zoomData.getMaxColorBarRange();
    const DISPLAY_TITLE = zoomData.getColorbarTitle() ?? "Height";

    // Initialize Colorbar
    const colorbarCanvas = document.getElementById(
      "colorbarCanvas",
    ) as HTMLCanvasElement | null;
    if (colorbarCanvas) {
      colorbar = new Colorbar({
        canvas: colorbarCanvas,
        palette: currentPalette,
        minValue: DISPLAY_MIN,
        maxValue: DISPLAY_MAX,
        title: DISPLAY_TITLE,
        numTicks: 7,
        fontSize: 12,
      });
      colorbar.render();
    }
  } catch (error) {
    // Error is already shown via onError callback
    console.error("Failed to start ZoomData:", error);
  }
}

// Run on DOM ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
