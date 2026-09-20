"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { reportProductEvent } from "@/lib/client-telemetry";

interface DemoStatus {
  source: "bundled" | "generated";
  durationSeconds: number;
  generatedAt: string | null;
  mimeType: string;
  storyVersion: number;
}

export function DemoPlayer() {
  const [status, setStatus] = useState<DemoStatus | null>(null);
  const [mediaSrc, setMediaSrc] = useState("/demo-assets/chessriot-demo.mp4");
  const [ended, setEnded] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const startedRef = useRef(false);

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
          !startedRef.current
          &&
          value?.source === "generated"
          && document.createElement("video").canPlayType(value.mimeType)
        ) {
          const revision = encodeURIComponent(value.generatedAt ?? "latest");
          setMediaSrc(`/api/demo-video/media?v=${revision}`);
        } else {
          setMediaSrc("/demo-assets/chessriot-demo.mp4");
        }
      })
      .catch(() => {
        setStatus(null);
        setMediaSrc("/demo-assets/chessriot-demo.mp4");
      });
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
          onError={() => {
            if (mediaSrc !== "/demo-assets/chessriot-demo.mp4") {
              setStatus(null);
              setMediaSrc("/demo-assets/chessriot-demo.mp4");
            }
          }}
          onPlay={() => {
            setEnded(false);
            if (!startedRef.current) {
              startedRef.current = true;
              reportProductEvent("demo.started");
            }
          }}
          onEnded={() => {
            setEnded(true);
            reportProductEvent("demo.completed");
          }}
        >
          <track kind="captions" src="/api/demo-video/captions" srcLang="en" label="English" default />
          Your browser does not support HTML video.
        </video>
        {ended ? <div className="demo-video-finish"><strong>READY FOR YOUR FIRST MOVE?</strong><Link className="primary-button" href="/app">SIGN IN TO PLAY</Link></div> : null}
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
