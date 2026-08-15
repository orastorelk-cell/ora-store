import React, { useEffect, useRef, useState } from 'react';
import { Camera, X, ScanLine } from 'lucide-react';

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  onDetected: (value: string) => void;
}

export const CameraBarcodeScanner: React.FC<Props> = ({ open, title, onClose, onDetected }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const detectedRef = useRef(false);
  const [message, setMessage] = useState('Starting rear camera...');

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    detectedRef.current = false;
    setMessage('Starting rear camera...');

    const stop = () => {
      try { controlsRef.current?.stop(); } catch {}
      controlsRef.current = null;
      const video = videoRef.current;
      const stream = video?.srcObject as MediaStream | null;
      stream?.getTracks().forEach(track => track.stop());
      if (video) video.srcObject = null;
    };

    const start = async () => {
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        if (cancelled || !videoRef.current) return;

        const reader = new BrowserMultiFormatReader();
        const controls = await reader.decodeFromConstraints(
          {
            audio: false,
            video: {
              facingMode: { ideal: 'environment' },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
          },
          videoRef.current,
          (result: any) => {
            if (!result || detectedRef.current) return;

            const value = String(
              typeof result.getText === 'function' ? result.getText() : result.text || ''
            ).trim();

            if (!value) return;

            detectedRef.current = true;
            setMessage(`Detected: ${value}`);
            stop();
            onDetected(value);
          }
        );

        if (cancelled) {
          controls.stop();
          return;
        }

        controlsRef.current = controls;
        setMessage('Point the camera at the waybill barcode.');
      } catch (error: any) {
        const name = String(error?.name || '');
        const permissionDenied = name === 'NotAllowedError' || name === 'PermissionDeniedError';
        setMessage(
          permissionDenied
            ? 'Camera permission was blocked. Allow camera access and try again.'
            : `Camera scanner could not start${error?.message ? `: ${error.message}` : '.'}`
        );
      }
    };

    start();
    return () => {
      cancelled = true;
      stop();
    };
  }, [open, onDetected]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/80 p-3">
      <div className="w-full max-w-lg overflow-hidden rounded-3xl border border-neutral-700 bg-neutral-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-black text-white">
              <Camera className="h-4 w-4 text-orange-400" />
              {title}
            </div>
            <p className="mt-0.5 text-[11px] text-neutral-400">
              Use the rear camera and keep the barcode inside the frame.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-neutral-800 p-2 text-neutral-300 hover:bg-neutral-700"
            aria-label="Close camera scanner"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="relative aspect-[4/3] bg-black">
          <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
          <div className="pointer-events-none absolute inset-[18%_8%] rounded-2xl border-2 border-orange-400 shadow-[0_0_0_9999px_rgba(0,0,0,0.18)]">
            <div className="absolute left-1/2 top-1/2 h-px w-[88%] -translate-x-1/2 -translate-y-1/2 bg-orange-400/70" />
          </div>
        </div>

        <div className="flex items-start gap-2 px-4 py-3 text-xs text-neutral-300">
          <ScanLine className="mt-0.5 h-4 w-4 shrink-0 text-orange-400" />
          <span>{message}</span>
        </div>
      </div>
    </div>
  );
};
