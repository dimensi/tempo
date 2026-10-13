import { productionConfig } from './production-config';
const config = productionConfig('general', [
  'e2e/foundation.spec.ts',
  'e2e/analytics.spec.ts',
  'e2e/reports-persisted.spec.ts',
]);
const foundation =
  'owner shell, all pages, theme persistence, mobile overflow and logout';
config.projects = config.projects!.map((project) => ({
  ...project,
  grep: new RegExp(
    project.name === 'desktop'
      ? `${foundation}|scoped analytics API, coverage, controls|persisted diary and private photo PDF API`
      : foundation,
  ),
}));
export default config;
