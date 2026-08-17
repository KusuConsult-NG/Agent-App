/**
 * Vehicle registry selection (PRD §21, §82).
 *
 * `VEHICLE_REGISTRY` chooses the adapter; `mock` is development only and
 * `config.ts` refuses to boot in production with it selected. Any other value
 * uses the configurable HTTP adapter and becomes the registry's name in the
 * vehicle record, so a captured vehicle says which authority confirmed it.
 */

import { config } from '../../config';
import { HttpVehicleRegistry } from './http';
import { MockVehicleRegistry } from './mock';
import type { VehicleRegistry } from './types';

export * from './types';
export { HttpVehicleRegistry } from './http';
export { MockVehicleRegistry } from './mock';

function selectVehicleRegistry(): VehicleRegistry {
  if (config.integrations.vehicleRegistry === 'mock') return new MockVehicleRegistry();
  return new HttpVehicleRegistry();
}

export const vehicleRegistry: VehicleRegistry = selectVehicleRegistry();
