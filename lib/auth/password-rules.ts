// Password rules for the change and reset forms (Plan 16b). Pure: the browser uses it for the meter, the server for the decision.
// Length over composition (NIST SP 800-63B). bcrypt (Supabase Auth) ignores bytes after 72, so longer is refused, not truncated.
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX_BYTES = 72;
export const PASSWORD_MIN_DISTINCT = 5;

export type PasswordIssue = 'too_short' | 'too_long' | 'too_simple' | 'has_email';
export type StrengthScore = 0 | 1 | 2 | 3 | 4;
export interface Strength {
  score: StrengthScore;
  issue: PasswordIssue | null;
}

export type PasswordError = 'missing_fields' | 'mismatch' | 'weak' | 'wrong_password' | 'same_password' | 'rate_limited' | 'link_expired' | 'unexpected';
export type PasswordFormState = { ok?: boolean; othersSignedOut?: boolean; error?: PasswordError };

const CLASSES = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/];

export function passwordStrength(password: string, email?: string | null): Strength {
  const chars = [...password];
  if (chars.length < PASSWORD_MIN) return { score: 0, issue: 'too_short' };
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) return { score: 0, issue: 'too_long' };
  if (new Set(chars).size < PASSWORD_MIN_DISTINCT) return { score: 0, issue: 'too_simple' };
  const local = (email ?? '').split('@')[0].trim().toLowerCase();
  if (local.length >= 3 && password.toLowerCase().includes(local)) return { score: 0, issue: 'has_email' };
  const base = chars.length >= 20 ? 3 : chars.length >= 16 ? 2 : 1;
  const bonus = CLASSES.filter((re) => re.test(password)).length >= 3 ? 1 : 0;
  return { score: Math.min(4, base + bonus) as StrengthScore, issue: null };
}
