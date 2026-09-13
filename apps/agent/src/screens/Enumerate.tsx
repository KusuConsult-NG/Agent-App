/**
 * Writing down what is in front of you, at the stall.
 *
 * The whole informal-sector programme rests on this one screen working in a
 * market, on a cheap handset, in the sun, held by somebody who is paid
 * commission on what they collect. Three things follow from that, and all
 * three are load-bearing.
 *
 * THE AGENT RECORDS FACTS, NOT A BAND AND NEVER AN AMOUNT.
 *
 * Premises, equipment, people. There is no field here for a size band, a
 * turnover, or a naira figure, and the server does not send one back beyond
 * the band it worked out itself. An agent holding a form with an amount on it
 * is being invited to negotiate somebody's tax at a stall — which is the
 * failure this regime has to avoid to survive its first year, and which no
 * amount of policy can prevent once the number is on the handset.
 *
 * THE BAND IS SHOWN, BECAUSE THE TRADER WILL ASK.
 *
 * Not so the agent can change it — they cannot, the server decides it from
 * the facts — but because "I have written you down as small" is an answer a
 * person is owed on the spot, and an agent who cannot say anything looks
 * either evasive or ignorant. What the band costs is a separate question with
 * a separate screen behind it, and the answer arrives by notice.
 *
 * THE ASSOCIATION IS OPTIONAL, AND ONLY IF IT HAS STANDING.
 *
 * A count recorded through a market association can be confirmed or
 * contradicted by its leader, which is the check that makes enumeration
 * survivable. But standing is something PSIRS confers, so only groups that
 * have it appear here — and the empty case says why rather than showing an
 * empty list.
 */

import { useEffect, useState, type FormEvent } from 'react';
import { ApiRequestError, api, asApiError, isConnectivityFailure, type ApiError } from '../lib/api';
import { requestBackgroundSync, submitOrQueue } from '../lib/drafts';
import { Alert, ErrorAlert, Field, KeyValue, Loading } from '../ui';
import { useI18n } from '../lib/i18n';
import { useReferenceList } from '../lib/reference';
import { bandFor, enumLabel, type Premises, type SizeBand } from '@psirs/shared';

interface Profile {
  taxpayer: {
    id: string;
    tin: string | null;
    first_name: string | null;
    last_name: string | null;
    business_name: string | null;
    phone: string;
    lga_name: string;
    economic_sector: string | null;
  };
}

interface Group {
  id: string;
  name: string;
  tax_role: string;
}

interface Recorded {
  id: string;
  sizeBand: string;
  premises: string;
  attestationState: string;
}

/** The rungs, smallest first, so the control reads as a ladder. */
const PREMISES: Premises[] = ['NONE', 'STALL', 'KIOSK', 'LOCK_UP_SHOP', 'BUILDING'];

