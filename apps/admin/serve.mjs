import express from 'express';
import { readFileSync } from 'node:fs';

const app = express();
app.disable('x-powered-by');
for (const [route, file] of [['/', 'index.html'], ['/styles.css', 'styles.css'], ['/dashboard.js', 'dashboard.js']]) {
  const contents = readFileSync(new URL(file, import.meta.url));
  app.get(route, (_request, response) => response.type(file).send(contents));
}
app.listen(5174, '127.0.0.1', () => console.log('Admin dashboard: http://localhost:5174'));
