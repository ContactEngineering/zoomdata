/** A pyramid listed in data/datasets.json by make_demo_data.py */
export interface Dataset {
  name: string;
  title: string;
  description?: string;
  /** Root URL of the pyramid */
  url: string;
}

/** What the viewer reports about a loaded pyramid */
export interface DatasetInfo {
  width: number;
  height: number;
  maxLevel: number;
  /** Title of the values with their unit, e.g. "Height (µm)" */
  title: string;
  /** Range of the values of the whole map */
  range: [number, number] | null;
  pixelsPerMeter: number | null;
  formatVersion: number;
  downsample: string | null;
}

/** State of the view */
export interface ViewInfo {
  /** Screen pixels (CSS) per data point */
  scale: number;
  /** Level drawn and the number of data points per drawn value along one axis */
  level: number;
  stride: number;
  /** Tiles in memory and the bytes they hold */
  tiles: number;
  bytes: number;
  loading: boolean;
}

/** Value under the pointer */
export interface Probe {
  /** Position in data points */
  x: number;
  y: number;
  /** NaN where the data is undefined */
  value: number;
  level: number;
  stride: number;
}
