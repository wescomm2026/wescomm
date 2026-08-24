"use client";

import { useEffect } from "react";
import { RouteErrorState } from "@/components/ui/RouteErrorState";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("WESCOMM global render error", error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <RouteErrorState
          label="WESCOMM recovery"
          title="WESCOMM needs to reload this screen."
          reset={reset}
        />
      </body>
    </html>
  );
}
