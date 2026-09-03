"use client";

import { useState } from "react";
import { Bell, Check, Download, ReceiptText, Share2, Smartphone } from "lucide-react";
import { usePwaInstall } from "@/components/pwa/PwaLifecycle";
import { Button } from "@/components/ui/button";

export function PwaInstallCard() {
  const { canPrompt, isInstalled, isIos, isMobile, requestInstall } = usePwaInstall();
  const [installing, setInstalling] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [notice, setNotice] = useState("");

  if (!isMobile || isInstalled) return null;

  const startInstall = async () => {
    setNotice("");
    if (!canPrompt) {
      setShowInstructions(true);
      return;
    }

    setInstalling(true);
    const result = await requestInstall();
    setInstalling(false);

    if (result === "dismissed") {
      setNotice("No problem. You can return here whenever you are ready to install WESCOMM.");
    } else if (result === "instructions") {
      setShowInstructions(true);
    }
  };

  return (
    <section
      data-testid="profile-install-card"
      className="min-w-0 overflow-hidden rounded-lg border border-[#cfe0d1] bg-[linear-gradient(145deg,#f7fbf7_0%,#ffffff_62%)] p-5 shadow-sm"
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-md bg-primary text-white shadow-sm">
          <Smartphone className="size-6" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-extrabold uppercase tracking-wide text-primary">Quick mobile access</p>
          <h2 className="mt-0.5 break-words font-extrabold text-[#17211b]">Install WESCOMM</h2>
          <p className="mt-1 text-sm leading-6 text-[#627068]">
            Add WESCOMM to your Home Screen so your reservations, receipts, and school updates are easier to reach.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-2 min-[420px]:grid-cols-3">
        <span className="flex min-w-0 items-center gap-2 rounded-md bg-white px-3 py-2 text-xs font-bold text-[#425048] ring-1 ring-[#e0e8e1]">
          <Check className="size-4 shrink-0 text-primary" aria-hidden="true" />
          Faster opening
        </span>
        <span className="flex min-w-0 items-center gap-2 rounded-md bg-white px-3 py-2 text-xs font-bold text-[#425048] ring-1 ring-[#e0e8e1]">
          <ReceiptText className="size-4 shrink-0 text-primary" aria-hidden="true" />
          Easy account access
        </span>
        <span className="flex min-w-0 items-center gap-2 rounded-md bg-white px-3 py-2 text-xs font-bold text-[#425048] ring-1 ring-[#e0e8e1]">
          <Bell className="size-4 shrink-0 text-primary" aria-hidden="true" />
          Phone updates
        </span>
      </div>

      {showInstructions ? (
        <div className="mt-4 rounded-md border border-[#d8e5d9] bg-white p-4 text-sm leading-6 text-[#4f5e55]">
          <p className="font-extrabold text-[#243028]">
            {isIos ? "Install on iPhone or iPad" : "Install from your mobile browser"}
          </p>
          {isIos ? (
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>Tap the <Share2 className="mx-1 inline size-4" aria-label="Share" /> Share button in Safari.</li>
              <li>Choose <strong>Add to Home Screen</strong>.</li>
              <li>Tap <strong>Add</strong> to confirm.</li>
            </ol>
          ) : (
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>Open your browser menu.</li>
              <li>Choose <strong>Install app</strong> or <strong>Add to Home Screen</strong>.</li>
              <li>Confirm the installation.</li>
            </ol>
          )}
        </div>
      ) : null}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="min-w-0 text-xs leading-5 text-[#69756e]" aria-live="polite">{notice}</p>
        <Button
          type="button"
          className="h-11 w-full shrink-0 sm:w-auto"
          onClick={() => void startInstall()}
          disabled={installing}
        >
          <Download className="size-4" aria-hidden="true" />
          {installing ? "Opening installer..." : canPrompt ? "Install now" : "Show install steps"}
        </Button>
      </div>
    </section>
  );
}
