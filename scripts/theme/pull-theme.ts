import { createLogger } from '../utils/logger.js'

const logger = createLogger('theme-pull')

logger.info('Theme pull is intentionally documented instead of executed by this script.', {
  reason: 'Shopify theme CLI authentication and theme selection should be explicit.',
  command: 'shopify theme pull --store babymood.bg --theme <HORIZON_THEME_ID> --path theme',
  note: 'Run this only after installing and authenticating Shopify CLI.'
})
