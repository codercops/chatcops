declare module 'cloudflare:workers' {
  export abstract class DurableObject {
    ctx: import('./types.js').DurableObjectState;
    env: unknown;
    constructor(ctx: import('./types.js').DurableObjectState, env: unknown);
  }
}
