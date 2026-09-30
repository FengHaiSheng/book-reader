import type { Migration } from './migrate'

export const migrations: Migration[] = [
  {
    version: 1,
    up: (db) => {
      db.exec(`
        CREATE TABLE settings (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `)
    }
  },
  {
    version: 2,
    up: (db) => {
      db.exec(`
        CREATE TABLE books (
          id             TEXT PRIMARY KEY,
          title          TEXT NOT NULL,
          author         TEXT,
          publisher      TEXT,
          language       TEXT,
          isbn           TEXT,
          cover_path     TEXT,
          file_path      TEXT NOT NULL,
          file_hash      TEXT NOT NULL UNIQUE,
          file_size      INTEGER NOT NULL,
          added_at       INTEGER NOT NULL,
          last_opened_at INTEGER,
          total_chars    INTEGER NOT NULL DEFAULT 0,
          chapter_count  INTEGER NOT NULL DEFAULT 0,
          status         TEXT NOT NULL DEFAULT 'unread'
        );
        CREATE INDEX idx_books_added ON books(added_at DESC);

        CREATE TABLE chapters (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          book_id     TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
          parent_id   INTEGER REFERENCES chapters(id) ON DELETE CASCADE,
          order_index INTEGER,
          title       TEXT NOT NULL,
          href        TEXT NOT NULL,
          depth       INTEGER NOT NULL DEFAULT 0,
          char_start  INTEGER,
          char_end    INTEGER
        );
        CREATE INDEX idx_chapters_book ON chapters(book_id, order_index);

        CREATE TABLE chunks (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          book_id     TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
          chapter_id  INTEGER REFERENCES chapters(id) ON DELETE CASCADE,
          order_index INTEGER NOT NULL,
          text        TEXT NOT NULL,
          token_count INTEGER NOT NULL,
          embedding   BLOB,
          heading_path TEXT NOT NULL
        );
        CREATE INDEX idx_chunks_book ON chunks(book_id);
        CREATE INDEX idx_chunks_pending ON chunks(book_id) WHERE embedding IS NULL;

        -- 只存 bigram 切分后的文本，检索走它，原文仍在 chunks.text
        CREATE VIRTUAL TABLE chunks_fts USING fts5(text_bigram, tokenize = 'unicode61');

        CREATE TABLE reading_progress (
          book_id    TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
          cfi        TEXT NOT NULL,
          chapter_id INTEGER,
          percent    REAL NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE highlights (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          book_id    TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
          chapter_id INTEGER REFERENCES chapters(id) ON DELETE SET NULL,
          start_cfi  TEXT NOT NULL,
          end_cfi    TEXT NOT NULL,
          text       TEXT NOT NULL,
          note       TEXT,
          color      TEXT NOT NULL DEFAULT 'yellow',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX idx_highlights_book ON highlights(book_id, chapter_id);

        CREATE TABLE ai_results (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          book_id       TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
          task          TEXT NOT NULL,
          scope_key     TEXT NOT NULL,
          prompt_version TEXT NOT NULL,
          provider      TEXT NOT NULL,
          model         TEXT NOT NULL,
          payload       TEXT NOT NULL,
          input_tokens  INTEGER NOT NULL DEFAULT 0,
          output_tokens INTEGER NOT NULL DEFAULT 0,
          created_at    INTEGER NOT NULL,
          UNIQUE (book_id, task, scope_key, prompt_version, model)
        );

        CREATE TABLE ai_messages (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          book_id    TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
          chapter_id INTEGER,
          scope_key  TEXT NOT NULL,
          role       TEXT NOT NULL,
          content    TEXT NOT NULL,
          tokens     INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX idx_ai_messages_scope ON ai_messages(book_id, scope_key, created_at);

        CREATE TABLE tags (
          id    INTEGER PRIMARY KEY AUTOINCREMENT,
          name  TEXT NOT NULL UNIQUE,
          color TEXT NOT NULL DEFAULT 'yellow'
        );

        CREATE TABLE book_tags (
          book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
          tag_id  INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
          PRIMARY KEY (book_id, tag_id)
        );
      `)
    }
  }
]
