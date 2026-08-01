/**
 * Central branding configuration. Server components read from env via
 * getEnv(); this module exposes only non-secret, display-safe values.
 */
import { getEnv } from "./env";

export interface Branding {
  appName: string;
  logo: string;
  favicon: string;
  supportEmail: string;
  matrixHomeserver: string;
  matrixServerName: string;
}

export function getBranding(): Branding {
  const env = getEnv();
  return {
    appName: env.APP_NAME,
    logo: env.APP_LOGO,
    favicon: env.APP_FAVICON,
    supportEmail: env.SUPPORT_EMAIL,
    matrixHomeserver: env.MATRIX_HOMESERVER,
    matrixServerName: env.MATRIX_SERVER_NAME,
  };
}
