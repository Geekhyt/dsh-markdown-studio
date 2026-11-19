import type * as ReactNamespace from 'react';
import { createClientPlugin } from './app';
import type { ClientPlugin } from './types/dsh';
import type { DshPrimitivesModule } from './types/dsh-primitives';

export function create(React: typeof ReactNamespace, primitives?: DshPrimitivesModule | null): ClientPlugin {
  return createClientPlugin(React, primitives);
}
