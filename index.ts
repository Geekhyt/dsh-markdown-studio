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
import { MATH_PATH, mathRoute } from './host/http/math-route';
import { MERMAID_PATH, mermaidRoute } from './host/http/mermaid-route';
import { ASSET_PREFIX, createAssetRoute, createImageRoute, ROUTE_PATH } from './host/http/routes';
import { startLocalImageServer } from './host/local-server';
import type { HostContext } from './src/types/dsh';

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
  const apiHandler = createImageRoute({ service });
  const assetHandler = createAssetRoute({ service });
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
  const aiHandler = createAiRoute({ service: aiService });

  ctx.effect(function () {
    const disposers: Array<() => void> = [];
    const rollback = (): void => {
      while (disposers.length) {
        try {
          disposers.pop()?.();
        } catch {
          /* best effort */
        }
      }
    };
    const abort = new AbortController();
    const localServer = startLocalImageServer({ service, signal: abort.signal });
    disposers.push(function () {
      abort.abort();
      localServer
        .then(function (result) {
          if (result && typeof result.stop === 'function') result.stop();
        })
        .catch(function () {
          /* best effort */
        });
    });
    try {
      disposers.push(ctx.webServer.register({ kind: 'exact', path: ROUTE_PATH, handler: apiHandler }));
      disposers.push(ctx.webServer.register({ kind: 'prefix', path: ASSET_PREFIX, handler: assetHandler }));
      disposers.push(ctx.webServer.register({ kind: 'exact', path: MERMAID_PATH, handler: mermaidRoute }));
      disposers.push(ctx.webServer.register({ kind: 'exact', path: MATH_PATH, handler: mathRoute }));
      disposers.push(ctx.webServer.register({ kind: 'exact', path: AI_ROUTE_PATH, handler: aiHandler }));
    } catch (error) {
      rollback();
      throw error;
    }
    return rollback;
  });
}
