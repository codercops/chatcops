import type { Chunk, ExtractedDoc } from './types.js';

export interface ChunkOptions {
  /** About this many tokens per chunk. Default 500. */
  targetTokens?: number;
  /** Tokens repeated from the end of the previous chunk in the same section. Default 60. */
  overlapTokens?: number;
}

interface Block {
  text: string;
  /** Code blocks and tables are never split or overlapped. */
  atomic: boolean;
}

interface Section {
  path: string[];
  blocks: Block[];
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;

/**
 * A rough token count: about four characters per token, except CJK, where
 * each character is about one. Good enough to size chunks; never billed on.
 */
export function estimateTokens(text: string): number {
  const cjk = text.match(CJK)?.length ?? 0;
  return cjk + Math.ceil((text.length - cjk) / 4);
}

/**
 * Splits a page into chunks: first at h1 to h3, then by packing blocks
 * (paragraphs, lists, code blocks, tables) up to `targetTokens`. Code blocks
 * and tables stay whole. Each chunk starts with its heading path
 * (`Page title > Section > Subsection`), so a chunk read alone still says
 * what it's about.
 */
export function chunkDoc(doc: ExtractedDoc, options: ChunkOptions = {}): Chunk[] {
  const target = Math.max(50, options.targetTokens ?? 500);
  const overlap = Math.max(0, Math.min(options.overlapTokens ?? 60, Math.floor(target / 2)));
  const chunks: Chunk[] = [];

  for (const section of sections(doc.markdown)) {
    const crumbs = [doc.title, ...section.path].filter((part): part is string => !!part);
    const breadcrumb = dedupe(crumbs).join(' > ');
    const section_ = section.path.length ? section.path.join(' > ') : undefined;
    for (const body of pack(section.blocks.flatMap((block) => split(block, target)), target, overlap)) {
      chunks.push({
        index: chunks.length,
        text: breadcrumb ? `${breadcrumb}\n\n${body}` : body,
        ...(section_ ? { section: section_ } : {}),
      });
    }
  }
  return chunks;
}

function sections(markdown: string): Section[] {
  const out: Section[] = [];
  // The current heading at each level (1 to 3); a heading clears the ones below it.
  const levels: Array<string | undefined> = [];
  let current: Section = { path: [], blocks: [] };
  const lines = markdown.split('\n');

  const flush = () => {
    if (current.blocks.length) out.push(current);
  };

  for (let i = 0; i < lines.length; ) {
    const line = lines[i];
    const heading = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1].length;
      levels[level] = heading[2];
      levels.length = level + 1;
      current = { path: levels.filter((text): text is string => !!text), blocks: [] };
      i++;
      continue;
    }
    if (/^\s*(```|~~~)/.test(line)) {
      const fence = line.trim().slice(0, 3);
      const start = i;
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence)) i++;
      i = Math.min(i + 1, lines.length);
      current.blocks.push({ text: lines.slice(start, i).join('\n'), atomic: true });
      continue;
    }
    if (/^\s*\|/.test(line)) {
      const start = i;
      while (i < lines.length && /^\s*\|/.test(lines[i])) i++;
      current.blocks.push({ text: lines.slice(start, i).join('\n'), atomic: true });
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const start = i;
    while (i < lines.length && lines[i].trim() && !/^(#{1,3})\s/.test(lines[i]) && !/^\s*(```|~~~|\|)/.test(lines[i])) i++;
    current.blocks.push({ text: lines.slice(start, i).join('\n'), atomic: false });
  }
  flush();
  return out;
}

/** A paragraph longer than a chunk, split at sentence ends (or, failing that, words). */
function split(block: Block, target: number): Block[] {
  if (block.atomic || estimateTokens(block.text) <= target) return [block];
  const sentences = block.text.match(/[^.!?。！？\n]+(?:[.!?。！？]+|\n|$)\s*/gu) ?? [block.text];
  const pieces: Block[] = [];
  let piece = '';
  for (const sentence of sentences) {
    if (piece && estimateTokens(piece + sentence) > target) {
      pieces.push({ text: piece.trim(), atomic: false });
      piece = '';
    }
    if (estimateTokens(sentence) > target) {
      for (const part of byLength(sentence, target)) pieces.push({ text: part, atomic: false });
    } else {
      piece += sentence;
    }
  }
  if (piece.trim()) pieces.push({ text: piece.trim(), atomic: false });
  return pieces;
}

function byLength(text: string, target: number): string[] {
  const parts: string[] = [];
  let part = '';
  for (const char of text) {
    part += char;
    if (estimateTokens(part) >= target) {
      parts.push(part.trim());
      part = '';
    }
  }
  if (part.trim()) parts.push(part.trim());
  return parts;
}

/** Blocks packed into chunk bodies, each starting with the previous chunk's last blocks up to `overlap`. */
function pack(blocks: Block[], target: number, overlap: number): string[] {
  const bodies: string[] = [];
  let current: Block[] = [];
  let tokens = 0;
  let fresh = false;

  const close = () => {
    if (fresh) bodies.push(current.map((block) => block.text).join('\n\n'));
    const tail: Block[] = [];
    let tailTokens = 0;
    for (let i = current.length - 1; i >= 0; i--) {
      const block = current[i];
      const size = estimateTokens(block.text);
      if (block.atomic || tailTokens + size > overlap) break;
      tail.unshift(block);
      tailTokens += size;
    }
    current = tail;
    tokens = tailTokens;
    fresh = false;
  };

  for (const block of blocks) {
    const size = estimateTokens(block.text);
    if (fresh && tokens + size > target) close();
    current.push(block);
    tokens += size;
    fresh = true;
  }
  if (fresh) bodies.push(current.map((block) => block.text).join('\n\n'));
  return bodies;
}

function dedupe(parts: string[]): string[] {
  return parts.filter((part, i) => i === 0 || part !== parts[i - 1]);
}
