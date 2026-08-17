/**
 * Minimal hash router.
 *
 * Hash routing rather than the History API so the installed PWA and any static
 * host serve every route from one file, with no server rewrite rules to get
 * wrong. The dependency footprint also stays small, which matters on the
 * low-bandwidth connections PRD §55 calls out.
 */

import { useCallback, useEffect, useState } from 'react';

export function useRoute(): [string, (path: string) => void] {
  const [route, setRoute] = useState(() => window.location.hash.slice(1) || '/');

  useEffect(() => {
    const onChange = () => setRoute(window.location.hash.slice(1) || '/');
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const navigate = useCallback((path: string) => {
    window.location.hash = path;
    window.scrollTo(0, 0);
  }, []);

  return [route, navigate];
}

/** Match `/collect/:id` style patterns, returning captured segments. */
export function matchRoute(route: string, pattern: string): Record<string, string> | null {
  const routeParts = route.split('?')[0]!.split('/').filter(Boolean);
  const patternParts = pattern.split('/').filter(Boolean);
  if (routeParts.length !== patternParts.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i += 1) {
    const patternPart = patternParts[i]!;
    const routePart = routeParts[i]!;
    if (patternPart.startsWith(':')) {
      params[patternPart.slice(1)] = decodeURIComponent(routePart);
    } else if (patternPart !== routePart) {
      return null;
    }
  }
  return params;
}

export function queryParams(route: string): URLSearchParams {
  const index = route.indexOf('?');
  return new URLSearchParams(index === -1 ? '' : route.slice(index + 1));
}
