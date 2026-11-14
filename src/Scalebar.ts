/**
 * Scale bar: sets the width of a bar element and the text of a label
 * element to a round physical length.
 */
export class Scalebar {
  private bar: HTMLElement;
  private label: HTMLElement;

  private pixelsPerMeter: number;

  /**
   * @param bar - Element whose CSS width is set to the bar length
   * @param label - Element showing the length
   * @param pixelsPerMeter - Image pixels per metre (descriptor PixelsPerMeter.Width)
   */
  constructor(bar: HTMLElement, label: HTMLElement, pixelsPerMeter: number) {
    this.bar = bar;
    this.label = label;
    this.pixelsPerMeter = pixelsPerMeter;
  }

  /**
   * @param k - Scale of the view: CSS pixels per image pixel
   */
  update(k: number): void {
    const mmPerScreenPx = 1000 / (this.pixelsPerMeter * k); // how many mm does one screen pixel represent at the current zoom level

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
