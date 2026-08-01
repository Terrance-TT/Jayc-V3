import { describe, expect, it } from 'vitest';
import { getSystemPrompt } from './prompts';

const GOLDEN_SECTIONS = [
  'system_constraints',
  'code_formatting_info',
  'product_judgment',
  'message_formatting_info',
  'diff_spec',
  'artifact_info',
  'examples',
];

const REMOVED_SECTIONS = [
  'secrets_handling',
  'deployment_readiness',
  'design_defaults',
  'domain_rules',
  'feature_suggestions',
];

describe('getSystemPrompt (golden scope)', () => {
  const prompt = getSystemPrompt('/home/project');

  it('contains every golden-era section', () => {
    for (const section of GOLDEN_SECTIONS) {
      expect(prompt, `missing <${section}>`).toContain(`<${section}>`);
    }
  });

  it('keeps the golden section order', () => {
    let previousIndex = -1;

    for (const section of GOLDEN_SECTIONS) {
      const index = prompt.indexOf(`<${section}>`);

      expect(index, `<${section}> out of order`).toBeGreaterThan(previousIndex);
      previousIndex = index;
    }
  });

  it('does not contain any removed sections', () => {
    for (const section of REMOVED_SECTIONS) {
      expect(prompt, `still contains <${section}>`).not.toContain(`<${section}>`);
    }
  });

  it('stays lean (the 42KB prompt prefilled every pass)', () => {
    expect(prompt.length).toBeLessThanOrEqual(29_000);
  });

  it('keeps the requested fixes', () => {
    expect(prompt).toContain('You are Jayc');
    expect(prompt).toContain('src/index.ts');
    expect(prompt).toContain('vite.config.ts');
    expect(prompt).not.toContain('You are Bolt');
  });
});
