import { describe, it, expect, vi } from 'vitest';
import {
  createScopeGuard,
  type DomainScope,
} from '../../../../src/mastra/shared/processors/scope-guard';

const scope: DomainScope = {
  domain: 'files-test',
  agentName: 'File Operations Agent',
  scope: 'local file operations',
  outOfScopeExamples: ['general knowledge questions'],
  siblings: [{ name: 'Research Agent', description: 'web research' }],
};

function userMessages(text: string) {
  return [{ id: 'm1', role: 'user', content: { parts: [{ type: 'text', text }] } }] as never;
}

function makeArgs(text = 'what happened at the resurrection of christ?') {
  const abort = vi.fn((..._args: unknown[]) => {
    throw new Error('TripWire');
  });
  const messages = userMessages(text);
  return { args: { messages, abort } as never, abort, messages };
}

describe('createScopeGuard', () => {
  it('has a domain-scoped id', () => {
    const guard = createScopeGuard({ ...scope, classify: async () => ({ inScope: true }) });
    expect(guard.id).toBe('scope-guard:files-test');
  });

  it('aborts with agent name and sibling redirect when out of scope', async () => {
    const guard = createScopeGuard({ ...scope, classify: async () => ({ inScope: false }) });
    const { args, abort } = makeArgs();

    await expect(guard.processInput!(args)).rejects.toThrow('TripWire');
    expect(abort).toHaveBeenCalledTimes(1);
    const reason = abort.mock.calls[0][0] as string;
    expect(reason).toContain('File Operations Agent only handles');
    expect(reason).toContain('Research Agent');
  });

  it('passes the message through when in scope', async () => {
    const guard = createScopeGuard({ ...scope, classify: async () => ({ inScope: true }) });
    const { args, abort, messages } = makeArgs('read the file notes.txt');

    await expect(guard.processInput!(args)).resolves.toBe(messages);
    expect(abort).not.toHaveBeenCalled();
  });

  it('fails open when the classifier throws', async () => {
    const guard = createScopeGuard({
      ...scope,
      classify: async () => {
        throw new Error('no provider key');
      },
    });
    const { args, abort, messages } = makeArgs();

    await expect(guard.processInput!(args)).resolves.toBe(messages);
    expect(abort).not.toHaveBeenCalled();
  });

  it('never classifies when disabled via enabled:false', async () => {
    const classify = vi.fn(async () => ({ inScope: false }));
    const guard = createScopeGuard({ ...scope, classify, enabled: false });
    const { args, messages } = makeArgs();

    await expect(guard.processInput!(args)).resolves.toBe(messages);
    expect(classify).not.toHaveBeenCalled();
  });

  it('passes through when there is no user text', async () => {
    const classify = vi.fn(async () => ({ inScope: false }));
    const guard = createScopeGuard({ ...scope, classify });
    const abort = vi.fn();
    const messages = [] as never;

    await expect(guard.processInput!({ messages, abort } as never)).resolves.toBe(messages);
    expect(classify).not.toHaveBeenCalled();
  });

  it('extracts text from the LAST user message only', async () => {
    const classify = vi.fn(async () => ({ inScope: true }));
    const guard = createScopeGuard({ ...scope, classify });
    const abort = vi.fn();
    const messages = [
      { id: 'u1', role: 'user', content: { parts: [{ type: 'text', text: 'first' }] } },
      { id: 'a1', role: 'assistant', content: { parts: [{ type: 'text', text: 'reply' }] } },
      { id: 'u2', role: 'user', content: { parts: [{ type: 'text', text: 'latest question' }] } },
    ] as never;

    await guard.processInput!({ messages, abort } as never);
    expect(classify).toHaveBeenCalledWith('latest question');
  });
});
