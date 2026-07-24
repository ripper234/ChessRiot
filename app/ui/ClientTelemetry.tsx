"use client";

import { useEffect } from "react";
import { reportClientEvent } from "@/lib/client-telemetry";

export function ClientTelemetry() {
  useEffect(() => {
    const onError = () => reportClientEvent("client.error", "window_error");
    const onUnhandledRejection = () => {
      reportClientEvent("client.unhandled_rejection", "unhandled_rejection");
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);
  return null;
}
