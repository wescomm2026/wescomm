import { HttpError } from "./http-error.js";

const CURSOR_VERSION = 1;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type CursorPayload = {
  v: number;
  id: string;
};

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 50;

export function normalizePageLimit(limit?: number) {
  return Math.min(Math.max(limit ?? DEFAULT_PAGE_LIMIT, 1), MAX_PAGE_LIMIT);
}

export function encodeCursor(id: string) {
  return Buffer.from(JSON.stringify({ v: CURSOR_VERSION, id } satisfies CursorPayload), "utf8").toString("base64url");
}

export function decodeCursor(cursor?: string | null) {
  if (!cursor) return null;

  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<CursorPayload>;
    if (parsed.v !== CURSOR_VERSION || typeof parsed.id !== "string" || !UUID_PATTERN.test(parsed.id)) {
      throw new Error("Invalid cursor payload.");
    }
    return parsed.id;
  } catch {
    throw new HttpError(400, "The pagination cursor is invalid or expired.", "INVALID_CURSOR");
  }
}

export function createPage<T extends { id: string }>(rows: T[], limit: number) {
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  return {
    items,
    nextCursor: hasMore && items.length ? encodeCursor(items[items.length - 1]!.id) : null
  };
}
