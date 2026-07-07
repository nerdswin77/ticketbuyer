import { useCallback, useRef } from 'react';

/** A function identity that never changes but always calls the latest implementation. Lets memoised children skip re-renders. */
export function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...args: A) => ref.current(...args), []);
}
