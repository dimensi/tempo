import { productionConfig } from '../ci/production-config';
const config = {
  ...productionConfig('smoke', [
    'smoke/*.spec.ts',
    'e2e/offline.spec.ts',
    'offline/application.spec.ts',
  ]),
  grep: /production real login|account replacement clears the previous reader and notifies the other tab|two foreground tabs send one durable operation once after reconnect/,
};
export default config;
