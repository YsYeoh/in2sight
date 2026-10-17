import type { StoredAccount } from '@/lib/accounts/types';

/** Needed to read comments. Without it Meta returns an EMPTY comments list with no error, so it must be checked first. */
export const COMMENTS_SCOPE = 'instagram_business_manage_comments';

/** Only what Meta reported at connect/reconnect counts; unknown (null/absent) = not granted. Never inferred from API answers. */
export const hasScope = (a: Pick<StoredAccount, 'grantedScopes'>, scope: string): boolean => a.grantedScopes?.includes(scope) ?? false;
