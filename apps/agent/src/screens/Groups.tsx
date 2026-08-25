/**
 * Cooperatives, unions and associations, registered where they meet.
 *
 * The informal sector does not arrive at a tax office one trader at a time. It
 * is organised — farmers' cooperatives, market associations, transport unions,
 * artisan guilds — and the way onto the register runs through the group rather
 * than around it. The platform was built for that: `taxpayer_groups`, a
 * membership table, a leader attestation, an officer approval, and an API test
 * that walks the whole journey.
 *
 * Every step of that journey was reachable only by calling the API directly.
 * `POST /groups` is gated on `group:register`, which among field users only an
 * agent holds, and carries `requireActiveAgent()` so it can only be called
 * from a registered handset — it was written for this screen, and this screen
 * did not exist. The officer portal implements the review half, because
 * approving is an officer's job and meeting the cooperative is not.
 *
 * WHAT THIS SCREEN REFUSES TO PRETEND
 *
 * Registering a group changes nothing about who owes what. It records that a
 * body exists and puts it in front of an officer. Members cannot be added
 * until that officer approves it, and a membership does not count until the
 * group's own leader confirms the person belongs — the agent recording members
 * is paid commission on what those members later pay, so their word alone is
 * not enough. The screen says all three things in the places an agent would
 * otherwise assume otherwise.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiRequestError, api, newIdempotencyKey, type ApiError } from '../lib/api';
import { TaxpayerPicker, type PickedTaxpayer } from '../components/TaxpayerPicker';
import { Alert, Badge, Empty, ErrorAlert, Field, KeyValue, Loading, Spinner } from '../ui';

interface GroupRow {
  id: string;
  code: string;
  name: string;
  group_type: string;
  economic_sector: string | null;
  status: string;
  lga_name: string;
  leader_name: string;
  leader_phone: string;
  attested_members: string;
}

interface GroupDetail extends GroupRow {
  ward_name: string | null;
  community: string | null;
  member_estimate: number | null;
  pending_members: string;
}

interface Lga {
  id: string;
  name: string;
}

/**
 * The kinds of body an agent actually meets.
 *
 * Kept in step with the enum `POST /groups` validates against — a value this
 * list offers and the API rejects is a form that cannot be submitted, and the
 * agent has no way to tell which of their answers was the wrong one.
 */
const GROUP_TYPES = [
  { value: 'FARMERS_COOPERATIVE', label: 'Farmers’ cooperative' },
  { value: 'MARKET_ASSOCIATION', label: 'Market association' },
  { value: 'TRANSPORT_UNION', label: 'Transport union' },
  { value: 'ARTISAN_GUILD', label: 'Artisan guild' },
  { value: 'TRADERS_ASSOCIATION', label: 'Traders’ association' },
  { value: 'FISHERIES_GROUP', label: 'Fisheries group' },
  { value: 'LIVESTOCK_ASSOCIATION', label: 'Livestock association' },
  { value: 'OTHER', label: 'Other' },
];

const readable = (value: string) =>
  GROUP_TYPES.find((t) => t.value === value)?.label ??
  value.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());

// ===========================================================================
// The list
// ===========================================================================

