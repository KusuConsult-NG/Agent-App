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
import { useI18n } from '../lib/i18n';
import type { TranslationDictionary } from '@psirs/shared';

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
const GROUP_TYPES: { value: string; label: keyof TranslationDictionary }[] = [
  { value: 'FARMERS_COOPERATIVE', label: 'grpFarmers' },
  { value: 'MARKET_ASSOCIATION', label: 'grpMarket' },
  { value: 'TRANSPORT_UNION', label: 'grpTransport' },
  { value: 'ARTISAN_GUILD', label: 'grpArtisan' },
  { value: 'TRADERS_ASSOCIATION', label: 'grpTraders' },
  { value: 'FISHERIES_GROUP', label: 'grpFisheries' },
  { value: 'LIVESTOCK_ASSOCIATION', label: 'grpLivestock' },
  { value: 'OTHER', label: 'grpOther' },
];

const readable = (value: string, t: TranslationDictionary) => {
  const type = GROUP_TYPES.find((candidate) => candidate.value === value);
  // A type the app does not know still has to read as something.
  return type
    ? t[type.label]
    : value.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());
};

// ===========================================================================
// The list
// ===========================================================================

export function GroupsScreen({ navigate }: { navigate: (path: string) => void }) {
  const { t } = useI18n();
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
        <h1>{t.grpTitle}</h1>
        <p>
          {t.grpListHint}
        </p>
      </header>

      <ErrorAlert error={error} />

      <button type="button" onClick={() => navigate('/groups/new')}>{t.grpRegister}</button>

      {groups === null && <Loading rows={3} />}

      {groups?.length === 0 && (
        <Empty>
          {t.grpEmpty}
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
                    {group.code} · {readable(group.group_type, t)} · {group.lga_name}
                  </p>
                  <p className="list__meta">
                    {t.grpConfirmedMembers.replace('{{n}}', group.attested_members)}
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
  const { t } = useI18n();
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
        <h1>{t.grpRegister}</h1>
        <p>
          {t.grpRegisterHint}
        </p>
      </header>

      <ErrorAlert error={error} />

      <form onSubmit={submit}>
        <Field label={t.grpName} hint="As the group itself gives it" required>
          <input
            type="text"
            value={form.name}
            onChange={(event) => set('name')(event.target.value)}
            required
          />
        </Field>

        <div className="field">
          <label htmlFor="group-type">{t.grpKind}</label>
          <select
            id="group-type"
            value={form.groupType}
            onChange={(event) => set('groupType')(event.target.value)}
            required
          >
            <option value="">{t.grpChooseOne}</option>
            {GROUP_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {t[type.label]}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="group-lga">{t.grpLga}</label>
          <select
            id="group-lga"
            value={form.lgaId}
            onChange={(event) => set('lgaId')(event.target.value)}
            required
          >
            <option value="">{t.grpChooseOne}</option>
            {lgas.map((lga) => (
              <option key={lga.id} value={lga.id}>
                {lga.name}
              </option>
            ))}
          </select>
        </div>

        <Field label={t.grpCommunity} hint="Where the group meets. Optional.">
          <input
            type="text"
            value={form.community}
            onChange={(event) => set('community')(event.target.value)}
            
          />
        </Field>

        <Field label={t.grpLeaderName} hint="The person who can confirm who belongs" required>
          <input
            type="text"
            value={form.leaderName}
            onChange={(event) => set('leaderName')(event.target.value)}
            required
          />
        </Field>

        <Field label={t.grpLeaderPhone} hint="They are sent a link to confirm the membership list" required>
          <input
            type="text"
            value={form.leaderPhone}
            onChange={(event) => set('leaderPhone')(event.target.value)}
            required
          />
        </Field>

        <Field label={t.grpMemberCount} hint="An estimate is fine. Optional.">
          <input
            type="number"
            value={form.memberEstimate}
            onChange={(event) => set('memberEstimate')(event.target.value)}
            
          />
        </Field>

        <Alert kind="info" title={t.grpNoAssessment}>
          <p style={{ margin: 0 }}>
            {t.grpNoAssessmentBody}
          </p>
        </Alert>

        <button type="submit" disabled={!ready || busy}>
          {busy ? <Spinner /> : t.grpRegisterGroup}
        </button>
      </form>
    </section>
  );
}

// ===========================================================================
// One group: its members, and the leader's confirmation
// ===========================================================================

export function GroupScreen({ groupId }: { groupId: string }) {
  const { t } = useI18n();
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
          {group.code} · {readable(group.group_type, t)}
        </p>
      </header>

      <ErrorAlert error={error} />

      <div className="card">
        <KeyValue
          items={[
            [t.appStatus, <Badge key="s" status={group.status} />],
            [t.grpLocalGovernment, group.lga_name],
            [t.tpWard, group.ward_name ?? '—'],
            [t.tpCommunity, group.community ?? '—'],
            [t.grpLeader, `${group.leader_name} · ${group.leader_phone}`],
            [t.grpMembersConfirmed, group.attested_members],
            [t.grpAwaitingLeader, group.pending_members],
          ]}
        />
      </div>

      {!active && (
        <Alert kind="info" title={t.grpWaitingOfficer}>
          <p style={{ margin: 0 }}>
            This group is {group.status.toLowerCase()}. Members can be recorded once an officer
            has approved it — there is nothing more to do here until then.
          </p>
        </Alert>
      )}

      {active && (
        <>
          <h2>{t.grpRecordMember}</h2>
          <p className="hint">
            {t.grpMemberHint}
          </p>

          {added && (
            <Alert kind="success" title={t.grpRecorded}>
              <p style={{ margin: 0 }}>{added}</p>
            </Alert>
          )}

          <TaxpayerPicker
            label={t.grpMember}
            hint={t.tpSearchByNamePhoneTin}
            chosen={chosen}
            onChoose={setChosen}
            onClear={() => setChosen(null)}
          />

          <button type="button" onClick={addMember} disabled={!chosen || busy}>
            {busy ? <Spinner /> : t.grpRecordThisMember}
          </button>

          <h2>{t.grpAskLeaderConfirm}</h2>
          <p className="hint">
            {t.grpAskLeaderHint}
          </p>

          <button type="button" className="secondary" onClick={askLeader} disabled={busy}>
            {busy ? <Spinner /> : t.grpSendLeaderLink}
          </button>

          {invitation && (
            <Alert kind="success" title={t.grpSendToLeader}>
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
