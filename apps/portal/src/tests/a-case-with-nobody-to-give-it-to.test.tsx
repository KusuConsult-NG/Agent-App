/**
 * The assignee picker that disappeared, and two reasons it could.
 *
 * `CaseControls` drew both routing pickers on `length > 0`, which collapsed
 * three states into one screen.
 *
 *   The officer list is empty because this officer does not hold
 *   `user:manage`, so it was never fetched. Hiding the picker is right — the
 *   staff list is deliberately not published to every role.
 *
 *   The officer list is empty because the read failed. Hiding the picker then
 *   tells an ADMINISTRATOR, who can assign this case, that there is nobody to
 *   assign it to. Nothing on the screen says otherwise and there is nothing to
 *   press.
 *
 * The department list has only the second cause, since every portal role may
 * read it: "routing a case to Finance requires seeing that Finance exists."
 *
 * What it costs is not an inconvenience. A case that cannot be given to a
 * named officer gets routed by role instead, and role is the coarser
 * mechanism departments exist to replace — "routing by role could not tell
 * Finance North from Finance South." So the case lands on the wrong desk, or
 * on none, and the officer who did it had no way to know.
 *
 * Both pickers are unchanged when the lists arrive. What is new is that a
 * failed read says so, in the picker's place, with the read offered again.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { CasesScreen } from '../screens/Cases';
import { ApiRequestError, api } from '../lib/api';
import * as apiModule from '../lib/api';
import { getTranslation, permissionsForRole, type Role } from '@psirs/shared';

const en = getTranslation('en');

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

const REFUSED = new ApiRequestError(503, {
  code: 'UPSTREAM_UNAVAILABLE',
  message: 'That list could not be read just now.',
  moneyStatus: 'NOT_APPLICABLE',
});

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

/** Dispatch by path: the panel's three reads are not interchangeable. */
function serve(options: { officers?: 'ok' | 'fail'; departments?: 'ok' | 'fail' } = {}) {
  let officerCalls = 0;
  const spy = vi.spyOn(api, 'get').mockImplementation((async (path: string) => {
    if (path.startsWith('/government/users')) {
      officerCalls += 1;
      // Fail the first read only, so a retry has something to find.
      if (options.officers === 'fail' && officerCalls === 1) throw REFUSED;
      return OFFICERS;
    }
    if (path.startsWith('/government/departments')) {
      if (options.departments === 'fail') throw REFUSED;
      return DEPARTMENTS;
    }
    return CASE;
  }) as never);
  return spy;
}

async function openTheCase(role: Role = 'admin') {
  render(
    <CasesScreen user={user(role)} route={`/cases?case=${CASE.id}`} navigate={vi.fn()} />,
  );
  await waitFor(() => expect(screen.getByText(/CASE-2026-000042/)).toBeTruthy());
}

beforeEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => cleanup());

describe('an administrator whose staff list did not arrive', () => {
  it('is told, rather than shown a case with nobody to give it to', async () => {
    signInAs('admin');
    serve({ officers: 'fail' });

    await openTheCase();

    await waitFor(() => expect(screen.getAllByText(en.ofcListCouldNotLoad).length).toBe(1));
  });

  it('can ask again, and gets the picker back', async () => {
    signInAs('admin');
    serve({ officers: 'fail' });

    await openTheCase();
    await screen.findByText(en.ofcListCouldNotLoad);

    fireEvent.click(screen.getByRole('button', { name: en.actionTryAgain }));

    await waitFor(() => expect(screen.getByLabelText('Assign to')).toBeTruthy());
    expect(screen.queryByText(en.ofcListCouldNotLoad)).toBeNull();
  });

  it('is told when it is the department list that did not arrive', async () => {
    // Routing to a department is what tells Finance North from Finance South,
    // and every portal role may read this list — so a failure here is never
    // "you are not allowed to see it".
    signInAs('admin');
    serve({ departments: 'fail' });

    await openTheCase();

    await screen.findByText(en.ofcListCouldNotLoad);
    expect(screen.queryByLabelText('Department')).toBeNull();
  });
});

describe('what this must not have changed', () => {
  it('still says nothing to an officer who may not see the staff list', async () => {
    // A supervisor does not hold `user:manage`, so the list is never fetched
    // and the picker is correctly absent. That silence is the whole reason
    // emptiness could not be read as failure.
    signInAs('supervisor');
    serve();

    await openTheCase('supervisor');

    await waitFor(() =>
      expect(screen.getAllByText(/Move this case/i).length).toBeGreaterThan(0),
    );
    expect(screen.queryByLabelText('Assign to')).toBeNull();
    expect(screen.queryByText(en.ofcListCouldNotLoad)).toBeNull();
  });

  it('still draws both pickers, and no notice, when the lists arrive', async () => {
    signInAs('admin');
    serve();

    await openTheCase();

    await waitFor(() => expect(screen.getByLabelText('Assign to')).toBeTruthy());
    expect(screen.getByLabelText('Department')).toBeTruthy();
    expect(screen.queryByText(en.ofcListCouldNotLoad)).toBeNull();
  });

  it('still opens showing the officer who actually holds the case', async () => {
    // The fix from `routing-a-case-off-someones-desk`: the picker is not a
    // filter over the change, it IS the assignee once Move case is pressed.
    signInAs('admin');
    serve();

    await openTheCase();

    await waitFor(() =>
      expect((screen.getByLabelText('Assign to') as HTMLSelectElement).value).toBe(ASSIGNEE),
    );
  });
});
