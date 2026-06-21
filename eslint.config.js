import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import nodePlugin from 'eslint-plugin-n';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  nodePlugin.configs['flat/recommended-module'],
  {
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression[callee.property.name="query"] > TemplateLiteral[expressions.length > 0]',
          message: 'Template literals with interpolations inside SQL queries are forbidden to prevent SQL injection. Use parameterized queries (?) instead.'
        }
      ],
      'n/file-extension-in-import': ['error', 'always'],
      // We are using typescript so we disable some rules that aren't aware of TS resolution
      'n/no-missing-import': 'off',
      'n/no-unpublished-import': 'off'
    }
  }
);
