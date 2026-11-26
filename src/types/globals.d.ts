export {};

declare global {
  interface Window {
    __MDSTUDIO_MERMAID__?: { render(code: unknown, id?: string): Promise<string> };
    __MDSTUDIO_MATH__?: { cssText: string; render(tex: unknown, displayMode?: boolean): string };
    __MDSTUDIO_DARKMODE__?: {
      run(nodes: HTMLElement[], opt?: { mode?: string }, container?: HTMLElement): void;
      reset(nodes: HTMLElement[]): void;
    };
  }
}
