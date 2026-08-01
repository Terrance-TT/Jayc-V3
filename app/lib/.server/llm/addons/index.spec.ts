import { describe, expect, it } from 'vitest';
import { getTriggeredAddons } from './index';

describe('getTriggeredAddons', () => {
  it('returns nothing for a plain build request', () => {
    expect(getTriggeredAddons({ userMessage: 'Build a todo app in React using Tailwind' })).toBe('');
    expect(getTriggeredAddons({ userMessage: 'Build a landing page for my bakery' })).toBe('');
  });

  it('injects the secrets addon when the request involves keys or env vars', () => {
    expect(getTriggeredAddons({ userMessage: 'Build an app with Clerk auth and an API key' })).toContain(
      '<secrets_handling>',
    );
    expect(getTriggeredAddons({ userMessage: 'add stripe checkout please' })).toContain('<secrets_handling>');
  });

  it('injects the secrets addon when the project graph contains .env files', () => {
    expect(
      getTriggeredAddons({ userMessage: 'Build a plain app', projectGraph: '.env.example | path only' }),
    ).toContain('<secrets_handling>');
  });

  it('injects the deployment addon when the request mentions deploying', () => {
    expect(getTriggeredAddons({ userMessage: 'make this deployable to railway' })).toContain('<deployment_readiness>');
    expect(getTriggeredAddons({ userMessage: 'Build an app I can host on vercel' })).toContain(
      '<deployment_readiness>',
    );
  });

  it('can inject both when the request needs both', () => {
    const addons = getTriggeredAddons({ userMessage: 'deploy my stripe app to railway' });

    expect(addons).toContain('<secrets_handling>');
    expect(addons).toContain('<deployment_readiness>');
  });

  it('injects the interactive addon for visual/interactive requests', () => {
    expect(getTriggeredAddons({ userMessage: 'Make a space invaders game' })).toContain('<interactive_conventions>');
    expect(getTriggeredAddons({ userMessage: 'build a bouncing ball with real gravity' })).toContain(
      '<interactive_conventions>',
    );
    expect(getTriggeredAddons({ userMessage: 'create a sailing simulator to teach wind direction' })).toContain(
      '<interactive_conventions>',
    );
  });

  it('does not inject the interactive addon for non-visual requests', () => {
    expect(getTriggeredAddons({ userMessage: 'Build a todo app in React using Tailwind' })).toBe('');
    expect(getTriggeredAddons({ userMessage: 'add stripe checkout please' })).not.toContain(
      '<interactive_conventions>',
    );

    // keyword-less visual apps are covered by the always-on review pass instead
    expect(getTriggeredAddons({ userMessage: 'create a sailing app to teach wind direction' })).toBe('');
  });
});
