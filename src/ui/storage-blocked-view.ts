import type * as ReactNamespace from 'react';
import type { ReactNode } from 'react';
import { type LibraryStorageError, rawLibrarySnapshot } from '../adapters/storage';
import { CHROME_CSS } from './styles';
import type { UiKit } from './ui-kit';

export interface StorageBlockedViewProps {
  React: typeof ReactNamespace;
  t: (key: string) => string;
  ui: UiKit;
  error: LibraryStorageError;
}

export function StorageBlockedView(props: StorageBlockedViewProps): ReactNode {
  const { React, t, ui: uiKit, error } = props;
  const h = React.createElement;
  const [exportFailed, setExportFailed] = React.useState(false);

  function exportOriginal(): void {
    try {
      const url = URL.createObjectURL(new Blob([rawLibrarySnapshot()], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'mdstudio-original-storage.json';
      document.body.appendChild(anchor);
      anchor.click();
      window.setTimeout(function () {
        anchor.remove();
        URL.revokeObjectURL(url);
      }, 800);
    } catch {
      setExportFailed(true);
    }
  }

  return h(
    'div',
    { className: 'mdstudio-root mdstudio-error-boundary', role: 'alert' },
    h('style', { 'data-plugin': 'dsh-markdown-studio' }, CHROME_CSS),
    h(
      'div',
      { className: 'mdstudio-error-card' },
      h('strong', null, t('storage.blocked')),
      h('p', null, t(error.reason === 'unsupported' ? 'storage.unsupported' : 'storage.corrupt')),
      h(uiKit.Button, { variant: 'primary', onClick: exportOriginal }, t('storage.exportOriginal')),
      exportFailed ? h('p', null, t('storage.exportFailed')) : null,
    ),
  );
}
