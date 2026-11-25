import type { ComponentType } from 'react';

export interface LocaleSnapshot {
  revision: number;
  locales: Array<{ id: string }>;
}

export interface LocaleService {
  getSnapshot(): LocaleSnapshot;
  getLocale(): { active: string };
  register(namespace: string, locale: string, messages: Record<string, string>): (() => void) | void;
  bind(namespace: string): (key: string) => string;
  subscribe(listener: () => void): () => void;
}

export interface SlotRegistration {
  name: string;
  id?: string;
  key?: string;
  order?: number;
  label?: () => string;
}

export interface SlotService {
  inject(name: string, callback: () => unknown): void;
  register(options: SlotRegistration, component: ComponentType): () => void;
}

export interface ClientContext {
  get<T>(service: string): T | undefined;
  effect(effect: () => void | (() => void)): void;
  slots: SlotService;
}

export interface ClientPlugin {
  inject: string[];
  apply(ctx: ClientContext): void;
}

export interface HostWebServer {
  register(route: {
    kind: 'exact' | 'prefix';
    path: string;
    handler: (
      req: import('node:http').IncomingMessage,
      res: import('node:http').ServerResponse,
    ) => void | Promise<void>;
  }): () => void;
}

export interface HostConnectionService {
  requestRejection?: (request: {
    readonly headers: import('node:http').IncomingMessage['headers'];
  }) => 401 | 403 | undefined;
}

export interface HostContext {
  webServer: HostWebServer;
  connection?: HostConnectionService;
  llm?: unknown;
  agentDefaultModel?: unknown;
  get?: <T>(service: string) => T | undefined;
  effect(effect: () => void | (() => void | Promise<void>)): void;
}
