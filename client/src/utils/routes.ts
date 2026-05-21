import { matchPath } from 'react-router-dom';

const matchesRouteStart = (pathname: string, pattern: string) =>
  matchPath({ path: pattern, end: false }, pathname) != null;

export const isArtifactRoute = (pathname: string) =>
  matchesRouteStart(pathname, '/c/*') ||
  matchesRouteStart(pathname, '/projects/:projectId/c/*') ||
  matchesRouteStart(pathname, '/share/*');

export const isChatRoute = (pathname: string) =>
  matchesRouteStart(pathname, '/c/*') ||
  matchesRouteStart(pathname, '/projects/:projectId/c/*');
