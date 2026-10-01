const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch] ?? ch);
}

const SAFE_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);

function isSafeHref(href: string): boolean {
  // Browsers drop tabs and newlines anywhere in a URL and trim leading
  // control characters and spaces, so normalize the same way before
  // reading the scheme. URLs without a scheme are relative and safe.
  const normalized = href.replace(/[\t\n\r]/g, '').replace(/^[\u0000-\u0020]+/, '');
  const scheme = /^([^:/?#]+):/.exec(normalized);
  return !scheme || SAFE_SCHEMES.has(scheme[1].toLowerCase());
}

export function renderMarkdown(input: string): string {
  let html = escapeHtml(input);

  // Code blocks (``` ... ```)
  html = html.replace(/```(?:\w*)\n?([\s\S]*?)```/g, (_match, code: string) => {
    return `<pre><code>${code.trim()}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Links (supports one level of nested parentheses in URLs). Links with an
  // unsafe scheme such as javascript: or data: are shown as plain text.
  html = html.replace(
    /\[([^\]]+)\]\(((?:[^()]*|\([^()]*\))*)\)/g,
    (_match, text: string, href: string) =>
      isSafeHref(href) ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>` : text
  );

  // Unordered lists
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`);

  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

  // Line breaks (double newline = paragraph break)
  html = html.replace(/\n\n/g, '<br><br>');
  html = html.replace(/\n/g, '<br>');

  return html;
}
