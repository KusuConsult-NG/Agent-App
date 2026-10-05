/**
 * The revenue items a vehicle renewal is charged under, and nothing else is.
 *
 * One definition for both directions. The renewal flow (`initiateRenewal`)
 * took any item it was given, so a vehicle's papers could be renewed for the
 * price of a market levy. And the general charge route would charge these
 * items, with no vehicle checked, no renewal recorded and no papers to follow;
 * the collect screen could not reach them only because it sent no inputs for a
 * formula item, until it was made to ask for them.
 *
 * A module of its own because both `services/vehicles.ts` and
 * `services/revenue.ts` need it, and the first already imports the second.
 */
export const VEHICLE_RENEWAL_ITEM_CODES: readonly string[] = ['VEH-RENEW-PRIVATE', 'VEH-RENEW-COMMERCIAL'];
