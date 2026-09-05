import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const mime = { '.html':'text/html; charset=utf-8', '.js':'application/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.svg':'image/svg+xml' };
createServer(async (req,res) => {
  const relative = decodeURIComponent(req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0]).replace(/^\//,'');
  const file = normalize(join(root,relative));
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  try { res.writeHead(200, {'Content-Type': mime[extname(file)] || 'application/octet-stream'}); res.end(await readFile(file)); }
  catch { res.writeHead(404); res.end('Not found'); }
}).listen(8000, '127.0.0.1');
