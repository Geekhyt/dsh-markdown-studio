import * as DarkmodeModule from 'mp-darkmode';

export interface DarkmodeRuntime {
  run: typeof DarkmodeModule.run;
  reset: typeof DarkmodeModule.reset;
}

const resolved = (DarkmodeModule as unknown as { default?: Partial<DarkmodeRuntime> }).default?.run
  ? (DarkmodeModule as unknown as { default: DarkmodeRuntime }).default
  : (DarkmodeModule as unknown as DarkmodeRuntime);

export const darkmodeRuntime: DarkmodeRuntime = {
  run: resolved.run,
  reset: resolved.reset,
};

if (typeof window !== 'undefined') {
  window.__MDSTUDIO_DARKMODE__ = darkmodeRuntime;
}
