declare module '@zxing/browser' {
  export class BrowserMultiFormatReader {
    constructor(...args: any[]);
    decodeFromConstraints(
      constraints: MediaStreamConstraints,
      previewElem: HTMLVideoElement,
      callback: (result: any, error: any, controls: any) => void
    ): Promise<{ stop: () => void; switchTorch?: () => Promise<void> }>;
  }
}
