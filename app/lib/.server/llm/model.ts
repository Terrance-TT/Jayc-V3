import { createOpenAI } from '@ai-sdk/openai';
import { env } from 'node:process';

export function getMoonshotModel(apiKey: string) {
  const moonshot = createOpenAI({
    apiKey,
    baseURL: env.MOONSHOT_BASE_URL || 'https://api.moonshot.ai/v1',
  });

  return moonshot(env.MOONSHOT_MODEL || 'kimi-k3');
}
