import { describe, expect, it } from 'vitest';
import { pruneMessages } from './prune-context';
import type { Messages } from './stream-text';

const OLD_ARTIFACT = `Here is the app.

<boltArtifact id="todo-app" title="Todo App">
  <boltAction type="file" filePath="package.json">
    { "name": "todo", "version": "0.0.0" }
  </boltAction>
  <boltAction type="shell">
    npm install
  </boltAction>
  <boltAction type="file" filePath="modules/frontend/src/App.tsx">
    export default function App() {
      return <div>OLD VERSION — thousands of lines would be here</div>;
    }
  </boltAction>
</boltArtifact>`;

const NEW_ARTIFACT = `<boltArtifact id="todo-app" title="Todo App">
  <boltAction type="file" filePath="modules/frontend/src/App.tsx">
    export default function App() {
      return <div>CURRENT VERSION</div>;
    }
  </boltAction>
</boltArtifact>`;

describe('pruneMessages', () => {
  it('strips file contents from older assistant messages but keeps structure', () => {
    const messages: Messages = [
      { role: 'user', content: 'build a todo app' },
      { role: 'assistant', content: OLD_ARTIFACT },
      { role: 'user', content: 'make the button blue' },
      { role: 'assistant', content: NEW_ARTIFACT },
    ];

    const pruned = pruneMessages(messages);

    // old file contents are gone
    expect(pruned[1].content).not.toContain('OLD VERSION');
    expect(pruned[1].content).not.toContain('"name": "todo"');

    // ...but structure, paths, and shell commands remain
    expect(pruned[1].content).toContain('boltArtifact');
    expect(pruned[1].content).toContain('filePath="package.json"');
    expect(pruned[1].content).toContain('filePath="modules/frontend/src/App.tsx"');
    expect(pruned[1].content).toContain('npm install');
    expect(pruned[1].content).toContain('superseded');
  });

  it('keeps the latest assistant message fully intact', () => {
    const messages: Messages = [
      { role: 'assistant', content: OLD_ARTIFACT },
      { role: 'assistant', content: NEW_ARTIFACT },
    ];

    const pruned = pruneMessages(messages);

    expect(pruned[1].content).toBe(NEW_ARTIFACT);
    expect(pruned[1].content).toContain('CURRENT VERSION');
  });

  it('never modifies user messages', () => {
    const messages: Messages = [
      { role: 'user', content: 'my diff with <boltAction type="file" filePath="x.ts"> stay as-is </boltAction>' },
      { role: 'assistant', content: NEW_ARTIFACT },
    ];

    const pruned = pruneMessages(messages);

    expect(pruned[0]).toBe(messages[0]);
  });

  it('leaves assistant messages without artifacts untouched', () => {
    const messages: Messages = [
      { role: 'assistant', content: 'Sure, I can explain that concept.' },
      { role: 'assistant', content: NEW_ARTIFACT },
    ];

    const pruned = pruneMessages(messages);

    expect(pruned[0]).toBe(messages[0]);
  });

  it('handles a single assistant message (nothing to prune)', () => {
    const messages: Messages = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: NEW_ARTIFACT },
    ];

    const pruned = pruneMessages(messages);

    expect(pruned[1].content).toBe(NEW_ARTIFACT);
  });
});