export function EnumerateScreen({
  taxpayerId,
  navigate,
}: {
  taxpayerId: string;
  navigate: (path: string) => void;
}) {
  const { t } = useI18n();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [groups, setGroups] = useState<Group[] | null>(null);
  const sectorList = useReferenceList<{ code: string; label: string }>('/taxpayers/sectors');
  const sectors = sectorList.items;
  const [form, setForm] = useState({
    premises: '',
    equipmentCount: '',
    peopleWorking: '',
    economicSector: '',
    groupId: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [recorded, setRecorded] = useState<Recorded | null>(null);
  /*
   * Held on the phone rather than sent.
   *
   * A separate state from `recorded` because the two confirmations cannot say
   * the same thing: a capture that reached the office comes back with a band,
   * and one sitting in the queue has none — nothing has worked it out yet. A
   * screen that showed a band here would be showing one the handset invented,
   * which is the single thing this whole design refuses to do.
   */
  const [queued, setQueued] = useState(false);

  useEffect(() => {
    api
      .get<Profile>(`/taxpayers/${taxpayerId}`)
      .then((result) => {
        setProfile(result);
        /*
         * Pre-filled from the register, not fixed. The sector a trader was
         * registered under is usually right and occasionally out of date — a
         * tailor who now sells phone credit is a different schedule column —
         * so the agent standing in front of them can correct it.
         */
        if (result.taxpayer.economic_sector) {
          setForm((current) => ({ ...current, economicSector: result.taxpayer.economic_sector! }));
        }
      })
      .catch((caught) => {
        setError(asApiError(caught));
      });

    api
      .get<{ groups: Group[] }>('/groups?status=ACTIVE')
      .then((result) => setGroups(result.groups.filter((group) => group.tax_role !== 'NONE')))
      .catch(() => setGroups([]));

  }, [taxpayerId]);

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  /*
   * Zero is an answer, and an empty box is not.
   *
   * A hawker with no equipment and nobody working for them is exactly the
   * person the exemption is for, and treating a blank as zero would record
   * that finding every time an agent simply skipped the question. So both
   * counts must be typed, including when the answer is nought.
   */
  const complete =
    form.premises !== '' &&
    form.economicSector !== '' &&
    form.equipmentCount.trim() !== '' &&
    form.peopleWorking.trim() !== '';

  /*
   * The band, worked out here on the phone.
   *
   * It runs `bandFor` from the shared package — the same function the platform
   * runs when the capture arrives, not a copy of it — so the answer an agent
   * gives at the stall and the answer the office reaches are the same answer
   * by construction rather than by both being maintained carefully.
   *
   * Shown as soon as the three facts are there, before saving and whether or
   * not there is any signal, because "what have you written me down as" is a
   * question a trader asks while the agent is still standing in front of them.
   *
   * What it is not is a price. The band multiplies an assumed turnover this
   * handset does not carry and will not be given; the sum arrives by notice.
   */
  const bandNow: SizeBand | null =
    complete
      ? bandFor({
          premises: form.premises as Premises,
          equipmentCount: Number(form.equipmentCount),
          peopleWorking: Number(form.peopleWorking),
        })
      : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!complete) return;
    setBusy(true);
    setError(null);
    const payload = {
      taxpayerId,
      premises: form.premises,
      equipmentCount: Number(form.equipmentCount),
      peopleWorking: Number(form.peopleWorking),
      economicSector: form.economicSector,
      ...(form.groupId ? { groupId: form.groupId } : {}),
      /*
       * What the agent was shown, travelling with the capture.
       *
       * Not what decides the band — the platform runs the rule again on
       * arrival and that result is the one that stands. This is the record of
       * what a trader was told at their own stall, and it matters precisely
       * when the two disagree: a handset running an old build, or a rule
       * changed between capture and sync. Without it the taxpayer hears
       * "small" from an agent and reads "medium" on a notice, and nothing
       * anywhere knows that happened.
       */
      ...(bandNow ? { bandAtCapture: bandNow } : {}),
    };
    try {
      /*
       * Sent if there is signal, queued if there is not, and the agent does
       * not have to know which before they press it.
       *
       * The markets this programme exists to reach are the ones the network is
       * worst in. An enumeration that required a connection would be collected
       * where coverage already is, which is precisely where the missing
       * taxpayers are not.
       *
       * A refusal is not a connectivity failure and is rethrown: a taxpayer
       * that is not active, a group with no standing, a negative count. Those
       * are the office answering, and queueing them would defer the same
       * answer to a day when the trader is no longer standing there.
       */
      const outcome = await submitOrQueue<Recorded>(
        'BUSINESS_OBSERVATION',
        payload,
        () => api.post<Recorded>('/government/enumeration/observations', payload),
        isConnectivityFailure,
      );
      if (outcome.sent) {
        setRecorded(outcome.result);
      } else {
        setQueued(true);
        await requestBackgroundSync();
      }
    } catch (caught) {
      setError(asApiError(caught));
    } finally {
      setBusy(false);
    }
  }

  if (!profile) return <Loading rows={5} />;

  const taxpayer = profile.taxpayer;
  const name =
    taxpayer.business_name ??
    [taxpayer.first_name, taxpayer.last_name].filter(Boolean).join(' ');

  if (queued) {
    return (
      <>
        <div className="card">
          <h2 className="card__title">{t.agEnQueuedTitle}</h2>
          <KeyValue
            items={[
              [t.agEnWho, name],
              [t.agEnPremises, enumLabel(form.premises, t)],
              /*
               * The band the phone worked out, shown here as it is shown on a
               * capture that got through. It is the same function the office
               * runs on arrival, so this is not a guess standing in for an
               * answer — but the office's run is the one that decides, which
               * is what the notice below says.
               */
              [t.agEnBand, bandNow ? enumLabel(bandNow, t) : '—'],
            ]}
          />
          <Alert kind="warning" title={t.agEnWhatHappensNextTitle}>
            {t.agEnQueuedNext}
          </Alert>
        </div>
        <button type="button" onClick={() => navigate(`/taxpayers/${taxpayerId}`)}>
          {t.agEnBackToTaxpayer}
        </button>
      </>
    );
  }

  if (recorded) {
    return (
      <>
        <div className="card">
          <h2 className="card__title">{t.agEnRecordedTitle}</h2>
          <KeyValue
            items={[
              [t.agEnWho, name],
              [t.agEnPremises, enumLabel(recorded.premises, t)],
              [t.agEnBand, enumLabel(recorded.sizeBand, t)],
            ]}
          />
          <Alert kind="info" title={t.agEnWhatHappensNextTitle}>
            {recorded.attestationState === 'PENDING'
              ? t.agEnNextWithLeader
              : t.agEnNextWithoutLeader}
          </Alert>
        </div>
        <button type="button" onClick={() => navigate(`/taxpayers/${taxpayerId}`)}>
          {t.agEnBackToTaxpayer}
        </button>
      </>
    );
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2 className="card__title">{t.agEnTitle}</h2>
      <p className="card__hint">{t.agEnIntro}</p>
      <KeyValue items={[[t.agEnWho, name], ['TIN', taxpayer.tin ?? t.tpNotYetAssigned]]} />

      <ErrorAlert error={error} />

      <Field label={t.agEnPremises} hint={t.agEnPremisesHint} required>
        <select value={form.premises} onChange={(event) => set('premises')(event.target.value)}>
          <option value="">{t.agEnChoose}</option>
          {PREMISES.map((premises) => (
            <option key={premises} value={premises}>
              {enumLabel(premises, t)}
            </option>
          ))}
        </select>
      </Field>

      <Field label={t.agEnEquipment} hint={t.agEnEquipmentHint} required>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          value={form.equipmentCount}
          onChange={(event) => set('equipmentCount')(event.target.value)}
        />
      </Field>

      <Field label={t.agEnPeople} hint={t.agEnPeopleHint} required>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          value={form.peopleWorking}
          onChange={(event) => set('peopleWorking')(event.target.value)}
        />
      </Field>

      <Field label={t.agEnSector} required>
        <select
          value={form.economicSector}
          onChange={(event) => set('economicSector')(event.target.value)}
        >
          <option value="">
            {sectorList.failed ? t.tpListCouldNotLoad : t.tpSelectSector}
          </option>
          {sectors.map((sector) => (
            <option key={sector.code} value={sector.code}>
              {sector.label}
            </option>
          ))}
        </select>
      </Field>
      {sectorList.failed && (
        <button type="button" className="secondary" onClick={sectorList.reload}>
          {t.actionTryAgain}
        </button>
      )}

      {groups === null ? null : groups.length === 0 ? (
        <Alert kind="info" title={t.agEnNoGroupsTitle}>
          {t.agEnNoGroups}
        </Alert>
      ) : (
        <Field label={t.agEnGroup} hint={t.agEnGroupHint}>
          <select value={form.groupId} onChange={(event) => set('groupId')(event.target.value)}>
            <option value="">{t.agEnNoGroupChosen}</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      {bandNow ? (
        <Alert kind="info" title={t.agEnBandSoFarTitle}>
          {t.agEnBandSoFar.replace('{{band}}', enumLabel(bandNow, t))}
        </Alert>
      ) : null}

      <Alert kind="info" title={t.agEnNoAmountTitle}>
        {t.agEnNoAmount}
      </Alert>

      <button type="submit" disabled={busy || !complete}>
        {busy ? t.agEnSaving : t.agEnSave}
      </button>
    </form>
  );
}
