import { describe, expect, it } from 'vitest';
import { pruneMessages } from './prune-context';
import type { Messages } from './stream-text';

const TURN_1_ARTIFACT = `Here is the app.

<boltArtifact id="todo-app" title="Todo App">
  <boltAction type="file" filePath="modules/frontend/src/App.tsx">
    export default function App() {
      return <div>APP WRITTEN IN TURN 1, NEVER TOUCHED AGAIN</div>;
    }
  </boltAction>
  <boltAction type="file" filePath="modules/frontend/src/TodoList.tsx">
    export function TodoList() {
      return <ul>TODOLIST VERSION 1</ul>;
    }
  </boltAction>
  <boltAction type="shell">
    npm install
  </boltAction>
</boltArtifact>`;

const TURN_5_ARTIFACT = `<boltArtifact id="todo-app" title="Todo App">
  <boltAction type="file" filePath="modules/frontend/src/TodoList.tsx">
    export function TodoList() {
      return <ul>TODOLIST VERSION 2 (CURRENT)</ul>;
    }
  </boltAction>
</boltArtifact>`;

describe('pruneMessages', () => {
  it('strips superseded file versions but keeps structure, paths, and shell commands', () => {
    const messages: Messages = [
      { role: 'user', content: 'build a todo app' },
      { role: 'assistant', content: TURN_1_ARTIFACT },
      { role: 'user', content: 'redo the list' },
      { role: 'assistant', content: TURN_5_ARTIFACT },
    ];

    const pruned = pruneMessages(messages);

    // turn 1 TodoList was superseded by turn 5 — body stripped
    expect(pruned[1].content).not.toContain('TODOLIST VERSION 1');
    expect(pruned[1].content).toContain('superseded');

    // ...but structure, paths, and shell commands remain
    expect(pruned[1].content).toContain('boltArtifact');
    expect(pruned[1].content).toContain('filePath="modules/frontend/src/TodoList.tsx"');
    expect(pruned[1].content).toContain('npm install');
  });

  it('keeps the contents of a file whose newest version is in an OLD message (never modified since)', () => {
    const messages: Messages = [
      { role: 'user', content: 'build a todo app' },
      { role: 'assistant', content: TURN_1_ARTIFACT },
      { role: 'user', content: 'redo the list' },
      { role: 'assistant', content: TURN_5_ARTIFACT },
    ];

    const pruned = pruneMessages(messages);

    // App.tsx only exists in turn 1 — it is still the current version,
    // so its contents must survive pruning even though the message is old
    expect(pruned[1].content).toContain('APP WRITTEN IN TURN 1, NEVER TOUCHED AGAIN');
  });

  it('keeps the newest version of every file fully intact', () => {
    const messages: Messages = [
      { role: 'assistant', content: TURN_1_ARTIFACT },
      { role: 'assistant', content: TURN_5_ARTIFACT },
    ];

    const pruned = pruneMessages(messages);

    expect(pruned[1].content).toBe(TURN_5_ARTIFACT);
    expect(pruned[1].content).toContain('TODOLIST VERSION 2 (CURRENT)');
  });

  it('never modifies user messages', () => {
    const messages: Messages = [
      { role: 'user', content: 'my diff with <boltAction type="file" filePath="x.ts"> stay as-is </boltAction>' },
      { role: 'assistant', content: TURN_5_ARTIFACT },
    ];

    const pruned = pruneMessages(messages);

    expect(pruned[0]).toBe(messages[0]);
  });

  it('leaves assistant messages without artifacts untouched', () => {
    const messages: Messages = [
      { role: 'assistant', content: 'Sure, I can explain that concept.' },
      { role: 'assistant', content: TURN_5_ARTIFACT },
    ];

    const pruned = pruneMessages(messages);

    expect(pruned[0]).toBe(messages[0]);
  });

  it('handles a single assistant message (nothing to prune)', () => {
    const messages: Messages = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: TURN_5_ARTIFACT },
    ];

    const pruned = pruneMessages(messages);

    expect(pruned[1].content).toBe(TURN_5_ARTIFACT);
  });
});
