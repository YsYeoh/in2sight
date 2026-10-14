export type AccountStatus = 'active' | 'needs_reconnect' | 'archived';

export interface StoredAccount {
  id: string;
  igUserId: string;
  username: string;
  displayName: string | null;
  accountType: string | null;
  profilePictureUrl: string | null;
  groupName: string | null;
  status: AccountStatus;
  archivedAt: string | null;
  lastError: string | null;
  tokenExpiresAt: string | null;
  connectedAt: string;
}

export interface NewAccount {
  igUserId: string;
  username: string;
  displayName: string | null;
  accountType: string | null;
  profilePictureUrl: string | null;
  groupName: string | null;
  tokenExpiresAt: string;
}

export type AccountPatch = Partial<Omit<StoredAccount, 'id' | 'igUserId' | 'connectedAt'>>;

export interface AccountsStore {
  list(): Promise<StoredAccount[]>;
  getById(id: string): Promise<StoredAccount | null>;
  findByIgUserId(igUserId: string): Promise<StoredAccount | null>;
  insert(a: NewAccount): Promise<StoredAccount>;
  update(id: string, patch: AccountPatch): Promise<StoredAccount>;
  saveToken(accountId: string, token: { accessToken: string; expiresAt: string }): Promise<void>;
  remove(id: string): Promise<void>;
}
