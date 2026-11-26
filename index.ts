/**
 * Host half of Markdown Studio.
 *
 * One bundle installs the editor, local content-addressed image service, and
 * loopback AI Writing Skill route. The host registers authenticated same-origin
 * action/asset routes, lazy MathJax/Mermaid script routes, and a read-only
 * loopback image server for previews and clipboard HTML. There is no WeChat
 * credential, public image host, or material upload.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AiHostService, type HostDefaultModelSource, type HostLlmRuntime } from './host/application/ai-service';
import { ImageHostService } from './host/application/image-store';
import { AI_ROUTE_PATH, createAiRoute } from './host/http/ai-route';
import { createDarkmodeRoute, DARKMODE_PATH } from './host/http/darkmode-route';
import { createMathRoute, MATH_PATH } from './host/http/math-route';
import { createMermaidRoute, MERMAID_PATH } from './host/http/mermaid-route';
import { ASSET_PREFIX, createAssetRoute, createImageRoute, type HostAuthChecker, ROUTE_PATH } from './host/http/routes';
import { startLocalImageServer } from './host/local-server';
import type { HostConnectionService, HostContext } from './src/types/dsh';

export const inject = ['webServer'];

export function resolveStorageDir(home: string): string {
  const dir = path.join(home, 'storages', 'dsh-markdown-studio');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function apply(ctx: HostContext): void {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  const storageDir = resolveStorageDir(home);
  const service = new ImageHostService({ storageDir });
  const checkAuth: HostAuthChecker = function (req) {
    const conn =
      (ctx.get ? ctx.get<HostConnectionService>('connection') : undefined) ||
      (ctx.connection as HostConnectionService | undefined);
    return typeof conn?.requestRejection === 'function' ? conn.requestRejection(req) : undefined;
  };
  const aiService = new AiHostService({
    getLlm: function () {
      return (ctx.get ? ctx.get<HostLlmRuntime>('llm') : undefined) || (ctx.llm as HostLlmRuntime | undefined);
    },
    getDefaultModel: function () {
      return (
        (ctx.get ? ctx.get<HostDefaultModelSource>('agentDefaultModel') : undefined) ||
        (ctx.agentDefaultModel as HostDefaultModelSource | undefined)
      );
    },
  });

  ctx.effect(function () {
    const disposers: Array<() => void | Promise<void>> = [];
    const rollback = async (): Promise<void> => {
      while (disposers.length) {
        try {
          await disposers.pop()?.();
        } catch {
          /* best effort */
        }
      }
    };
    const abort = new AbortController();
    const localServer = startLocalImageServer({ service, signal: abort.signal });
    const apiHandler = createImageRoute({ service, checkAuth, readyPromise: localServer });
    const assetHandler = createAssetRoute({ service, checkAuth });
    const aiHandler = createAiRoute({ service: aiService, signal: abort.signal, checkAuth });
    const mathHandler = createMathRoute({ checkAuth, signal: abort.signal });
    const mermaidHandler = createMermaidRoute({ checkAuth, signal: abort.signal });
    const darkmodeHandler = createDarkmodeRoute({ checkAuth, signal: abort.signal });
    disposers.push(async function () {
      abort.abort();
      try {
        const result = await localServer;
        if (result && typeof result.stop === 'function') await result.stop();
      } catch {
        /* best effort */
      }
    });
    try {
      disposers.push(ctx.webServer.register({ kind: 'exact', path: ROUTE_PATH, handler: apiHandler }));
      // DeepSeek Harness `webServer` matches `kind: 'prefix'` via `pathname === prefix || pathname.startsWith(prefix + '/')`,
      // so the registered prefix must omit the trailing slash (otherwise DSH checks `//`).
      disposers.push(
        ctx.webServer.register({
          kind: 'prefix',
          path: ASSET_PREFIX.replace(/\/+$/, ''),
          handler: assetHandler,
        }),
      );
      disposers.push(ctx.webServer.register({ kind: 'exact', path: MERMAID_PATH, handler: mermaidHandler }));
      disposers.push(ctx.webServer.register({ kind: 'exact', path: MATH_PATH, handler: mathHandler }));
      disposers.push(ctx.webServer.register({ kind: 'exact', path: DARKMODE_PATH, handler: darkmodeHandler }));
      disposers.push(ctx.webServer.register({ kind: 'exact', path: AI_ROUTE_PATH, handler: aiHandler }));
    } catch (error) {
      void rollback();
      throw error;
    }
    return rollback;
  });
}
