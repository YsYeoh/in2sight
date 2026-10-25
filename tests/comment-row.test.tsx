import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { CommentRow, type CommentRowProps } from '@/components/account/CommentRow';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { TEXT_CAP, type CommentView } from '@/lib/comments/view';
import { DEFAULT_PREFS } from '@/lib/prefs';

const T = en.pages.account.commentInsights.row;
const ACC = '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b';
const C: CommentView = {
  id: '1801',
  mediaId: '1790',
  authorUsername: 'amy.lee',
  text: 'Where is this?',
  postedAt: '2026-10-20T08:00:00Z',
  likeCount: 2,
  isQuestion: true,
  hidden: null,
  repliedByOwner: null,
  post: { id: '1790', type: 'REELS', postedAt: '2026-10-19T10:00:00Z', caption: 'Penang' },
};

function view(p: Partial<CommentRowProps> = {}, locale: 'en' | 'zh-CN' = 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : zh}>
      <PrefsProvider initial={{ ...DEFAULT_PREFS, locale, dateFormat: 'YYYY-MM-DD' }} persist={vi.fn()}>
        <CommentRow comment={C} accountId={ACC} {...p} />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
}

describe('CommentRow', () => {
  it('author (opens Instagram), time, likes, the question badge, the text and the Post Lab link with the scope', () => {
    view({ scopeQuery: 'from=90d' });
    expect(screen.getByRole('article', { name: 'Comment by @amy.lee' })).toBeInTheDocument();
    const profile = screen.getByRole('link', { name: 'Open @amy.lee on Instagram' });
    expect(profile).toHaveAttribute('href', 'https://www.instagram.com/amy.lee/');
    expect(profile).toHaveAttribute('target', '_blank');
    expect(profile).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText('2 likes')).toBeInTheDocument();
    expect(screen.getByText(T.question)).toBeInTheDocument();
    expect(screen.queryByText(T.replied)).toBeNull();
    expect(screen.queryByText(T.hidden)).toBeNull();
    expect(screen.getByText('Where is this?')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'On your post of 2026-10-19' })).toHaveAttribute('href', `/accounts/${ACC}/media/1790?from=90d`);
    expect(screen.getByText(/^2026-10-20/)).toHaveAttribute('dateTime', '2026-10-20T08:00:00Z');
  });

  it('text is third-party content: shown as text, never as HTML', () => {
    const { container } = view({ comment: { ...C, text: '<img src=x onerror=alert(1)><b>bold</b>' } });
    expect(container.querySelector('img, b')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)><b>bold</b>')).toBeInTheDocument();
  });

  it(`long text is cut at ${TEXT_CAP} characters with an ellipsis; line breaks are kept`, () => {
    const { container } = view({ comment: { ...C, text: `${'a'.repeat(TEXT_CAP)}TAIL` } });
    const p = container.querySelector('p')!;
    expect(p.textContent).toBe(`${'a'.repeat(TEXT_CAP)}…`);
    expect(p).toHaveClass('whitespace-pre-wrap');
    expect(screen.getByTitle(T.more)).toBeInTheDocument();
  });

  it('an unbroken 500-character string (a URL, "hahaha...") cannot widen the row at 360px: the text and the author may shrink and wrap anywhere', () => {
    // jsdom cannot measure layout: pin the class tokens that do the work (min-w-0 on the grid item, overflow-wrap:anywhere)
    const { container } = view({ comment: { ...C, authorUsername: 'a'.repeat(30), text: 'h'.repeat(500) } });
    const p = container.querySelector('p')!;
    expect(p.classList.contains('min-w-0')).toBe(true);
    expect(p.classList.contains('wrap-anywhere')).toBe(true);
    const name = screen.getByText(`@${'a'.repeat(30)}`);
    expect(name.classList.contains('truncate')).toBe(true);
    expect(name.classList.contains('min-w-0')).toBe(true);
    expect(name.parentElement!.classList.contains('min-w-0')).toBe(true);
  });

  it('reply seen and hidden badges only when known; no likes line for 0 or unknown; unknown author and a gone post', () => {
    view({ comment: { ...C, authorUsername: null, likeCount: 0, isQuestion: false, repliedByOwner: true, post: null }, status: 'hidden' });
    expect(screen.getByRole('article', { name: `Comment by ${T.unknownAuthor}` })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Instagram/ })).toBeNull();
    expect(screen.getByText(T.replied)).toBeInTheDocument();
    expect(screen.getByText(T.hidden)).toBeInTheDocument();
    expect(screen.queryByText(T.question)).toBeNull();
    expect(screen.queryByText(/like/)).toBeNull();
    expect(screen.getByText(T.postGone)).toBeInTheDocument();
  });

  it('the actions slot (Plan 15d) renders when given', () => {
    view({ actions: <button type="button">Hide</button> });
    expect(screen.getByRole('button', { name: 'Hide' })).toBeInTheDocument();
  });

  it('zh-CN', () => {
    view({}, 'zh-CN');
    expect(screen.getByRole('article', { name: '@amy.lee 的评论' })).toBeInTheDocument();
    expect(screen.getByText('2 个赞')).toBeInTheDocument();
    expect(screen.getByText('问题')).toBeInTheDocument();
  });
});
