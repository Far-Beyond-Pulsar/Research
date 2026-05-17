import fs from 'fs/promises';
import path from 'path';
import matter from 'gray-matter';
import slugify from 'slugify';

const sections = ['published', 'drafts'];

function cleanName(name) {
  return slugify(name, { lower: true, strict: true });
}

function titleFromFilename(name) {
  return name
    .replace(/\.md$/i, '')
    .replace(/[\-_]/g, ' ')
    .trim();
}

function fallbackDescription(content) {
  const first = content
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/```[\s\S]*?```/g, '')
    .split('\n\n')
    .find((chunk) => chunk.trim().length > 0);

  if (!first) {
    return 'No description yet.';
  }

  return first.replace(/\s+/g, ' ').slice(0, 180);
}

async function walkMarkdown(dir, prefix = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue;
    }

    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      const nested = await walkMarkdown(full, [...prefix, entry.name]);
      files.push(...nested);
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      files.push({ fullPath: full, relativeParts: [...prefix, entry.name] });
    }
  }

  return files;
}

async function parseDoc(section, file) {
  const source = await fs.readFile(file.fullPath, 'utf8');
  const { data, content } = matter(source);

  const rawParts = file.relativeParts.map((part, index) => {
    if (index === file.relativeParts.length - 1) {
      return part.replace(/\.md$/i, '');
    }
    return part;
  });

  const slugParts = rawParts.map(cleanName).filter(Boolean);
  const slug = slugParts.join('/');
  const stats = await fs.stat(file.fullPath);
  const title = data.title || titleFromFilename(rawParts[rawParts.length - 1]) || 'Untitled';

  return {
    section,
    slug,
    slugParts,
    filePath: file.fullPath,
    title,
    description: data.description || fallbackDescription(content),
    content,
    date: data.date || stats.mtime.toISOString(),
    dateLabel: new Date(data.date || stats.mtime).toLocaleDateString(),
    tags: Array.isArray(data.tags) ? data.tags : [],
  };
}

export async function getSectionDocs(section) {
  if (!sections.includes(section)) {
    return [];
  }

  const base = path.join(process.cwd(), 'public', section);
  const files = await walkMarkdown(base);
  const docs = await Promise.all(files.map((file) => parseDoc(section, file)));

  return docs.sort((a, b) => +new Date(b.date) - +new Date(a.date));
}

export async function getAllDocs() {
  const grouped = await Promise.all(sections.map((section) => getSectionDocs(section)));
  return grouped.flat().sort((a, b) => +new Date(b.date) - +new Date(a.date));
}

export async function getDocBySlug(section, slugInput) {
  const docs = await getSectionDocs(section);
  const slug = Array.isArray(slugInput) ? slugInput.join('/') : slugInput;
  return docs.find((doc) => doc.slug === slug) || null;
}

export async function getStaticSlugs(section) {
  const docs = await getSectionDocs(section);
  return docs.map((doc) => ({ slug: doc.slug }));
}
