// The Worker's bindings, read in src/pages/api/chat.ts. Only what the site uses.
declare module 'cloudflare:workers' {
  export const env: Record<string, unknown>;
}
