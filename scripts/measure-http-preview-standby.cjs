#!/usr/bin/env node
'use strict';

const http = require('node:http');
const readline = require('node:readline');

const PROBE_INTERVAL_MS = 500;
const DEFAULT_TIMEOUT_MS = 2_000;

const usage = () => {
  console.error(
    'Usage: HOMEBACK_TOKEN=<64-hex-token> node scripts/measure-http-preview-standby.cjs http://TV-IP:9876',
  );
};

const token = process.env.HOMEBACK_TOKEN?.trim() ?? '';
if (!/^[0-9a-f]{64}$/.test(token)) {
  usage();
  console.error('HOMEBACK_TOKEN must contain the 64-hex HomeBack API token.');
  process.exit(64);
}

const rawUrl = process.argv[2];
if (!rawUrl) {
  usage();
  process.exit(64);
}

let statusUrl;
try {
  statusUrl = new URL(rawUrl);
} catch {
  console.error('The HomeBack URL is invalid.');
  process.exit(64);
}
if (statusUrl.protocol !== 'http:') {
  console.error('The Preview listener is plain HTTP; use an http:// URL on a trusted LAN.');
  process.exit(64);
}
statusUrl.username = '';
statusUrl.password = '';
statusUrl.pathname = '/status';
statusUrl.search = '';
statusUrl.hash = '';

const configuredTimeout = Number(process.env.HOMEBACK_PROBE_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
if (!Number.isInteger(configuredTimeout) || configuredTimeout < PROBE_INTERVAL_MS || configuredTimeout > 30_000) {
  console.error(`HOMEBACK_PROBE_TIMEOUT_MS must be an integer from ${PROBE_INTERVAL_MS} to 30000.`);
  process.exit(64);
}
const probeTimeoutMs = configuredTimeout;

let sequence = 0;
let timer = null;
let input = null;
let stopped = false;
let standbyMarkedAt = null;
let wakeMarkedAt = null;
let firstStandbyFailure = null;
let firstWakeSuccess = null;

const iso = timestamp => new Date(timestamp).toISOString();
const elapsedMs = start => Number(process.hrtime.bigint() - start) / 1_000_000;

const probe = () => {
  const id = ++sequence;
  const startedAt = Date.now();
  const startedMono = process.hrtime.bigint();

  return new Promise(resolve => {
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      resolve({
        id,
        startedAt,
        endedAt: Date.now(),
        latencyMs: elapsedMs(startedMono),
        ...result,
      });
    };

    const request = http.request(
      statusUrl,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Connection: 'close',
        },
        agent: false,
      },
      response => {
        response.resume();
        response.once('end', () => {
          if (response.statusCode === 200) finish({ ready: true, mode: 'HTTP_200' });
          else finish({ ready: false, mode: `HTTP_${response.statusCode ?? 'UNKNOWN'}` });
        });
      },
    );

    request.setTimeout(probeTimeoutMs, () => {
      const error = new Error('HomeBack status probe timed out.');
      error.code = 'ETIMEDOUT';
      request.destroy(error);
    });
    request.once('error', error => {
      const mode = typeof error.code === 'string' ? error.code : error.name || 'ERROR';
      finish({ ready: false, mode });
    });
    request.end();
  });
};

const printProbe = result => {
  console.log(
    [
      'probe',
      result.id,
      iso(result.endedAt),
      result.ready ? 'ready' : 'unavailable',
      result.mode,
      result.latencyMs.toFixed(1),
    ].join(','),
  );
};

const stop = code => {
  if (stopped) return;
  stopped = true;
  if (timer) clearInterval(timer);
  timer = null;
  if (input) input.close();
  input = null;
  process.exitCode = code;
};

const printSummaryAndStop = () => {
  if (!firstStandbyFailure || !firstWakeSuccess || standbyMarkedAt === null || wakeMarkedAt === null) return;
  console.log('summary');
  console.log(`standby_failure_mode=${firstStandbyFailure.mode}`);
  console.log(`standby_probe_latency_ms=${firstStandbyFailure.latencyMs.toFixed(1)}`);
  console.log(`standby_detection_ms=${firstStandbyFailure.endedAt - standbyMarkedAt}`);
  console.log(`wake_to_http_ready_ms=${firstWakeSuccess.endedAt - wakeMarkedAt}`);
  stop(0);
};

const handleResult = result => {
  if (stopped) return;
  printProbe(result);

  if (
    standbyMarkedAt !== null &&
    firstStandbyFailure === null &&
    result.startedAt >= standbyMarkedAt &&
    !result.ready
  ) {
    firstStandbyFailure = result;
    console.log(
      `standby_failure,${iso(result.endedAt)},${result.mode},${result.latencyMs.toFixed(1)},${result.endedAt - standbyMarkedAt}`,
    );
  }

  if (
    wakeMarkedAt !== null &&
    firstWakeSuccess === null &&
    result.startedAt >= wakeMarkedAt &&
    result.ready
  ) {
    firstWakeSuccess = result;
    console.log(`wake_ready,${iso(result.endedAt)},${result.endedAt - wakeMarkedAt}`);
    printSummaryAndStop();
  }
};

const launchProbe = () => {
  void probe().then(handleResult);
};

const startMeasurement = async () => {
  const baseline = await probe();
  printProbe(baseline);
  if (!baseline.ready) {
    console.error(
      `Baseline /status probe failed (${baseline.mode}, ${baseline.latencyMs.toFixed(1)} ms). ` +
        'Verify listener status, bearer token and allowedSources before measuring standby.',
    );
    stop(1);
    return;
  }

  console.log(`probe_interval_ms=${PROBE_INTERVAL_MS}`);
  console.log(`probe_timeout_ms=${probeTimeoutMs}`);
  console.log('Press Enter at the moment you send the TV into standby.');

  input = readline.createInterface({ input: process.stdin, output: process.stdout });
  input.on('line', () => {
    if (standbyMarkedAt === null) {
      standbyMarkedAt = Date.now();
      console.log(`standby_mark,${iso(standbyMarkedAt)}`);
      console.log('Wait until an unavailable probe is recorded, then press Enter when you send the wake command.');
      return;
    }

    if (wakeMarkedAt === null) {
      wakeMarkedAt = Date.now();
      console.log(`wake_mark,${iso(wakeMarkedAt)}`);
      if (firstStandbyFailure === null) {
        console.log('warning,wake_marked_before_standby_failure_was_observed');
      }
      console.log('Waiting for the first authenticated HTTP 200 after the wake mark...');
    }
  });
  input.once('close', () => {
    if (!stopped) {
      console.error('Input closed before the measurement completed.');
      stop(130);
    }
  });

  timer = setInterval(launchProbe, PROBE_INTERVAL_MS);
  launchProbe();
};

process.once('SIGINT', () => {
  console.error('Measurement interrupted.');
  stop(130);
});

void startMeasurement();
