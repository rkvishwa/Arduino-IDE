declare module 'vite' {
  export type UserConfig = Record<string, unknown>;

  export function defineConfig(config: UserConfig): UserConfig;
}

declare module '@vitejs/plugin-react' {
  const react: () => unknown;
  export default react;
}
