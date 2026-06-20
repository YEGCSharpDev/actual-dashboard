import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression[callee.property.name="query"] > TemplateLiteral[expressions.length > 0]',
          message: 'Template literals with interpolations inside SQL queries are forbidden to prevent SQL injection. Use parameterized queries (?) instead.'
        }
      ]
    }
  }
);
