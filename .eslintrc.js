module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  // eslint-plugin-node is unmaintained, eslint-plugin-n is the live fork
  plugins: ['@typescript-eslint', 'n', 'prettier'],
  parserOptions: {
    tsconfigRootDir: __dirname,
    project: ['./tsconfig.json'],
  },
  extends: [
    'eslint:recommended',
    'plugin:n/recommended',
    'plugin:@typescript-eslint/eslint-recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
    'plugin:prettier/recommended',
  ],
  settings: {
    n: {
      // peers are supplied by the host app, so importing them is correct
      allowModules: [
        '@nestjs/common',
        '@nestjs/config',
        '@nestjs/core',
        '@nestjs/event-emitter',
        '@nestjs/microservices',
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
    'prettier/prettier': 'warn',
    // the rule that would have caught 1.0.1 shipping broken: it fails when
    // src imports a package that is in neither dependencies nor peers
    'n/no-extraneous-import': 'error',
    'n/no-extraneous-require': 'error',
    'n/no-missing-import': 'off',
    'n/no-empty-function': 'off',
    'n/no-unsupported-features/es-syntax': 'off',
    'n/no-missing-require': 'off',
    'n/hashbang': 'off',
    'n/no-unpublished-import': 'off',
    'n/no-unpublished-require': 'off',
    'n/no-process-exit': 'off',
    '@typescript-eslint/no-use-before-define': 'off',
    quotes: ['warn', 'single', { avoidEscape: true }],
    '@typescript-eslint/no-unsafe-assignment': 'off',
    '@typescript-eslint/no-var-requires': 'off',
    '@typescript-eslint/ban-ts-comment': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
  },
  ignorePatterns: ['dist/**', 'node_modules/**'],
};
