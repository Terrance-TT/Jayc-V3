import { env } from 'node:process';

export function getAPIKey(cloudflareEnv: Env) {
  return env.MOONSHOT_API_KEY || cloudflareEnv.MOONSHOT_API_KEY;
}
