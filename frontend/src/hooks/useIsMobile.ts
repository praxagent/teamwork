import { useEffect, useState } from 'react';

/**
 * Reactive media-query hook for the mobile breakpoint.
 *
 * Tailwind's `md:` breakpoint kicks in at 768px, so we mirror that here.
 * Used by panels that need to switch layout (e.g. side-by-side chat
 * sidebar on desktop → overlay on mobile) — Tailwind classes alone can't
 * express it when the wrapping component sets pixel widths via inline
 * styles (which always beat CSS classes).
 */
export function useIsMobile(breakpointPx = 768): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window === 'undefined' ? false : window.innerWidth < breakpointPx,
  );

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpointPx - 1}px)`);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    setIsMobile(mql.matches);
    if (mql.addEventListener) {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }
    // Safari < 14 fallback
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, [breakpointPx]);

  return isMobile;
}
