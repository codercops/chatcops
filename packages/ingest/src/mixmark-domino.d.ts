// The package's own types declare the module under its old name, 'domino'.
declare module '@mixmark-io/domino' {
  const domino: { createDocument(html?: string, force?: boolean): Document };
  export default domino;
}
