"use client";

import { useEffect, useId, useRef, type RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

const openDialogStack: string[] = [];
let bodyLockCount = 0;
let savedBodyOverflow = "";

function lockBodyScroll() {
  if (bodyLockCount === 0) {
    savedBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  bodyLockCount += 1;
}

function unlockBodyScroll() {
  bodyLockCount = Math.max(0, bodyLockCount - 1);
  if (bodyLockCount === 0) document.body.style.overflow = savedBodyOverflow;
}

function focusableElements(dialog: HTMLElement) {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
}

export function useAccessibleDialog<T extends HTMLElement = HTMLElement>(
  open: boolean,
  onClose: () => void,
  options: { returnFocus?: HTMLElement | null } = {}
) {
  const reactId = useId();
  const dialogId = `wescomm-dialog-${reactId.replace(/:/g, "")}`;
  const titleId = `${dialogId}-title`;
  const dialogRef = useRef<T | null>(null);
  const closeRef = useRef(onClose);
  const wasOpenRef = useRef(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  closeRef.current = onClose;

  // Capture the trigger during render, before React commits any `autoFocus`
  // element inside the newly opened dialog.
  if (open && !wasOpenRef.current && typeof document !== "undefined") {
    returnFocusRef.current = options.returnFocus?.isConnected
      ? options.returnFocus
      : document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
  }
  wasOpenRef.current = open;

  useEffect(() => {
    if (!open) return;

    openDialogStack.push(dialogId);
    lockBodyScroll();

    const focusInside = () => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const preferred = dialog.querySelector<HTMLElement>("[data-dialog-autofocus]");
      (preferred ?? focusableElements(dialog)[0] ?? dialog).focus({ preventScroll: true });
    };
    const frame = window.requestAnimationFrame(focusInside);

    const onKeyDown = (event: KeyboardEvent) => {
      if (openDialogStack.at(-1) !== dialogId) return;
      const dialog = dialogRef.current;
      if (!dialog) return;

      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = focusableElements(dialog);
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable.at(-1) ?? first;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const onFocusIn = (event: FocusEvent) => {
      if (openDialogStack.at(-1) !== dialogId) return;
      const dialog = dialogRef.current;
      if (dialog && event.target instanceof Node && !dialog.contains(event.target)) focusInside();
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
      const stackIndex = openDialogStack.lastIndexOf(dialogId);
      if (stackIndex >= 0) openDialogStack.splice(stackIndex, 1);
      unlockBodyScroll();
      const returnFocus = returnFocusRef.current;
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
      returnFocusRef.current = null;
    };
  }, [dialogId, open]);

  return {
    dialogRef: dialogRef as RefObject<T>,
    titleId,
    dialogProps: {
      id: dialogId,
      role: "dialog" as const,
      "aria-modal": true,
      "aria-labelledby": titleId,
      tabIndex: -1
    }
  };
}
