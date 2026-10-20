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
  // biome-ignore lint/suspicious/noControlCharactersInRegex: strip control characters from url
  const normalized = href.replace(/[\t\n\r]/g, '').replace(/^[\u0000-\u0020]+/, '');
  const scheme = /^([^:/?#]+):/.exec(normalized);
  return !scheme || SAFE_SCHEMES.has(scheme[1].toLowerCase());
}

// Reserve a placeholder token that cannot collide with the input: it grows
// until the token cannot appear anywhere in the text being rendered.
function reserveToken(text: string): string {
  let token = '\u0000';
  while (text.includes(token)) token += '\u0000';
  return token;
}

export function renderMarkdown(input: string): string {
  let html = escapeHtml(input);
  const token = reserveToken(html);
  const stash: string[] = [];

  const stashHtml = (value: string): string => {
    const index = stash.push(value) - 1;
    return `${token}${index}${token}`;
  };

  // Code blocks (``` ... ```) — stashed before any markdown transformation so
  // their content stays literal and their newlines survive the <br> step.
  html = html.replace(/```(?:\w*)\n?([\s\S]*?)```/g, (_match, code: string) => {
    return stashHtml(`<pre><code>${code.trim()}</code></pre>`);
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, (_match, code: string) => stashHtml(`<code>${code}</code>`));

  // Headings
  html = html.replace(/^(#{1,6}) (.+)$/gm, (_match, hashes: string, text: string) => {
    const level = hashes.length;
    return `<h${level}>${text}</h${level}>`;
  });

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Italic
  html = html.replace(/\*(\S(?:.*?\S)??)\*/g, '<em>$1</em>');

  // Links (supports one level of nested parentheses in URLs). Links with an
  // unsafe scheme such as javascript: or data: are shown as plain text.
  html = html.replace(
    /\[([^\]]+)\]\(((?:[^()]*|\([^()]*\))*)\)/g,
    (_match, text: string, href: string) =>
      isSafeHref(href) ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>` : text
  );

  // Lists — tag each item with its list type so consecutive same-type
  // items can be grouped into a <ul>/<ol>, and a `-` list followed by a
  // `1.` list stays two separate lists. Intra-list newlines are removed
  // here so the line-break step below does not insert <br> between items.
  html = html.replace(/^[-*+] (.+)$/gm, '<li data-md="ul">$1</li>');
  html = html.replace(/^\d+\. (.+)$/gm, '<li data-md="ol">$1</li>');
  html = html.replace(
    /(?:<li data-md="ul">.*?<\/li>\n?)+|(?:<li data-md="ol">.*?<\/li>\n?)+/g,
    (run) => {
      const ordered = run.includes('data-md="ol"');
      const tag = ordered ? 'ol' : 'ul';
      const items = run.replace(/ data-md="(?:ul|ol)"/g, '').replace(/\n/g, '');
      return `<${tag}>${items}</${tag}>`;
    }
  );

  // A heading is a block, so no <br> right after one.
  html = html.replace(/(<\/h[1-6]>)\n+/g, '$1');

  // Line breaks (double newline = paragraph break)
  html = html.replace(/\n\n/g, '<br><br>');
  html = html.replace(/\n/g, '<br>');

  // Restore stashed code so its content stays literal and its newlines are
  // actual newlines rather than <br> tags.
  for (let i = 0; i < stash.length; i++) {
    html = html.replace(`${token}${i}${token}`, () => stash[i]);
  }

  return html;
}
