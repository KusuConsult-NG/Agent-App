/**
 * TIN service selection (PRD §11, §82).
 *
 * `TIN_SERVICE` chooses the adapter; `mock` is development only and `config.ts`
 * refuses to boot in production with it selected. Any other value uses the
 * configurable HTTP adapter and becomes the service's name in the record.
 */

import { config } from '../../config';
import { HttpTinService } from './http';
import { MockTinService } from './mock';
import type { TinService } from './types';

export * from './types';
export { HttpTinService } from './http';
export { MockTinService } from './mock';

function selectTinService(): TinService {
  if (config.integrations.tinService === 'mock') return new MockTinService();
  return new HttpTinService();
}

export const tinService: TinService = selectTinService();
