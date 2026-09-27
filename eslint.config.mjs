import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["main.js", "release/**", "node_modules", "*.map"] },
  ...tseslint.configs.recommended,
  { rules: { "@typescript-eslint/no-explicit-any": "error" } }
);
