export class Scalebar {
  private bar: HTMLDivElement;
  private label: HTMLDivElement;

  private perPixelWidth: number;
  private imagePixelWidth: number;
  private maxZoomLevel: number;

  constructor(
    barId: string,
    labelId: string,
    perPixelWidth: number,
    imagePixelWidth: number,
    maxZoomLevel: number,
  ) {
    this.bar = document.getElementById(barId) as HTMLDivElement;
    this.label = document.getElementById(labelId) as HTMLDivElement;
    this.perPixelWidth = perPixelWidth;
    this.imagePixelWidth = imagePixelWidth;
    this.maxZoomLevel = maxZoomLevel;

    if (!this.bar || !this.label) {
      throw new Error(`Scalebar: could not find elements #${barId} or #${labelId}`);
    }
  }

  update(zoomLevel: number): void {
    const scale = Math.pow(2, this.maxZoomLevel - zoomLevel);
    const imageScreenWidthPx = this.imagePixelWidth / scale;

    const physicalWidthM = this.imagePixelWidth / this.perPixelWidth;
    const physicalWidthMm = physicalWidthM * 1000;

    const mmPerScreenPx = physicalWidthMm / imageScreenWidthPx; // how many mm does one screen pixel represent at the current zoom level

    const targetBarMm = 100 * mmPerScreenPx; // how much mm would a 100px bar represent at the current zoom level. needed for scalebar

    // Round to a nice number
    const niceMm = this.niceRound(targetBarMm);

    // Convert back to screen pixels
    const barWidthPx = niceMm / mmPerScreenPx;

    // Format label with appropriate unit
    let labelText: string;
    if (niceMm >= 1.0) {
      labelText = `${niceMm.toFixed(0)} mm`;
    } else if (niceMm >= 0.001) {
      labelText = `${(niceMm * 1000).toFixed(0)} µm`;
    } else {
      labelText = `${(niceMm * 1_000_000).toFixed(0)} nm`;
    }

    this.bar.style.width = `${barWidthPx}px`;
    this.label.textContent = labelText;
  }

  private niceRound(value: number): number {
    const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
    const normalized = value / magnitude;

    let nice: number;
    if (normalized < 1.5) nice = 1;
    else if (normalized < 3.5) nice = 2;
    else if (normalized < 7.5) nice = 5;
    else nice = 10;

    return nice * magnitude;
  }
}
