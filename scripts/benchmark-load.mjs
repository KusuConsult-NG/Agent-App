#!/usr/bin/env node
/**
 * PSIRS High-Throughput Concurrency & Load Benchmark Runner.
 *
 * Simulates high-density concurrent traffic from field revenue agents
 * and public QR receipt verifications.
 *
 * Usage:
 *   node scripts/benchmark-load.mjs [DURATION_SECONDS] [CONCURRENCY]
 */

const DURATION_SEC = Number.parseInt(process.argv[2] || '5', 10);
const CONCURRENCY = Number.parseInt(process.argv[3] || '50', 10);
const BASE_URL = process.env.API_URL || 'http://127.0.0.1:4000';

const ENDPOINTS = [
  { path: '/health', weight: 3 },
  { path: '/metrics', weight: 2 },
  { path: '/api/v1/reference/lgas', weight: 5 },
  { path: '/api/v1/verify/NOSUCHRECEIPTCODE', weight: 4 },
];

console.log('=== PSIRS High-Throughput Concurrency Benchmark ===');
console.log(`Target:      ${BASE_URL}`);
console.log(`Duration:    ${DURATION_SEC}s`);
console.log(`Concurrency: ${CONCURRENCY} workers`);
console.log('----------------------------------------------------');

const latencies = [];
let totalRequests = 0;
let successRequests = 0;
let errorRequests = 0;

function getRandomEndpoint() {
  const totalWeight = ENDPOINTS.reduce((sum, e) => sum + e.weight, 0);
  let random = Math.random() * totalWeight;
  for (const ep of ENDPOINTS) {
    if (random < ep.weight) return ep.path;
    random -= ep.weight;
  }
  return ENDPOINTS[0].path;
}

async function worker(stopAt) {
  while (Date.now() < stopAt) {
    const path = getRandomEndpoint();
    const start = performance.now();
    try {
      const res = await fetch(`${BASE_URL}${path}`, {
        headers: { 'x-app-version': '1.0.0' },
      });
      const duration = performance.now() - start;
      latencies.push(duration);
      totalRequests++;

      if (res.status < 500) {
        // 404 on NOSUCHRECEIPTCODE is a successful negative response
        successRequests++;
      } else {
        errorRequests++;
      }
    } catch {
      errorRequests++;
      totalRequests++;
    }
  }
}

async function runBenchmark() {
  // First check target is reachable
  try {
    const health = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(3000) });
    if (!health.ok) {
      console.error(`Target returned status ${health.status}. Make sure API is running on ${BASE_URL}`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`Could not reach ${BASE_URL}/health. Start the API before running the benchmark: ${err.message}`);
    process.exit(1);
  }

  const stopAt = Date.now() + DURATION_SEC * 1000;
  const workers = Array.from({ length: CONCURRENCY }, () => worker(stopAt));

  await Promise.all(workers);

  latencies.sort((a, b) => a - b);

  const getPercentile = (p) => {
    if (latencies.length === 0) return 0;
    const index = Math.min(Math.floor((p / 100) * latencies.length), latencies.length - 1);
    return latencies[index].toFixed(2);
  };

  const avgLatency =
    latencies.length > 0 ? (latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(2) : 0;
  const reqPerSec = (totalRequests / DURATION_SEC).toFixed(1);

  console.log('\n=== Benchmark Results ===');
  console.log(`Total Requests:    ${totalRequests}`);
  console.log(`Successful:        ${successRequests} (${((successRequests / (totalRequests || 1)) * 100).toFixed(1)}%)`);
  console.log(`Errors (HTTP 5xx): ${errorRequests}`);
  console.log(`Throughput:        ${reqPerSec} req/sec`);
  console.log(`Latency (Avg):     ${avgLatency} ms`);
  console.log(`Latency (P50):     ${getPercentile(50)} ms`);
  console.log(`Latency (P90):     ${getPercentile(90)} ms`);
  console.log(`Latency (P95):     ${getPercentile(95)} ms`);
  console.log(`Latency (P99):     ${getPercentile(99)} ms`);
  console.log('----------------------------------------------------');
  console.log('Benchmark completed successfully.\n');
}

runBenchmark().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
