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

const API = process.argv.includes('--api')
  ? process.argv[process.argv.indexOf('--api') + 1]
  : (process.env.UAT_API ?? 'http://localhost:4000');

/** Everything is mounted under the versioned prefix; nothing answers at the root. */
const BASE = `${API}/api/v1`;

const AGENT_DEVICE = 'uat-agent-device-000001';
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

const BUSINESSES = [
  'Jos Main Market Provisions',
  'Rukuba Road Motor Spares',
  'Bukuru Cold Room Enterprises',
  'Plateau Agro Supplies',
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
  for (const [index, businessName] of BUSINESSES.entries()) {
    const { body } = await post(
      '/taxpayers',
      {
        taxpayerType: 'BUSINESS',
        businessName,
        phone: `+23480320000${String(index + 10).padStart(2, '0')}`,
        address: `${index + 11} Beach Road, Jos`,
        lgaId: jos.id,
        consentGiven: true,
        declarationAccepted: true,
      },
      { ...agentAuth, idempotencyKey: key('tp') },
    );
    taxpayers.push({ ...body, name: businessName });
  }
  const withTin = taxpayers.filter((taxpayer) => taxpayer.tin).length;
  log(`registered ${taxpayers.length} taxpayers (${withTin} received a TIN immediately)`);

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

  const to = new Date();
  const from = new Date(to.getTime() - 24 * 60 * 60_000);
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
