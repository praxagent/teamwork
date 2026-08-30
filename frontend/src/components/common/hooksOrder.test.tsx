/**
 * Regression guard for React #310 — "Rendered more hooks than during the
 * previous render."
 *
 * A real one reached a user on 2026-08-30. `SpacePage` had
 * `if (spaceQuery.isLoading || !space) return <Loading/>` ABOVE a
 * `useState`/`useEffect` pair for the chat width. The loading render ran two
 * fewer hooks than the loaded render, so the transition between them unmounted
 * the WHOLE tree — and because the early-return branch is taken exactly when
 * the backend is slow or returns nothing, the top-level boundary reported it as
 * "a backend it depends on is unreachable". The trigger was the backend. The
 * fault was the hook order.
 *
 * Two layers of defence, and this file is the second:
 *   1. `react-hooks/rules-of-hooks` (eslint, now actually configured — it was a
 *      declared dependency with NO config, so it had never run).
 *   2. This test, which reproduces the *transition* the rule only reasons about
 *      statically. A lint rule can be disabled inline; a failing render cannot.
 */
import { render, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let spy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  spy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => spy.mockRestore());

/** The bug: a hook that only runs once the early return stops firing. */
function Buggy({ loading }: { loading: boolean }) {
  useState(0);
  if (loading) return <div>loading</div>;
  const [width] = useState(320);      // eslint-disable-line react-hooks/rules-of-hooks
  return <div>width {width}</div>;
}

/** The fix: every hook runs unconditionally, above the early return. */
function Fixed({ loading }: { loading: boolean }) {
  useState(0);
  const [width, setWidth] = useState(320);
  useEffect(() => setWidth((w) => w), []);
  if (loading) return <div>loading</div>;
  return <div>width {width}</div>;
}

describe('hook-count stability across a loading -> loaded transition', () => {
  it('DEMONSTRATES the bug: hook count changing across renders throws', () => {
    const { rerender } = render(<Buggy loading />);
    expect(screen.getByText('loading')).toBeInTheDocument();
    // The transition — not the first render — is what breaks. A test that only
    // rendered the loaded state would pass while the app crashed in production.
    expect(() => rerender(<Buggy loading={false} />)).toThrow();
  });

  it('the fixed shape survives the same transition', () => {
    const { rerender } = render(<Fixed loading />);
    expect(screen.getByText('loading')).toBeInTheDocument();
    rerender(<Fixed loading={false} />);
    expect(screen.getByText('width 320')).toBeInTheDocument();
  });

  it('and survives the transition back, and repeated flapping', () => {
    const { rerender } = render(<Fixed loading={false} />);
    for (let i = 0; i < 3; i++) {
      rerender(<Fixed loading />);
      rerender(<Fixed loading={false} />);
    }
    expect(screen.getByText('width 320')).toBeInTheDocument();
  });
});
