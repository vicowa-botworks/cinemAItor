import js from "npm:@eslint/js@^9.33.0";
import globals from "npm:globals@^16.3.0";
import tseslint from "npm:typescript-eslint@^8.33.0";

export default tseslint.config(
  {
    ignores: ["node_modules/"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        project: false,
      },
    },
    rules: {
      "no-undef": "off",
    },
  },
  {
    files: ["src/server.ts", "tests/**/*.ts"],
    languageOptions: {
      globals: {
        ...globals.browser,
        Deno: "readonly",
      },
    },
  },
);
