/**
 * Who may do what, changed without a deployment.
 *
 * The permissions were always granular and properly enforced — the problem was
 * where the map lived. Changing who may approve a refund was a code change and
 * a release, so PSIRS could not answer a change in their own delegation of
 * authority without an engineer.
 *
 * WHAT THIS SCREEN DELIBERATELY DOES NOT OFFER
 *
 * Inventing a permission. The catalogue stays in code, because a permission is
 * a name the route handlers check: a grant naming something no route consults
 * would appear in this list, read like an authority, and be none — so somebody
 * would believe an officer could do something they cannot. The screen offers
 * only what the server says exists.
 *
 * AND ONE THING IT SAYS OUT LOUD
 *
 * Taking a permission away signs out everybody holding the role. That is not a
 * side effect to be apologised for, it is the mechanism: the map is cached for
 * thirty seconds, and thirty seconds is a long time for an officer whose
 * authority has just been withdrawn to keep exercising it. The warning is on
 * the control, before it is pressed.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiRequestError, api, can, stepUp, type ApiError, type User } from '../lib/api';
import { Alert, Badge, ErrorAlert, Loading, Table } from '../ui';
import { usePortalI18n } from '../lib/i18n';
import { localName } from '@psirs/shared';

interface Role {
  name: string;
  label: string;
  label_ha: string | null;
  description: string | null;
  is_system: boolean;
  is_portal: boolean;
  status: string;
  officers: string;
  permissions: string[];
}

export function RolesScreen({ user }: { user: User }) {
  const { t, lang } = usePortalI18n();
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [grantable, setGrantable] = useState<string[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const body = await api.get<{ roles: Role[]; grantable: string[] }>('/government/roles');
      setRoles(body.roles);
      setGrantable(body.grantable);
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.error : null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const role = roles?.find((row) => row.name === selected) ?? null;

  return (
    <>
      <div className="card">
        <h2>{t.ofcRlTitle}</h2>
        <p className="muted">{t.ofcRlIntro}</p>
        <Alert kind="info">{t.ofcRlCatalogueNote}</Alert>
        <ErrorAlert error={error} />
        {notice && <Alert kind="success">{notice}</Alert>}
        {can('user:manage') && (
          <button type="button" onClick={() => setAdding((value) => !value)}>
            {t.ofcRlNewRole}
          </button>
        )}
      </div>

      {adding && roles && (
        <NewRoleForm
          user={user}
          roles={roles}
          onDone={async (message) => {
            setAdding(false);
            setNotice(message);
            await load();
          }}
        />
      )}

      <div className="card card--flush">
        {!roles ? (
          <div style={{ padding: 18 }}>
            <Loading />
          </div>
        ) : (
          <Table
            rows={roles}
            empty="ofcNoneRoles"
            columns={[
              {
                key: 'label',
                label: 'ofcRlRole',
                render: (row: Role) => (
                  <>
                    <strong>{localName(lang, row.label, row.label_ha)}</strong>
                    <br />
                    <span className="muted">{row.name}</span>
                  </>
                ),
              },
              {
                key: 'is_system',
                label: 'ofcRlSystemRole',
                render: (row: Role) => (
                  <>
                    {row.is_system ? '✓' : '—'}
                    {row.is_portal && (
                      <>
                        <br />
                        <span className="muted">{t.ofcRlPortalRole}</span>
                      </>
                    )}
                  </>
                ),
              },
              { key: 'officers', label: 'ofcRlOfficers', numeric: true },
              {
                key: 'permissions',
                label: 'ofcRlPermissions',
                numeric: true,
                render: (row: Role) => row.permissions.length,
              },
              {
                key: 'status',
                label: 'ofcCwStatus',
                render: (row: Role) => <Badge status={row.status} />,
              },
              {
                key: 'open',
                label: 'ofcOvAction',
                render: (row: Role) => (
                  <>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setSelected(selected === row.name ? null : row.name)}
                    >
                      {t.ofcRlPermissions}
                    </button>{' '}
                    {/*
                      * Retiring is offered only for a role somebody created.
                      * The six the platform ships with are referenced by name
                      * in the portal's menus and in every test that enumerates
                      * them, so the server refuses and the screen does not ask.
                      */}
                    {!row.is_system && can('user:manage') && (
                      <LifecycleButton
                        roleName={row.name}
                        action={row.status === 'ACTIVE' ? 'retire' : 'restore'}
                        user={user}
                        onDone={async (message) => {
                          setNotice(message);
                          await load();
                        }}
                      />
                    )}
                  </>
                ),
              },
            ]}
          />
        )}
      </div>

      {role && (
        <PermissionEditor
          role={role}
          grantable={grantable}
          user={user}
          onDone={async (message) => {
            setNotice(message);
            await load();
          }}
        />
      )}
    </>
  );
}

