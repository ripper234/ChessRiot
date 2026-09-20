"use client";

import { useEffect } from "react";
import {
  lowResourceConnection,
  type NetworkInformationLike,
} from "@/lib/client-recovery";

export const PERFORMANCE_MODE_EVENT = "chessriot:performance-mode";

interface BrowserNetworkInformation extends NetworkInformationLike, EventTarget {}

function browserConnection(): BrowserNetworkInformation | null {
  return (navigator as Navigator & { connection?: BrowserNetworkInformation }).connection ?? null;
}

export function PerformanceMode() {
  useEffect(() => {
    const connection = browserConnection();
    const update = () => {
      const lowResource = lowResourceConnection(connection);
      document.documentElement.dataset.performance = lowResource ? "low" : "standard";
      window.dispatchEvent(new CustomEvent(PERFORMANCE_MODE_EVENT, {
        detail: { lowResource },
      }));
    };
    update();
    connection?.addEventListener("change", update);
    return () => connection?.removeEventListener("change", update);
  }, []);

  return null;
}
