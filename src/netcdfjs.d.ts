declare module 'netcdfjs' {
  export class NetCDFReader {
    constructor(data: ArrayBuffer);
    getDataVariable(name: string): number[] | null | undefined;
    variables: Array<{ name: string; dimensions: number[] }>;
    dimensions: Array<{ size: number; name: string }>;
  }
}
