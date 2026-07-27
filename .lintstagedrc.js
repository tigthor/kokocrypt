module.exports = {
  // type aware linting only works on files the tsconfig includes, so config
  // files at the repo root get prettier only
  'src/**/*.ts': ['eslint --fix', 'prettier --write'],
  'test/**/*.ts': ['eslint --fix', 'prettier --write'],
  '*.{js,json,md,yml}': ['prettier --write'],
};
