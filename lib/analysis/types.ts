// Inputs and shared result types for the pure analysis functions. Rows are shaped by lib/dashboard/read.ts.
// Every metric is nullable: Meta returns nothing under 100 followers, for days it has not settled, or for removed metrics.
import type { MediaKind } from '@/lib/instagram/parse';

/** One account_daily row. day = 'YYYY-MM-DD' in the owner's timezone (as written by the sync). */
export interface DailyRow {
  day: string;
  followers: number | null;
  reach: number | null;
  views: number | null;
  accountsEngaged: number | null;
  interactions: number | null;
  follows: number | null;
  unfollows: number | null;
  linkTaps: number | null;
}

/** A media item with its LATEST media_metrics snapshot (lifetime values). Stories carry mediaType 'STORY'. */
export interface Post {
  id: string;
  accountId: string;
  mediaType: MediaKind;
  postedAt: string; // ISO UTC
  permalink: string | null;
  reach: number | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
}

/** One online_followers row: 24 values, index = hour as Instagram reports it (hour base UNCERTAIN, see lib/instagram/metrics.ts). */
export interface OnlineFollowersRow {
  day: string;
  hourly: (number | null)[];
}

/** Tags are a part-2 feature (tables `tags`, `media_tags`); the analysis accepts them as plain input now. */
export interface Tag {
  id: string;
  name: string;
  color: string; // a token name such as 'chart-3', never a raw colour
}
export interface MediaTag {
  mediaId: string;
  tagId: string;
}

/** Why a number is missing. Each key has a translation under `analysis.reasons.*`. */
export type MissingReason = 'no_data' | 'needs_100_followers' | 'not_enough_history' | 'not_enough_posts' | 'backfilling' | 'needs_5_viewers' | 'few_posts';
