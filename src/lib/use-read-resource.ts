'use client';
import { useEffect, useRef } from 'react';
import { canonicalReadKey, clientReads } from './client-read';
/** Hydration and fresh responses update the existing view; its editor state is never involved. */
export function useReadResource<T>(
  href: string | undefined,
  parse: (value: unknown) => T,
  accept: (data: T) => void,
) {
  const handlers = useRef({ parse, accept });
  useEffect(() => {
    handlers.current = { parse, accept };
  }, [parse, accept]);
  useEffect(() => {
    if (!href) return;
    const key = canonicalReadKey(new URL(href, location.origin));
    let previous: string | undefined;
    let active = true;
    const changed = () => {
      const body = clientReads.snapshot(key).data;
      if (!active || body === undefined || body === previous) return;
      try {
        const value = handlers.current.parse(JSON.parse(body));
        previous = body;
        handlers.current.accept(value);
      } catch {
        /* An incompatible copy never reaches the screen. */
      }
    };
    const stop = clientReads.subscribe(key, changed);
    void clientReads.restore(key).then(changed);
    return () => {
      active = false;
      stop();
    };
  }, [href]);
}