// ===========================================================================
/*
 * Retire, and the way back from it.
 *
 * Both sides are the same control because they are the same decision seen from
 * either end, and because splitting them invites the screen that offers only
 * the one-way half. A retired role is left listed with its status showing
 * rather than filtered out, so an administrator can see what was closed and
 * put it back.
 */
function LifecycleButton({
  roleName,
  action,
  user,
  onDone,
}: {
  roleName: string;
  action: 'retire' | 'restore';
  user: User;
  onDone: (message: string) => Promise<void>;
}) {
  const { t } = usePortalI18n();
  const [reason, setReason] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  if (!open) {
    return (
      <button type="button" className="secondary" onClick={() => setOpen(true)}>
        {action === 'retire' ? t.ofcRlRetire : t.ofcRlRestore}
      </button>
    );
  }

  return (
    <div>
      <ErrorAlert error={error} />
      <input
        value={reason}
        placeholder={t.ofcCwWhy}
        onChange={(event) => setReason(event.target.value)}
      />
      <button
        type="button"
        disabled={busy || reason.trim().length < 10}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await stepUp('user.role.change', user.phone);
            /*
             * Both paths written out, for the reason the permission editor
             * gives below: a reachability guard that reads this file cannot
             * credit an endpoint whose path is assembled at runtime.
             */
            if (action === 'retire') {
              await api.post(`/government/roles/${roleName}/retire`, { reason: reason.trim() });
            } else {
              await api.post(`/government/roles/${roleName}/restore`, { reason: reason.trim() });
            }
            setOpen(false);
            await onDone(t.ofcCwSaved);
          } catch (caught) {
            setError(caught instanceof ApiRequestError ? caught.error : null);
          } finally {
            setBusy(false);
          }
        }}
      >
        {action === 'retire' ? t.ofcRlRetire : t.ofcRlRestore}
      </button>
    </div>
  );
}

