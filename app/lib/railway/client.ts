/**
 * Browser-side Railway client for the publish wizard. Every call tunnels
 * through /api/railway (CORS proxy); the user's personal token is stored in
 * localStorage only and sent per request — same pattern as the GitHub token.
 */

const TOKEN_STORAGE_KEY = 'jayc_railway_token';

export function getSavedRailwayToken(): string {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveRailwayToken(token: string) {
  try {
    if (token) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // localStorage unavailable — token simply won't persist
  }
}

interface GraphqlEnvelope<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

async function railway<T>(token: string, query: string, variables?: Record<string, unknown>): Promise<T> {
  const response = await fetch('/api/railway', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, query, variables }),
  });

  if (!response.ok) {
    throw new Error(`Railway request failed (HTTP ${response.status})`);
  }

  const envelope = (await response.json()) as GraphqlEnvelope<T>;

  if (envelope.errors?.length) {
    throw new Error(envelope.errors.map((error) => error.message).join('; '));
  }

  if (!envelope.data) {
    throw new Error('Railway returned an empty response');
  }

  return envelope.data;
}

export async function validateRailwayToken(token: string): Promise<string> {
  const data = await railway<{ me: { name: string } | null }>(token, 'query { me { name } }');

  if (!data.me) {
    throw new Error('Token rejected by Railway — create one at railway.app/account/tokens');
  }

  return data.me.name;
}

export async function createProject(token: string, name: string): Promise<string> {
  const data = await railway<{ projectCreate: { id: string } }>(
    token,
    'mutation ($name: String!) { projectCreate(input: { name: $name }) { id } }',
    { name },
  );

  return data.projectCreate.id;
}

export async function getProductionEnvironmentId(token: string, projectId: string): Promise<string> {
  const data = await railway<{ project: { environments: Array<{ id: string; name: string }> } }>(
    token,
    'query ($projectId: String!) { project(id: $projectId) { environments { id name } } }',
    { projectId },
  );

  const production =
    data.project.environments.find((environment) => environment.name === 'production') ?? data.project.environments[0];

  if (!production) {
    throw new Error('No environment found on the new project');
  }

  return production.id;
}

export async function createServiceFromRepo(
  token: string,
  projectId: string,
  repoFullName: string,
  serviceName: string,
): Promise<string> {
  const data = await railway<{ serviceCreate: { id: string } }>(
    token,
    'mutation ($input: ServiceCreateInput!) { serviceCreate(input: $input) { id } }',
    { input: { projectId, name: serviceName, source: { repo: repoFullName } } },
  );

  return data.serviceCreate.id;
}

export async function upsertVariable(
  token: string,
  ids: { projectId: string; environmentId: string; serviceId: string },
  name: string,
  value: string,
): Promise<void> {
  await railway(token, 'mutation ($input: VariableUpsertInput!) { variableUpsert(input: $input) }', {
    input: { ...ids, name, value },
  });
}

/**
 * Triggers a deploy of the service. Creating a service from a repo usually
 * auto-deploys, so a rejected trigger is tolerated (returns false) — the
 * domain step below is what the user actually needs.
 */
export async function triggerDeploy(token: string, serviceId: string, environmentId: string): Promise<boolean> {
  try {
    await railway(token, 'mutation ($input: ServiceInstanceDeployInput!) { serviceInstanceDeployV2(input: $input) }', {
      input: { serviceId, environmentId },
    });

    return true;
  } catch {
    return false;
  }
}

export async function createServiceDomain(token: string, serviceId: string, environmentId: string): Promise<string> {
  const data = await railway<{ serviceDomainCreate: { domain: string } }>(
    token,
    'mutation ($input: ServiceDomainCreateInput!) { serviceDomainCreate(input: $input) { domain } }',
    { input: { serviceId, environmentId } },
  );

  return data.serviceDomainCreate.domain;
}
