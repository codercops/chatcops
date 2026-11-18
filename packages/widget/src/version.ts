declare const __CHATCOPS_VERSION__: string | undefined;

/** The widget's version, from package.json at build time. */
export const VERSION: string = typeof __CHATCOPS_VERSION__ === 'string' ? __CHATCOPS_VERSION__ : '0.0.0-dev';
