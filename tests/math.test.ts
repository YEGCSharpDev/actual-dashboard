import { describe, it, expect } from 'vitest';
import { parseMathInput } from '../backend/server';

describe('Safe Math Input Parser', () => {
  it('should parse simple arithmetic expressions', () => {
    expect(parseMathInput('100 + 50')).toBe(150);
    expect(parseMathInput('500 - 200')).toBe(300);
    expect(parseMathInput('50 * 3')).toBe(150);
    expect(parseMathInput('10 / 2')).toBe(5);
  });

  it('should respect operator precedence', () => {
    expect(parseMathInput('100 + 50 * 2')).toBe(200);
    expect(parseMathInput('(100 + 50) * 2')).toBe(300);
  });

  it('should handle decimals', () => {
    expect(parseMathInput('10.5 + 4.5')).toBe(15);
    expect(parseMathInput('0.1 * 10')).toBe(1);
  });

  it('should return 0 for empty or whitespace expressions', () => {
    expect(parseMathInput('')).toBe(0);
    expect(parseMathInput('   ')).toBe(0);
  });

  it('should block unsafe input (scripts, injections)', () => {
    expect(parseMathInput('alert(1)')).toBe(0);
    expect(parseMathInput('1 + console.log(2)')).toBe(0);
    expect(parseMathInput('eval("1+1")')).toBe(0);
    expect(parseMathInput('1 ** 99999')).toBe(0); // blocks power operator, only allows basic ops
  });
});