export function GroupsScreen({ navigate }: { navigate: (path: string) => void }) {
  const [groups, setGroups] = useState<GroupRow[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await api.get<{ groups: GroupRow[] }>('/groups?limit=100');
      setGroups(result.groups);
    } catch (caught) {
      if (caught instanceof ApiRequestError) setError(caught.error);
      setGroups([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section>
      <header className="screen-head">
        <h1>Groups and cooperatives</h1>
        <p>
          The groups you registered, and any an officer recorded for you to work. Another
          agent’s cooperatives are not listed here.
        </p>
      </header>

      <ErrorAlert error={error} />

      <button type="button" onClick={() => navigate('/groups/new')}>
        Register a group
      </button>

      {groups === null && <Loading rows={3} />}

      {groups?.length === 0 && (
        <Empty>
          No groups yet. When you meet a cooperative, a market association or a union, register
          it here so its members can be brought onto the register together.
        </Empty>
      )}

      {groups && groups.length > 0 && (
        <ul className="list">
          {groups.map((group) => (
            <li key={group.id}>
              <a href={`#/groups/${group.id}`}>
                <div>
                  <p className="list__title">{group.name}</p>
                  <p className="list__meta">
                    {group.code} · {readable(group.group_type)} · {group.lga_name}
                  </p>
                  <p className="list__meta">
                    {group.attested_members} confirmed member
                    {group.attested_members === '1' ? '' : 's'}
                  </p>
                </div>
                <Badge status={group.status} />
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ===========================================================================
// Registering one
// ===========================================================================

export function RegisterGroupScreen({ navigate }: { navigate: (path: string) => void }) {
  const [lgas, setLgas] = useState<Lga[]>([]);
  const [form, setForm] = useState({
    name: '',
    groupType: '',
    lgaId: '',
    community: '',
    leaderName: '',
    leaderPhone: '',
    memberEstimate: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    fetch('/api/v1/reference/lgas')
      .then((response) => (response.ok ? response.json() : []))
      .then((rows: Lga[]) => setLgas(rows))
      .catch(() => setLgas([]));
  }, []);

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ groupId: string; code: string }>(
        '/groups',
        {
          name: form.name.trim(),
          groupType: form.groupType,
          lgaId: form.lgaId,
          ...(form.community.trim() ? { community: form.community.trim() } : {}),
          leaderName: form.leaderName.trim(),
          leaderPhone: form.leaderPhone.trim(),
          ...(form.memberEstimate
            ? { memberEstimate: Number(form.memberEstimate) }
            : {}),
        },
        newIdempotencyKey('group.register'),
      );
      navigate(`/groups/${result.groupId}`);
    } catch (caught) {
      if (caught instanceof ApiRequestError) setError(caught.error);
    } finally {
      setBusy(false);
    }
  }

  const ready =
    form.name.trim().length >= 3 &&
    form.groupType &&
    form.lgaId &&
    form.leaderName.trim().length >= 3 &&
    form.leaderPhone.trim().length >= 8;

  return (
    <section>
      <header className="screen-head">
        <h1>Register a group</h1>
        <p>
          Record the body itself, and who leads it. Members are added after an officer has
          approved the group.
        </p>
      </header>

      <ErrorAlert error={error} />

      <form onSubmit={submit}>
        <Field label="Group name" hint="As the group itself gives it" required>
          <input
            type="text"
            value={form.name}
            onChange={(event) => set('name')(event.target.value)}
            required
          />
        </Field>

        <div className="field">
          <label htmlFor="group-type">What kind of group</label>
          <select
            id="group-type"
            value={form.groupType}
            onChange={(event) => set('groupType')(event.target.value)}
            required
          >
            <option value="">Choose one</option>
            {GROUP_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="group-lga">Local Government Area</label>
          <select
            id="group-lga"
            value={form.lgaId}
            onChange={(event) => set('lgaId')(event.target.value)}
            required
          >
            <option value="">Choose one</option>
            {lgas.map((lga) => (
              <option key={lga.id} value={lga.id}>
                {lga.name}
              </option>
            ))}
          </select>
        </div>

        <Field label="Community" hint="Where the group meets. Optional.">
          <input
            type="text"
            value={form.community}
            onChange={(event) => set('community')(event.target.value)}
            
          />
        </Field>

        <Field label="Leader’s name" hint="The person who can confirm who belongs" required>
          <input
            type="text"
            value={form.leaderName}
            onChange={(event) => set('leaderName')(event.target.value)}
            required
          />
        </Field>

        <Field label="Leader’s phone number" hint="They are sent a link to confirm the membership list" required>
          <input
            type="text"
            value={form.leaderPhone}
            onChange={(event) => set('leaderPhone')(event.target.value)}
            required
          />
        </Field>

        <Field label="Roughly how many members" hint="An estimate is fine. Optional.">
          <input
            type="number"
            value={form.memberEstimate}
            onChange={(event) => set('memberEstimate')(event.target.value)}
            
          />
        </Field>

        <Alert kind="info" title="This does not assess anybody">
          <p style={{ margin: 0 }}>
            Registering a group records that it exists. Nobody is charged anything, and no
            member is added, until an officer has approved it.
          </p>
        </Alert>

        <button type="submit" disabled={!ready || busy}>
          {busy ? <Spinner /> : 'Register group'}
        </button>
      </form>
    </section>
  );
}

// ===========================================================================
// One group: its members, and the leader's confirmation
// ===========================================================================

export function GroupScreen({ groupId }: { groupId: string }) {
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [chosen, setChosen] = useState<PickedTaxpayer | null>(null);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const [invitation, setInvitation] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setGroup(await api.get<GroupDetail>(`/groups/${groupId}`));
    } catch (caught) {
      if (caught instanceof ApiRequestError) setError(caught.error);
    }
  }, [groupId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!group) {
    return (
      <section>
        <ErrorAlert error={error} />
        {!error && <Loading rows={4} />}
      </section>
    );
  }

  const active = group.status === 'ACTIVE';

  async function addMember() {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    setAdded(null);
    try {
      const result = await api.post<{ membershipId: string; message: string }>(
        `/groups/${groupId}/members`,
        { taxpayerId: chosen.id },
        newIdempotencyKey('group.member'),
      );
      setAdded(result.message);
      setChosen(null);
      await load();
    } catch (caught) {
      if (caught instanceof ApiRequestError) setError(caught.error);
    } finally {
      setBusy(false);
    }
  }

  async function askLeader() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ invitationUrl: string; message: string }>(
        `/groups/${groupId}/attestation-request`,
        {},
      );
      setInvitation(result.invitationUrl);
    } catch (caught) {
      if (caught instanceof ApiRequestError) setError(caught.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <header className="screen-head">
        <h1>{group.name}</h1>
        <p>
          {group.code} · {readable(group.group_type)}
        </p>
      </header>

      <ErrorAlert error={error} />

      <div className="card">
        <KeyValue
          items={[
            ['Status', <Badge key="s" status={group.status} />],
            ['Local Government', group.lga_name],
            ['Ward', group.ward_name ?? '—'],
            ['Community', group.community ?? '—'],
            ['Leader', `${group.leader_name} · ${group.leader_phone}`],
            ['Members confirmed', group.attested_members],
            ['Awaiting the leader', group.pending_members],
          ]}
        />
      </div>

      {!active && (
        <Alert kind="info" title="Waiting for an officer">
          <p style={{ margin: 0 }}>
            This group is {group.status.toLowerCase()}. Members can be recorded once an officer
            has approved it — there is nothing more to do here until then.
          </p>
        </Alert>
      )}

      {active && (
        <>
          <h2>Record a member</h2>
          <p className="hint">
            The person has to be registered as a taxpayer first. Search for them by name, phone
            or TIN.
          </p>

          {added && (
            <Alert kind="success" title="Recorded">
              <p style={{ margin: 0 }}>{added}</p>
            </Alert>
          )}

          <TaxpayerPicker
            label="Member"
            hint="Search by name, phone number or TIN"
            chosen={chosen}
            onChoose={setChosen}
            onClear={() => setChosen(null)}
          />

          <button type="button" onClick={addMember} disabled={!chosen || busy}>
            {busy ? <Spinner /> : 'Record this member'}
          </button>

          <h2>Ask the leader to confirm</h2>
          <p className="hint">
            You are paid commission on what these members pay, so your word that somebody
            belongs is not enough on its own. The group’s own leader confirms the list.
          </p>

          <button type="button" className="secondary" onClick={askLeader} disabled={busy}>
            {busy ? <Spinner /> : 'Send the leader a confirmation link'}
          </button>

          {invitation && (
            <Alert kind="success" title="Send this to the leader">
              <p style={{ margin: 0, wordBreak: 'break-all' }}>{invitation}</p>
              <p style={{ margin: '0.5rem 0 0' }}>
                {group.leader_name} can open it on any phone. Until they confirm, the members
                you recorded are not counted.
              </p>
            </Alert>
          )}
        </>
      )}
    </section>
  );
}
