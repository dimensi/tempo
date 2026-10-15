const navigationPaths = new Set([
  '/',
  '/diary',
  '/analytics',
  '/anamnesis',
  '/measurements',
  '/workouts',
  '/workouts/catalog',
  '/settings',
  '/reports',
  '/offline/index.html',
]);

/** Public shell fallback is restricted to the application's known read routes. */
export function isOfflineNavigationPath(pathname: string) {
  return (
    navigationPaths.has(pathname) ||
    /^\/anamnesis\/(?:markers|documents)\/[^/]+$/.test(pathname) ||
    /^\/workouts\/(?:plans\/[A-Za-z0-9_%~-]+\/(?:workouts\/[A-Za-z0-9_%~-]+(?:\/results)?|edit)|sessions\/[A-Za-z0-9_%~-]+(?:\/edit)?|native\/[1-9][0-9]*|links\/[A-Za-z0-9_%~-]+|new)$/.test(
      pathname,
    )
  );
}
