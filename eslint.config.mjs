import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/.next/**", "**/.open-next/**", "**/dist/**", "**/dist-types/**", "**/generated/**", "**/.wrangler/**", "infra/tranquil/vendor/**", "playwright-report/**", "test-results/**", "apps/lynx/scripts/**", "scripts/**", "*.config.*", "**/*.config.*", "**/env*.d.ts"] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error"
    }
  }
);
