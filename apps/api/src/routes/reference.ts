/**
 * Public reference geography.
 *
 * Plateau's LGAs and wards are published public information, and both
 * front-ends need them before anyone has signed in — an agent applicant must
 * pick their LGA on the application form, and a taxpayer registering through
 * the citizen portal needs the same list. Putting this behind authentication
 * would make the application form impossible to complete.
 *
 * Nothing here identifies a person, so exposing it costs nothing; the endpoint
 * is still rate limited like every other public surface.
 */

import { Router } from 'express';
import { z } from 'zod';
import { pool, query } from '../db/pool';
import { rateLimit } from '../middleware/security';
import { asyncHandler, uuidSchema, validateQuery } from '../middleware/validate';

export const referenceRouter = Router();

referenceRouter.use(rateLimit({ max: 120, keyPrefix: 'reference', keyBy: 'ip' }));

referenceRouter.get(
  '/lgas',
  asyncHandler(async (_req, res) => {
    res.setHeader('cache-control', 'public, max-age=3600');
    res.json(
      await query(
        pool,
        `SELECT l.id, l.code, l.name, l.zone, l.headquarters,
                (SELECT count(*) FROM wards w WHERE w.lga_id = l.id) AS ward_count
           FROM lgas l WHERE l.status = 'ACTIVE'
          ORDER BY l.zone, l.name`,
      ),
    );
  }),
);

referenceRouter.get(
  '/wards',
  validateQuery(z.object({ lgaId: uuidSchema }), async (_req, res, data) => {
    res.setHeader('cache-control', 'public, max-age=3600');
    res.json(
      await query(pool, `SELECT id, code, name FROM wards WHERE lga_id = $1 ORDER BY name`, [
        data.lgaId,
      ]),
    );
  }),
);
