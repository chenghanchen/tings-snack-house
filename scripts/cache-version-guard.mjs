// Transitional extraction: legacy classifier remains standalone for trusted-base loading.
// Exact parity is enforced until the legacy path is retired; no Stage 6 manifest.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const hash = value => createHash('sha256').update(value).digest('hex');
export const managedResources = Object.freeze({
  'styles.css': { html: 'index.html', tag: 'link', attribute: 'href' },
  'mobile-header.js': { html: 'index.html', tag: 'script', attribute: 'src' },
  'customer-account.css': { html: 'index.html', tag: 'link', attribute: 'href' },
  'customer-account.js': { html: 'index.html', tag: 'script', attribute: 'src' },
});
const normalizedHash = source => hash(source.replace(/\r\n/g, '\n'));
export function resourceParts(source) {
  let offset = 0, shape = '';
  const references = [];
  while (offset < source.length) {
    const next = source.indexOf('<', offset);
    if (next < 0) { shape += source.slice(offset); break; }
    shape += source.slice(offset, next);
    const token = /^(?:<!--[\s\S]*?-->|<!doctype[^>]*>|<\/?([a-z][a-z0-9:-]*)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>)/i.exec(source.slice(next));
    if (!token) throw Error('Unrecognized HTML syntax');
    let rendered = token[0];
    offset = next + rendered.length;
    const name = token[1]?.toLowerCase();
    if (name && !rendered.startsWith('</')) {
      if (name === 'base') throw Error('HTML base URL requires reference review');
      const start = /^<[a-z][a-z0-9:-]*/i.exec(rendered)[0].length;
      const attrs = new Map(); let pos = start;
      while (!/^\s*\/?\s*>$/.test(rendered.slice(pos))) {
        const a = /\s+([a-z_:][a-z0-9_.:-]*)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/iy;
        a.lastIndex = pos; const m = a.exec(rendered);
        if (!m || attrs.has(m[1].toLowerCase())) throw Error('Ambiguous HTML attributes');
        attrs.set(m[1].toLowerCase(), { value: m[2], start: m.index + m[0].lastIndexOf(m[2] || '') });
        pos = a.lastIndex;
      }
      // Both canonical references and suspicious aliases count, including extra consumers.
      for (const attribute of ['src', 'href']) {
        const a = attrs.get(attribute); if (!a?.value) continue;
        const quoted = /^["']/.test(a.value);
        const raw = quoted ? a.value.slice(1, -1) : a.value;
        let decoded;
        try {
          const entities = raw.replace(/&#(?:x([a-f0-9]+)|(\d+));?/gi, (_, x, d) => String.fromCodePoint(parseInt(x || d, x ? 16 : 10)));
          if (/&(?!amp;)[a-z][a-z0-9]*;/i.test(entities)) throw Error('Unknown entity');
          decoded = decodeURIComponent(entities.replace(/&amp;/gi, '&')).replace(/[\t\r\n]/g, '');
        }
        catch { throw Error('Unrecognized resource URL encoding'); }
        for (const [asset, expected] of Object.entries(managedResources)) {
          if (!decoded.includes(asset)) continue;
          const prefix = `${asset}?v=`;
          const version = raw.startsWith(prefix) ? raw.slice(prefix.length) : '';
          const canonical = quoted && /^[a-zA-Z0-9._-]+$/.test(version) && name === expected.tag && attribute === expected.attribute &&
            (name !== 'link' || /^(["'])stylesheet\1$/i.test(attrs.get('rel')?.value || ''));
          references.push({ asset, version, canonical });
          if (canonical) {
            const at = a.start + 1 + prefix.length;
            // Only version bytes may be masked. All paths, attributes and code stay exact.
            rendered = rendered.slice(0, at) + '__RESOURCE_VERSION__' + rendered.slice(at + version.length);
          }
        }
      }
      shape += rendered;
      if (['script', 'style', 'title', 'textarea', 'svg', 'math', 'template', 'noscript', 'xmp', 'iframe', 'noembed', 'noframes'].includes(name)) {
        if (/\/\s*>$/.test(token[0])) throw Error('Ambiguous raw-text tag');
        const close = new RegExp(`</${name}\\s*>`, 'i').exec(source.slice(offset));
        if (!close) throw Error('Unterminated HTML element');
        const body = source.slice(offset, offset + close.index);
        if (!['script', 'style', 'title', 'textarea'].includes(name) && new RegExp(`<${name}\\b`, 'i').test(body)) throw Error('Nested opaque HTML');
        // Dynamic imports/hidden consumers are not covered by the static reference map.
        if (Object.keys(managedResources).some(asset => body.includes(asset))) throw Error('Opaque resource consumer requires review');
        shape += body + close[0]; offset += close.index + close[0].length;
      }
    } else shape += rendered;
  }
  return { shape, references };
}

export function checkResourceVersions(git, base, target, changes) {
  const files = git('ls-tree', '-r', '--name-only', '-z', target).split('\0').filter(f => /\.html$/i.test(f));
  const relevant = changes.some(c => Object.hasOwn(managedResources, c.path) || /\.html$/i.test(c.path));
  if (!relevant) return { status: 'NOT_REQUIRED', reason: 'No managed resource or HTML changes' };
  const checked = [], problems = [];
  try {
    const expected = new Map(Object.keys(managedResources).map(asset => {
      if (!git('ls-tree', target, '--', asset).startsWith('100644 blob ')) throw Error(`Missing/non-regular managed resource: ${asset}`);
      return [asset, normalizedHash(git('show', `${target}:${asset}`))];
    }));
    for (const html of files) {
      if (!git('ls-tree', target, '--', html).startsWith('100644 blob ')) throw Error(`Non-regular HTML: ${html}`);
      const parsed = resourceParts(git('show', `${target}:${html}`));
      for (const ref of parsed.references) {
        if (!ref.canonical || managedResources[ref.asset].html !== html) problems.push(`Unknown reference: ${html} -> ${ref.asset}`);
        if (ref.version !== expected.get(ref.asset)) problems.push(`Stale content version: ${html} -> ${ref.asset}`);
        checked.push({ html, asset: ref.asset, version: ref.version, sha256: expected.get(ref.asset) });
      }
    }
    for (const asset of Object.keys(managedResources)) {
      if (checked.filter(r => r.asset === asset).length !== 1) problems.push(`Missing/duplicate consumer: ${asset}`);
      const changed = changes.find(c => c.path === asset);
      if (changed && changed.before !== changed.after) {
        // Require a changed cache key as well as a matching target content hash.
        const old = resourceParts(git('show', `${base}:${managedResources[asset].html}`));
        const prior = old.references.filter(r => r.asset === asset);
        const next = checked.filter(r => r.asset === asset);
        if (prior.length !== 1 || next.length !== 1 || prior[0].version === next[0].version) problems.push(`Unchanged/unknown cache key: ${asset}`);
      }
    }
  } catch (error) { problems.push(error.message); }
  return { status: problems.length ? 'FAIL' : 'PASS', checked, problems };
}


export function checkGitVersions(root, base, target) {
  if (![base,target].every(s=>/^[a-f0-9]{40}$/.test(s||''))) throw Error('Explicit full base/checkout SHA required');
  const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024});
  git('merge-base','--is-ancestor',base,target);
  const paths=git('diff','--name-only','--no-renames','-z',base,target,'--').split('\0').filter(Boolean);
  const changes=paths.map(file=>({path:file,before:base,after:target}));
  return checkResourceVersions(git,base,target,changes);
}
