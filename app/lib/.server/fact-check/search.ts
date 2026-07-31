import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('FactCheck');

const TAVILY_ENDPOINT = 'https://api.tavily.com/search';

/** hard caps so a search response can never blow up the chat payload */
const MAX_RESULTS = 5;
const MAX_SNIPPET_LENGTH = 600;
const MAX_TOTAL_LENGTH = 4000;

interface TavilyResult {
  title?: string;
  content?: string;
  url?: string;
}

interface TavilyResponse {
  answer?: string;
  results?: TavilyResult[];
}

/**
 * Searches the web for reference facts about a topic using Tavily.
 *
 * Returns a compact, formatted digest (Tavily's synthesized answer plus the
 * top result snippets, hard-truncated) or null when nothing useful was found
 * or the request failed. Never throws — fact-check is best-effort by design.
 */
export async function searchFacts(query: string, apiKey: string): Promise<string | null> {
  try {
    const response = await fetch(TAVILY_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },

      // hard ceiling on latency: a slow search must never stall the chat
      signal: AbortSignal.timeout(8_000),
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: MAX_RESULTS,
        include_answer: true,
      }),
    });

    if (!response.ok) {
      logger.warn(`Tavily request failed with status ${response.status}`);

      return null;
    }

    const data = (await response.json()) as TavilyResponse;
    const sections: string[] = [];

    if (data.answer && data.answer.trim().length > 0) {
      sections.push(`Summary: ${data.answer.trim()}`);
    }

    for (const result of data.results ?? []) {
      if (!result.content || result.content.trim().length === 0) {
        continue;
      }

      const snippet = result.content.trim().slice(0, MAX_SNIPPET_LENGTH);
      const source = result.url ? ` (source: ${result.url})` : '';

      sections.push(`- ${result.title?.trim() || 'Result'}: ${snippet}${source}`);
    }

    if (sections.length === 0) {
      return null;
    }

    return sections.join('\n\n').slice(0, MAX_TOTAL_LENGTH);
  } catch (error) {
    logger.warn('Fact search failed:', error);

    return null;
  }
}
