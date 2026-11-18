'use client';

/**
 * The chat composer: an auto-growing textarea (Enter sends, Shift+Enter adds
 * a line), image attachments (paste, drop, camera or photo library) and
 * voice input.
 *
 * Text and attachments live here rather than in the chat panel, so typing
 * does not re-render the conversation.
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from 'react';
import { ArrowUp, Camera, ImagePlus, Images, Loader2, Mic, Square, X } from 'lucide-react';
import { useToast } from '@/components/ToastProvider';
import { useVoiceRecorder } from './useVoiceRecorder';

export type ComposerImage = { id: string; url: string; mediaType: string };

export type ComposerHandle = {
  focus: () => void;
  /** Replace the text (a suggestion to finish, or a transcript) and focus. */
  setText: (text: string) => void;
  addFiles: (files: Iterable<File>) => void;
};

const MAX_IMAGES = 4;
const MAX_EDGE = 1568;
const MAX_HEIGHT = 200;
/** A press held this long is "hold to talk": letting go finishes the recording. */
const HOLD_MS = 450;

/**
 * Downscale to at most MAX_EDGE on the long side and re-encode as JPEG.
 * Phone photos are several megabytes; the model does not need more than this
 * to read a receipt, and the image is stored with the conversation.
 */
async function prepareImage(file: File): Promise<{ url: string; mediaType: string }> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return { url: canvas.toDataURL('image/jpeg', 0.85), mediaType: 'image/jpeg' };
  } catch {
    // A format the canvas cannot decode: send it as it is.
    const url = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    return { url, mediaType: file.type };
  }
}

const iconButton =
  'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-secondary transition-colors hover:bg-graphite-surface-hover hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint/40';

type Props = {
  /** A reply is being produced: show Stop instead of Send. */
  busy: boolean;
  onSend: (message: { text: string; images: ComposerImage[] }) => void;
  onStop: () => void;
  placeholder?: string;
};

