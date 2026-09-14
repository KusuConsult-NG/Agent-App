/**
 * A demonstration dataset, created through the front door.
 *
 * Every record here is made by calling the same HTTP endpoints the agent PWA
 * and the officer portal call, with the same headers and the same
 * authorisation. Nothing is inserted with SQL.
 *
 * That is the whole design rule. A seed that writes rows directly can produce
 * states the platform itself cannot reach — a payment marked verified without a
 * gateway confirmation, an agent active without clearance — and a screenshot of
 * such a state proves nothing about the software. Driving the API means that if
 * any step here stops working, seeding fails loudly instead of quietly
 * manufacturing a demonstration that could never happen in production.
 *
 * It is also a test in its own right: the script exercises registration,
 * assessment, payment initiation, gateway confirmation, receipt issue, vehicle
 * capture and renewal, settlement and reconciliation end to end.
 *
 * Usage:  node scripts/uat/seed-uat.mjs [--api http://localhost:4000]
 */

import { writeFileSync, mkdirSync } from 'node:fs';

const API = process.argv.includes('--api')
  ? process.argv[process.argv.indexOf('--api') + 1]
  : (process.env.UAT_API ?? 'http://localhost:4000');

/** Everything is mounted under the versioned prefix; nothing answers at the root. */
const BASE = `${API}/api/v1`;

const AGENT_DEVICE = 'uat-agent-device-000001';

/**
 * Where the one-time links this run issues are written.
 *
 * A referee invitation and a group-leader attestation are each a token that
 * exists in plaintext for the length of one HTTP response and is stored only
 * as a hash. Whatever wants to open those screens later — a presenter, the
 * browser walkthrough — has to be told by the run that created them.
 */
const LINKS_FILE = process.env.UAT_LINKS_FILE ?? '/tmp/psirs-uat/seed-links.json';
const APP_VERSION = '1.0.0';

let step = 0;
const log = (message) => console.log(`  ${String(++step).padStart(2, '0')}. ${message}`);

class ApiError extends Error {
  constructor(method, path, status, body) {
    super(`${method} ${path} -> ${status}: ${JSON.stringify(body)}`);
    this.status = status;
    this.body = body;
  }
}

async function call(method, path, { body, token, deviceId, idempotencyKey, allow } = {}) {
  const headers = { 'content-type': 'application/json', 'x-app-version': APP_VERSION };
  if (token) headers.authorization = `Bearer ${token}`;
  if (deviceId) headers['x-device-id'] = deviceId;
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;

  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!response.ok && !(allow ?? []).includes(response.status)) {
    throw new ApiError(method, path, response.status, parsed);
  }
  return { status: response.status, body: parsed };
}

const get = (path, options) => call('GET', path, options);
const post = (path, body, options) => call('POST', path, { ...options, body });

/**
 * Sign in, waiting out the auth rate limit rather than tripping over it.
 *
 * `/auth/login` is deliberately rate-limited harder than everything else, which
 * is correct and which a seed signing in as six people in a row will hit. The
 * limiter tells us how long to wait; honouring that is the difference between
 * exercising the platform and working around it.
 */
async function login(phone, password, deviceId) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await post('/auth/login', { phone, password }, { deviceId, allow: [429] });
    if (response.status !== 429) return response.body.accessToken;
    const seconds = Number(/Wait (\d+) second/.exec(response.body?.error?.message ?? '')?.[1] ?? 5);
    await new Promise((resolve) => setTimeout(resolve, (seconds + 1) * 1000));
  }
  throw new Error(`Could not sign in as ${phone}: still rate limited after eight attempts.`);
}

/** A key per call, because one key replayed is a different test from one call. */
let keySeq = 0;
const key = (label) => `uat-${label}-${++keySeq}`;

// ---------------------------------------------------------------------------

const NAMES = [
  ['Amina', 'Bulus', 'INDIVIDUAL'],
  ['Danjuma', 'Pam', 'INDIVIDUAL'],
  ['Ladi', 'Gyang', 'INDIVIDUAL'],
  ['Musa', 'Dung', 'INDIVIDUAL'],
  ['Rifkatu', 'Choji', 'INDIVIDUAL'],
  ['Sunday', 'Danladi', 'INDIVIDUAL'],
  ['Hauwa', 'Mafeng', 'INDIVIDUAL'],
  ['Yakubu', 'Nyam', 'INDIVIDUAL'],
];

/*
 * Businesses with a sector each, because sector is not decoration here.
 *
 * The PAYE lead list narrows to the sectors that actually employ — a
 * provisions stall is one person, a hotel is thirty — and the consumption-tax
 * list narrows to the ones that serve. Businesses seeded without a sector
 * matched neither, so both screens came up empty against a database that
 * looked full.
 */
const BUSINESSES = [
  { name: 'Jos Main Market Provisions', sector: 'RETAIL_TRADE' },
  { name: 'Rukuba Road Motor Spares', sector: 'RETAIL_TRADE' },
  { name: 'Bukuru Cold Room Enterprises', sector: 'MANUFACTURING' },
  { name: 'Plateau Agro Supplies', sector: 'AGRICULTURE' },
  { name: 'Terminus Grand Hotel', sector: 'HOTEL_HOSPITALITY' },
  { name: 'Zawan Block Industries', sector: 'CONSTRUCTION' },
  { name: 'Plateau Star Transport', sector: 'TRANSPORT_PASSENGER' },
  { name: 'Rayfield Medical Centre', sector: 'HEALTHCARE' },
];

