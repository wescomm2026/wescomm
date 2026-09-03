"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from "react";
import { AlertTriangle, CircleHelp, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAccessibleDialog } from "@/components/ui/useAccessibleDialog";
import { cn } from "@/lib/utils";

export type ConfirmationDialogOptions = {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "warning" | "danger";
};

type ConfirmationRequest = {
  id: number;
  options: ConfirmationDialogOptions;
};

type Confirm = (options: ConfirmationDialogOptions) => Promise<boolean>;

const ConfirmationDialogContext = createContext<Confirm | null>(null);

export function ConfirmationDialogProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmationRequest | null>(null);
  const requestIdRef = useRef(0);
  const resolveRef = useRef<((confirmed: boolean) => void) | null>(null);

  const settle = useCallback((confirmed: boolean) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    setRequest(null);
    resolve?.(confirmed);
  }, []);

  const confirm = useCallback<Confirm>((options) => new Promise<boolean>((resolve) => {
    resolveRef.current?.(false);
    resolveRef.current = resolve;
    requestIdRef.current += 1;
    setRequest({ id: requestIdRef.current, options });
  }), []);

  useEffect(() => () => {
    resolveRef.current?.(false);
    resolveRef.current = null;
  }, []);

  const dialog = useAccessibleDialog<HTMLElement>(Boolean(request), () => settle(false));
  const descriptionId = `${dialog.titleId}-description`;
  const tone = request?.options.tone ?? "default";
  const Icon = tone === "danger" ? Trash2 : tone === "warning" ? AlertTriangle : CircleHelp;

  return (
    <ConfirmationDialogContext.Provider value={confirm}>
      {children}
      {request ? (
        <div
          className="fixed inset-0 z-[13000] grid place-items-center overflow-y-auto bg-[#101820]/55 p-4 backdrop-blur-[2px]"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) settle(false);
          }}
        >
          <section
            key={request.id}
            ref={dialog.dialogRef}
            {...dialog.dialogProps}
            role="alertdialog"
            aria-describedby={descriptionId}
            className="w-full max-w-md overflow-hidden rounded-2xl border border-[#dce5dd] bg-white shadow-[0_24px_70px_rgba(16,24,32,0.28)] outline-none"
          >
            <div className="flex items-start gap-4 p-5 sm:p-6">
              <div
                className={cn(
                  "grid size-11 shrink-0 place-items-center rounded-full",
                  tone === "danger"
                    ? "bg-red-50 text-red-700"
                    : tone === "warning"
                      ? "bg-amber-50 text-amber-700"
                      : "bg-[#eef6ef] text-primary"
                )}
                aria-hidden="true"
              >
                <Icon className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 id={dialog.titleId} className="text-lg font-extrabold leading-6 text-[#17211b]">
                  {request.options.title}
                </h2>
                <p id={descriptionId} className="mt-2 break-words text-sm leading-6 text-[#59655d]">
                  {request.options.description}
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2 border-t border-[#e1e8e2] bg-[#fbfdfb] p-4 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="secondary"
                className="w-full sm:w-auto"
                data-dialog-autofocus
                onClick={() => settle(false)}
              >
                {request.options.cancelLabel ?? "Cancel"}
              </Button>
              <Button
                type="button"
                variant={tone === "danger" ? "destructive" : "primary"}
                className="w-full sm:w-auto"
                onClick={() => settle(true)}
              >
                {request.options.confirmLabel ?? "Confirm"}
              </Button>
            </div>
          </section>
        </div>
      ) : null}
    </ConfirmationDialogContext.Provider>
  );
}

export function useConfirmationDialog() {
  const confirm = useContext(ConfirmationDialogContext);
  if (!confirm) {
    throw new Error("useConfirmationDialog must be used inside ConfirmationDialogProvider.");
  }
  return confirm;
}
