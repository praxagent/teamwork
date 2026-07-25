/**
 * Fault isolation for panels.
 *
 * TeamWork proxies a lot of its data from the agent backend (model info, memory,
 * scheduler, plugins, observability, library). Any of those can be unreachable
 * or return a shape the UI did not expect — and without a boundary, one bad
 * field takes down *everything*: React unmounts the whole tree and the user gets
 * a blank white page with no clue what happened.
 *
 * That is not hypothetical. A missing `PRAX_URL` meant `/prax/model` returned no
 * `current_model`; a `.split()` on it threw, and the entire app — chat included —
 * went white. The chat was fine. The model picker in the header was not.
 *
 * With a boundary, that becomes "this panel could not load" and everything else
 * keeps working.
 */
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Shown in the fallback so the user knows *which* part failed. */
  name?: string;
  /** Render something else entirely instead of the default card. */
  fallback?: ReactNode;
  /** Remount children when any of these change (e.g. the selected channel). */
  resetKeys?: unknown[];
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the stack in the console — the boundary must not make debugging
    // harder than the crash it replaces.
    console.error(`[ErrorBoundary${this.props.name ? `: ${this.props.name}` : ''}]`, error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    // A failure is usually specific to what was being rendered. When the caller
    // signals that changed, try again rather than stranding the user on an
    // error card until a full reload.
    if (!this.state.error || !this.props.resetKeys) return;
    const changed =
      prev.resetKeys?.length !== this.props.resetKeys.length ||
      this.props.resetKeys.some((k, i) => !Object.is(k, prev.resetKeys?.[i]));
    if (changed) this.setState({ error: null });
  }

  private reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;

    const label = this.props.name ?? 'This section';
    return (
      <div className="flex-1 flex items-center justify-center p-6" role="alert">
        <div className="max-w-md text-center">
          <AlertTriangle className="w-10 h-10 mx-auto mb-3 text-amber-500" />
          <p className="font-medium text-gray-700 dark:text-gray-200">{label} couldn’t load</p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            The rest of the app is still working. This usually means a backend it
            depends on is unreachable.
          </p>
          <p className="mt-2 text-xs font-mono text-gray-400 dark:text-gray-500 break-words">
            {error.message}
          </p>
          <button
            onClick={this.reset}
            className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md
                       bg-gray-100 hover:bg-gray-200 dark:bg-slate-700 dark:hover:bg-slate-600
                       text-gray-700 dark:text-gray-200"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Try again
          </button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
