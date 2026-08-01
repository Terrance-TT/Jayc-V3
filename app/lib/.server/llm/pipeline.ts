import { createScopedLogger } from '~/utils/logger';
import { isClarifyingQuestions } from '~/utils/thinking';
import { queryFromMessage, searchFacts } from '~/lib/.server/fact-check/search';
import {
  BUILD_EFFORT,
  BUILD_MAX_TOKENS,
  EXPAND_EFFORT,
  EXPAND_MAX_TOKENS,
  LIGHT_EFFORT,
  MAX_RESPONSE_SEGMENTS,
  PLAN_EFFORT,
  PLAN_MAX_TOKENS,
  THINKING_BUDGET_MS,
  VERIFY_EFFORT,
  VERIFY_MAX_TOKENS,
  type GenerationPlan,
  type ReasoningEffort,
} from './constants';
import {
  BUILD_PHASE_PROMPT,
  BUILD_TIMEOUT_PROMPT,
  CONTINUE_PROMPT,
  EXPAND_BRIDGE_PROMPT,
  EXPAND_PHASE_SUFFIX,
  PLAN_PHASE_SUFFIX,
  VERIFY_BRIDGE_PROMPT,
  VERIFY_PHASE_SUFFIX,
} from './prompts';
import { streamText, type Messages, type StreamingOptions } from './stream-text';
import type SwitchableStream from './switchable-stream';
import type { ByokConfig } from './model';

const logger = createScopedLogger('GenerationPipeline');

interface RunGenerationParams {
  messages: Messages;
  env: Env;
  stream: SwitchableStream;
  generation: GenerationPlan;
  projectGraph?: string;
  webSearch?: string;
  byok?: ByokConfig;

  /** true for first-build turns (build-like first message or answered clarifying questions) */
  isFirstBuild?: boolean;
}

interface PassParams {
  messages: Messages;
  effort: ReasoningEffort;
  maxTokens: number;
  systemSuffix?: string;
  abortSignal?: AbortSignal;
}

interface PassResult {
  text: string;
  finishReason: string;
}

/**
 * Tees an AI-protocol stream to accumulate the full text while passing all
 * bytes through untouched. The protocol is newline-delimited and upstream
 * stages forward complete frames (see switchable-stream.ts), so whole
 * `0:"..."` text frames arrive intact per chunk; anything unparseable is
 * ignored. The accumulated text survives aborts, which is what the
 * thinking-clock salvage path needs.
 */
function createTextAccumulator() {
  let text = '';
  const decoder = new TextDecoder();

  const stream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk);

      const decoded = decoder.decode(chunk, { stream: true });

      for (const line of decoded.split('\n')) {
        if (!line.startsWith('0:')) {
          continue;
        }

        try {
          text += JSON.parse(line.slice(2)) as string;
        } catch {
          // not a text frame — ignore
        }
      }
    },
  });

  return { stream, getText: () => text };
}

/**
 * Drives the whole generation for one chat request: resolves the plan,
 * runs the thinking phases when pipelined, then the build pass with
 * continuations, and closes the stream. The caller returns the HTTP
 * response immediately while this runs in the background.
 */
export async function runGeneration(params: RunGenerationParams): Promise<void> {
  const { stream, generation } = params;

  try {
    if (generation.pipeline) {
      const { buildMessages, timedOut } = await runThinkingPhases(params);

      if (buildMessages === null) {
        // clarifying questions were asked — the reply is complete
        stream.close();

        return;
      }

      await params.stream.switchSource(markerStream(timedOut ? BUILD_TIMEOUT_MARKER : BUILD_MARKER));

      await streamWithContinuations(params, buildMessages, BUILD_EFFORT, BUILD_MAX_TOKENS);

      await maybeVerifyFacts(params, buildMessages);
    } else {
      await streamWithContinuations(params, params.messages, generation.effort, generation.maxTokens);
    }

    stream.close();
  } catch (error) {
    logger.error('Generation failed', error);
    stream.error(error);
  }
}

/**
 * Visible phase markers, injected between passes so the user can see the
 * pipeline move from thinking to building.
 */
