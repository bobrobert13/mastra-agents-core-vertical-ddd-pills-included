import { describe, expect, it } from 'vitest';
import { workspace } from '../../../../src/mastra/workspace';

describe('workspace containment', () => {
  it('rejects paths outside the base directory', async () => {
    await expect(workspace.filesystem!.writeFile('../escape.txt', 'x')).rejects.toThrow();
  });

  it('writes and reads inside the base directory', async () => {
    await workspace.filesystem!.writeFile('notes/check.txt', 'hello');
    expect(await workspace.filesystem!.readFile('notes/check.txt', { encoding: 'utf8' })).toBe(
      'hello'
    );
  });
});
