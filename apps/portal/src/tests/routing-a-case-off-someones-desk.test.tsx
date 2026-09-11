/**
 * Moving a case must not quietly take it off the assignee's desk.
 *
 * `/cases/:id/assign` moves three things at once — assignee, department by
 * role, department by row — and only the two department fields are guarded:
 * the service reads `undefined` as "leave alone" for those, while
 * `assignee_id` is written from the body unconditionally and the route schema
 * requires the field. So the panel's assignee picker is not a filter over the
 * change, it *is* the assignee after the button is pressed.
 *
 * The picker was seeded empty. `department` and `departmentId` were both
 * seeded from the case, which is what makes this a slip rather than a design:
 * an administrator opening the panel to route a case from Audit to Finance
 * sent `assigneeId: null` along with the routing, and the officer who had been
 * working it was silently removed. The case then sat in a department queue
 * belonging to nobody, and the only trace was an audit row nobody reads until
 * something has already gone wrong.
 *
 * Two halves, and both are needed. The panel has to open showing who holds the
 * case — otherwise it lies about the state it is about to write — and pressing
 * Move case without touching the assignee has to leave the assignee alone.
 * Choosing "Nobody yet" deliberately must still unassign, or the fix has
 * replaced a silent clear with an impossible one.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { CasesScreen } from '../screens/Cases';
import { api } from '../lib/api';
import * as apiModule from '../lib/api';
import { permissionsForRole, type Role } from '@psirs/shared';

function signInAs(role: Role) {
  apiModule.setSession(null);
  sessionStorage.setItem(
    'psirs.portal.user',
    JSON.stringify({
      id: 'u1',
      phone: '+2348000000001',
      fullName: 'Admin Dung',
      role,
      permissions: permissionsForRole(role),
    }),
  );
}

const user = (role: Role) =>
  ({
    id: 'u1',
    phone: '+2348000000001',
    fullName: 'Admin Dung',
    email: null,
    role,
    permissions: permissionsForRole(role),
  }) as never;

const ASSIGNEE = 'u9000000-0000-4000-8000-000000000009';
const AUDIT = 'dd000000-0000-4000-8000-00000000000a';
const FINANCE = 'dd000000-0000-4000-8000-00000000000b';

const CASE = {
  id: 'cc000000-0000-4000-8000-000000000042',
  case_number: 'CASE-2026-000042',
  subject: 'Receipt raised against a reversed payment',
  description: 'The receipt is on file and the payment is not.',
  category: 'REVENUE_ANOMALY',
  status: 'INVESTIGATING',
  priority: 'HIGH',
  risk_level: 'HIGH',
  department: 'auditor',
  department_id: AUDIT,
  due_at: null,
  created_at: '2026-09-01T09:00:00.000Z',
  overdue: false,
  assignee_id: ASSIGNEE,
  assignee_name: 'Auditor Ngo',
  opened_by_name: 'Revenue Ladi',
  transaction_reference: null,
  transaction_id: null,
  transaction_amount_kobo: null,
  transaction_status: null,
  agent_code: null,
  agent_name: null,
  taxpayer_name: null,
  tin: null,
  lga_name: null,
  subject_user_name: null,
  resolution: null,
  resolved_by_name: null,
  comment_count: '0',
  evidence_count: '0',
  may_work: true,
  attachable: [],
  events: [
    {
      id: 'e1',
      sequence_no: '1',
      kind: 'OPENED',
      body: 'The receipt is on file and the payment is not.',
      old_value: null,
      new_value: null,
      created_at: '2026-09-01T09:00:00.000Z',
      actor_name: 'Revenue Ladi',
      actor_role: 'revenue_officer',
      mention_names: [],
    },
  ],
};

const OFFICERS = [
  { id: ASSIGNEE, full_name: 'Auditor Ngo', role: 'auditor' },
  { id: 'u9000000-0000-4000-8000-00000000000f', full_name: 'Finance Bala', role: 'finance_officer' },
];

const DEPARTMENTS = [
  { id: AUDIT, name: 'Internal Audit', status: 'ACTIVE' },
  { id: FINANCE, name: 'Finance North', status: 'ACTIVE' },
];

/**
 * Dispatch by path, because the panel's three reads are not interchangeable.
 *
 * A single `mockResolvedValue` would hand the case body to the officer list,
 * `officers.length` would be undefined, the picker would never render, and the
 * test would report on a screen the officer never sees.
 */
function serve() {
  return vi.spyOn(api, 'get').mockImplementation((async (path: string) => {
    if (path.startsWith('/government/users')) return OFFICERS;
    if (path.startsWith('/government/departments')) return DEPARTMENTS;
    return CASE;
  }) as never);
}

async function openTheCase() {
  render(
    <CasesScreen user={user('admin')} route={`/cases?case=${CASE.id}`} navigate={vi.fn()} />,
  );
  await waitFor(() => expect(screen.getByText(/CASE-2026-000042/)).toBeTruthy());
  // The picker only exists once the officer list has arrived.
  await waitFor(() => expect(screen.getByLabelText('Assign to')).toBeTruthy());
}

beforeEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('moving a case', () => {
  it('opens showing the officer who actually holds it', async () => {
    signInAs('admin');
    serve();
    await openTheCase();

    expect((screen.getByLabelText('Assign to') as HTMLSelectElement).value).toBe(ASSIGNEE);
  });

  it('routes to another department without taking the case off its officer', async () => {
    signInAs('admin');
    serve();
    const post = vi.spyOn(api, 'post').mockResolvedValue(undefined as never);
    await openTheCase();

    fireEvent.change(screen.getByLabelText('Department'), { target: { value: FINANCE } });
    fireEvent.click(screen.getByRole('button', { name: 'Move this case' }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    const [path, body] = post.mock.calls[0]! as [string, Record<string, unknown>];
    expect(path).toBe(`/government/cases/${CASE.id}/assign`);
    expect(body.departmentId).toBe(FINANCE);
    // The whole point: the officer is still on it.
    expect(body.assigneeId).toBe(ASSIGNEE);
  });

  it('still unassigns when an officer chooses to', async () => {
    signInAs('admin');
    serve();
    const post = vi.spyOn(api, 'post').mockResolvedValue(undefined as never);
    await openTheCase();

    fireEvent.change(screen.getByLabelText('Assign to'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move this case' }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    const [, body] = post.mock.calls[0]! as [string, Record<string, unknown>];
    expect(body.assigneeId).toBeNull();
    // And nothing else moved on the way.
    expect(body.departmentId).toBe(AUDIT);
    expect(body.department).toBe('auditor');
  });
});
