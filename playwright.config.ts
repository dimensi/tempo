import { productionConfig } from './tests/ci/production-config';
const config = {
  ...productionConfig('general', ['e2e/*.spec.ts']),
  testIgnore: ['**/offline.spec.ts'],
};
export default config;
