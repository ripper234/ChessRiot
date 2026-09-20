"use client";

import { useEffect } from "react";
import { reportProductEvent } from "@/lib/client-telemetry";

export function PublicAnalytics() {
  useEffect(() => {
    reportProductEvent("public.home_viewed");
  }, []);
  return null;
}
