import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      'out/**',
      'coverage/**',
      'node_modules/**',
      'scripts/**',
      '*.config.ts',
      '*.config.js'
    ]
  },
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.web.json', './tsconfig.test.json'],
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      // Invariante 1: `strict` allein verbietet `any` nicht.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      // Invariante 7 (Vorbereitung, CSP-Teil folgt in S0.2)
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'Invariante 7: keine Netzwerkaufrufe in src/.' },
        { name: 'XMLHttpRequest', message: 'Invariante 7: keine Netzwerkaufrufe in src/.' }
      ],
      // Fehlerbehandlung: kein stiller Fehlschlag (S1.5 baut darauf auf)
      'no-empty': ['error', { allowEmptyCatch: false }]
    }
  },
  {
    // Hook-Regeln nur fuer Komponenten. `exhaustive-deps` ist der eigentliche
    // Gewinn: unvollstaendige Abhaengigkeitslisten faellt kein Review
    // zuverlaessig auf, und Phase 2 bringt weitere Effekte dazu.
    //
    // eslint-plugin-jsx-a11y fehlt hier bewusst: keine veroeffentlichte
    // Version unterstuetzt ESLint 10. Die Live-Regionen sichern stattdessen
    // Tests in test/unit/App.test.tsx.
    files: ['**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error'
    }
  }
)