const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  { busy, onSend, onStop, placeholder = 'Ask about your money, or log an expense…' },
  ref
) {
  const toast = useToast();
  const [text, setTextValue] = useState('');
  const [images, setImages] = useState<ComposerImage[]>([]);
  const [preparing, setPreparing] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [touch, setTouch] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const imageCount = useRef(0);
  imageCount.current = images.length + preparing;

  // A phone or tablet gets the camera / library choice; a desktop goes straight to the file picker.
  useEffect(() => {
    const query = window.matchMedia('(pointer: coarse)');
    const update = () => setTouch(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    // Empty: one line. (scrollHeight would count a placeholder that wraps on a narrow screen.)
    if (!el.value) {
      el.style.overflowY = 'hidden';
      return;
    }
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden';
  }, []);
  useEffect(resize, [text, resize]);
  // The same text needs a different height when the box gets wider or
  // narrower (rotation, the sidebar appearing, styles arriving after mount).
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      resize();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [resize]);

  const setText = useCallback((value: string) => {
    setTextValue(value);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(value.length, value.length);
    });
  }, []);

  const addFiles = useCallback(
    (files: Iterable<File>) => {
      const list = [...files];
      const picked = list.filter((file) => file.type.startsWith('image/'));
      if (picked.length < list.length) toast.error('Only images can be attached');
      const room = MAX_IMAGES - imageCount.current;
      if (picked.length > room) toast.error(`You can attach up to ${MAX_IMAGES} images`);
      for (const file of picked.slice(0, Math.max(room, 0))) {
        if (file.size > 25 * 1024 * 1024) {
          toast.error('That image is too large (25 MB at most)');
          continue;
        }
        setPreparing((n) => n + 1);
        prepareImage(file)
          .then((image) =>
            setImages((prev) => [...prev, { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, ...image }])
          )
          .catch(() => toast.error('That image could not be read'))
          .finally(() => setPreparing((n) => n - 1));
      }
    },
    [toast]
  );

  useImperativeHandle(ref, () => ({ focus: () => textareaRef.current?.focus(), setText, addFiles }), [
    setText,
    addFiles,
  ]);

  // ---- voice ----
  const voice = useVoiceRecorder({
    // The transcript goes into the box to check before sending, after anything already typed.
    onText: (spoken) => setText(text.trim() ? `${text.trim()} ${spoken}` : spoken),
    onError: (message) => toast.error(message),
  });
  const listening = voice.state === 'requesting' || voice.state === 'recording';
  const pressRef = useRef<{ started: boolean; at: number }>({ started: false, at: 0 });

  // Mouse and touch: a tap starts, a second tap finishes; holding and letting go also finishes.
  const onMicPointerDown = () => {
    pressRef.current = { started: voice.state === 'idle', at: Date.now() };
    if (voice.state === 'idle') void voice.start();
  };
  const onMicPointerUp = () => {
    const press = pressRef.current;
    // voice.stop() cancels if the permission prompt has not been answered
    // yet, so letting go early can never leave a recording running.
    if (press.started && Date.now() - press.at >= HOLD_MS) voice.stop();
  };
  const onMicClick = (event: React.MouseEvent) => {
    const press = pressRef.current;
    pressRef.current = { started: false, at: 0 };
    if (event.detail === 0) {
      // Keyboard (Enter or Space): toggle.
      if (voice.state === 'idle') void voice.start();
      else voice.stop();
    } else if (!press.started) {
      voice.stop();
    }
  };

  useEffect(() => {
    if (!listening) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') voice.cancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [listening, voice]);

  // ---- attach menu ----
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  // ---- send ----
  const canSend = !busy && preparing === 0 && (text.trim() !== '' || images.length > 0);
  const send = () => {
    if (!canSend) return;
    onSend({ text: text.trim(), images });
    setTextValue('');
    setImages([]);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // isComposing: Enter is confirming an IME candidate, not sending.
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...event.clipboardData.files].filter((file) => file.type.startsWith('image/'));
    if (files.length === 0) return;
    event.preventDefault();
    addFiles(files);
  };

  const onFileInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) addFiles(event.target.files);
    event.target.value = '';
    setMenuOpen(false);
  };

  const elapsed = `${Math.floor(voice.seconds / 60)}:${String(voice.seconds % 60).padStart(2, '0')}`;

  return (
    <div className="rounded-3xl border border-graphite-border bg-graphite-surface shadow-panel transition-colors focus-within:border-mint/40">
      {(images.length > 0 || preparing > 0) && (
        <ul className="flex flex-wrap gap-2 px-3 pt-3" aria-label="Attached images">
          {images.map((image, index) => (
            <li key={image.id} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image.url}
                alt={`Attachment ${index + 1}`}
                className="h-16 w-16 rounded-xl border border-graphite-border object-cover"
              />
              <button
                type="button"
                onClick={() => setImages((prev) => prev.filter((i) => i.id !== image.id))}
                className="absolute -right-2 -top-2 inline-flex h-7 w-7 items-center justify-center rounded-full border border-graphite-border bg-graphite-surface-2 text-ink-secondary hover:text-ink"
                aria-label={`Remove attachment ${index + 1}`}
              >
                <X size={13} aria-hidden="true" />
              </button>
            </li>
          ))}
          {preparing > 0 && (
            <li className="flex h-16 w-16 items-center justify-center rounded-xl border border-graphite-border-subtle bg-graphite-surface-2">
              <Loader2 size={16} className="animate-spin text-ink-muted" aria-label="Preparing image" />
            </li>
          )}
        </ul>
      )}

      {listening ? (
        <div className="flex min-h-[52px] items-center gap-3 px-4 pt-3" role="status">
          <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger opacity-60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-danger" />
          </span>
          <p className="flex-1 text-base text-ink">
            {voice.state === 'requesting' ? 'Waiting for the microphone…' : `Listening… ${elapsed}`}
          </p>
          <button
            type="button"
            onClick={voice.cancel}
            className="min-h-[44px] rounded-full px-3 text-sm text-ink-secondary hover:bg-graphite-surface-2 hover:text-ink"
          >
            Cancel
          </button>
        </div>
      ) : (
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(event) => setTextValue(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          rows={1}
          enterKeyHint="send"
          placeholder={voice.state === 'transcribing' ? 'Transcribing…' : placeholder}
          aria-label="Message the assistant"
          // 16px: anything smaller makes iOS zoom the page when the field is focused.
          className="block w-full resize-none bg-transparent px-4 pt-3.5 text-base leading-6 text-ink placeholder-ink-muted focus:outline-none"
        />
      )}

      <div className="flex items-center gap-1 px-2 pb-2 pt-1">
        <input ref={libraryRef} type="file" accept="image/*" multiple className="hidden" onChange={onFileInput} />
        {/* capture opens the camera directly; the library input above deliberately has none. */}
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={onFileInput}
        />
        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => (touch ? setMenuOpen((open) => !open) : libraryRef.current?.click())}
            className={iconButton}
            aria-label="Attach an image"
            aria-haspopup={touch ? 'menu' : undefined}
            aria-expanded={touch ? menuOpen : undefined}
            disabled={listening}
          >
            <ImagePlus size={19} aria-hidden="true" />
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute bottom-12 left-0 z-10 w-52 overflow-hidden rounded-2xl border border-graphite-border bg-graphite-surface-2 py-1 shadow-panel animate-fade-up"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => cameraRef.current?.click()}
                className="flex min-h-[44px] w-full items-center gap-3 px-4 text-left text-sm text-ink hover:bg-graphite-surface-hover"
              >
                <Camera size={17} aria-hidden="true" className="text-ink-secondary" /> Take a photo
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => libraryRef.current?.click()}
                className="flex min-h-[44px] w-full items-center gap-3 px-4 text-left text-sm text-ink hover:bg-graphite-surface-hover"
              >
                <Images size={17} aria-hidden="true" className="text-ink-secondary" /> Photo library
              </button>
            </div>
          )}
        </div>

        <button
          type="button"
          onPointerDown={onMicPointerDown}
          onPointerUp={onMicPointerUp}
          onPointerCancel={onMicPointerUp}
          onClick={onMicClick}
          disabled={voice.state === 'transcribing'}
          aria-pressed={listening}
          aria-label={listening ? 'Finish recording' : 'Dictate a message'}
          title={listening ? 'Finish recording (Esc cancels)' : 'Dictate: tap, or hold and let go'}
          className={`${iconButton} touch-none select-none ${listening ? 'bg-danger-dim text-danger hover:bg-danger-dim hover:text-danger' : ''}`}
        >
          {voice.state === 'transcribing' ? (
            <Loader2 size={19} className="animate-spin" aria-hidden="true" />
          ) : (
            <Mic size={19} aria-hidden="true" />
          )}
        </button>

        <div className="flex-1" />

        {busy ? (
          <button
            type="button"
            onClick={onStop}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-ink text-graphite transition-colors hover:bg-ink-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint/40"
            aria-label="Stop the reply"
          >
            <Square size={14} fill="currentColor" aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            onClick={send}
            disabled={!canSend}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-mint text-graphite transition-colors hover:bg-mint-bright disabled:bg-graphite-surface-2 disabled:text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint/40"
            aria-label="Send message"
          >
            <ArrowUp size={19} strokeWidth={2.4} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
});

export default Composer;
