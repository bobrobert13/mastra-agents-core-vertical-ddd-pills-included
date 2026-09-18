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
 * Spec 06 extension, re-pointed 2026-09-18: every domain ALSO exports its
 * buildSecurityStack result with the ORDER RULE baked in — the raw-input
 * injection scanner runs BEFORE the scope guard, which is the last mutator
 * (its redirect note must never be re-classified by a guard behind it). That
 * proves the agent modules wire the full defense-in-depth pipeline, not a bare
 * guard array (root hard rule).
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

  it.each(stacks)('%s security stack wires the scope guard behind the raw-input scanner', (domain, stack) => {
    const ids = stack.inputProcessors.map(p => p.id);
    expect(ids).toContain(`scope-guard:${domain}`);
    // Order rule (2026-09-18): indexOf beats lastIndexOf(-1) when the injection
    // slot is absent (keyless CI) and proves the order when it is mounted.
    expect(ids.indexOf(`scope-guard:${domain}`)).toBeGreaterThan(
      ids.lastIndexOf('prompt-injection-detector')
    );
    expect(stack.inputProcessors.length).toBeGreaterThan(0);
  });

  it('file-operations never mounts the response cache (mutating tools excluded, spec 06 R2)', () => {
    expect(
      fileOperationsSecurityStack.inputProcessors.some(p => p.id === 'mastra/response-cache')
    ).toBe(false);
  });
});
