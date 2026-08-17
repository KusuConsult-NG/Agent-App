/**
 * Request validation (PRD §54 "Request validation, Input sanitization").
 *
 * Every handler receives a parsed, typed value — never `req.body` directly.
 * Anything not in the schema is stripped, so an unexpected field cannot reach
 * a SQL parameter list or a JSONB column.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z, ZodError, type ZodTypeAny } from 'zod';
import { validationFailed } from '../lib/errors';

/**
 * A request whose route parameters are single strings.
 *
 * Express 5 types a parameter as `string | string[]`, because its router can
 * produce an array for a repeated or wildcard segment (`:id+`, `*path`). This
 * API declares no such route — every parameter is a plain `:name`, and a
 * repeated one would be meaningless here: an id, a token or a code is exactly
 * one value.
 *
 * Declaring it once on the wrappers below is what keeps that out of sixty call
 * sites. It is a claim about the routes rather than a convenience, so
 * `routes.test.ts` asserts it by scanning every route path for wildcard syntax
 * — if someone adds one, that test fails rather than this type quietly
 * becoming a lie.
 */
export type RouteRequest = Request<Record<string, string>>;

/**
 * The single place that assertion is made.
 *
 * One cast, here, guarded by the route-path test — rather than sixty casts
 * spread through the route files, each of which would have to be re-justified
 * if a wildcard route were ever added.
 */
function asRouteRequest(req: Request): RouteRequest {
  return req as unknown as RouteRequest;
}

export function validateBody<T extends ZodTypeAny>(
  schema: T,
  handler: (req: RouteRequest, res: Response, data: z.infer<T>) => Promise<void> | void,
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = schema.parse(req.body ?? {});
      await handler(asRouteRequest(req), res, parsed);
    } catch (error) {
      if (error instanceof ZodError) {
        return next(
          validationFailed(
            error.issues.map((issue) => ({
              field: issue.path.join('.') || undefined,
              issue: issue.message,
            })),
          ),
        );
      }
      next(error);
    }
  };
}

export function validateQuery<T extends ZodTypeAny>(
  schema: T,
  handler: (req: RouteRequest, res: Response, data: z.infer<T>) => Promise<void> | void,
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = schema.parse(req.query ?? {});
      await handler(asRouteRequest(req), res, parsed);
    } catch (error) {
      if (error instanceof ZodError) {
        return next(
          validationFailed(
            error.issues.map((issue) => ({
              field: issue.path.join('.') || undefined,
              issue: issue.message,
            })),
          ),
        );
      }
      next(error);
    }
  };
}

/** Wrap an async handler so rejections reach the error middleware. */
export function asyncHandler(
  handler: (req: RouteRequest, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    handler(asRouteRequest(req), res, next).catch(next);
  };
}

// ---------------------------------------------------------------------------
// Shared field schemas
// ---------------------------------------------------------------------------

/** Nigerian mobile numbers, normalised to +234XXXXXXXXXX. */
export const phoneSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s-()]/g, ''))
  .refine(
    (value) => /^(?:\+?234|0)[789]\d{9}$/.test(value),
    'Enter a valid Nigerian phone number, for example 08012345678',
  )
  .transform((value) => {
    if (value.startsWith('+234')) return value;
    if (value.startsWith('234')) return `+${value}`;
    return `+234${value.slice(1)}`;
  });

export const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address');

export const uuidSchema = z.string().uuid('Not a valid identifier');

/**
 * Money on the wire: a whole number of kobo as a string.
 * Rejecting JSON numbers here is deliberate (see money.ts).
 */
export const koboSchema = z
  .union([z.string(), z.number()])
  .transform((value, ctx) => {
    const text = typeof value === 'number' ? String(value) : value.trim();
    if (!/^\d+$/.test(text)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Amount must be a whole number of kobo (100 kobo = ₦1)',
      });
      return z.NEVER;
    }
    return BigInt(text);
  });

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

export const dateRangeSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

/** Coordinates captured during a field transaction (PRD §33). */
export const geoSchema = z.object({
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});
