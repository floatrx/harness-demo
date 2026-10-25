// Bookmark logic, kept free of React so `node --test` runs it directly (Node strips the types).

export interface Bookmark {
  id: string;
  title: string;
  url: string;
  addedAt: string;
}

export interface NewBookmark {
  title: string;
  url: string;
}

export class BookmarkError extends Error {
  override name = 'BookmarkError';
}

/** Adds `https://` when the scheme is missing and rejects anything that is not an http(s) URL. */
export function normalizeUrl(input: string): string {
  const raw = input.trim();
  if (!raw) throw new BookmarkError('the URL is empty');
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new BookmarkError(`not a URL: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new BookmarkError('only http and https links');
  return url.toString();
}

/** Returns a new list with the bookmark appended. The input list is never changed. */
export function addBookmark(list: readonly Bookmark[], input: NewBookmark, now = new Date()): Bookmark[] {
  const url = normalizeUrl(input.url);
  const title = input.title.trim() || new URL(url).hostname;
  const bookmark: Bookmark = { id: `b-${now.getTime().toString(36)}-${list.length}`, title, url, addedAt: now.toISOString() };
  return [...list, bookmark];
}

export function removeBookmark(list: readonly Bookmark[], id: string): Bookmark[] {
  return list.filter((bookmark) => bookmark.id !== id);
}

/** Newest first. */
export function sortBookmarks(list: readonly Bookmark[]): Bookmark[] {
  return [...list].sort((a, b) => b.addedAt.localeCompare(a.addedAt));
}
