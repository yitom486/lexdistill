import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const manifest = JSON.parse(readFileSync(join(WEB_ROOT, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>;
};
const fonts = Object.entries(manifest.dependencies).filter(([name]) => name.startsWith('@fontsource/'));

describe('bundled font delivery', () => {
  it('pins font packages and delivers their complete copyright and license notices', () => {
    expect(fonts.length).toBeGreaterThan(0);
    for (const [name, version] of fonts) {
      expect(version, `${name} must use an exact version`).toMatch(/^\d+\.\d+\.\d+$/);
      const source = readFileSync(join(WEB_ROOT, 'node_modules', name, 'LICENSE'), 'utf8');
      const delivered = readFileSync(join(WEB_ROOT, 'public', 'licenses', 'fonts', `${name.split('/')[1]}-LICENSE.txt`), 'utf8');
      expect(delivered, `${name} bundled notice must match its source`).toBe(source);
      expect(delivered).toContain('SIL OPEN FONT LICENSE Version 1.1');
    }
  });

  it('imports complete local unicode-range stylesheets without Google Fonts links', () => {
    const entry = readFileSync(join(WEB_ROOT, 'src', 'main.tsx'), 'utf8');
    const imports = [...entry.matchAll(/import\s+['"](@fontsource\/[^'"]+\.css)['"]/g)];
    expect(imports.length).toBeGreaterThan(0);
    for (const match of imports) {
      const css = readFileSync(join(WEB_ROOT, 'node_modules', match[1]!), 'utf8');
      expect(css, `${match[1]} must preserve subset selection`).toContain('unicode-range:');
      expect(css).not.toMatch(/url\(\s*['"]?https?:/);
    }
    const html = readFileSync(join(WEB_ROOT, 'index.html'), 'utf8');
    expect(html).not.toMatch(/<link[^>]+(?:fonts\.googleapis\.com|fonts\.gstatic\.com)/);
  });
});
