/**
 * A boundary around the whole app.
 *
 * Without one, a single component reading a field off an undefined object takes
 * the entire page to black — no message, no stack, nothing for a player to
 * report. That happened here for real: an unknown wallet's login reply was a
 * three-field object rather than a player, the header read `inventory.rune` off
 * it, and the first thing anyone would ever have seen was an empty screen.
 *
 * The process contract was fixed so that cannot happen again, but the class of
 * failure is not worth being one bug away from.
 */
import { Component, ErrorInfo, ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Rune Realm crashed:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-full items-center justify-center p-6">
        <div className="panel w-full max-w-lg p-6">
          <h1 className="text-lg font-semibold">Something broke</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            The page hit an error it could not recover from. Reloading usually
            fixes it; if it does not, the message below is the useful part.
          </p>
          <pre className="mt-4 max-h-56 overflow-auto rounded-[3px] border border-edge bg-void/50 p-3 font-mono text-[11px] leading-relaxed text-bad">
            {error.message}
          </pre>
          <div className="mt-5 flex gap-2">
            <button
              onClick={() => window.location.reload()}
              className="inline-flex h-10 items-center rounded-[3px] bg-element px-4 text-sm font-semibold text-void"
            >
              Reload
            </button>
            <button
              onClick={() => navigator.clipboard.writeText(
                `${error.message}\n\n${error.stack ?? ''}`,
              )}
              className="inline-flex h-10 items-center rounded-[3px] border border-edge px-4 text-sm text-muted"
            >
              Copy details
            </button>
          </div>
        </div>
      </div>
    );
  }
}
