'use client';

// One comment (Plan 15c): who wrote it and when, likes, rule badges, the text, and the post it belongs to (a link to its
// Post Lab). The text is third-party content: React text only (never HTML), at most TEXT_CAP characters. Plan 15d
// contract: `actions` is the slot for moderation buttons, `status` shows a Hidden badge; keep both names.
import type { ReactNode } from 'react';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { Badge } from '@/components/ui/badge';
import { capText, type CommentView } from '@/lib/comments/view';
import { formatDate, formatDateTime } from '@/lib/format';
import { postLabHref } from '@/lib/post-lab/params';

export interface CommentRowProps {
  comment: CommentView;
  accountId: string;
  scopeQuery?: string; // the Time Scope query carried into the Post Lab link
  status?: 'visible' | 'hidden';
  actions?: ReactNode;
}

export function CommentRow({ comment: c, accountId, scopeQuery = '', status, actions }: CommentRowProps) {
  const t = useTranslations('pages.account.commentInsights.row');
  const { prefs } = usePrefs();
  const author = c.authorUsername ? `@${c.authorUsername}` : t('unknownAuthor');
  const { text, cut } = capText(c.text);
  return (
    <article aria-label={t('label', { author })} className="grid min-w-0 gap-1.5 rounded-md border bg-card p-[var(--gp)] text-sm">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {c.authorUsername ? (
          <a href={`https://www.instagram.com/${encodeURIComponent(c.authorUsername)}/`} target="_blank" rel="noopener noreferrer" aria-label={t('openProfile', { username: c.authorUsername })} className="inline-flex min-w-0 items-center gap-1 font-medium underline-offset-4 hover:underline">
            <span className="truncate">{author}</span>
            <ExternalLink aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
          </a>
        ) : (
          <span className="font-medium text-muted-foreground">{author}</span>
        )}
        <time dateTime={c.postedAt} className="text-xs text-muted-foreground">
          {formatDateTime(c.postedAt, prefs)}
        </time>
        {c.likeCount !== null && c.likeCount > 0 ? <span className="text-xs text-muted-foreground">{t('likes', { count: c.likeCount })}</span> : null}
        {c.isQuestion ? <Badge variant="secondary">{t('question')}</Badge> : null}
        {c.repliedByOwner === true ? <Badge variant="outline">{t('replied')}</Badge> : null}
        {status === 'hidden' ? <Badge variant="outline">{t('hidden')}</Badge> : null}
      </div>
      <p className="break-words whitespace-pre-wrap">
        {text}
        {cut ? <span title={t('more')}>…</span> : null}
      </p>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        {c.post ? (
          <Link href={postLabHref(accountId, c.mediaId, scopeQuery)} className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
            {t('onPost', { date: formatDate(c.post.postedAt, prefs) })}
          </Link>
        ) : (
          <span className="text-xs text-muted-foreground">{t('postGone')}</span>
        )}
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </article>
  );
}
