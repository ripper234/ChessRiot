"use client";

import { useEffect, useRef, useState } from "react";

interface DemoStatus {
  source: "bundled" | "generated";
  durationSeconds: number;
  generatedAt: string | null;
  mimeType: string;
  storyVersion: number;
}

export function DemoPlayer() {
  const [status, setStatus] = useState<DemoStatus | null>(null);
  const [mediaSrc, setMediaSrc] = useState(
    "/demo-assets/chessriot-demo.mp4",
  );
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/demo-video/status", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response): Promise<DemoStatus | null> => (
        response.ok ? await response.json() as DemoStatus : null
      ))
      .then((value) => {
        setStatus(value);
        if (
          value?.source === "generated"
          && videoRef.current?.canPlayType(value.mimeType)
        ) {
          const revision = encodeURIComponent(value.generatedAt ?? "latest");
          setMediaSrc(`/api/demo-video/media?v=${revision}`);
        }
      })
      .catch(() => setStatus(null));
    return () => controller.abort();
  }, []);

  return (
    <section className="demo-player-card" aria-label="ChessRiot explainer video">
      <div className="demo-video-frame">
        <video
          controls
          playsInline
          preload="metadata"
          poster="/demo-assets/poster.jpg"
          ref={videoRef}
          src={mediaSrc}
        >
          Your browser does not support HTML video.
        </video>
      </div>
      <div className="demo-player-meta">
        <span>1:30 STORY</span>
        <span>CAPTIONS INCLUDED</span>
        <span>SYNTHETIC NARRATION</span>
        {status?.source === "generated" && status.generatedAt ? (
          <span>
            UPDATED {new Date(status.generatedAt).toLocaleDateString()}
          </span>
        ) : null}
      </div>
    </section>
  );
}
