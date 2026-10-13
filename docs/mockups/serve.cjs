// Tiny static server for the mockups: node docs/mockups/serve.cjs [port]
// Open http://localhost:5173/ for an index, or /?page=app-prototype
const http = require('http'), fs = require('fs'), path = require('path');
const DIR = __dirname, PORT = +process.argv[2] || 5173;
const TYPES = { '.css': 'text/css', '.js': 'text/javascript', '.html': 'text/html' };

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/files/')) {
    const f = path.join(DIR, path.basename(u.pathname));
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'text/plain' });
    return res.end(fs.readFileSync(f));
  }
  const page = (u.searchParams.get('page') || '').replace(/[^\w-]/g, '');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  if (!page) {
    const list = fs.readdirSync(DIR).filter(f => f.endsWith('.html'))
      .map(f => `<li><a href="/?page=${f.slice(0, -5)}">${f.slice(0, -5)}</a></li>`).join('');
    return res.end(`<!doctype html><meta charset=utf-8><body style="font:15px system-ui;padding:32px"><h2>in2sight mockups</h2><ul>${list}</ul>`);
  }
  // pages are HTML fragments; wrap them like the brainstorm companion did
  res.end('<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><body style="margin:0;background:#1c1c1e;padding:24px;font-family:system-ui">'
    + fs.readFileSync(path.join(DIR, page + '.html'), 'utf8'));
}).listen(PORT, () => console.log(`mockups: http://localhost:${PORT}/`));