const EXPAND_MARKER = '\n\n---\n\n🕸 **Expanding the design…**\n\n';
const BUILD_MARKER = '\n\n---\n\n🔨 **Design locked — building now.** Watch the files appear on the right.\n\n';
const BUILD_TIMEOUT_MARKER =
  '\n\n---\n\n🔨 **Thinking time was up — building from the current design.** Watch the files appear on the right.\n\n';

/**
 * A one-frame stream carrying a marker line as a protocol-valid text part.
 */
function markerStream(text: string): ReadableStream<Uint8Array> {
  const frame = new TextEncoder().encode(`0:${JSON.stringify(text)}\n`);

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(frame);
      controller.close();
    },
  });
}

const VERIFY_MARKER = '\n\n---\n\n🔍 **Verifying domain facts…**\n\n';

/**
 * Post-build domain verification (first-build pipelines with a Tavily key
 * only): a fresh targeted search, then a bounded pass that re-reads the
 * domain-rules file against the facts and fixes any mismatches. Silent skip
 * on missing key or any failure — never blocks or breaks the build.
 */
async function maybeVerifyFacts(params: RunGenerationParams, messages: Messages): Promise<void> {
  const apiKey = params.env.TAVILY_API_KEY;

  if (!apiKey || !params.isFirstBuild) {
    return;
  }

  const firstUserMessage = params.messages.find((message) => message.role === 'user');

  if (!firstUserMessage) {
    return;
  }

  const query = queryFromMessage(firstUserMessage.content);

  if (query.length === 0) {
    return;
  }

  const facts = await searchFacts(query, apiKey);

  if (!facts) {
    logger.warn('Verify phase skipped: fact search returned nothing');

    return;
  }

  await params.stream.switchSource(markerStream(VERIFY_MARKER));

  const verifyMessages = [
    ...messages,
    {
      role: 'user' as const,
      content: [VERIFY_BRIDGE_PROMPT, '', '<reference_facts>', facts, '</reference_facts>'].join('\n'),
    },
  ];

  try {
    await runPass(params, {
      messages: verifyMessages,
      effort: VERIFY_EFFORT,
      maxTokens: VERIFY_MAX_TOKENS,
      systemSuffix: VERIFY_PHASE_SUFFIX,
    });
  } catch (error) {
    logger.warn('Verify phase failed — build stands as-is', error);
  }
}

/**
 * Runs the plan and expand passes, returning the message list for the build
 * pass plus whether the thinking clock cut the design short. Thinking-phase
 * failures never lose the build: a failed pass falls back to building from
 * whatever exists, and the clock transitions to the build phase instead of
 * stopping the session. When the plan pass answers with clarifying
 * QUESTIONS instead of a plan, `buildMessages` is null — the pipeline stops
 * there and the questions are the whole reply.
 */
async function runThinkingPhases(
  params: RunGenerationParams,
): Promise<{ buildMessages: Messages | null; timedOut: boolean }> {
  const thinking = [...params.messages];

  let abortedByClock = false;
  let currentAbort: AbortController | null = null;

  const clock = setTimeout(() => {
    abortedByClock = true;
    logger.warn(`Thinking budget (${THINKING_BUDGET_MS}ms) reached — moving to the build phase`);
    currentAbort?.abort();
  }, THINKING_BUDGET_MS);

  try {
    // phase 1: quick, powerful core draft (or clarifying questions)
    try {
      currentAbort = new AbortController();

      const plan = await runPass(params, {
        messages: thinking,
        effort: PLAN_EFFORT,
        maxTokens: PLAN_MAX_TOKENS,
        systemSuffix: PLAN_PHASE_SUFFIX,
        abortSignal: currentAbort.signal,
      });

      if (isClarifyingQuestions(plan.text)) {
        /**
         * The model needs answers before it can plan. The questions are
         * already streamed; stop the pipeline here. The user's answer is
         * treated as pipeline-worthy on the next turn (see api.chat.ts).
         */
        logger.info('Plan phase returned clarifying questions — pausing the pipeline for the answer');

        return { buildMessages: null, timedOut: false };
      }

      if (plan.text.trim().length > 0) {
        thinking.push({ role: 'assistant', content: plan.text });
      }
    } catch (error) {
      logger.warn('Plan phase failed — falling back to a direct build', error);
      thinking.push({ role: 'user', content: BUILD_PHASE_PROMPT });

      return { buildMessages: thinking, timedOut: false };
    }

    if (abortedByClock) {
      thinking.push({ role: 'user', content: BUILD_TIMEOUT_PROMPT });

      return { buildMessages: thinking, timedOut: true };
    }

    // phase 2: spiderweb expansion of the draft
    try {
      thinking.push({ role: 'user', content: EXPAND_BRIDGE_PROMPT });

      await params.stream.switchSource(markerStream(EXPAND_MARKER));

      currentAbort = new AbortController();

      const expanded = await runPass(params, {
        messages: thinking,
        effort: EXPAND_EFFORT,
        maxTokens: EXPAND_MAX_TOKENS,
        systemSuffix: EXPAND_PHASE_SUFFIX,
        abortSignal: currentAbort.signal,
      });

      if (expanded.text.trim().length > 0) {
        thinking.push({ role: 'assistant', content: expanded.text });
      }

      thinking.push({ role: 'user', content: abortedByClock ? BUILD_TIMEOUT_PROMPT : BUILD_PHASE_PROMPT });

      return { buildMessages: thinking, timedOut: abortedByClock };
    } catch (error) {
      logger.warn('Expand phase failed — building from the plan only', error);
      thinking.push({ role: 'user', content: BUILD_PHASE_PROMPT });

      return { buildMessages: thinking, timedOut: false };
    }
  } finally {
    clearTimeout(clock);
  }
}

