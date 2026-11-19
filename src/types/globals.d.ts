export {};

declare global {
  interface Window {
    __MDSTUDIO_MERMAID__?: { render(code: unknown, id?: string): Promise<string> };
    __MDSTUDIO_MATH__?: { cssText: string; render(tex: unknown, displayMode?: boolean): string };
  }
}
