"use client";

import { useSyncExternalStore } from "react";

export type CursorPage<T> = {
  items: T[];
  nextCursor: string | null;
  updatedAt: number;
};

type CacheEntry = unknown;

const cache = new Map<string, CacheEntry>();
const listeners = new Map<string, Set<() => void>>();

function emit(key: string) {
  listeners.get(key)?.forEach((listener) => listener());
}

export function readServerState<T>(key: string) {
  return cache.get(key) as T | undefined;
}

export function writeServerState<T>(key: string, value: T | ((current: T | undefined) => T)) {
  const nextValue = typeof value === "function"
    ? (value as (current: T | undefined) => T)(readServerState<T>(key))
    : value;
  cache.set(key, nextValue);
  emit(key);
  return nextValue;
}

export function clearServerState(key: string) {
  if (cache.delete(key)) emit(key);
}

export function useServerState<T>(key: string) {
  return useSyncExternalStore(
    (listener) => {
      const keyListeners = listeners.get(key) ?? new Set<() => void>();
      keyListeners.add(listener);
      listeners.set(key, keyListeners);
      return () => {
        keyListeners.delete(listener);
        if (!keyListeners.size) listeners.delete(key);
      };
    },
    () => readServerState<T>(key),
    () => undefined
  );
}

export function mergeCursorPage<T extends { id: string }>(
  current: CursorPage<T> | undefined,
  incoming: { items: T[]; nextCursor: string | null },
  mode: "replace" | "prepend" | "append"
): CursorPage<T> {
  if (!current || mode === "replace") {
    return { ...incoming, updatedAt: Date.now() };
  }

  const source = mode === "append"
    ? [...current.items, ...incoming.items]
    : [...incoming.items, ...current.items];
  const seen = new Set<string>();
  const items = source.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });

  return {
    items,
    nextCursor: mode === "append" ? incoming.nextCursor : current.nextCursor,
    updatedAt: Date.now()
  };
}

export function upsertCursorItem<T extends { id: string }>(key: string, item: T, prepend = false) {
  return writeServerState<CursorPage<T>>(key, (current) => {
    const existingItems = current?.items ?? [];
    const existingIndex = existingItems.findIndex((entry) => entry.id === item.id);
    const items = existingIndex >= 0
      ? existingItems.map((entry) => entry.id === item.id ? item : entry)
      : prepend ? [item, ...existingItems] : [...existingItems, item];
    return {
      items,
      nextCursor: current?.nextCursor ?? null,
      updatedAt: Date.now()
    };
  });
}

export function reservationCacheKey(ownerId: string) {
  return `reservations:${ownerId}`;
}

export function receiptCacheKey(ownerId: string) {
  return `receipts:${ownerId}`;
}
