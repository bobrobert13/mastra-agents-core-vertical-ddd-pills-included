import { describe, it, expect } from 'vitest';
import { AppError } from '../../../../src/mastra/shared/handlers/app-error';
import {
  AppResult,
  FailResult,
  OkResult,
  isFail,
  isOk,
} from '../../../../src/mastra/shared/handlers/app-result';

class TestError extends AppError {
  readonly code = 'TEST_FAILED' as const;
  readonly domain = 'test-domain' as const;

  constructor(message = 'test failure') {
    super(message);
  }
}

describe('AppResult (general result base for domains)', () => {
  it('builds a success with the plain value and a failure with the typed error', () => {
    const ok = AppResult.ok<number, TestError>(42);
    const fail = AppResult.fail<number, TestError>(new TestError('nope'));

    expect(ok.ok).toBe(true);
    expect(ok.isOk()).toBe(true);
    expect(ok.isFail()).toBe(false);
    expect(fail.ok).toBe(false);
    expect(fail.isFail()).toBe(true);
    expect(fail.isOk()).toBe(false);
  });

  it('exposes value / error through the concrete subclasses', () => {
    const ok = AppResult.ok<number, TestError>(42);
    const fail = AppResult.fail<number, TestError>(new TestError('nope'));

    expect(isOk(ok)).toBe(true);
    expect(isFail(fail)).toBe(true);
    if (isOk(ok)) expect(ok.value).toBe(42);
    if (isFail(fail)) expect(fail.error.message).toBe('nope');
  });

  it('unwrap returns the value or throws the typed error', () => {
    expect(AppResult.ok<number, TestError>(42).unwrap()).toBe(42);

    const error = new TestError('nope');
    expect(() => AppResult.fail<number, TestError>(error).unwrap()).toThrow(error);
    expect(() => AppResult.fail<number, TestError>(error).unwrap()).toThrow(TestError);
  });

  it('unwrapOr falls back only on failure', () => {
    expect(AppResult.ok<number, TestError>(7).unwrapOr(0)).toBe(7);
    expect(AppResult.fail<number, TestError>(new TestError()).unwrapOr(0)).toBe(0);
  });

  it('map transforms the success value and leaves a failure untouched', () => {
    const mapped = AppResult.ok<number, TestError>(2).map(n => n * 3);
    expect(mapped.unwrap()).toBe(6);

    const error = new TestError('nope');
    const untouched = AppResult.fail<number, TestError>(error).map(n => n * 3);
    expect(isFail(untouched)).toBe(true);
    if (isFail(untouched)) expect(untouched.error).toBe(error);
  });

  it('match collapses both branches', () => {
    const describeResult = (result: AppResult<number, TestError>): string =>
      result.match({ ok: value => `ok:${value}`, fail: error => `fail:${error.code}` });

    expect(describeResult(AppResult.ok<number, TestError>(1))).toBe('ok:1');
    expect(describeResult(AppResult.fail<number, TestError>(new TestError()))).toBe('fail:TEST_FAILED');
  });

  it('the concrete classes are exported and the discriminant is an own enumerable property', () => {
    expect(new OkResult<number, TestError>(1)).toBeInstanceOf(AppResult);
    expect(new FailResult<number, TestError>(new TestError())).toBeInstanceOf(AppResult);
    expect(Object.keys(new OkResult<number, TestError>(1))).toContain('ok');
    expect(Object.keys(new FailResult<number, TestError>(new TestError()))).toContain('error');
  });
});
