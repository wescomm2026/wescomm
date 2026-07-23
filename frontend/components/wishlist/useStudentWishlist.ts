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

const EMPTY_WISHLIST = new Set<string>();

export function useStudentWishlist() {
  const { user, ready: authReady, openAuth } = useStudentAuth();
  const [productIds, setProductIds] = useState<Set<string>>(new Set());
  const [loadedOwnerId, setLoadedOwnerId] = useState("");
  const [pendingProductIds, setPendingProductIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestSequenceRef = useRef(0);
  const ownerId = authReady && user?.role === "STUDENT" ? user.id : "";
  const token = ownerId ? user?.accessToken ?? "" : "";
  const visibleProductIds = loadedOwnerId === ownerId ? productIds : EMPTY_WISHLIST;
  const ready = authReady && (!ownerId || loadedOwnerId === ownerId) && !loading;

  useEffect(() => {
    const requestSequence = ++requestSequenceRef.current;
    setProductIds(new Set());
    setPendingProductIds(new Set());
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
        setProductIds(new Set(items.map((item) => item.productId)));
        setLoadedOwnerId(ownerId);
      })
      .catch((wishlistError) => {
        if (requestSequence !== requestSequenceRef.current) return;
        setError(wishlistError instanceof Error ? wishlistError.message : "Unable to load your wishlist.");
        setLoadedOwnerId(ownerId);
      })
      .finally(() => {
        if (requestSequence === requestSequenceRef.current) setLoading(false);
      });

    return () => {
      requestSequenceRef.current += 1;
    };
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
    if (!token || !ownerId || loadedOwnerId !== ownerId || pendingProductIds.has(productId)) {
      return {
        ok: false,
        reason: "REQUEST_FAILED",
        message: loading ? "Your wishlist is still loading. Please try again." : "Please refresh and try again."
      };
    }

    const wasWishlisted = visibleProductIds.has(productId);
    const requestSequence = requestSequenceRef.current;
    setError("");
    setPendingProductIds((current) => new Set(current).add(productId));
    setProductIds((current) => {
      const next = new Set(current);
      if (wasWishlisted) next.delete(productId);
      else next.add(productId);
      return next;
    });

    try {
      if (wasWishlisted) await removeWishlistItemFromApi(token, productId);
      else await addWishlistItemFromApi(token, productId);

      if (requestSequence !== requestSequenceRef.current) {
        return { ok: false, reason: "REQUEST_FAILED" };
      }
      return { ok: true, wishlisted: !wasWishlisted };
    } catch (wishlistError) {
      if (requestSequence === requestSequenceRef.current) {
        setProductIds((current) => {
          const next = new Set(current);
          if (wasWishlisted) next.add(productId);
          else next.delete(productId);
          return next;
        });
      }
      return {
        ok: false,
        reason: "REQUEST_FAILED",
        message: wishlistError instanceof Error ? wishlistError.message : "Unable to update your wishlist."
      };
    } finally {
      if (requestSequence === requestSequenceRef.current) {
        setPendingProductIds((current) => {
          const next = new Set(current);
          next.delete(productId);
          return next;
        });
      }
    }
  }, [
    loadedOwnerId,
    loading,
    openAuth,
    ownerId,
    pendingProductIds,
    token,
    user,
    visibleProductIds
  ]);

  return useMemo(() => ({
    productIds: visibleProductIds,
    pendingProductIds,
    ready,
    loading,
    error,
    toggle
  }), [error, loading, pendingProductIds, ready, toggle, visibleProductIds]);
}
