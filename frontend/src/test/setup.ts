import '@testing-library/jest-dom/vitest';

// jsdom has no matchMedia; several panels call it at module/mount time.
// A minimal stub — tests that care about a specific query can override it.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false, media: query, onchange: null,
      addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
