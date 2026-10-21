import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { DEFAULT_PREFS } from '@/lib/prefs';

const { push, replace, refresh } = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', async (orig) => ({ ...(await orig<object>()), useRouter: () => ({ push, replace, refresh, prefetch: vi.fn(), back: vi.fn() }) }));

import { FollowerUpload } from '@/components/account/FollowerUpload';

const ACC = '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b';
const T = en.pages.account.followerDiff;
const entry = (name: string) => ({ title: '', media_list_data: [], string_list_data: [{ href: `https://www.instagram.com/${name}`, value: name, timestamp: 1_700_000_000 }] });
const json = (name: string, v: unknown) => new File([JSON.stringify(v)], name, { type: 'application/json' });
const fetchMock = vi.fn();

function view(locale: 'en' | 'zh-CN' = 'en') {
  render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : zh}>
      <PrefsProvider initial={{ ...DEFAULT_PREFS, locale }} persist={vi.fn()}>
        <FollowerUpload accountId={ACC} username="shop.one" today="2026-10-21" />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: locale === 'en' ? T.upload.open : zh.pages.account.followerDiff.upload.open }));
  return screen.getByRole('dialog');
}
const choose = (...files: File[]) => fireEvent.change(screen.getByLabelText(T.upload.files), { target: { files } });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  refresh.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('FollowerUpload', () => {
  it('a dialog: title, the account in the description, a labelled multi-file JSON input and a date (today, never later)', () => {
    const dialog = view();
    expect(dialog).toHaveTextContent(T.upload.title);
    expect(dialog).toHaveTextContent('@shop.one');
    const input = screen.getByLabelText(T.upload.files);
    expect(input).toHaveAttribute('type', 'file');
    expect(input).toHaveAttribute('multiple');
    expect(input).toHaveAttribute('accept', '.json,application/json');
    const date = screen.getByLabelText(T.upload.date);
    expect(date).toHaveValue('2026-10-21');
    expect(date).toHaveAttribute('max', '2026-10-21');
    expect(screen.getByRole('button', { name: T.upload.submit })).toBeDisabled();
  });

  it('reads the files in the browser and previews the counts, skipped entries and skipped files', async () => {
    view();
    choose(json('followers_1.json', [entry('alice'), entry('bob'), { junk: true }]), json('following.json', { relationships_following: [entry('carol')] }), json('recently_unfollowed_profiles.json', { relationships_unfollowed_users: [] }));
    expect(await screen.findByText('2 followers and 1 account you follow')).toBeInTheDocument();
    expect(screen.getByText('1 entry is not a valid username and will be skipped.')).toBeInTheDocument();
    expect(screen.getByText('Not needed, skipped: recently_unfollowed_profiles.json')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: T.upload.submit })).toBeEnabled();
  });

  it('wrong files are refused before reading, with the file named and the limit formatted', async () => {
    view();
    choose(new File(['x'], 'instagram-shop.one.zip'));
    expect(await screen.findByRole('alert')).toHaveTextContent('instagram-shop.one.zip is a zip file. Unzip it first');
    choose(...Array.from({ length: 11 }, (_, i) => json(`followers_${i}.json`, [])));
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose at most 10 files.');
    choose(json('following.json', { relationships_following: [entry('carol')] }));
    expect(await screen.findByRole('alert')).toHaveTextContent(T.errors.needFollowers);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a file the browser cannot read names that file in the error', async () => {
    view();
    const unreadable = json('followers_2.json', []);
    unreadable.text = () => Promise.reject(new Error('NotReadableError'));
    choose(json('followers_1.json', [entry('alice')]), unreadable);
    expect(await screen.findByRole('alert')).toHaveTextContent('followers_2.json could not be read as JSON.');
    expect(screen.getByRole('button', { name: T.upload.submit })).toBeDisabled();
  });

  it('uploads ONLY usernames and times to the owner route, then closes and refreshes the page', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 201, headers: { 'content-type': 'application/json' } }));
    view();
    choose(json('followers_1.json', [entry('Alice')]));
    await screen.findByText(/1 follower\./);
    fireEvent.change(screen.getByLabelText(T.upload.date), { target: { value: '2026-10-01' } });
    fireEvent.click(screen.getByRole('button', { name: T.upload.submit }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/accounts/${ACC}/followers`);
    expect(init).toMatchObject({ method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin' });
    expect(JSON.parse(String(init.body))).toEqual({ v: 1, takenOn: '2026-10-01', followers: [['alice', 1_700_000_000]], following: null });
    expect(String(init.body)).not.toContain('instagram.com'); // the raw file stays on the device
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('a future date is refused; a server error key is shown translated; anything else is "unexpected"', async () => {
    view();
    choose(json('followers_1.json', [entry('alice')]));
    await screen.findByText(/1 follower\./);
    fireEvent.change(screen.getByLabelText(T.upload.date), { target: { value: '2026-10-22' } });
    fireEvent.click(screen.getByRole('button', { name: T.upload.submit }));
    expect(await screen.findByRole('alert')).toHaveTextContent(T.errors.badDate);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(T.upload.date), { target: { value: '2026-10-21' } });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'tooManySnapshots' }), { status: 409 }));
    fireEvent.click(screen.getByRole('button', { name: T.upload.submit }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This account already has 60 snapshots.');
    fetchMock.mockResolvedValueOnce(new Response('<html>login</html>', { status: 500 }));
    fireEvent.click(screen.getByRole('button', { name: T.upload.submit }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(T.errors.unexpected));
    expect(refresh).not.toHaveBeenCalled();
  });

  it('zh-CN: the preview and errors are translated', async () => {
    view('zh-CN');
    fireEvent.change(screen.getByLabelText(zh.pages.account.followerDiff.upload.files), { target: { files: [json('followers_1.json', [entry('alice'), entry('bob')])] } });
    expect(await screen.findByText('2 位粉丝。没有 following.json，因此该快照的回关列表为空。')).toBeInTheDocument();
  });
});
