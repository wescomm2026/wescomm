"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStudentAuth } from "@/components/auth/StudentAuthProvider";
import {
  addWishlistItemFromApi,
  getWishlistFromApi,
  removeWishlistItemFromApi
} from "@/lib/api";

type WishlistToggleResult =
  | { ok: true; wishlisted: boolean }
  | { ok: false; reason: "AUTH_REQUIRED" | "STUDENT_ONLY" | "MISSING_PRODUCT" | "REQUEST_FAILED"; message?: string };

type WishlistMutation = {
  wishlisted: boolean;
  pending: boolean;
};

const EMPTY_WISHLIST = new Set<string>();

function applyWishlistMutations(
  productIds: Set<string>,
  mutations: Map<string, WishlistMutation>
) {
  if (!mutations.size) return productIds;

  const next = new Set(productIds);
  mutations.forEach((mutation, productId) => {
    if (mutation.wishlisted) next.add(productId);
    else next.delete(productId);
  });
  return next;
}

export function useStudentWishlist() {
  const { user, ready: authReady, openAuth } = useStudentAuth();
  const [productIds, setProductIds] = useState<Set<string>>(new Set());
  const [loadedOwnerId, setLoadedOwnerId] = useState("");
  const [mutations, setMutations] = useState<Map<string, WishlistMutation>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const requestSequenceRef = useRef(0);
  const productIdsRef = useRef<Set<string>>(new Set());
  const mutationsRef = useRef<Map<string, WishlistMutation>>(new Map());
  const loadedOwnerIdRef = useRef("");
  const ownerId = authReady && user?.role === "STUDENT" ? user.id : "";
  const token = ownerId ? user?.accessToken ?? "" : "";
  const ownerProductIds = loadedOwnerId === ownerId ? productIds : EMPTY_WISHLIST;
  const visibleProductIds = useMemo(
    () => applyWishlistMutations(ownerProductIds, mutations),
    [mutations, ownerProductIds]
  );
  const pendingProductIds = useMemo(
    () => new Set(
      Array.from(mutations)
        .filter(([, mutation]) => mutation.pending)
        .map(([productId]) => productId)
    ),
    [mutations]
  );
  const ready = authReady && (!ownerId || loadedOwnerId === ownerId) && !loading;

  const replaceProductIds = useCallback((next: Set<string>) => {
    productIdsRef.current = next;
    setProductIds(next);
  }, []);

  const replaceMutations = useCallback((next: Map<string, WishlistMutation>) => {
    mutationsRef.current = next;
    setMutations(next);
  }, []);

  useEffect(() => {
    const requestSequence = ++requestSequenceRef.current;
    replaceProductIds(new Set());
    replaceMutations(new Map());
    loadedOwnerIdRef.current = "";
    setLoadedOwnerId("");
    setError("");

    if (!ownerId || !token) {
      setLoading(false);
      return;
    }

    setLoading(true);
    getWishlistFromApi(token)
      .then((items) => {
        if (requestSequence !== requestSequenceRef.current) return;
        const nextProductIds = new Set(items.map((item) => item.productId));
        const nextMutations = new Map(mutationsRef.current);

        nextMutations.forEach((mutation, productId) => {
          if (mutation.pending) return;
          if (mutation.wishlisted) nextProductIds.add(productId);
          else nextProductIds.delete(productId);
          nextMutations.delete(productId);
        });

        replaceProductIds(nextProductIds);
        replaceMutations(nextMutations);
        loadedOwnerIdRef.current = ownerId;
        setLoadedOwnerId(ownerId);
      })
      .catch((wishlistError) => {
        if (requestSequence !== requestSequenceRef.current) return;
        setError(wishlistError instanceof Error ? wishlistError.message : "Unable to load your wishlist.");
      })
      .finally(() => {
        if (requestSequence === requestSequenceRef.current) setLoading(false);
      });

    return () => {
      requestSequenceRef.current += 1;
    };
  }, [ownerId, reloadKey, replaceMutations, replaceProductIds, token]);

  const retry = useCallback(() => {
    if (ownerId && token) setReloadKey((current) => current + 1);
  }, [ownerId, token]);

  const toggle = useCallback(async (productId?: string): Promise<WishlistToggleResult> => {
    if (!user) {
      openAuth();
      return { ok: false, reason: "AUTH_REQUIRED" };
    }
    if (user.role !== "STUDENT") {
      return { ok: false, reason: "STUDENT_ONLY" };
    }
    if (!productId) {
      return { ok: false, reason: "MISSING_PRODUCT" };
    }
    if (!token || !ownerId || mutationsRef.current.get(productId)?.pending) {
      return {
        ok: false,
        reason: "REQUEST_FAILED",
        message: "Please wait for the current wishlist update to finish."
      };
    }

    const currentMutation = mutationsRef.current.get(productId);
    const wasWishlisted = currentMutation?.wishlisted ?? productIdsRef.current.has(productId);
    const nextWishlisted = !wasWishlisted;
    const requestSequence = requestSequenceRef.current;
    setError("");
    replaceMutations(new Map(mutationsRef.current).set(productId, {
      wishlisted: nextWishlisted,
      pending: true
    }));

    try {
      if (wasWishlisted) await removeWishlistItemFromApi(token, productId);
      else await addWishlistItemFromApi(token, productId);

      if (requestSequence !== requestSequenceRef.current) {
        return { ok: false, reason: "REQUEST_FAILED" };
      }

      const nextProductIds = new Set(productIdsRef.current);
      if (nextWishlisted) nextProductIds.add(productId);
      else nextProductIds.delete(productId);
      replaceProductIds(nextProductIds);

      const nextMutations = new Map(mutationsRef.current);
      if (loadedOwnerIdRef.current === ownerId) nextMutations.delete(productId);
      else nextMutations.set(productId, { wishlisted: nextWishlisted, pending: false });
      replaceMutations(nextMutations);

      return { ok: true, wishlisted: nextWishlisted };
    } catch (wishlistError) {
      if (requestSequence === requestSequenceRef.current) {
        const nextMutations = new Map(mutationsRef.current);
        nextMutations.delete(productId);
        replaceMutations(nextMutations);
      }
      return {
        ok: false,
        reason: "REQUEST_FAILED",
        message: wishlistError instanceof Error ? wishlistError.message : "Unable to update your wishlist."
      };
    }
  }, [
    openAuth,
    ownerId,
    replaceMutations,
    replaceProductIds,
    token,
    user
  ]);

  return useMemo(() => ({
    productIds: visibleProductIds,
    pendingProductIds,
    ready,
    loading,
    error,
    retry,
    toggle
  }), [error, loading, pendingProductIds, ready, retry, toggle, visibleProductIds]);
}
