import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Instagram API response fixtures. Hand-written from Meta's docs until a real account exists; replace each file with a
 * recorded, redacted response (docs/RUNBOOK_SYNC.md step 4). The `_source` key is ignored by the parsers.
 */
export const fixture = (name: string): Record<string, unknown> => JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures/instagram', `${name}.json`), 'utf8'));
