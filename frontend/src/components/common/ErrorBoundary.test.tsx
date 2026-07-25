/**
 * The boundary that turns a crash into a broken widget.
 *
 * Written after a real outage: `/prax/model` came back without `current_model`
 * (PRAX_URL was unset), a `.split()` on it threw, and — with no boundary
 * anywhere in the app — React unmounted the entire tree. The user saw a blank
 * white page and no clue that only the model picker was at fault.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { ErrorBoundary } from './ErrorBoundary';

function Boom({ shouldThrow = true }: { shouldThrow?: boolean }) {
  if (shouldThrow) throw new Error('kaboom');
  return <div>recovered</div>;
}

// React logs caught errors to console.error; silence it so the suite output
// stays readable, but assert we still report through it (below).
let spy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  spy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => spy.mockRestore());

describe('ErrorBoundary', () => {
  it('renders children when nothing throws', () => {
    render(
      <ErrorBoundary name="Panel">
        <div>all good</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText('all good')).toBeInTheDocument();
  });

  it('catches a render error instead of unmounting the tree', () => {
    render(
      <ErrorBoundary name="Desktop">
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Desktop couldn’t load/)).toBeInTheDocument();
  });

  it('names the failing section so the user knows what broke', () => {
    render(
      <ErrorBoundary name="Scheduler">
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText(/Scheduler couldn’t load/)).toBeInTheDocument();
  });

  it('surfaces the error message rather than hiding it', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText('kaboom')).toBeInTheDocument();
  });

  it('still reports to the console so debugging is not harder', () => {
    render(
      <ErrorBoundary name="X">
        <Boom />
      </ErrorBoundary>,
    );
    expect(spy).toHaveBeenCalled();
  });

  it('isolates the failure — siblings keep rendering', () => {
    // The whole point: chat must survive a panel blowing up.
    render(
      <div>
        <ErrorBoundary name="Broken panel">
          <Boom />
        </ErrorBoundary>
        <div>chat still here</div>
      </div>,
    );
    expect(screen.getByText('chat still here')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('recovers via Try again once the cause is gone', () => {
    function Wrapper() {
      return (
        <ErrorBoundary name="Panel">
          <Boom shouldThrow={false} />
        </ErrorBoundary>
      );
    }
    const { rerender } = render(
      <ErrorBoundary name="Panel">
        <Boom />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    rerender(<Wrapper />);
    expect(screen.getByText('recovered')).toBeInTheDocument();
  });

  it('resets when resetKeys change, so switching channels un-sticks it', () => {
    const { rerender } = render(
      <ErrorBoundary name="Panel" resetKeys={['channel-a']}>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    rerender(
      <ErrorBoundary name="Panel" resetKeys={['channel-b']}>
        <Boom shouldThrow={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('recovered')).toBeInTheDocument();
  });

  it('honours a custom fallback', () => {
    render(
      <ErrorBoundary fallback={<span>custom</span>}>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText('custom')).toBeInTheDocument();
  });
});
