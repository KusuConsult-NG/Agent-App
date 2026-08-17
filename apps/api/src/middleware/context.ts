/**
 * Per-request context: a correlation id, the caller's IP, device and app
 * version. The request id is echoed on every response and written into audit
 * entries, so a support ticket quoting one reference can be traced end to end.
 */

import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Role, Permission } from '@psirs/shared';

export interface AuthContext {
  userId: string;
  role: Role;
  sessionId: string;
  permissions: readonly Permission[];
  agentId?: string;
  deviceId?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      clientIp: string | null;
      deviceIdentifier: string | null;
      appVersion: string | null;
      auth?: AuthContext;
      rawBody?: Buffer;
    }
  }
}

export function requestContext(req: Request, res: Response, next: NextFunction): void {
  req.requestId = (req.header('x-request-id') ?? randomUUID()).slice(0, 64);
  req.clientIp = req.ip ?? req.socket.remoteAddress ?? null;
  req.deviceIdentifier = req.header('x-device-id')?.slice(0, 128) ?? null;
  req.appVersion = req.header('x-app-version')?.slice(0, 32) ?? null;
  res.setHeader('x-request-id', req.requestId);
  next();
}
