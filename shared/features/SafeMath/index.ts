/**
 * @file shared/features/SafeMath/index.ts
 * @description Utility slice for securely evaluating mathematical expressions from user input.
 * This slice completely avoids the dangerous `eval()` function, which can lead to
 * Cross-Site Scripting (XSS) and Remote Code Execution (RCE) vulnerabilities.
 * Instead, it implements a custom, lightweight Abstract Syntax Tree (AST)-like parser
 * that only permits numbers and basic arithmetic operators (+, -, *, /, ()).
 */

/**
 * Safely parses and evaluates a math input string.
 * 
 * SECURITY:
 * 1. Input Sanitization: We strip all whitespace and apply a strict regex pattern to ensure only digits and operators (+, -, *, /) are present.
 *    If the input contains ANY character outside of numbers and basic operators (e.g., letters, quote marks),
 *    the entire expression is rejected immediately. This guarantees that malicious payloads like `alert(1)`
 *    cannot pass the first line of defense.
 * 2. Custom Parsing: We tokenize the string into discrete numbers and operator strings. We do not pass
 *    the string to the JavaScript engine's execution context.
 * 3. Graceful Failure: If parsing encounters an invalid state (e.g., unmatched parens or NaN), it returns 0.
 * 
 * @param exprStr The raw string expression provided by the user (e.g., "100 + (50 * 2)").
 * @returns The evaluated numerical result, or 0 if invalid.
 */
export function parseMathInput(exprStr: string): number {
  if (!exprStr || !exprStr.trim()) return 0;
  
  // Strip all whitespace.
  const clean = exprStr.replace(/\s+/g, '');
  
  // STRICT REGEX FILTERING: Allow only digits, decimal points, and basic operators.
  // This explicitly blocks function calls, alphabetical characters, and malicious scripts.
  if (!/^[0-9+\-*/().]+$/.test(clean)) {
    return 0;
  }

  try {
    const result = evaluateSimpleExpression(clean);
    return isNaN(result) || !isFinite(result) ? 0 : result;
  } catch (e) {
    // If the expression is malformed, we safely swallow the error and return 0.
    return 0;
  }
}

/**
 * Evaluates a sanitized mathematical expression string using a custom lexer and recursive-descent-like logic.
 * 
 * HOW IT WORKS (WITHOUT EVAL):
 * 1. Tokenization (Lexing): The string is iterated character by character. Consecutive digits/decimals 
 *    are grouped into numeric string tokens. Operators are grouped as individual tokens.
 *    Example: "10+5*2" becomes tokens: ["10", "+", "5", "*", "2"]
 * 
 * 2. Parentheses Resolution (Deepest-first):
 *    We scan the token list for the first closing parenthesis `)`, and match it with the closest preceding
 *    opening parenthesis `(`. This gives us the deepest nested sub-expression. We evaluate that sub-expression
 *    (which now contains no parentheses) and replace the entire `(...)` token block with the resulting numerical value.
 *    We loop this until all parentheses are resolved.
 * 
 * 3. Operator Precedence (Multiplication & Division):
 *    Within a parenthesis-free sub-expression, we make a pass to find `*` and `/`. When found, we take the
 *    number to the left, apply the operation to the number on the right, and replace those 3 tokens with the result.
 * 
 * 4. Final Evaluation (Addition & Subtraction):
 *    We do a final pass for `+` and `-` from left to right, accumulating the total sum/difference.
 * 
 * @param expr The sanitized expression string containing only numbers and operators.
 * @returns The numerical evaluation result.
 */
function evaluateSimpleExpression(expr: string): number {
  // Step 1: Tokenization
  const tokens: string[] = [];
  let numAccum = '';
  
  for (let i = 0; i < expr.length; i++) {
    const char = expr[i];
    if (/[0-9.]/.test(char)) {
      numAccum += char;
    } else {
      if (numAccum) {
        tokens.push(numAccum);
        numAccum = '';
      }
      tokens.push(char);
    }
  }
  if (numAccum) {
    tokens.push(numAccum);
  }

  // Helper to evaluate a flat token array (no parentheses left)
  const parseNoParens = (toks: string[]): number => {
    // Step 3: Handle * and / first (Operator Precedence)
    const intermediate: (number | string)[] = [];
    let i = 0;
    while (i < toks.length) {
      const tok = toks[i];
      if (tok === '*' || tok === '/') {
        // Pop the left operand from the intermediate stack
        const left = Number(intermediate.pop());
        // Grab the right operand
        const right = Number(toks[i + 1]);
        if (tok === '*') {
          intermediate.push(left * right);
        } else {
          intermediate.push(left / right);
        }
        // Skip over the right operand as we've just consumed it
        i += 2;
      } else {
        intermediate.push(isNaN(Number(tok)) ? tok : Number(tok));
        i++;
      }
    }

    if (intermediate.length === 0) return 0;
    
    // Step 4: Handle + and - from left to right
    let res = Number(intermediate[0]);
    let j = 1;
    while (j < intermediate.length) {
      const op = intermediate[j];
      const val = Number(intermediate[j + 1]);
      if (op === '+') {
        res += val;
      } else if (op === '-') {
        res -= val;
      }
      j += 2;
    }
    return res;
  };

  // Step 2: Handle parentheses by continuously evaluating the innermost pair
  let hasParens = tokens.includes('(');
  let limit = 100; // Safeguard against infinite loops in malformed input
  while (hasParens && limit > 0) {
    limit--;
    let openIdx = -1;
    let closeIdx = -1;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i] === '(') {
        openIdx = i;
      } else if (tokens[i] === ')') {
        closeIdx = i;
        break;
      }
    }
    if (openIdx !== -1 && closeIdx !== -1) {
      // Extract the sub-expression between the parens
      const subExpression = tokens.slice(openIdx + 1, closeIdx);
      // Evaluate it
      const val = parseNoParens(subExpression);
      // Replace the entire ( ... ) block with the evaluated numerical value
      tokens.splice(openIdx, closeIdx - openIdx + 1, val.toString());
    } else {
      break;
    }
    hasParens = tokens.includes('(');
  }

  // Finally, evaluate the remaining flat token array
  return parseNoParens(tokens);
}
