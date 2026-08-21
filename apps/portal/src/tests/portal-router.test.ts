/**
 * Portal Hash Router & RBAC Navigation Tests.
 */

import { describe, it, expect } from 'vitest';
import { matchRoute, queryParams } from '../router';
import { roleHasPermission, type Role, type Permission } from '@psirs/shared';

describe('Portal Hash Router', () => {
  it('matches static routes accurately', () => {
    expect(matchRoute('/', '/')).toEqual({});
    expect(matchRoute('/finance', '/finance')).toEqual({});
    expect(matchRoute('/configuration', '/configuration')).toEqual({});
    expect(matchRoute('/oversight', '/oversight')).toEqual({});
    expect(matchRoute('/finance', '/oversight')).toBeNull();
  });

  it('extracts dynamic parameters from route patterns', () => {
    const params = matchRoute('/agents/00000000-0000-0000-0000-000000000001', '/agents/:id');
    expect(params).toEqual({ id: '00000000-0000-0000-0000-000000000001' });

    const verifyParams = matchRoute('/verify/T7C72-QTUDN', '/verify/:code');
    expect(verifyParams).toEqual({ code: 'T7C72-QTUDN' });
  });

  it('parses URL query parameters correctly', () => {
    const query = queryParams('/transactions?lgaId=PL-JOSN&status=PAID');
    expect(query.get('lgaId')).toBe('PL-JOSN');
    expect(query.get('status')).toBe('PAID');
  });
});

describe('Portal RBAC Role & Permission Gates', () => {
  it('allows administrator to configure catalogue and manage agents', () => {
    expect(roleHasPermission('admin', 'catalogue:configure')).toBe(true);
    expect(roleHasPermission('admin', 'agent:suspend')).toBe(true);
  });

  it('allows finance officer to reconcile and disburse, but blocks catalogue reconfiguration', () => {
    expect(roleHasPermission('finance_officer', 'payment:reconcile')).toBe(true);
    expect(roleHasPermission('finance_officer', 'commission:payout:approve')).toBe(true);
    expect(roleHasPermission('finance_officer', 'catalogue:configure')).toBe(false);
  });

  it('allows auditor read-only audit logs access', () => {
    expect(roleHasPermission('auditor', 'audit:read')).toBe(true);
    expect(roleHasPermission('auditor', 'agent:suspend')).toBe(false);
    expect(roleHasPermission('auditor', 'commission:payout:approve')).toBe(false);
  });
});