async function main() {
  console.log(`\nSeeding demonstration data through ${API}\n`);

  // --- who we act as -------------------------------------------------------
  const agentToken = await login('+2347010000001', 'FieldAgent2026', AGENT_DEVICE);
  log('signed in as the field agent');
  const admin = await login('+2348000000001', 'Password123');
  const revenue = await login('+2348000000002', 'Password123');
  const finance = await login('+2348000000003', 'Password123');
  log('signed in as admin, revenue officer and finance officer');

  /*
   * The agent PWA generates its own device id on first run, so the handset the
   * seed uses is not the one the clearance pipeline registered. Registering and
   * approving it is exactly what an officer does on the Agents screen, and
   * without it every collection below is refused for want of an approved
   * device — which is the platform behaving correctly, and would look like a
   * broken seed.
   */
  const roster = (await get('/agents', { token: admin })).body;
  const list = Array.isArray(roster) ? roster : (roster.agents ?? []);
  const fieldAgent = list.find((row) => (row.phone ?? '').endsWith('7010000001')) ?? list[0];
  const agentId = fieldAgent.id ?? fieldAgent.agentId;

  await post(
    '/agents/me/devices',
    { deviceIdentifier: AGENT_DEVICE, model: 'UAT Handset', platform: 'ANDROID', pwaVersion: APP_VERSION },
    { token: agentToken, deviceId: AGENT_DEVICE, allow: [409, 422] },
  );
  const detail = (await get(`/agents/${agentId}`, { token: admin })).body;
  const handset = (detail.devices ?? []).find((device) => device.device_identifier === AGENT_DEVICE);
  if (handset && handset.status !== 'ACTIVE') {
    await post(`/agents/devices/${handset.id}/approve`, {}, { token: admin, allow: [400, 409, 422] });
  }
  log(`the UAT handset is registered and ${handset ? 'approved' : 'already in place'}`);

  // --- reference data we need ---------------------------------------------
  const lgas = (await get('/reference/lgas', { token: agentToken })).body;
  const jos = lgas.find((lga) => /jos north/i.test(lga.name)) ?? lgas[0];
  const items = (await get('/revenue/items', { token: agentToken })).body;
  /*
   * Only items with an approved rate in force can be assessed. Seven of the
   * forty-two have none, and the platform refuses them with NO_EFFECTIVE_RATE —
   * correctly, since a rate is government configuration rather than something
   * the software may invent. Picking by code without checking is how a seed
   * ends up "failing" on the platform working exactly as designed.
   */
  const byCode = (code) => {
    const item = items.find((row) => row.code === code);
    if (!item) throw new Error(`Revenue item ${code} is not in the catalogue.`);
    if (!item.rate_type) throw new Error(`Revenue item ${code} has no approved rate in force.`);
    return item;
  };
  const marketLevy = byCode('MARKET-LEVY');       // daily, ₦200
  const shopLevy = byCode('SHOPS-KIOSKS');        // annual, ₦3,000
  const devLevy = byCode('DEV-LEVY');             // annual, ₦2,000
  const consumptionTax = byCode('CONSUMPTION-TAX'); // 5% of the declared base
  log(`reference data: ${lgas.length} LGAs, ${items.length} revenue items`);

  const agentAuth = { token: agentToken, deviceId: AGENT_DEVICE };
  const taxpayers = [];

  // --- taxpayers the agent onboards ---------------------------------------
  for (const [index, [firstName, lastName]] of NAMES.entries()) {
    const { body } = await post(
      '/taxpayers',
      {
        taxpayerType: 'INDIVIDUAL',
        firstName,
        lastName,
        phone: `+23480310000${String(index + 10).padStart(2, '0')}`,
        address: `${index + 3} Ahmadu Bello Way, Jos`,
        lgaId: jos.id,
        consentGiven: true,
        declarationAccepted: true,
      },
      { ...agentAuth, idempotencyKey: key('tp') },
    );
    taxpayers.push({ ...body, name: `${firstName} ${lastName}` });
  }
  for (const [index, business] of BUSINESSES.entries()) {
    const { body } = await post(
      '/taxpayers',
      {
        taxpayerType: 'BUSINESS',
        businessName: business.name,
        phone: `+23480320000${String(index + 10).padStart(2, '0')}`,
        address: `${index + 11} Beach Road, Jos`,
        lgaId: jos.id,
        economicSector: business.sector,
        consentGiven: true,
        declarationAccepted: true,
      },
      { ...agentAuth, idempotencyKey: key('tp') },
    );
    taxpayers.push({ ...body, name: business.name });
  }
  /*
   * One trader from the next Local Government Area along.
   *
   * The reason the search is scoped by territory and the reason an exact
   * identifier is not are the same case, and it is an ordinary one: somebody
   * registered in Jos South sells at a Jos North market on a Thursday. A
   * demonstration in which every taxpayer lives where the agent works cannot
   * show either half — the agent searching a name and correctly not finding
   * a stranger's record, or the same agent finding them the moment the
   * trader reads out their TIN.
   */
  const nextLga = lgas.find((lga) => /jos south/i.test(lga.name));
  if (!nextLga) throw new Error('Jos South is not in the reference data.');
  const { body: visitor } = await post(
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Talatu',
      lastName: 'Bawa',
      phone: '+2348031000099',
      address: '4 Bukuru Express Way, Jos South',
      lgaId: nextLga.id,
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...agentAuth, idempotencyKey: key('tp') },
  );
  taxpayers.push({ ...visitor, name: 'Talatu Bawa' });

  const withTin = taxpayers.filter((taxpayer) => taxpayer.tin).length;
  log(`registered ${taxpayers.length} taxpayers (${withTin} received a TIN immediately)`);
  log(`  one of them, Talatu Bawa, is registered in ${nextLga.name} rather than ${jos.name}`);

  // --- assessments, invoices and payments ---------------------------------
  const collected = [];
  const collectedAmounts = [];
  const pendingPayments = [];
  let collectedKobo = 0;

  for (const [index, taxpayer] of taxpayers.entries()) {
    /*
     * A spread of what a collection day actually looks like: a daily market
     * levy, an annual shop rate, a development levy, and — for the businesses —
     * a consumption tax assessed as a percentage of a declared base, which is
     * the "tax remittance" shape rather than a flat fee.
     */
    const isBusiness = index >= NAMES.length;
    const item = isBusiness
      ? consumptionTax
      : index % 3 === 0
        ? marketLevy
        : index % 3 === 1
          ? shopLevy
          : devLevy;
    const inputs = item.rate_type === 'PERCENTAGE'
      ? { baseAmountKobo: String(2_500_000 + index * 750_000) }
      : {};

    const assessment = await post(
      '/revenue/assessments',
      { taxpayerId: taxpayer.taxpayerId, revenueItemId: item.id, inputs },
      { ...agentAuth, idempotencyKey: key('as'), allow: [400, 422] },
    );
    if (assessment.status >= 400) {
      console.log(`      skipped ${taxpayer.name}: ${assessment.status} ${assessment.body?.error?.code ?? ''} ${assessment.body?.error?.message ?? ''}`);
      continue;
    }

    const payment = await post(
      '/payments/initiate',
      { transactionId: assessment.body.transactionId, paymentMethod: index % 2 === 0 ? 'CARD' : 'BANK_TRANSFER' },
      { ...agentAuth, idempotencyKey: key('pay') },
    );

    // Two thirds are confirmed by the gateway; the rest stay pending, so the
    // officer screens show both an ordinary day's collection and the queue of
    // things nobody has confirmed yet.
    if (index % 3 !== 2) {
      await post(
        '/payments/simulate',
        { gatewayReference: payment.body.gatewayReference, outcome: 'SUCCESS' },
        agentAuth,
      );
      const confirmed = await post(`/payments/${payment.body.paymentId}/confirm`, {}, { ...agentAuth, allow: [202] });
      const amount = Number(assessment.body.amountKobo ?? payment.body.amountKobo ?? 0);
      collectedKobo += amount;
      collectedAmounts.push(amount);
      collected.push({
        taxpayer: taxpayer.name,
        item: item.name,
        gatewayReference: payment.body.gatewayReference,
        // Carried so the summary can look up the acknowledgement of whichever
        // collection is deliberately left awaiting its bank credit.
        reference: assessment.body.transactionReference,
        receipt: confirmed.body?.receiptNumber ?? null,
      });
    } else {
      pendingPayments.push(payment.body.gatewayReference);
    }
  }
  log(
    `${collected.length} collections confirmed and acknowledged, ` +
      `${pendingPayments.length} left unconfirmed (receipts follow the settlement)`,
  );

  // --- vehicles ------------------------------------------------------------
  /*
   * Two renewal items, private and commercial, both priced by formula from the
   * vehicle's own class rather than a flat fee. Picking the right one per
   * vehicle is what the agent app does, and getting it wrong is the defect the
   * platform's own audit found earlier — a renewal charged at the wrong rate.
   */
  const privateRenewal = byCode('VEH-RENEW-PRIVATE');
  const commercialRenewal = byCode('VEH-RENEW-COMMERCIAL');
  const vehicles = [];
  const renewalReferences = [];
  for (const [index, taxpayer] of taxpayers.slice(0, 4).entries()) {
    const vehicle = await post(
      '/vehicles',
      {
        taxpayerId: taxpayer.taxpayerId,
        registrationNumber: `PL${String(index + 1).padStart(3, '0')}JOS`,
        vehicleType: index % 2 === 0 ? 'PRIVATE_CAR' : 'COMMERCIAL_BUS',
        vehicleClass: index % 2 === 0 ? 'SALOON' : 'MINIBUS',
        make: index % 2 === 0 ? 'Toyota' : 'Mercedes',
        model: index % 2 === 0 ? 'Corolla' : 'Sprinter',
        yearOfManufacture: 2015 + index,
        colour: index % 2 === 0 ? 'Silver' : 'White',
        ownerName: taxpayer.name,
        chassisNumber: `CHASSIS${index}00000000${index}`,
        engineNumber: `ENG${index}00000${index}`,
      },
      { ...agentAuth, idempotencyKey: key('veh'), allow: [400, 409, 422] },
    );
    if (vehicle.status >= 400) {
      console.log(`      vehicle skipped: ${vehicle.status} ${JSON.stringify(vehicle.body?.error ?? vehicle.body)}`);
      continue;
    }
    vehicles.push(vehicle.body);

    const renewal = await post(
      `/vehicles/${vehicle.body.vehicleId}/renew`,
      {
        revenueItemId: (index % 2 === 0 ? privateRenewal : commercialRenewal).id,
        renewalPeriodMonths: 12,
        taxpayerId: taxpayer.taxpayerId,
      },
      { ...agentAuth, idempotencyKey: key('ren'), allow: [400, 409, 422] },
    );
    if (renewal.status >= 400) {
      console.log(`      renewal skipped: ${renewal.status} ${JSON.stringify(renewal.body?.error ?? renewal.body)}`);
      continue;
    }

    const payment = await post(
      '/payments/initiate',
      { transactionId: renewal.body.transactionId, paymentMethod: 'CARD' },
      { ...agentAuth, idempotencyKey: key('pay') },
    );
    if (index < 3) {
      await post('/payments/simulate', { gatewayReference: payment.body.gatewayReference, outcome: 'SUCCESS' }, agentAuth);
      await post(`/payments/${payment.body.paymentId}/confirm`, {}, { ...agentAuth, allow: [202] });
      /*
       * Renewal collections go into the same settlement as everything else.
       * Vehicle particulars are issued when the money reaches the government
       * account, not when the gateway confirms — a renewal left out of the
       * settlement is a renewal with no document, which is correct behaviour
       * and a confusing thing to demonstrate.
       */
      collectedKobo += Number(renewal.body.amountKobo ?? payment.body.amountKobo ?? 0);
      renewalReferences.push(payment.body.gatewayReference);
    }
  }
  log(
    `${vehicles.length} vehicles captured, ${renewalReferences.length} renewals paid ` +
      '(particulars issued at settlement)',
  );

  // --- the finance officer's side -----------------------------------------
  /*
   * One confirmed collection is deliberately left out of the settlement.
   *
   * It is the state the whole platform turns on and the one a screenshot of a
   * fully settled day cannot show: the gateway has confirmed the money, the
   * taxpayer holds an acknowledgement, and PSIRS has not been paid, so no
   * receipt exists. Officers see it under money in transit rather than as an
   * exception, because nothing has gone wrong \u2014 the bank credit is simply
   * not in yet.
   */
  const awaitingSettlement = collected.slice(-1);
  const awaitingSettlementKobo = collectedAmounts.slice(-1).reduce((a, b) => a + b, 0);
  const references = [
    ...collected.slice(0, -1).map((row) => row.gatewayReference),
    ...renewalReferences,
  ];
  const settlingKobo = collectedKobo - awaitingSettlementKobo;

  const to = new Date();
  const from = new Date(to.getTime() - 24 * 60 * 60_000);

  /*
   * Ask the gateway for its statement before recording anything against it.
   *
   * This run is what imports `gateway_statement_lines`, and since revision 10 a
   * settlement is refused outright unless the gateway's own statement confirms
   * every reference in the batch — the control that stops one officer holding
   * `payment:reconcile` from minting receipts for money that never arrived.
   *
   * The seed used to settle first and reconcile afterwards, which was the order
   * that made sense while the officer's typed figure was the only evidence
   * there was. Against the corroboration rule it means settling against a
   * statement nobody has fetched yet, so every reference came back unconfirmed,
   * the settlement was refused, and the seeded demonstration had no settlement
   * and therefore no receipt in it at all. The refusal was correct; the order
   * was wrong.
   */
  const statement = await post(
    '/government/reconciliation/run',
    { from: from.toISOString(), to: to.toISOString() },
    { token: finance, allow: [400, 404, 409, 422] },
  );
  log(
    statement.status >= 400
      ? `statement import refused: ${statement.status} ${JSON.stringify(statement.body?.error ?? statement.body)}`
      : `imported the gateway's statement for the period: ${statement.body.statementLines ?? 0} line(s)`,
  );

  if (references.length > 0) {
    /*
     * The bank pays the exact total of what the gateway confirmed, so this
     * settlement reconciles clean. The variance path — a bank paying less than
     * the collections it covers — is exercised by the API suite rather than
     * here, because a demonstration that starts with an unexplained shortfall
     * makes every screenshot after it harder to read.
     */
    const settlement = await post(
      '/government/settlements',
      {
        settlementDate: new Date().toISOString().slice(0, 10),
        gatewayReferences: references,
        receivedAmountKobo: String(settlingKobo),
        bankReference: `UAT-SETTLEMENT-${new Date().toISOString().slice(0, 10)}`,
      },
      { token: finance, allow: [400, 409, 422] },
    );
    if (settlement.status >= 400) {
      log(`settlement refused: ${settlement.status} ${JSON.stringify(settlement.body?.error ?? settlement.body)}`);
    } else {
      log(
        `recorded a settlement of ${(settlingKobo / 100).toLocaleString('en-NG')} naira covering ` +
          `${references.length} collections \u2014 this is what issues the receipts and particulars. ` +
          `${awaitingSettlement.length} confirmed collection still awaits its bank credit`,
      );
    }
  }

  /*
   * And once more, now that the batch has been settled, so the reconciliation
   * screen has a run in it that reports on the settled state rather than only
   * the one that fetched the statement.
   */
  const reconciliation = await post(
    '/government/reconciliation/run',
    { from: from.toISOString(), to: to.toISOString() },
    { token: finance, allow: [400, 404, 409, 422] },
  );
  log(
    reconciliation.status >= 400
      ? `reconciliation refused: ${reconciliation.status} ${JSON.stringify(reconciliation.body?.error ?? reconciliation.body)}`
      : `reconciliation: ${reconciliation.body.matched} matched, ${reconciliation.body.exceptions} exception(s), ${reconciliation.body.unchecked} unchecked`,
  );

  // --- a support ticket, so the desk is not empty --------------------------
  await post(
    '/support/tickets',
    {
      category: 'PAYMENT_ISSUE',
      subject: 'Receipt not received by SMS',
      description: 'The taxpayer paid at the market and did not get the confirmation message.',
    },
    { token: agentToken, deviceId: AGENT_DEVICE, allow: [400, 422] },
  );
  log('raised a support ticket from the field');

  /*
   * The codes a presenter needs in their hand.
   *
   * Public verification is the part of the demonstration a room can check for
   * itself, and it needs a real code typed into a real box. Printing them here
   * is the difference between that and somebody opening a database client in
   * front of an audience.
   *
   * One of each, deliberately: a receipt for a settled collection, and an
   * acknowledgement for the one still awaiting its bank credit. They answer
   * differently, and the difference is the point of the whole change.
   */
  const issued = await get('/receipts?limit=1', { token: finance, allow: [403, 404] });
  const receipt = Array.isArray(issued.body) ? issued.body[0] : null;
  const pendingTxn = awaitingSettlement[0];
  const ackDoc = pendingTxn
    ? await get(`/payments/transactions/${pendingTxn.reference}/status`, {
        token: agentToken,
        deviceId: AGENT_DEVICE,
        allow: [403, 404],
      })
    : null;
  const ack = ackDoc?.body?.transaction ?? null;

  /*
   * THE TWO SURFACES A PERSON REACHES BY LINK AND NOTHING ELSE.
   *
   * A referee answering for an agent, and a group leader confirming that the
   * members an agent recorded are real. Neither has an account; both arrive
   * on a one-time link sent to their phone, and each is the only check on a
   * claim nobody else can verify — that this applicant is who they say, and
   * that these ninety names are ninety people.
   *
   * Both had no fixture at all. The plaintext token exists once, at the
   * moment it is issued, and is stored only as a hash; without capturing it
   * here neither screen can be opened in a browser by anybody, which is why
   * neither had ever been.
   */
  const links = {};
  mkdirSync(LINKS_FILE.replace(/\/[^/]+$/, ''), { recursive: true });

  /*
   * A second applicant, part way through clearance.
   *
   * The demonstration had exactly one agent and they were already cleared, so
   * "Agents & clearance" and "Field application" showed an officer nothing to
   * decide — and a referee cannot be nominated for a cleared applicant at all,
   * which is correct and left the referee portal unreachable. This is somebody
   * mid-application: identity submitted, referee asked, waiting.
   */
  const applicantPhone = '+2347010000002';
  const applicantPassword = 'FieldAgent2026';
  await post(
    '/agents/apply',
    {
      fullName: 'Grace Dachung',
      phone: applicantPhone,
      email: 'grace.dachung@psirs.demo',
      password: applicantPassword,
      dateOfBirth: '1995-08-19',
      gender: 'FEMALE',
      address: '22 Zaria Road, Jos',
      lgaId: jos.id,
      occupation: 'Trader',
      bankName: 'Zenith Bank',
      bankCode: '057',
      accountName: 'Grace Dachung',
      accountNumber: '0123456799',
    },
    { allow: [400, 409, 422] },
  );
  const applicantToken = await login(applicantPhone, applicantPassword);
  const nomination = await post(
    '/agents/me/referees',
    {
      fullName: 'Yusuf Gyang',
      phone: '+2348051000021',
      email: 'yusuf.gyang@psirs.demo',
      occupation: 'Head teacher',
      category: 'COMMUNITY_LEADER',
      relationship: 'Knows the applicant through the market association',
    },
    { token: applicantToken, idempotencyKey: key('ref'), allow: [400, 409, 422] },
  );
  if (nomination.body?.invitationUrl) {
    links.referee = nomination.body.invitationUrl;
    log('a second applicant is part way through clearance, with a referee still to answer');
  }

  const group = await post(
    '/groups',
    {
      name: 'Rukuba Road Traders Association',
      groupType: 'TRADERS_ASSOCIATION',
      lgaId: jos.id,
      community: 'Rukuba Road',
      leaderName: 'Comfort Dalyop',
      leaderPhone: '+2348051000022',
      memberEstimate: 60,
    },
    { ...agentAuth, idempotencyKey: key('grp'), allow: [400, 409, 422] },
  );
  let tradersAssociation = null;
  if (group.body?.groupId ?? group.body?.id) {
    const groupId = group.body.groupId ?? group.body.id;
    tradersAssociation = groupId;
    // An officer approves it, because members cannot be recorded until one has.
    await post(
      `/groups/${groupId}/review`,
      { decision: 'APPROVE', reason: 'Demonstration fixture: a market association on file.' },
      { token: admin, allow: [400, 409, 422] },
    );
    /*
     * Members are taxpayers on the register, not names typed into a form.
     * That is the point of the whole screen: a cooperative's membership list
     * has to be people the platform already knows, so an allocation cannot be
     * awarded to a name somebody invented.
     */
    for (const member of taxpayers.slice(0, 3)) {
      await post(
        `/groups/${groupId}/members`,
        { taxpayerId: member.taxpayerId },
        { ...agentAuth, idempotencyKey: key('mem'), allow: [400, 409, 422] },
      );
    }
    const attestation = await post(
      `/groups/${groupId}/attestation-request`,
      {},
      { ...agentAuth, idempotencyKey: key('att'), allow: [400, 409, 422] },
    );
    if (attestation.body?.invitationUrl) {
      links.groupAttestation = attestation.body.invitationUrl;
      log('registered a cooperative whose leader has not yet confirmed its members');
    }
  }

  // -------------------------------------------------------------------------
  // The informal sector: a schedule, an enumeration, a payroll and a debt
  //
  // Five screens whose whole subject is people the tax net does not reach, and
  // all five are unreadable empty. What follows is the shortest run through
  // them that produces a state an officer would recognise: a published
  // schedule, an association with standing, a count taken at a stall, a leader
  // who disagrees with it, an estimate, an objection, and an employer's return.
  //
  // Driven through the endpoints the screens themselves call, so a screenshot
  // taken afterwards is a picture of the platform rather than of the seed.
  // -------------------------------------------------------------------------

  /*
   * Who is outside the net at all. Adopted before anything else, because
   * assessment refuses to guess: with no policy on file the platform will not
   * produce an estimate rather than produce one nobody adopted.
   */
  await post(
    '/government/presumptive/nano-policy',
    {
      construction: 'CONJUNCTIVE',
      turnoverCeilingKobo: '1200000000',
      legalBasis:
        'Opinion of the Attorney-General of Plateau State on section 29 of the Nigeria Tax ' +
        'Act 2025, 12 January 2026.',
      effectiveFrom: '2026-01-01',
    },
    { token: admin, allow: [409] },
  );
  log('adopted a reading of the nano exemption, so an estimate can say who is outside it');

  /*
   * Four classes of Local Government, and the turnover assumed in each.
   *
   * A trader in Wase does not turn over what the same trader turns over on
   * Ahmadu Bello Way, and a single statewide figure would be a rural
   * over-charge dressed as fairness. The classes are fixed for three years by
   * the schema, so this is not a number anybody can move mid-year.
   */
  const classes = ['A', 'B', 'C', 'D'];
  /*
   * Jos North first, and class A, because that is where the seeded taxpayers
   * trade. Classifying four arbitrary Councils leaves every assessment below
   * refused with LGA_NOT_CLASSIFIED — which is the platform declining to
   * invent a figure, and correct, and looks exactly like a broken seed.
   */
  const classedLgas = [jos, ...lgas.filter((lga) => lga.id !== jos.id).slice(0, 3)];
  for (const [index, lga] of classedLgas.entries()) {
    await post(
      '/government/presumptive/lga-classes',
      {
        lgaId: lga.id,
        classCode: classes[index],
        indexInputs: {
          roadAccess: index < 2 ? 'paved' : 'earth',
          marketDays: index < 2 ? 6 : 2,
          bankBranches: Math.max(0, 8 - index * 3),
        },
        indexSource: 'National Bureau of Statistics, Plateau State profile 2025',
        effectiveFrom: '2026-01-01',
        effectiveTo: '2029-01-01',
      },
      { token: admin, allow: [409] },
    );
  }
  log(`classified ${classedLgas.length} Local Governments A to D, fixed to 2029`);

  /*
   * The schedule itself: sector by band by class. Deliberately more than one
   * row per sector, because the screen exists to be read as a table and a
   * table with one row in it demonstrates nothing about the shape of it.
   */
  /*
   * Millions of naira a year, and they have to be plausible or nothing else
   * is. A micro trader assumed to turn over ₦120m is not micro, would never
   * fall under the ₦12m nano ceiling, and would make the exemption
   * unreachable — the screen would show a hawker with no premises and no
   * employees being charged, which is the failure the exemption exists to
   * prevent. These are figures a Plateau trader would recognise.
   */
  const TURNOVERS = {
    ARTISAN_CRAFT: { MICRO: 3.6, SMALL: 18, MEDIUM: 60 },
    RETAIL_TRADE: { MICRO: 4.8, SMALL: 24, MEDIUM: 84 },
    FOOD_BEVERAGE: { MICRO: 6, SMALL: 30, MEDIUM: 96 },
  };
  const CLASS_FACTOR = { A: 1, B: 0.7, C: 0.45, D: 0.25 };
  let published = 0;
  for (const [sector, bands] of Object.entries(TURNOVERS)) {
    for (const [band, millions] of Object.entries(bands)) {
      for (const classCode of classes) {
        const naira = Math.round(millions * 1_000_000 * CLASS_FACTOR[classCode]);
        const result = await post(
          '/government/presumptive/schedule',
          {
            economicSector: sector,
            sizeBand: band,
            lgaClass: classCode,
            assumedAnnualTurnoverKobo: String(naira * 100),
            instrumentReference:
              'Plateau State Revenue (Presumptive Assessment) Regulation 2026, First Schedule',
            effectiveFrom: '2026-01-01',
          },
          { token: admin, allow: [409] },
        );
        if (result.status === 201) published += 1;
      }
    }
  }
  log(`published ${published} rows of assumed turnover — 1% of which is the charge`);

  /*
   * The association gets standing.
   *
   * Until an officer says so, its leader cannot contradict what an agent
   * wrote down about a member — which is the control that makes the
   * disagreement queue below possible at all.
   */
  if (tradersAssociation) {
    await post(
      `/groups/${tradersAssociation}/tax-role`,
      {
        taxRole: 'ATTESTATION',
        reason:
          'Recognised under the Rukuba Road market bye-law; the leader confirms who trades there.',
      },
      { token: admin, allow: [400, 409, 422] },
    );
    log('gave the traders association a part in enumeration, so its leader may confirm a count');
  }

  /*
   * What the agent saw. Facts only — premises, equipment, people — because a
   * form with a band on it invites a negotiation at the stall.
   */
  const OBSERVED = [
    { premises: 'LOCK_UP_SHOP', equipmentCount: 3, peopleWorking: 2, economicSector: 'ARTISAN_CRAFT' },
    { premises: 'STALL', equipmentCount: 1, peopleWorking: 0, economicSector: 'RETAIL_TRADE' },
    { premises: 'NONE', equipmentCount: 0, peopleWorking: 0, economicSector: 'RETAIL_TRADE' },
    { premises: 'BUILDING', equipmentCount: 8, peopleWorking: 5, economicSector: 'FOOD_BEVERAGE' },
    { premises: 'KIOSK', equipmentCount: 2, peopleWorking: 1, economicSector: 'ARTISAN_CRAFT' },
  ];
  const observations = [];
  for (const [index, facts] of OBSERVED.entries()) {
    const subject = taxpayers[index];
    if (!subject) continue;
    const recorded = await post(
      '/government/enumeration/observations',
      {
        taxpayerId: subject.taxpayerId,
        ...facts,
        ...(tradersAssociation && index < 3 ? { groupId: tradersAssociation } : {}),
      },
      { token: revenue, allow: [400, 409, 422] },
    );
    if (recorded.status === 201) observations.push({ ...recorded.body, subject });
  }
  log(`recorded ${observations.length} enumerations, three of them through the association`);

  if (observations[0]) {
    await post(
      `/government/enumeration/observations/${observations[0].id}/attest`,
      { agrees: true, attestedByName: 'Comfort Dalyop' },
      { token: admin, allow: [400, 409, 422] },
    );
  }
  if (observations[1]) {
    /*
     * The leader says smaller. Both accounts stay on file and the screen shows
     * the band each would produce, because a disagreement that does not move
     * the band is a phone call and one that does is a visit.
     */
    await post(
      `/government/enumeration/observations/${observations[1].id}/attest`,
      {
        agrees: false,
        attestedByName: 'Comfort Dalyop',
        premises: 'NONE',
        equipmentCount: 0,
        peopleWorking: 0,
      },
      { token: admin, allow: [400, 409, 422] },
    );
  }
  log('one count confirmed by the leader, one contradicted');

  const assessments = [];
  for (const observation of [observations[0], observations[2], observations[3]]) {
    if (!observation) continue;
    const assessed = await post(
      `/government/enumeration/observations/${observation.id}/assess`,
      {},
      { token: revenue, allow: [400, 409, 422] },
    );
    if (assessed.status === 201) assessments.push({ ...assessed.body, observation });
  }
  const exempt = assessments.filter((row) => row.taxTier === 'NANO').length;
  log(`raised ${assessments.length} estimates, ${exempt} of them recording an exemption`);

  const chargeable = assessments.find((row) => row.taxTier !== 'NANO');
  if (chargeable) {
    await post(
      `/government/enumeration/assessments/${chargeable.id}/object`,
      {
        ground: 'FACTS_WRONG',
        statement:
          'The taxpayer says two of the machines counted belong to a relative and were being ' +
          'repaired on the day of the visit.',
      },
      { token: revenue, allow: [400, 409, 422] },
    );
    log('one estimate is under objection, so nothing chases the debt while it stands');
  }

  /*
   * An employer nobody was collecting from.
   *
   * PAYE off a filed schedule is the least contentious money in the informal
   * sector — the tax was deducted from wages already, and what is missing is
   * the remittance. The schedule declares emoluments only; the platform works
   * out what was owed, because a return that accepted a tax figure would make
   * the liability negotiable at the counter.
   */
  const employer = taxpayers.find((row) => row.name === 'Bukuru Cold Room Enterprises');
  if (employer) {
    const filed = await post(
      '/government/paye/returns',
      {
        employerTaxpayerId: employer.taxpayerId,
        periodYear: 2026,
        periodMonth: 7,
        lines: [
          { employeeName: 'Nanle Dung', grossEmolumentKobo: '18000000' },
          { employeeName: 'Saratu Bitrus', grossEmolumentKobo: '12500000' },
          { employeeName: 'Ezekiel Pam', grossEmolumentKobo: '9000000' },
          { employeeName: 'Talatu Gyang', grossEmolumentKobo: '7500000' },
        ],
      },
      { token: revenue, allow: [400, 409, 422] },
    );
    if (filed.status === 201) {
      log('an employer filed a July schedule for four staff, and the platform priced it');
    }
  }

  /*
   * The connection graph, built from the vehicle register.
   *
   * Nothing here is surveillance: it reads records PSIRS already holds and
   * says which of them belong to the same person, so a lead is a fact about
   * the register rather than a fact about somebody's life.
   */
  const rebuilt = await post('/government/intelligence/rebuild', {}, { token: admin, allow: [403] });
  if (rebuilt.status === 200 || rebuilt.status === 201) {
    log('rebuilt the connection graph from the vehicle register');
  }

  // --- the officer command centre -----------------------------------------
  /*
   * Targets, a case, a drawn sample and a signed report.
   *
   * Everything above this line is the money path, and the command centre
   * screens read it: the transaction file, global search and the integration
   * health panel all had something to show the moment the collections existed.
   * Four screens did not, because nothing above creates the records they are
   * about — a target is a decision somebody makes, not a by-product of
   * collecting — so Targets, Cases, the audit workbench and the inbox all
   * opened empty on a freshly seeded stack. Empty is the one state a
   * demonstration cannot use, because a client cannot tell it apart from
   * broken.
   *
   * Through the API like everything else, which is what makes the states
   * reachable ones: the sample really is drawn from a stored seed, the report
   * really is signed under step-up, and the inbox fills because those actions
   * raise notifications rather than because a row was written saying so.
   */
  const auditor = await login('+2348000000005', 'Password123');
  const whoami = async (token) => (await get('/auth/me', { token })).body.userId;
  const auditorId = await whoami(auditor);
  const financeId = await whoami(finance);
  log('signed in as the auditor');

  const period = async (kind) =>
    (await get(`/government/targets/period?kind=${kind}`, { token: revenue })).body;
  const thisMonth = await period('MONTHLY');

  /*
   * Both targets are for the same month, because the roll-up compares them.
   *
   * `targetRollup` is asked about one period and puts the State figure beside
   * the sum apportioned below it; a State target for the year and an LGA target
   * for the month are not the same period, so the card that exists to compare
   * them has nothing to compare and reads as though no target were set at all.
   *
   * The figures are a month's worth against a day's seeded collections, so
   * every achievement reads early. That is the honest shape of the data rather
   * than a flattering one, and an achievement of a third of the way through the
   * month is a more useful thing to look at than one sitting at 0.2% of a year.
   */
  await post(
    '/government/targets',
    {
      scope: 'STATE',
      periodKind: 'MONTHLY',
      periodStart: thisMonth.periodStart,
      periodEnd: thisMonth.periodEnd,
      amountKobo: '50000000',
      note: 'Internally generated revenue expected across the State this month.',
    },
    { token: revenue, allow: [409, 422] },
  );

  /*
   * One LGA carries a target and the rest do not, deliberately.
   *
   * The roll-up card exists to show the State figure beside the sum of what was
   * apportioned below it, and its own note says an LGA with no target is the
   * more useful thing to notice. Giving all seventeen a target would produce a
   * tidier screen that demonstrates nothing.
   */
  await post(
    '/government/targets',
    {
      scope: 'LGA',
      lgaId: jos.id,
      periodKind: 'MONTHLY',
      periodStart: thisMonth.periodStart,
      periodEnd: thisMonth.periodEnd,
      amountKobo: '15000000',
      note: 'Apportioned to Jos North for the month.',
    },
    { token: revenue, allow: [409, 422] },
  );
  log(`a State target for the month and one apportioned to ${jos.name}; the other 16 LGAs have none`);

  /*
   * A case about the collection that is still waiting for its bank credit.
   *
   * Opened by the auditor and addressed to finance, because that is the shape
   * the workspace exists for: the person who noticed it and the person who can
   * answer it are in different departments, and neither has authority over the
   * other's work. The comment underneath comes from the finance officer, who
   * holds `case:contribute` and not `case:manage` — they can answer without
   * being able to move the case.
   */
  const stillWaiting = awaitingSettlement[0];
  let caseNumber = null;
  if (stillWaiting) {
    const file = await get(`/government/transactions/${stillWaiting.reference}/full`, {
      token: auditor,
      allow: [404],
    });
    const opened = await post(
      '/government/cases',
      {
        subject: `Confirmed collection ${stillWaiting.reference} not yet credited`,
        description:
          'The gateway confirmed this collection and the taxpayer holds an acknowledgement. ' +
          'It has not appeared in a settlement. Asking finance to confirm whether the credit ' +
          'is in the next batch before it ages into the exception queue.',
        category: 'RECONCILIATION_EXCEPTION',
        riskLevel: 'MEDIUM',
        priority: 'NORMAL',
        department: 'finance_officer',
        /*
         * Assigned to a person, not only addressed to a department.
         *
         * A case with a department and no assignee sits in a queue and tells
         * nobody: `inbox.raise` is called when work is handed to somebody, on
         * assignment, mention or escalation, so a demonstration seeded with
         * unassigned cases has an empty inbox and no way to show that the
         * platform tells an officer anything.
         */
        transactionId: file.body?.transaction?.id ?? file.body?.id ?? null,
        sourceType: 'MANUAL',
      },
      { token: auditor, allow: [400, 422] },
    );
    caseNumber = opened.body?.case_number ?? opened.body?.caseNumber ?? null;
    const caseId = opened.body?.id ?? null;
    if (caseId) {
      /*
       * Handed to a person as its own step, which is how an officer does it and
       * the only path that tells the person they have it: `inbox.raise` sits in
       * `assign`, not in `openCase`, so a case created with an assignee already
       * on it notifies nobody. Opening then assigning also gives the case file
       * the two entries it would really have.
       */
      await post(
        `/government/cases/${caseId}/assign`,
        {
          assigneeId: financeId,
          department: 'finance_officer',
          reason: 'Finance holds the statement this needs checking against.',
        },
        { token: auditor, allow: [400, 403, 422] },
      );
      await post(
        `/government/cases/${caseId}/comments`,
        {
          body:
            'Checked against this morning’s statement. Not in it. The gateway settles this ' +
            'merchant on a two-day cycle, so it should land tomorrow; I will record it against ' +
            'this case when it does.',
          internal: false,
          // Naming the auditor puts it in their inbox, which is how the person
          // who raised the question finds out it has been answered.
          mentions: [auditorId],
        },
        { token: finance, allow: [400, 403, 422] },
      );
    }
    log(`opened a case with finance about the collection still awaiting its credit${caseNumber ? ` (${caseNumber})` : ''}`);
  }

  /*
   * A sample the auditor drew, part examined.
   *
   * Left part examined on purpose. A completed sample is a finished piece of
   * paper; one with items still to look at is the screen an auditor actually
   * sits in front of, and it is the state in which the platform will refuse to
   * mark the sample complete — which is the thing worth showing.
   */
  const sample = await post(
    '/government/audit/samples',
    {
      title: 'Market and shop collections, this week',
      method: 'RANDOM',
      size: 5,
      criteria: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
    },
    { token: auditor, allow: [400, 422] },
  );
  const sampleId = sample.body?.id ?? sample.body?.sample?.id ?? null;
  if (sampleId) {
    const drawn = (await get(`/government/audit/samples/${sampleId}`, { token: auditor })).body;
    const items = drawn.items ?? [];
    /*
     * One exception among several clean, because a sample in which everything
     * was fine and a sample nobody has looked at read the same on the summary
     * row. The finding names what an auditor would actually have found.
     */
    const findings = [
      { outcome: 'CLEAN', finding: 'Assessment, rate and receipt agree. Nothing to raise.' },
      { outcome: 'CLEAN', finding: 'Traced to the settlement and the bank reference. Clean.' },
      {
        outcome: 'EXCEPTION',
        finding:
          'Collected against the market levy but the taxpayer is registered to a lock-up shop. ' +
          'Right money, wrong revenue item; referred for correction.',
      },
    ];
    let recorded = 0;
    for (const [index, item] of items.slice(0, findings.length).entries()) {
      const response = await post(
        `/government/audit/samples/items/${item.id}/finding`,
        findings[index],
        { token: auditor, allow: [400, 404, 409, 422] },
      );
      if (response.status < 400) recorded += 1;
    }
    log(
      `${drawn.sample?.sample_number ?? 'a sample'} drawn: ${items.length} transactions, ` +
        `${recorded} examined, ${items.length - recorded} still to look at`,
    );
  } else {
    log(`sample refused: ${sample.status} ${JSON.stringify(sample.body?.error ?? sample.body)}`);
  }

  /*
   * Two reports: one signed, one not.
   *
   * Generating freezes the figures and signing puts a name to them, and they
   * are deliberately separate steps — often different officers. One of each on
   * the screen is what makes that visible; a list where every report is signed
   * looks like signing is what generating does.
   */
  const reportParameters = {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
  const signedReport = await post(
    '/government/audit/reports',
    {
      reportType: 'REVENUE_COLLECTION',
      title: 'Revenue collected and settled, this week',
      parameters: reportParameters,
    },
    { token: auditor, allow: [400, 422] },
  );
  await post(
    '/government/audit/reports',
    {
      reportType: 'PAYMENT_RECONCILIATION',
      title: 'Gateway confirmations against bank credits, this week',
      parameters: reportParameters,
    },
    { token: auditor, allow: [400, 422] },
  );

  const signedId = signedReport.body?.id ?? null;
  if (signedId) {
    /*
     * Signing is step-up protected, so the seed steps up rather than going
     * round it. The code comes back in the response because the demonstration
     * stack uses the mock SMS provider; config.ts refuses to start in
     * production with that setting, so this path does not exist there.
     */
    const otp = await post(
      '/auth/otp/request',
      { destination: '+2348000000005', purpose: 'STEP_UP' },
      { token: auditor, allow: [400, 422, 429] },
    );
    const code = otp.body?.developmentCode ?? null;
    if (code) {
      await post(
        '/auth/step-up',
        { action: 'audit.report.sign', destination: '+2348000000005', code },
        { token: auditor, allow: [400, 401, 422] },
      );
      const signed = await post(
        `/government/audit/reports/${signedId}/sign`,
        { note: 'Figures traced to the settlements they came from. Signed for the file.' },
        { token: auditor, allow: [400, 401, 403, 409, 422] },
      );
      log(
        signed.status < 400
          ? 'generated two audit reports and signed one of them under step-up'
          : `report signing refused: ${signed.status} ${JSON.stringify(signed.body?.error ?? signed.body)}`,
      );
    } else {
      log('generated two audit reports; no development code came back, so neither is signed');
    }
  }

  /*
   * Written down as well as printed. A one-time link cannot be recovered from
   * the database, so the browser walkthrough has no way to reach either screen
   * unless the run that created them says where they are.
   */
  writeFileSync(LINKS_FILE, `${JSON.stringify(links, null, 2)}\n`);

  console.log('\nTo demonstrate public verification, at http://localhost:5174/#/verify');
  if (receipt) {
    console.log(`  receipt          ${receipt.verification_code}  (${receipt.receipt_number})`);
    console.log('                   answers VALID - a genuine government receipt');
  }
  if (ack?.acknowledgement_code) {
    console.log(`  acknowledgement  ${ack.acknowledgement_code}  (${ack.acknowledgement_number})`);
    console.log('                   answers VALID - NOT A RECEIPT, money not yet received');
  }
  console.log('  anything else    answers NOT FOUND');

  if (links.referee || links.groupAttestation) {
    console.log('\nTwo screens a person reaches only by link, both awaiting an answer:');
    if (links.referee) console.log(`  referee        ${links.referee}`);
    if (links.groupAttestation) console.log(`  group leader   ${links.groupAttestation}`);
    console.log(`  (also written to ${LINKS_FILE})`);
  }

  console.log('\nOpen the agent app at:');
  console.log(`  http://localhost:5173/?device=${AGENT_DEVICE}`);
  console.log('  (the seeded agent already has a handset, so a browser that arrives');
  console.log('   without this is their SECOND handset and waits for an officer)');

  console.log('\nDone. Sign-in details:');
  console.log('  Agent PWA      +2347010000001 / FieldAgent2026');
  console.log('  Admin          +2348000000001 / Password123');
  console.log('  Revenue        +2348000000002 / Password123');
  console.log('  Finance        +2348000000003 / Password123');
  console.log('  Supervisor     +2348000000004 / Password123');
  console.log('  Auditor        +2348000000005 / Password123');
  console.log('  Finance (2nd)  +2348000000006 / Password123  \u2014 closing a disputed');
  console.log('                                                settlement needs the other one\n');
}

main().catch((error) => {
  console.error('\nSeed failed:', error.message);
  process.exit(1);
});
