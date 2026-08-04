import { createScopedLogger } from '~/utils/logger';
import { isClarifyingQuestions, THINKING_CHOICE_SENTINEL } from '~/utils/thinking';
import { checkDeployReadiness } from '~/lib/.server/deploy-check';
import { queryFromMessage, searchFacts } from '~/lib/.server/fact-check/search';
import {
  BUILD_EFFORT,
  BUILD_MAX_TOKENS,
  EXPAND_EFFORT,
  EXPAND_MAX_TOKENS,
  LIGHT_EFFORT,
  MAX_RESPONSE_SEGMENTS,
  MAX_THINK_EXTENSIONS,
  PLAN_EFFORT,
  PLAN_MAX_TOKENS,
  REVIEW_EFFORT,
  REVIEW_MAX_TOKENS,
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
  CONTINUE_THINKING_PROMPT,
  CONTINUE_THINKING_SUFFIX,
  EXPAND_BRIDGE_PROMPT,
  EXPAND_PHASE_SUFFIX,
  PLAN_PHASE_SUFFIX,
  REVIEW_BRIDGE_PROMPT,
  REVIEW_PHASE_SUFFIX,
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

  /** skips the post-build review pass (turbo mode — speed over ceremony) */
  skipReview?: boolean;

  /** set when the user's message is a thinking-choice control reply */
  control?: 'think_longer' | 'build_now';

  /** prior think_longer choices in this chat (stateless cap input) */
  extensionsUsed?: number;
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
 * Drives the whole generation for one chat request: thinking-choice control
 * replies first, then pipeline or single-pass generation. The caller
 * returns the HTTP response immediately while this runs in the background.
 */
export async function runGeneration(params: RunGenerationParams): Promise<void> {
  const { stream, generation } = params;

  try {
    if (params.control === 'think_longer') {
      await runThinkLonger(params);
    } else if (params.control === 'build_now') {
      await runBuildNow(params);
    } else if (generation.pipeline) {
      const outcome = await runThinkingPhases(params);

      if (outcome.kind !== 'build') {
        // clarifying questions or a thinking choice — the reply is complete
        stream.close();

        return;
      }

      await params.stream.switchSource(markerStream(outcome.timedOut ? THINKING_CAP_MARKER : BUILD_MARKER));

      await streamWithContinuations(params, outcome.messages, BUILD_EFFORT, BUILD_MAX_TOKENS);

      await runPostBuildPhases(params, outcome.messages);
    } else {
      await streamWithContinuations(params, params.messages, generation.effort, generation.maxTokens);

      await runPostBuildPhases(params, params.messages);
    }

    stream.close();
  } catch (error) {
    logger.error('Generation failed', error);
    stream.error(error);
  }
}

/**
 * The user chose "think longer" at the thinking-clock choice: continue the
 * design in a fresh window (up to MAX_THINK_EXTENSIONS times), then build.
 * At the cap, build immediately instead of offering another choice.
 */
async function runThinkLonger(params: RunGenerationParams): Promise<void> {
  const messages = [...params.messages];

  // replace the control tag with a real instruction for the model
  const last = messages[messages.length - 1];

  if (last?.role === 'user') {
    messages[messages.length - 1] = { role: 'user', content: CONTINUE_THINKING_PROMPT };
  }

  if ((params.extensionsUsed ?? 0) >= MAX_THINK_EXTENSIONS) {
    logger.info('Think-longer cap reached — building instead of extending again');
    await params.stream.switchSource(markerStream(THINKING_CAP_MARKER));

    messages.push({ role: 'user', content: BUILD_TIMEOUT_PROMPT });

    await streamWithContinuations(params, messages, BUILD_EFFORT, BUILD_MAX_TOKENS);
    await runPostBuildPhases(params, messages);

    return;
  }

  await params.stream.switchSource(markerStream(THINK_LONGER_MARKER));

  const outcome = await runContinueThinking(params, messages);

  if (outcome.kind !== 'build') {
    // another clock fire — the choice note is already on the stream
    return;
  }

  await params.stream.switchSource(markerStream(outcome.timedOut ? THINKING_CAP_MARKER : BUILD_MARKER));

  await streamWithContinuations(params, outcome.messages, BUILD_EFFORT, BUILD_MAX_TOKENS);
  await runPostBuildPhases(params, outcome.messages);
}

/**
 * The user chose "build now": build immediately from the salvaged design
 * (the timeout semantics — plan skeleton is complete, gaps are filled with
 * house-style defaults and product judgment).
 */
async function runBuildNow(params: RunGenerationParams): Promise<void> {
  const messages = [...params.messages];

  // replace the control tag with the build instruction
  const last = messages[messages.length - 1];

  if (last?.role === 'user') {
    messages[messages.length - 1] = { role: 'user', content: BUILD_TIMEOUT_PROMPT };
  }

  await params.stream.switchSource(markerStream(BUILD_TIMEOUT_MARKER));

  await streamWithContinuations(params, messages, BUILD_EFFORT, BUILD_MAX_TOKENS);
  await runPostBuildPhases(params, messages);
}

/**
 * One continued-thinking pass with the same clock semantics as the main
 * thinking phases: on timeout, offer the choice again (or force the build
 * when the extension cap is now reached).
 */
async function runContinueThinking(params: RunGenerationParams, messages: Messages): Promise<ThinkingOutcome> {
  let abortedByClock = false;
  const controller = new AbortController();

  const clock = setTimeout(() => {
    abortedByClock = true;
    logger.warn(`Thinking extension budget (${THINKING_BUDGET_MS}ms) reached`);
    controller.abort();
  }, THINKING_BUDGET_MS);

  try {
    const result = await runPass(params, {
      messages,
      effort: EXPAND_EFFORT,
      maxTokens: EXPAND_MAX_TOKENS,
      systemSuffix: CONTINUE_THINKING_SUFFIX,
      abortSignal: controller.signal,
    });

    const build = [...messages];

    if (result.text.trim().length > 0) {
      build.push({ role: 'assistant', content: result.text });
    }

    if (abortedByClock) {
      const extensionsNowUsed = (params.extensionsUsed ?? 0) + 1;

      if (extensionsNowUsed >= MAX_THINK_EXTENSIONS) {
        build.push({ role: 'user', content: BUILD_TIMEOUT_PROMPT });

        return { kind: 'build', messages: build, timedOut: true };
      }

      await params.stream.switchSource(markerStream(choiceNote()));

      return { kind: 'choice' };
    }

    build.push({ role: 'user', content: BUILD_PHASE_PROMPT });

    return { kind: 'build', messages: build, timedOut: false };
  } finally {
    clearTimeout(clock);
  }
}

/**
 * Visible phase markers, injected between passes so the user can see the
 * pipeline move from thinking to building.
 */
const EXPAND_MARKER = '\n\n---\n\n🧭 **Expanding the design…**\n\n';
const BUILD_MARKER = '\n\n---\n\n⌘ **Design locked — building now.** Watch the files appear on the right.\n\n';
const BUILD_TIMEOUT_MARKER =
  '\n\n---\n\n⌘ **Building from the current design.** Watch the files appear on the right.\n\n';
const THINKING_CAP_MARKER =
  '\n\n---\n\n⌘ **Thinking cap reached — building from the current design.** Watch the files appear on the right.\n\n';
const THINK_LONGER_MARKER = '\n\n---\n\n🧭 **Thinking some more…**\n\n';

/**
 * Outcomes of the thinking phases: proceed to the build pass (timedOut =
 * the clock or cap forced it), stop for clarifying questions, or stop for a
 * thinking-clock user choice.
 */
type ThinkingOutcome =
  | { kind: 'build'; messages: Messages; timedOut: boolean }
  | { kind: 'questions' }
  | { kind: 'choice' };

/**
 * The visible note offered when the thinking clock runs out: explains the
 * state and presents the two choices. Carries the sentinel the client
 * turns into buttons.
 */
function choiceNote(): string {
  return [
    '',
    '',
    '---',
    '',
    '> 🧭 **This one is genuinely complex** — the design is partway there after ~10 minutes of thinking.',
    '> Choose below: **🧭 Think longer** — I keep deepening the design (about 10 more minutes) — or **⌘ Build now** — I build from what the design already covers and fill the gaps with my best judgment.',
    '',
    THINKING_CHOICE_SENTINEL,
    '',
    '',
  ].join('\n');
}

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
const REVIEW_MARKER = '\n\n---\n\n🔍 **Reviewing the build…**\n\n';

/**
 * Unified post-build phases, run after any first build completes (pipeline,
 * single-pass, or thinking-clock build): first the second-opinion REVIEW (no key needed — hunts
 * the visual/logic bug class: z-order, sign conventions, clipping,
 * interaction targets, dead controls), then the facts VERIFY phase (needs
 * TAVILY_API_KEY — grounds domain rules in fresh search results). Each
 * phase skips silently when its gate is unmet and failures never block.
 *
 * Before the review, a deterministic deploy-readiness scan (deploy-check.ts)
 * verifies the structural Railway rules no prompt can guarantee; its
 * findings ride into the review so the model fixes them with full files.
 */
async function runPostBuildPhases(params: RunGenerationParams, messages: Messages): Promise<void> {
  if (params.isFirstBuild && !params.skipReview) {
    await params.stream.switchSource(markerStream(REVIEW_MARKER));

    const buildText = messages
      .filter((message) => message.role === 'assistant')
      .map((message) => message.content)
      .join('\n');
    const deployFindings = checkDeployReadiness(buildText);
    const bridge =
      deployFindings.length > 0
        ? `${REVIEW_BRIDGE_PROMPT}\n\nDeterministic deploy-readiness scan found these issues — fix each one as well (all normal artifact rules apply):\n${deployFindings.map((finding) => `- ${finding.detail}`).join('\n')}`
        : REVIEW_BRIDGE_PROMPT;

    if (deployFindings.length > 0) {
      logger.info(`Deploy-readiness scan: ${deployFindings.length} finding(s) routed to the review pass`);
    }

    const reviewMessages = [...messages, { role: 'user' as const, content: bridge }];

    try {
      await runPass(params, {
        messages: reviewMessages,
        effort: REVIEW_EFFORT,
        maxTokens: REVIEW_MAX_TOKENS,
        systemSuffix: REVIEW_PHASE_SUFFIX,
      });
    } catch (error) {
      logger.warn('Review phase failed — build stands as-is', error);
    }
  }

  await maybeVerifyFacts(params, messages);
}

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
 * Runs the plan and expand passes. Thinking-phase failures never lose the
 * build: a failed pass falls back to building from whatever exists. When
 * the thinking clock fires, the user chooses what happens next — unless the
 * extension cap is already reached, in which case the build is forced.
 * When the plan pass answers with clarifying QUESTIONS, the pipeline stops
 * there and the questions are the whole reply.
 */
async function runThinkingPhases(params: RunGenerationParams): Promise<ThinkingOutcome> {
  const thinking = [...params.messages];

  let abortedByClock = false;
  let currentAbort: AbortController | null = null;

  const clock = setTimeout(() => {
    abortedByClock = true;
    logger.warn(`Thinking budget (${THINKING_BUDGET_MS}ms) reached`);
    currentAbort?.abort();
  }, THINKING_BUDGET_MS);

  // clock handling shared by both phases: choice, or forced build at the cap
  const onClock = async (): Promise<ThinkingOutcome> => {
    if ((params.extensionsUsed ?? 0) >= MAX_THINK_EXTENSIONS) {
      thinking.push({ role: 'user', content: BUILD_TIMEOUT_PROMPT });

      return { kind: 'build', messages: thinking, timedOut: true };
    }

    await params.stream.switchSource(markerStream(choiceNote()));

    return { kind: 'choice' };
  };

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

        return { kind: 'questions' };
      }

      if (plan.text.trim().length > 0) {
        thinking.push({ role: 'assistant', content: plan.text });
      }
    } catch (error) {
      logger.warn('Plan phase failed — falling back to a direct build', error);
      thinking.push({ role: 'user', content: BUILD_PHASE_PROMPT });

      return { kind: 'build', messages: thinking, timedOut: false };
    }

    if (abortedByClock) {
      return onClock();
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

      if (abortedByClock) {
        return onClock();
      }

      thinking.push({ role: 'user', content: BUILD_PHASE_PROMPT });

      return { kind: 'build', messages: thinking, timedOut: false };
    } catch (error) {
      logger.warn('Expand phase failed — building from the plan only', error);
      thinking.push({ role: 'user', content: BUILD_PHASE_PROMPT });

      return { kind: 'build', messages: thinking, timedOut: false };
    }
  } finally {
    clearTimeout(clock);
  }
}

/**
 * Streams one pass and, when the model hits its token budget, continues it
 * seamlessly (up to MAX_RESPONSE_SEGMENTS). Every segment — including the
 * final one — is appended to `messages`, so post-build phases (review,
 * verify) receive the COMPLETE build in context, not just the cut-off
 * segments. A literally empty answer is retried once at light effort so the
 * user never gets silence.
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
      messages.push({ role: 'assistant', content: text });

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
