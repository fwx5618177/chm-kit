module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint', 'prettier'],
  extends: [
    'eslint:recommended',
    'prettier',
  ],
  rules: {
    'prettier/prettier': 'error',
    'no-console': 'warn',
    'no-debugger': 'error',
    'no-duplicate-imports': 'error',
    'no-unused-expressions': 'error',
    'no-undef': 'off', // TypeScript 编译器已处理未定义变量检查
    'prefer-const': 'error',
    'prefer-template': 'error',
    '@typescript-eslint/no-unused-vars': 'error',
    '@typescript-eslint/no-explicit-any': 'warn',
  },
  env: {
    node: true,
    es2020: true,
  },
  ignorePatterns: ['dist/', 'node_modules/', '*.js'],
  overrides: [
    {
      files: ['src/logger/logger.ts'],
      rules: {
        'no-console': 'off',
      },
    },
  ],
}; 