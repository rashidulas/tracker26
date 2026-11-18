'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type VoiceState = 'idle' | 'requesting' | 'recording' | 'transcribing';

/** Recording stops by itself after this long. */
const MAX_SECONDS = 120;

function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return null;
  return (
    ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t)) ?? ''
  );
}

/**
 * Microphone recording and transcription (app/api/assistant/transcribe).
 *
 * start → requesting (the browser may ask for permission) → recording →
 * stop → transcribing → idle, with the text passed to onText.
 *
 * Every start gets a session number. cancel(), stop() while the permission
 * prompt is still open, and unmounting all bump it, and a microphone stream
 * that arrives for an old session is closed immediately. That is what
 * prevents the "released before permission resolved, records forever" bug:
 * a late permission grant can no longer start a recording nobody can stop.
 */
export function useVoiceRecorder({
  onText,
  onError,
}: {
  onText: (text: string) => void;
  onError: (message: string) => void;
}) {
  const [state, setStateValue] = useState<VoiceState>('idle');
  const [seconds, setSeconds] = useState(0);
  const stateRef = useRef<VoiceState>('idle');
  const sessionRef = useRef(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const callbacks = useRef({ onText, onError });
  callbacks.current = { onText, onError };

  const setState = useCallback((next: VoiceState) => {
    stateRef.current = next;
    setStateValue(next);
  }, []);

  const releaseMicrophone = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  const transcribe = useCallback(
    async (blob: Blob, mimeType: string, session: number) => {
      setState('transcribing');
      try {
        const form = new FormData();
        form.append('audio', blob, `speech.${mimeType.includes('mp4') ? 'mp4' : 'webm'}`);
        const res = await fetch('/api/assistant/transcribe', { method: 'POST', body: form });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.error || 'Could not transcribe that');
        if (session === sessionRef.current) callbacks.current.onText(String(data.text));
      } catch (error) {
        if (session === sessionRef.current) {
          callbacks.current.onError(error instanceof Error ? error.message : 'Could not transcribe that');
        }
      } finally {
        if (session === sessionRef.current) setState('idle');
      }
    },
    [setState]
  );

  /** Throw away whatever is in progress and return to idle. */
  const cancel = useCallback(() => {
    sessionRef.current += 1;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = null;
      recorder.stop();
    }
    releaseMicrophone();
    setSeconds(0);
    setState('idle');
  }, [releaseMicrophone, setState]);

  /** Finish recording and transcribe it. While permission is still pending, this cancels. */
  const stop = useCallback(() => {
    if (stateRef.current === 'requesting') return cancel();
    const recorder = recorderRef.current;
    if (stateRef.current === 'recording' && recorder && recorder.state !== 'inactive') recorder.stop();
  }, [cancel]);

  const start = useCallback(async () => {
    if (stateRef.current !== 'idle') return;
    const mimeType = pickMimeType();
    if (mimeType === null || !navigator.mediaDevices?.getUserMedia) {
      callbacks.current.onError('Voice input is not available in this browser');
      return;
    }
    const session = (sessionRef.current += 1);
    setState('requesting');

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      if (session === sessionRef.current) {
        setState('idle');
        callbacks.current.onError('Allow microphone access to use voice input');
      }
      return;
    }
    // Cancelled, or the component went away, while the prompt was open.
    if (session !== sessionRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const type = recorder.mimeType || mimeType || 'audio/webm';
    streamRef.current = stream;
    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      releaseMicrophone();
      setSeconds(0);
      const blob = new Blob(chunks, { type });
      // Too short to contain speech.
      if (blob.size < 500) return setState('idle');
      void transcribe(blob, type, session);
    };
    recorder.start();
    setSeconds(0);
    setState('recording');
    const startedAt = Date.now();
    timerRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      setSeconds(elapsed);
      if (elapsed >= MAX_SECONDS && recorder.state !== 'inactive') recorder.stop();
    }, 250);
  }, [releaseMicrophone, setState, transcribe]);

  // Leaving the page must never leave the microphone open.
  useEffect(
    () => () => {
      sessionRef.current += 1;
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        recorder.onstop = null;
        recorder.stop();
      }
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
    },
    []
  );

  return { state, seconds, start, stop, cancel };
}
