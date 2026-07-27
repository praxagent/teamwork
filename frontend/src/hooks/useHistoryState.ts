/**
 * Make an in-app view selection participate in browser history.
 *
 * The workspace persisted which panel you were on to localStorage, which
 * survives a reload but is invisible to the browser: there was exactly one
 * history entry for `/project/:id`, so Back left the app entirely and dumped
 * you on the project picker — from six panels deep, with no way back except
 * navigating in again.
 *
 * On a phone Back is the primary way people move, so "Back leaves the app" is
 * not a small annoyance; it is the app losing an argument with the platform.
 *
 * Each selection pushes an entry carrying its value, and a popstate restores
 * it. Deliberately NOT put in the URL: these are panel toggles rather than
 * addressable locations, and inventing a query-param vocabulary for every one
 * would commit us to URLs we would then have to keep working. History entries
 * give the Back behaviour without that promise.
 */
import { useEffect, useRef } from 'react';

export function useHistoryState<T extends string | null>(
  key: string,
  value: T,
  restore: (value: T) => void,
) {
  // Set while WE are applying a popstate, so the resulting value change does
  // not push a new entry — that would rebuild the stack as fast as you unwound
  // it, and Back would appear to do nothing.
  const applying = useRef(false);
  const previous = useRef<T | null>(null);
  const restoreRef = useRef(restore);
  restoreRef.current = restore;

  useEffect(() => {
    if (previous.current === null) {
      // First render: record where we started without pushing. Replacing keeps
      // the current entry meaningful so the first Back has somewhere to land.
      previous.current = value;
      window.history.replaceState(
        { ...(window.history.state || {}), [key]: value }, '',
      );
      return;
    }
    if (applying.current || previous.current === value) return;

    previous.current = value;
    window.history.pushState({ ...(window.history.state || {}), [key]: value }, '');
  }, [key, value]);

  useEffect(() => {
    const onPop = (event: PopStateEvent) => {
      const next = event.state?.[key];
      if (next === undefined || next === previous.current) return;
      applying.current = true;
      previous.current = next;
      restoreRef.current(next);
      // Released after the state update has been applied, so the effect above
      // sees `applying` still set and stays quiet.
      requestAnimationFrame(() => { applying.current = false; });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [key]);
}
