// Fires one screen_view per route change (backlog #113).
//
// The app uses declarative <Routes>, not a data router, so useMatches() is not
// available — matchPath against the taxonomy's ordered pattern list is the
// explicit, testable equivalent. Storing the PATTERN rather than the path is
// the point: raw paths are unbounded cardinality.
import { useEffect } from 'react';
import { useLocation, matchPath } from 'react-router-dom';
import taxonomy from '../utils/usageTaxonomy.json';
import { track } from '../utils/usage';

export function resolveScreen(pathname) {
  for (const pattern of taxonomy.screens) {
    const match = matchPath(pattern, pathname);
    if (match) return { screen: pattern, params: match.params || {} };
  }
  return null;
}

export default function useScreenView() {
  const { pathname } = useLocation();

  useEffect(() => {
    const hit = resolveScreen(pathname);
    if (!hit) return;
    // track() is itself a no-op when there is no fsa_user in localStorage —
    // the same signal ProtectedRoute uses — so public routes stay untracked.
    track('screen_view', { screen: hit.screen, props: hit.params });
  }, [pathname]);
}
