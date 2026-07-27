// eslint 9 flat config. the old .eslintrc.js is no longer read.
const tseslint = require('typescript-eslint');
const n = require('eslint-plugin-n');
const prettier = require('eslint-config-prettier');

module.exports = tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      '*.config.js',
      '.lintstagedrc.js',
    ],
  },
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    languageOptions: {
      parserOptions: {
        // the build tsconfig excludes test/, so linting needs its own project
        project: ['./tsconfig.eslint.json'],
        tsconfigRootDir: __dirname,
      },
    },
    plugins: { n },
    settings: {
      n: {
        // peers are supplied by the host app, so importing them is correct
        allowModules: [
          '@nestjs/common',
          '@nestjs/config',
          '@nestjs/core',
          '@nestjs/event-emitter',
          '@nestjs/microservices',
          '@nestjs/testing',
          'kafkajs',
          'rxjs',
          'express',
          'ntru',
          'liboqs-node',
        ],
        tryExtensions: ['.ts', '.js', '.json', '.node'],
      },
    },
    rules: {
      // this is the rule that would have caught 1.0.1 shipping broken: it
      // fails when src imports a package that is in neither deps nor peers
      'n/no-extraneous-import': 'error',
      'n/no-extraneous-require': 'error',

      // a crypto library must not drop a rejected promise on the floor
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',

      '@typescript-eslint/no-explicit-any': 'warn',
      // a leading underscore is the usual way to say "intentionally unused"
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/require-await': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      // expect(obj.method) is how you assert on a jest mock, and an async
      // express handler is how you write one. both are fine in a spec
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
    },
  },
  prettier
);
