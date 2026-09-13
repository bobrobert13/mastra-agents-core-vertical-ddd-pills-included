import { describe, it, expect } from 'vitest';
import {
  researchScopeGuard,
  researchScope,
  researchSecurityStack,
} from '../../../src/mastra/domains/research';
import {
  taskManagementScopeGuard,
  taskManagementScope,
  taskManagementSecurityStack,
} from '../../../src/mastra/domains/task-management';
import {
  fileOperationsScopeGuard,
  fileOperationsScope,
  fileOperationsSecurityStack,
} from '../../../src/mastra/domains/file-operations';
import {
  communicationScopeGuard,
  communicationScope,
  communicationSecurityStack,
} from '../../../src/mastra/domains/communication';

/**
 * Structural guarantee (Agent internals are not public — root AGENTS.md gotcha 3):
 * every domain exports a scope-guard whose id matches its domain, proving the
 * agent module wires one. The guard instance itself is unit-tested offline.
 *
 * Spec 06 extension: every domain ALSO exports its buildSecurityStack result
 * with the scope guard at slot 0 — proving the agent modules wire the full
 * defense-in-depth pipeline, not a bare guard array (root hard rule).
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

  const stacks = [
    ['research', researchSecurityStack],
    ['task-management', taskManagementSecurityStack],
    ['file-operations', fileOperationsSecurityStack],
    ['communication', communicationSecurityStack],
  ] as const;

  it.each(stacks)('%s security stack carries the scope guard at slot 0', (domain, stack) => {
    expect(stack.inputProcessors[0]?.id).toBe(`scope-guard:${domain}`);
    expect(stack.inputProcessors.length).toBeGreaterThan(0);
  });

  it('file-operations never mounts the response cache (mutating tools excluded, spec 06 R2)', () => {
    expect(
      fileOperationsSecurityStack.inputProcessors.some(p => p.id === 'mastra/response-cache')
    ).toBe(false);
  });
});