// ===========================================================================
function PermissionEditor({
  role,
  grantable,
  user,
  onDone,
}: {
  role: Role;
  grantable: string[];
  user: User;
  onDone: (message: string) => Promise<void>;
}) {
  const { t, lang } = usePortalI18n();
  const [filter, setFilter] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const held = useMemo(() => new Set(role.permissions), [role.permissions]);
  const shown = useMemo(
    () =>
      grantable
        .filter((permission) => permission.includes(filter.trim().toLowerCase()))
        .sort((left, right) => {
          // Held first, so an officer reading the list sees what the role has
          // before what it could have.
          const heldDiff = Number(held.has(right)) - Number(held.has(left));
          return heldDiff !== 0 ? heldDiff : left.localeCompare(right);
        }),
    [grantable, filter, held],
  );

  const mayManage = can('user:manage');

  async function change(permission: string, granting: boolean) {
    setBusy(true);
    setError(null);
    try {
      // Changing the platform's delegation of authority is at least as
      // consequential as changing one officer's role, which already asks for a
      // fresh code.
      await stepUp('user.role.change', user.phone);
      /*
       * The two paths written out rather than assembled.
       *
       * `officer-actions-reachable.test.ts` reads this file to check that every
       * officer endpoint has a way in, and it can only see a path up to its
       * first interpolation — so `/roles/${name}/${verb}` reduces to
       * `/government/roles/` and both endpoints read as unreachable. Spelling
       * them out is not verbosity; it is what makes the guard able to do its
       * job.
       */
      const result = granting
        ? await api.post<{ sessionsEnded?: number }>(
            `/government/roles/${role.name}/grant`,
            { permission, reason: reason.trim() },
          )
        : await api.post<{ sessionsEnded?: number }>(
            `/government/roles/${role.name}/revoke`,
            { permission, reason: reason.trim() },
          );
      setReason('');
      await onDone(
        granting || !result?.sessionsEnded
          ? t.ofcCwSaved
          : `${t.ofcRlSignedOut}: ${result.sessionsEnded}`,
      );
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.error : null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3>{localName(lang, role.label, role.label_ha)}</h3>
      <ErrorAlert error={error} />

      {mayManage && (
        <>
          <Alert kind="warning">{t.ofcRlRevokeWarning}</Alert>
          <div className="filters">
            <label>
              {t.ofcRlSearchPermission}
              <input value={filter} onChange={(event) => setFilter(event.target.value)} />
            </label>
            <label>
              {t.ofcRlGrantReason}
              <input value={reason} onChange={(event) => setReason(event.target.value)} />
            </label>
          </div>
        </>
      )}

      <ul className="list">
        {shown.map((permission) => (
          <li key={permission}>
            <div className="signal-detail">
              <span className="mono">{permission}</span>
              {held.has(permission) ? (
                <Badge status="ACTIVE" />
              ) : (
                <span className="muted">—</span>
              )}
              {mayManage && (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy || reason.trim().length < 10}
                  onClick={() => change(permission, !held.has(permission))}
                >
                  {held.has(permission) ? t.ofcRlRevoke : t.ofcRlGrant}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ===========================================================================
function NewRoleForm({
  user,
  roles,
  onDone,
}: {
  user: User;
  roles: Role[];
  onDone: (message: string) => Promise<void>;
}) {
  const { t } = usePortalI18n();
  const [form, setForm] = useState({
    name: '',
    label: '',
    isPortal: true,
    copyFrom: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  return (
    <div className="card">
      <h3>{t.ofcRlNewRole}</h3>
      <p className="muted">{t.ofcRlCopyFromBody}</p>
      <ErrorAlert error={error} />
      <div className="filters">
        <label>
          {t.ofcRlRoleName}
          <input
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </label>
        <label>
          {t.ofcRlRoleLabel}
          <input
            value={form.label}
            onChange={(event) => setForm({ ...form, label: event.target.value })}
          />
        </label>
        <label>
          {t.ofcRlCopyFrom}
          <select
            value={form.copyFrom}
            onChange={(event) => setForm({ ...form, copyFrom: event.target.value })}
          >
            <option value="">—</option>
            {roles
              .filter((role) => role.status === 'ACTIVE')
              .map((role) => (
                <option key={role.name} value={role.name}>
                  {role.label}
                </option>
              ))}
          </select>
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={form.isPortal}
            onChange={(event) => setForm({ ...form, isPortal: event.target.checked })}
          />
          {t.ofcRlIsPortalRole}
        </label>
      </div>
      <button
        type="button"
        disabled={busy || form.name.trim().length < 3 || form.label.trim().length < 2}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await stepUp('user.role.change', user.phone);
            await api.post('/government/roles', {
              name: form.name.trim(),
              label: form.label.trim(),
              isPortal: form.isPortal,
              copyFrom: form.copyFrom || null,
            });
            await onDone(t.ofcCwSaved);
          } catch (caught) {
            setError(caught instanceof ApiRequestError ? caught.error : null);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? '…' : t.ofcRlNewRole}
      </button>
    </div>
  );
}
