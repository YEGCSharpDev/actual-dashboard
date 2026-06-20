import { describe, it, expect } from 'vitest';
import { parseMathInput } from './index.js';

describe('SafeMath parser', () => {
  it('handles basic arithmetic', () => {
    expect(parseMathInput('2 + 3')).toBe(5);
    expect(parseMathInput('10 - 4')).toBe(6);
    expect(parseMathInput('5 * 6')).toBe(30);
    expect(parseMathInput('20 / 4')).toBe(5);
  });

  it('handles parentheses and precedence', () => {
    expect(parseMathInput('2 + 3 * 4')).toBe(14);
    expect(parseMathInput('(2 + 3) * 4')).toBe(20);
    expect(parseMathInput('100 / (10 + 15)')).toBe(4);
  });

  it('handles empty or whitespace-only strings', () => {
    expect(parseMathInput('')).toBe(0);
    expect(parseMathInput('   ')).toBe(0);
  });

  it('handles edge case: division by zero', () => {
    // JS evaluates 1/0 as Infinity
    expect(parseMathInput('1 / 0')).toBe(Infinity);
  });

  it('handles edge case: mismatched or multiple parentheses (( ', () => {
    // If malformed, we might fail or get NaN, which is mapped to 0
    expect(parseMathInput('((')).toBe(0);
    expect(parseMathInput('2 + (3')).toBe(0); // This one might actually fail in evaluation, which we catch
  });

  it('handles edge case: multiple negative signs (--1)', () => {
    expect(parseMathInput('--1')).toBe(0); // Double operator is likely malformed in our simple parser
    expect(parseMathInput('1 - -1')).toBe(0); // Depending on how we handle negative numbers vs operators, it might fail to 0
  });

  it('handles edge case: large numbers (9e99)', () => {
    // e is an alphabet character, which is rejected by our STRICT REGEX filter!
    expect(parseMathInput('9e99')).toBe(0);
  });

  it('handles malicious inputs (XSS / Injection)', () => {
    expect(parseMathInput('alert(1)')).toBe(0);
    expect(parseMathInput('process.exit()')).toBe(0);
    expect(parseMathInput('console.log("hello")')).toBe(0);
  });
});
