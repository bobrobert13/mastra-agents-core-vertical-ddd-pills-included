import { describe, it, expect } from 'vitest';
import { researchScopeGuard, researchScope } from '../../../src/mastra/domains/research';
import {
  taskManagementScopeGuard,
  taskManagementScope,
} from '../../../src/mastra/domains/task-management';
import {
  fileOperationsScopeGuard,
  fileOperationsScope,
} from '../../../src/mastra/domains/file-operations';
import {
  communicationScopeGuard,
  communicationScope,
} from '../../../src/mastra/domains/communication';

/**
 * Structural guarantee (Agent internals are not public — root AGENTS.md gotcha 3):
 * every domain exports a scope-guard whose id matches its domain, proving the
 * agent module wires one. The guard instance itself is unit-tested offline.
 */
describe('domain scope guards wiring', () => {
  const cases = [
    ['research', researchScope, researchScopeGuard],
    ['task-management', taskManagementScope, taskManagementScopeGuard],
    ['file-operations', fileOperationsScope, fileOperationsScopeGuard],
    ['communication', communicationScope, communicationScopeGuard],
  ] as const;

  it.each(cases)('%s exports a matching scope guard', (_domain, scope, guard) => {
    expect(guard.id).toBe(`scope-guard:${scope.domain}`);
    expect(scope.scope.length).toBeGreaterThan(10);
    expect(scope.outOfScopeExamples.length).toBeGreaterThan(0);
    expect(scope.siblings).toHaveLength(3);
  });
});
