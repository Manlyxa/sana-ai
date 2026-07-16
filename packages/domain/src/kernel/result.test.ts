import { describe, expect, it } from 'vitest';
import { all, andThen, err, isErr, isOk, map, mapErr, ok, unwrap, unwrapOr } from './result';

describe('Result', () => {
  it('ok/err конструируют и распознаются', () => {
    expect(isOk(ok(1))).toBe(true);
    expect(isErr(ok(1))).toBe(false);
    expect(isOk(err('e'))).toBe(false);
    expect(isErr(err('e'))).toBe(true);
  });

  it('map трансформирует только Ok', () => {
    expect(map(ok(2), (x) => x * 2)).toEqual(ok(4));
    expect(map(err<string>('e'), (x: number) => x * 2)).toEqual(err('e'));
  });

  it('mapErr трансформирует только Err', () => {
    expect(mapErr(ok(2), () => 'other')).toEqual(ok(2));
    expect(mapErr(err('e'), (e) => e.toUpperCase())).toEqual(err('E'));
  });

  it('andThen цепляет вычисления и коротко замыкается на Err', () => {
    const half = (x: number) => (x % 2 === 0 ? ok(x / 2) : err('odd'));
    expect(andThen(ok(4), half)).toEqual(ok(2));
    expect(andThen(ok(3), half)).toEqual(err('odd'));
    expect(andThen(err<string>('e'), half)).toEqual(err('e'));
  });

  it('unwrapOr возвращает значение или запасной вариант', () => {
    expect(unwrapOr(ok(1), 9)).toBe(1);
    expect(unwrapOr(err('e'), 9)).toBe(9);
  });

  it('unwrap возвращает значение и бросает на Err', () => {
    expect(unwrap(ok(1))).toBe(1);
    expect(() => unwrap(err('boom'))).toThrow(/boom/);
  });

  it('all собирает массив и возвращает первый Err', () => {
    expect(all([ok(1), ok(2)])).toEqual(ok([1, 2]));
    expect(all([ok(1), err('a'), err('b')])).toEqual(err('a'));
  });
});
