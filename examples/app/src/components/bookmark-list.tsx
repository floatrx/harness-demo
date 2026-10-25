'use client';

import { type FormEvent, useEffect, useState } from 'react';
import { type Bookmark, BookmarkError, addBookmark, removeBookmark, sortBookmarks } from '@/lib/bookmarks';
import { SEED } from '@/lib/seed';

const STORAGE_KEY = 'bookmarks:v1';

export function BookmarkList() {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(SEED);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) setBookmarks(JSON.parse(saved) as Bookmark[]);
  }, []);

  const save = (next: Bookmark[]) => {
    setBookmarks(next);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      save(addBookmark(bookmarks, { title, url }));
      setTitle('');
      setUrl('');
      setError(null);
    } catch (caught) {
      setError(caught instanceof BookmarkError ? caught.message : 'could not add the bookmark');
    }
  };

  return (
    <section className="bookmarks">
      <form className="add-form" onSubmit={onSubmit} data-testid="add-form">
        <input aria-label="URL" placeholder="https://…" value={url} onChange={(event) => setUrl(event.target.value)} required />
        <input aria-label="Title" placeholder="Title (optional)" value={title} onChange={(event) => setTitle(event.target.value)} />
        <button type="submit">Add</button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <ul className="list" data-testid="bookmark-list">
        {sortBookmarks(bookmarks).map((bookmark) => (
          <li key={bookmark.id} className="item" data-testid="bookmark-item">
            <a href={bookmark.url} target="_blank" rel="noreferrer">
              <span className="item-title">{bookmark.title}</span>
              <span className="item-url">{new URL(bookmark.url).hostname}</span>
            </a>
            <button type="button" aria-label={`Remove ${bookmark.title}`} onClick={() => save(removeBookmark(bookmarks, bookmark.id))}>
              ×
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
