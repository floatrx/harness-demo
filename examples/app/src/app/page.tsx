import { BookmarkList } from '@/components/bookmark-list';

export default function HomePage() {
  return (
    <main className="page">
      <header className="page-header">
        <h1>Bookmarks</h1>
        <p>Save a link, find it later.</p>
      </header>
      <BookmarkList />
    </main>
  );
}