/**
 * Streams one pass and, when the model hits its token budget, continues it
 * seamlessly (up to MAX_RESPONSE_SEGMENTS). A literally empty answer is
 * retried once at light effort so the user never gets silence.
 */
async function streamWithContinuations(
  params: RunGenerationParams,
  messages: Messages,
  effort: ReasoningEffort,
  maxTokens: number,
): Promise<void> {
  let emptyRetryUsed = false;

  for (let segment = 0; segment < MAX_RESPONSE_SEGMENTS; segment++) {
    const { text, finishReason } = await runPass(params, { messages, effort, maxTokens });

    if (text.trim().length === 0) {
      if (emptyRetryUsed) {
        logger.warn('Model returned an empty response twice — closing');

        return;
      }

      emptyRetryUsed = true;
      logger.warn('Model returned an empty response: retrying once at light effort');
      messages.push({ role: 'user', content: CONTINUE_PROMPT });
      effort = LIGHT_EFFORT;

      continue;
    }

    if (finishReason !== 'length') {
      return;
    }

    logger.info(
      `Reached max token limit (${maxTokens}): continuing (${MAX_RESPONSE_SEGMENTS - segment - 1} segments left)`,
    );

    messages.push({ role: 'assistant', content: text });
    messages.push({ role: 'user', content: CONTINUE_PROMPT });
  }

  logger.warn('Segment ceiling reached — closing with what was produced');
}

/**
 * Runs a single model pass: streams it into the shared SwitchableStream and
 * resolves with the full text when the pass ends. Settles on finish OR on
 * abort (with the salvaged partial text); rejects only on call-time
 * failures (API rejects before streaming starts).
 */
async function runPass(params: RunGenerationParams, pass: PassParams): Promise<PassResult> {
  const accumulator = createTextAccumulator();

  const completion = new Promise<PassResult>((resolve, reject) => {
    let settled = false;

    const settle = (result: PassResult) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };

    const fail = (error: unknown) => {
      if (!settled) {
        settled = true;
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    };

    const requestOptions: StreamingOptions = {
      toolChoice: 'none',
      maxTokens: pass.maxTokens,
      abortSignal: pass.abortSignal,
      onFinish: ({ text, finishReason }) => settle({ text: accumulator.getText() || text, finishReason }),
    };

    if (pass.abortSignal) {
      pass.abortSignal.addEventListener(
        'abort',
        () => {
          // salvage whatever streamed in before the abort
          settle({ text: accumulator.getText(), finishReason: 'aborted' });
        },
        { once: true },
      );
    }

    streamText(pass.messages, params.env, {
      requestOptions,
      projectGraph: params.projectGraph,
      webSearch: params.webSearch,
      effort: pass.effort,
      systemSuffix: pass.systemSuffix,
      includeThinking: true,
      byok: params.byok,
    })
      .then((result) => params.stream.switchSource(result.toAIStream().pipeThrough(accumulator.stream)))
      .catch(fail);
  });

  return completion;
}
