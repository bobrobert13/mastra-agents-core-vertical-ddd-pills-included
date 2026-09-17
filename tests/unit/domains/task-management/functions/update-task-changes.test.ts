import { describe, it, expect } from 'vitest';
import { buildTaskChanges } from '../../../../../src/mastra/domains/task-management/functions/update-task';

describe('buildTaskChanges', () => {
  it('includes only the defined fields', () => {
    expect(buildTaskChanges({ status: 'in-progress' })).toEqual({ status: 'in-progress' });
  });

  it('drops undefined fields entirely (no undefined keys)', () => {
    const changes = buildTaskChanges({ title: undefined, description: undefined });
    expect(changes).toEqual({});
    expect(Object.keys(changes)).toHaveLength(0);
  });

  it('passes through every provided field', () => {
    expect(
      buildTaskChanges({ title: 'a', description: 'b', status: 'pending', priority: 'high' })
    ).toEqual({ title: 'a', description: 'b', status: 'pending', priority: 'high' });
  });
});
