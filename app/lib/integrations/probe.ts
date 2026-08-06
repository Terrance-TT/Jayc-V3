import { webcontainer } from '~/lib/webcontainer';
import type { ProbeConfig } from './catalog';

/**
 * Live key validation. Runs INSIDE the user's WebContainer (browser sandbox)
 * talking directly to the provider — the key never transits Jayc's backend.
 *
 * Safety rules (see the plan's security model):
 *  - only the hand-verified catalog endpoints are ever contacted;
 *  - the key is passed via the process environment, never on the command
 *    line, never written to disk, never echoed to the terminal;
 *  - the probe script prints a single JSON status line — never the key.
 */

export type ProbeStatus = 'ok' | 'auth_failed' | 'unreachable';

export interface ProbeResult {
  status: ProbeStatus;

  /** the endpoint that answered, when one did (regional detection) */
  endpoint?: string;
}

const PER_ENDPOINT_TIMEOUT_MS = 8_000;
const OVERALL_TIMEOUT_MS = 30_000;

/**
 * The probe script. Everything variable arrives via process.env; the script
 * itself is static and contains no secrets. It tries each candidate endpoint
 * in order: a matching status proves the key (and region), 401/403 means the
 * key was rejected, anything else moves on to the next endpoint.
 */
const PROBE_SCRIPT = `
const endpoints = JSON.parse(process.env.PROBE_ENDPOINTS);
const headersTpl = JSON.parse(process.env.PROBE_HEADERS);
const values = JSON.parse(process.env.PROBE_VALUES);
const okStatus = JSON.parse(process.env.PROBE_OK_STATUS);
const key = process.env.PROBE_KEY;
const path = process.env.PROBE_PATH;
const method = process.env.PROBE_METHOD;

const interpolate = (text) =>
  text
    .replace(/\\$\\{key\\}/g, key)
    .replace(/\\$\\{env:([A-Z0-9_]+)\\}/g, (_m, name) => values[name] ?? '');

const finish = (status, endpoint) => {
  console.log(JSON.stringify({ status, endpoint }));
  process.exit(0);
};

(async () => {
  let sawAuthFailure = false;

  for (const endpointTemplate of endpoints) {
    const endpoint = interpolate(endpointTemplate);

    if (!endpoint.startsWith('http')) {
      continue; // unresolved \${env:…} template — value not provided yet
    }

    const headers = {};

    for (const [name, template] of Object.entries(headersTpl)) {
      headers[name] = interpolate(template);
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), ${PER_ENDPOINT_TIMEOUT_MS});

      const response = await fetch(endpoint + interpolate(path), { method, headers, signal: controller.signal });

      clearTimeout(timer);

      if (okStatus.includes(response.status)) {
        finish('ok', endpoint);
      }

      if (response.status === 401 || response.status === 403) {
        sawAuthFailure = true;
      }
    } catch {
      // network/DNS/timeout — try the next endpoint
    }
  }

  finish(sawAuthFailure ? 'auth_failed' : 'unreachable');
})();
`;

export async function probeKey(probe: ProbeConfig, values: Record<string, string>): Promise<ProbeResult> {
  const key = values[probe.keyEnv];

  if (!key) {
    return { status: 'unreachable' };
  }

  const container = await webcontainer;

  let process;

  try {
    process = await container.spawn('node', ['-e', PROBE_SCRIPT], {
      env: {
        PROBE_KEY: key,
        PROBE_ENDPOINTS: JSON.stringify(probe.endpoints),
        PROBE_PATH: probe.path,
        PROBE_METHOD: probe.method ?? 'GET',
        PROBE_HEADERS: JSON.stringify(probe.headers),
        PROBE_OK_STATUS: JSON.stringify(probe.okStatus),
        PROBE_VALUES: JSON.stringify(values),
      },
    });
  } catch {
    return { status: 'unreachable' };
  }

  let output = '';

  const collecting = process.output.pipeTo(
    new WritableStream({
      write(data) {
        output += data;
      },
    }),
  );

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('probe timed out')), OVERALL_TIMEOUT_MS),
  );

  try {
    await Promise.race([collecting, timeout]);
  } catch {
    process.kill();

    return { status: 'unreachable' };
  }

  try {
    const line = output.trim().split('\n').pop() ?? '';
    const parsed = JSON.parse(line) as { status?: unknown; endpoint?: unknown };

    if (parsed.status === 'ok' || parsed.status === 'auth_failed' || parsed.status === 'unreachable') {
      return { status: parsed.status, endpoint: typeof parsed.endpoint === 'string' ? parsed.endpoint : undefined };
    }
  } catch {
    // fall through — unparseable output is treated as "couldn't verify"
  }

  return { status: 'unreachable' };
}
