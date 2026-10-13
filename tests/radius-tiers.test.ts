import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ui = (n: string) => readFileSync(join(process.cwd(), `components/ui/${n}.tsx`), 'utf8');

describe('radius tiers follow the radius setting', () => {
  it('card uses the medium tier (rounded-lg), not large', () => {
    const s = ui('card');
    expect(s).toContain('rounded-lg');
    expect(s).not.toContain('rounded-xl');
  });
  it.each(['dialog', 'alert-dialog'])('%s content uses the large tier (rounded-xl)', (n) => {
    const s = ui(n);
    expect(s).toContain('rounded-xl');
    expect(s).not.toMatch(/\brounded-lg\b/);
  });
  it('checkbox has no hard-coded radius', () => {
    expect(ui('checkbox')).not.toContain('rounded-[');
  });
});
