import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';

export default ts.config(
  { ignores: ['node_modules/**', '.svelte-kit/**', 'build/**', 'src-tauri/**', 'WorkFiles/**'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs['flat/recommended'],
  {
    files: ['**/*.svelte.ts'],
    languageOptions: { parser: ts.parser },
    // Controller lookup indexes do not participate in rendering.
    rules: { 'svelte/prefer-svelte-reactivity': 'off' },
  },
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
  {
    files: ['**/*.svelte'],
    languageOptions: { parserOptions: { parser: ts.parser, extraFileExtensions: ['.svelte'] } },
  },
);
