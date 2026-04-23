import matter from 'gray-matter';

/** Parsed YAML config from markdown file */
export interface ParsedConfig<T> {
  data: T;
  content: string; // Content after YAML frontmatter
  raw: string;     // Original raw content
}

/** Parse a markdown file with YAML frontmatter */
export function parseMarkdownConfig<T>(raw: string): ParsedConfig<T> {
  const parsed = matter(raw);
  return {
    data: parsed.data as T,
    content: parsed.content,
    raw
  };
}

/** Serialize data back to markdown with YAML frontmatter */
export function serializeMarkdownConfig<T>(data: T, content: string = ''): string {
  const yamlLines = Object.entries(data)
    .filter(([, v]) => v !== undefined)
    .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);

  return `---\n${yamlLines.join('\n')}\n---\n\n${content}`;
}
