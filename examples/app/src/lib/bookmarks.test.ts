import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BookmarkError, addBookmark, normalizeUrl, removeBookmark, sortBookmarks } from './bookmarks.ts';
import { SEED } from './seed.ts';

test('normalizeUrl adds https and rejects other schemes', () => {
  assert.equal(normalizeUrl('example.com'), 'https://example.com/');
  assert.equal(normalizeUrl(' http://example.com/a '), 'http://example.com/a');
  assert.throws(() => normalizeUrl('ftp://example.com'), BookmarkError);
  assert.throws(() => normalizeUrl(''), BookmarkError);
});

test('addBookmark appends without changing the input and defaults the title to the host', () => {
  const now = new Date('2026-10-25T10:00:00.000Z');
  const next = addBookmark(SEED, { title: '  ', url: 'example.com' }, now);
  assert.equal(SEED.length, 3);
  assert.equal(next.length, 4);
  assert.deepEqual(next.at(-1), { id: next.at(-1)?.id, title: 'example.com', url: 'https://example.com/', addedAt: now.toISOString() });
});

test('removeBookmark and sortBookmarks', () => {
  assert.deepEqual(
    removeBookmark(SEED, 'b-2').map((bookmark) => bookmark.id),
    ['b-1', 'b-3'],
  );
  assert.deepEqual(
    sortBookmarks(SEED).map((bookmark) => bookmark.id),
    ['b-3', 'b-2', 'b-1'],
  );
});
