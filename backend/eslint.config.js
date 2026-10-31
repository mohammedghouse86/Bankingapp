const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    files: ['**/*.js'],
    ignores: ['node_modules/**'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: { ...globals.node } },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['error', { args: 'none', ignoreRestSiblings: true }],
    },
  },
];
