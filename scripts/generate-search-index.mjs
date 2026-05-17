import fs from 'fs/promises';
import path from 'path';
import matter from 'gray-matter';
import slugify from 'slugify';

const sections = ['published', 'drafts'];

function cleanName(name) {
  return slugify(name, { lower: true, strict: true });
}

function stripMarkdown(content) {
  return content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function walkMarkdown(dir, prefix = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;

    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkMarkdown(full, [...prefix, entry.name])));
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      files.push({ fullPath: full, relativeParts: [...prefix, entry.name] });
    }
  }

  return files;
}

function titleFromFilename(name) {
  return name.replace(/\.md$/i, '').replace(/[\-_]/g, ' ').trim();
}

async function build() {
  const docs = [];
  const contentDocs = [];

  for (const section of sections) {
    const root = path.join(process.cwd(), 'public', section);
    const files = await walkMarkdown(root);

    for (const file of files) {
      const source = await fs.readFile(file.fullPath, 'utf8');
      const { data, content } = matter(source);

      const rawParts = file.relativeParts.map((part, i) =>
        i === file.relativeParts.length - 1 ? part.replace(/\.md$/i, '') : part
      );
      const slugParts = rawParts.map(cleanName).filter(Boolean);
      const stats = await fs.stat(file.fullPath);
      const plain = stripMarkdown(content);

      docs.push({
        section,
        slug: slugParts.join('/'),
        title: data.title || titleFromFilename(rawParts[rawParts.length - 1]),
        description: data.description || plain.slice(0, 180),
        tags: Array.isArray(data.tags) ? data.tags : [],
        content: plain.slice(0, 4000),
        dateLabel: new Date(data.date || stats.mtime).toLocaleDateString(),
      });

      contentDocs.push({
        section,
        slug: slugParts.join('/'),
        title: data.title || titleFromFilename(rawParts[rawParts.length - 1]),
        description: data.description || plain.slice(0, 180),
        dateLabel: new Date(data.date || stats.mtime).toLocaleDateString(),
        markdown: content,
      });
    }
  }

  const payload = {
    docs,
    generatedAt: new Date().toISOString(),
  };

  await fs.mkdir(path.join(process.cwd(), 'public'), { recursive: true });
  await fs.writeFile(path.join(process.cwd(), 'public', 'search-index.json'), JSON.stringify(payload, null, 2));
  await fs.writeFile(
    path.join(process.cwd(), 'public', 'content-index.json'),
    JSON.stringify({ docs: contentDocs, generatedAt: payload.generatedAt }, null, 2)
  );

  console.log(`Generated search index with ${docs.length} docs.`);
}

build().catch((error) => {
  console.error(error);
  process.exit(1);
});
