/**
 * Native evals toolkit (spec 07): dataset seeding, scorer registry, Tier A
 * gate runner, committed-baseline regression check, eval-scoped instance.
 *
 * ADR-010: datasets & experiments live in (throwaway or production) Mastra
 * storage; git JSON stays the reviewed seed source.
 */

export * from './eval-storage';
export * from './seed';
export * from './research-relevance-scorer';
export * from './scorers-registry';
export * from './baseline-check';
export * from './gate-runner';
