import React, { useState } from 'react';

interface KineticPlayerProps {
  videoUrl: string | null | undefined;
  vttUrl?: string | null;
  /** BCP-47 locale code for the <track> srclang attribute */
  locale?: string;
}

/**
 * Video player with optional WebVTT caption support and an error fallback.
 * Returns null for videoless pages so the step list flows without an empty gap.
 */
export default function KineticPlayer({ videoUrl, vttUrl, locale = 'en' }: KineticPlayerProps) {
  const [errored, setErrored] = useState(false);

  if (!videoUrl) return null;

  if (errored) {
    return (
      <div className="rounded-xl border border-slate-200 my-10 bg-slate-50 aspect-video flex flex-col items-center justify-center gap-3 text-slate-400">
        <svg className="w-12 h-12 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M15.182 16.318A4.486 4.486 0 0012.016 15a4.486 4.486 0 00-3.198 1.318M21 12a9 9 0 11-18 0 9 9 0 0118 0zM9.75 9.75c0 .414-.168.75-.375.75S9 10.164 9 9.75 9.168 9 9.375 9s.375.336.375.75zm-.375 0h.008v.015h-.008V9.75zm5.625 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75zm-.375 0h.008v.015h-.008V9.75z"
          />
        </svg>
        <p className="text-sm font-medium">Video not yet available</p>
        <p className="text-xs opacity-60">Run the pipeline to generate this video</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 my-8 bg-slate-900 aspect-video">
      <video
        className="w-full h-full object-cover"
        controls
        src={videoUrl}
        onError={() => setErrored(true)}
        // Preload metadata so the browser shows the first frame as poster
        preload="metadata"
      >
        {vttUrl && (
          <track
            kind="subtitles"
            src={vttUrl}
            srcLang={locale.split('-')[0]}
            label="Captions"
            default
          />
        )}
        Your browser does not support HTML video.
      </video>
    </div>
  );
}
