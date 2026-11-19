import type * as ReactNamespace from 'react';
import type { ComponentType, ReactNode } from 'react';
import type { DshButtonProps } from '../types/dsh-primitives';

export interface ErrorBoundaryProps {
  t: (key: string) => string;
  children?: ReactNode;
}

export interface ErrorBoundaryOptions {
  Button?: ComponentType<DshButtonProps>;
  cssText?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
  generation: number;
}

function DefaultErrorButton(React: typeof ReactNamespace): ComponentType<DshButtonProps> {
  return function RawErrorButton(props: DshButtonProps) {
    const cls = props.variant === 'primary' ? 'mdstudio-btn is-primary' : 'mdstudio-btn';
    return React.createElement('button', { type: 'button', className: cls, onClick: props.onClick }, props.children);
  };
}

export function createErrorBoundary(React: typeof ReactNamespace, options?: ErrorBoundaryOptions) {
  const h = React.createElement;
  const ActionButton = options?.Button || DefaultErrorButton(React);
  const cssText = options?.cssText;

  class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
    state: ErrorBoundaryState = { error: null, generation: 0 };

    static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
      return { error };
    }

    componentDidCatch(error: Error, info: ReactNamespace.ErrorInfo): void {
      console.error('Markdown Studio render failed', error, info.componentStack);
    }

    retry = (): void => {
      this.setState(function (state) {
        return { error: null, generation: state.generation + 1 };
      });
    };

    render(): ReactNode {
      if (this.state.error) {
        return h(
          'div',
          { className: 'mdstudio-root mdstudio-error-boundary', role: 'alert' },
          cssText ? h('style', { 'data-plugin': 'dsh-markdown-studio' }, cssText) : null,
          h(
            'div',
            { className: 'mdstudio-error-card' },
            h('strong', null, this.props.t('error.title')),
            h('p', null, this.props.t('error.body')),
            h(
              'div',
              { className: 'mdstudio-error-actions' },
              h(ActionButton, { variant: 'primary', size: 'md', onClick: this.retry }, this.props.t('error.retry')),
              h(
                ActionButton,
                {
                  variant: 'outline',
                  size: 'md',
                  onClick: function () {
                    window.location.reload();
                  },
                },
                this.props.t('error.reload'),
              ),
            ),
          ),
        );
      }
      return h(React.Fragment, { key: this.state.generation }, this.props.children);
    }
  }

  return ErrorBoundary;
}

export type ErrorBoundaryComponent = ReturnType<typeof createErrorBoundary>;
