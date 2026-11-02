import { readFileSync, writeFileSync } from 'node:fs';
const template = readFileSync('index.template.html', 'utf8');
const styles = readFileSync('styles.css', 'utf8');
const script = readFileSync('app.js', 'utf8');
if (/<\/script/i.test(script) || /<\/style/i.test(styles)) throw new Error('Embedded asset contains a closing tag');
// Inline scripts do not defer, so execute after the document has been parsed.
const page = template.replace('__STYLES__', () => styles).replace('__SCRIPT__', () => "document.addEventListener('DOMContentLoaded', () => {\n" + script + "\n});");
writeFileSync('index.html', page);
