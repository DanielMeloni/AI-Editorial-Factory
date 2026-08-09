import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'coverage/**',
      'next-env.d.ts',
      'playwright-report/**',
      'test-results/**',
      'src/lib/supabase/database.types.ts',
      // Rotte generate dal Workflow SDK a ogni build: non sono codice sorgente.
      'src/app/.well-known/**',
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@supabase/supabase-js',
              importNames: ['createClient'],
              message:
                'Usa i wrapper in src/lib/supabase (client.ts, server.ts, admin.ts) invece di createClient diretto.',
            },
          ],
        },
      ],
      eqeqeq: ['error', 'always'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Il client con service role e' l'unico autorizzato a usare createClient.
    files: ['src/lib/supabase/admin.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    files: ['tests/**/*.ts', 'tests/**/*.tsx'],
    rules: { 'no-console': 'off' },
  },
);
