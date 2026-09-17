import { describe, it, expect } from 'vitest';
import { AppError } from '../../../../../src/mastra/shared/handlers';
import {
  InvalidScheduleError,
  ScheduleOperationError,
  SchedulingUnavailableError,
  TaskConflictError,
  TaskManagementError,
  TaskNotFoundError,
  TaskPersistenceUnavailableError,
  UnexpectedTaskManagementError,
  toTaskManagementError,
} from '../../../../../src/mastra/domains/task-management/handlers';
import type { Task } from '../../../../../src/mastra/domains/task-management/entities/task';

const sampleTask: Task = {
  id: 't-1',
  title: 'sample',
  status: 'pending',
  priority: 'medium',
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

const cases: Array<{ error: TaskManagementError; code: string; kind: string }> = [
  {
    error: new TaskPersistenceUnavailableError('db down'),
    code: 'PERSISTENCE_UNAVAILABLE',
    kind: 'unavailable',
  },
  { error: new TaskNotFoundError('missing'), code: 'TASK_NOT_FOUND', kind: 'not_found' },
  { error: new TaskConflictError('conflict'), code: 'TASK_CONFLICT', kind: 'conflict' },
  { error: new InvalidScheduleError('bad'), code: 'INVALID_SCHEDULE', kind: 'validation' },
  {
    error: new SchedulingUnavailableError('no runtime'),
    code: 'SCHEDULING_UNAVAILABLE',
    kind: 'unavailable',
  },
  { error: new ScheduleOperationError('boom'), code: 'SCHEDULE_ERROR', kind: 'internal' },
  {
    error: new UnexpectedTaskManagementError(new Error('weird')),
    code: 'TASK_MANAGEMENT_ERROR',
    kind: 'internal',
  },
];

describe('TaskManagementError hierarchy', () => {
  it.each(cases)('$error.name exposes code/domain/kind', ({ error, code, kind }) => {
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(TaskManagementError);
    expect(error.domain).toBe('task-management');
    expect(error.code).toBe(code);
    expect(error.kind).toBe(kind);
    expect(error.name).toBe(error.constructor.name);
  });

  it('toJSON exposes the AppError shape', () => {
    const json = new TaskNotFoundError('nope').toJSON();
    expect(json).toMatchObject({
      code: 'TASK_NOT_FOUND',
      domain: 'task-management',
      kind: 'not_found',
      message: 'nope',
    });
  });

  it('TaskConflictError carries the fresh row when provided', () => {
    expect(new TaskConflictError('c', sampleTask).current).toBe(sampleTask);
    expect(new TaskConflictError('c').current).toBeUndefined();
  });

  it('UnexpectedTaskManagementError derives its message from the cause', () => {
    const fromError = new UnexpectedTaskManagementError(new Error('kaboom'));
    expect(fromError.message).toBe('kaboom');
    expect(fromError.cause).toBeInstanceOf(Error);

    const fromString = new UnexpectedTaskManagementError('raw');
    expect(fromString.message).toBe('raw');
    expect(fromString.cause).toBe('raw');
  });
});

describe('toTaskManagementError', () => {
  it('passes a TaskManagementError through untouched', () => {
    const original = new TaskNotFoundError('x');
    expect(toTaskManagementError(original)).toBe(original);
  });

  it('maps a PERSISTENCE_UNAVAILABLE throw to TaskPersistenceUnavailableError', () => {
    const normalized = toTaskManagementError({ id: 'PERSISTENCE_UNAVAILABLE' });
    expect(normalized).toBeInstanceOf(TaskPersistenceUnavailableError);
    expect(normalized.kind).toBe('unavailable');
  });

  it('wraps a bare Error as UnexpectedTaskManagementError', () => {
    const normalized = toTaskManagementError(new Error('boom'));
    expect(normalized).toBeInstanceOf(UnexpectedTaskManagementError);
    expect(normalized.message).toBe('boom');
  });
});
