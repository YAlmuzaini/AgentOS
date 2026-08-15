import { CircleCheck, CircleX, Info, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "../../lib/cn";

/**
 * Transient feedback for things that already happened.
 *
 * The app had none, so roughly forty mutations failed silently: a delete that
 * 403'd, a save that lost a race, a rotate that timed out all looked exactly
 * like success. A confirmation dialog asks before; this reports after.
 *
 * Errors do not auto-dismiss — an operator who looked away should still find
 * out that the thing they asked for did not happen.
 */
type ToastTone = "success" | "error" | "info";

interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
  detail?: string;
}

interface ToastApi {
  success: (message: string, detail?: string) => void;
  error: (message: string, detail?: string) => void;
  info: (message: string, detail?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const ICON: Record<ToastTone, ReactNode> = {
  success: <CircleCheck />,
  error: <CircleX />,
  info: <Info />,
};

const TONE: Record<ToastTone, string> = {
  success: "text-live",
  error: "text-danger",
  info: "text-link",
};

/** Errors stay until dismissed; everything else clears itself. */
const TTL: Record<ToastTone, number | null> = {
  success: 4000,
  info: 5000,
  error: null,
};

export function ToastProvider(props: { children: ReactNode }): React.JSX.Element {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback((tone: ToastTone, message: string, detail?: string) => {
    const id = nextId.current++;
    setToasts((current) => [...current.slice(-3), { id, tone, message, detail }]);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      success: (message, detail) => push("success", message, detail),
      error: (message, detail) => push("error", message, detail),
      info: (message, detail) => push("info", message, detail),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {props.children}

      <div
        // aria-live so a screen reader hears the outcome without moving focus,
        // which would yank the operator out of whatever they were doing.
        aria-live="polite"
        className="pointer-events-none fixed right-4 bottom-4 z-[70] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
      >
        {toasts.map((toast) => (
          <ToastRow key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastRow(props: { toast: Toast; onDismiss: () => void }): React.JSX.Element {
  const { toast } = props;
  const ttl = TTL[toast.tone];

  useEffect(() => {
    if (ttl === null) {
      return;
    }
    const timer = setTimeout(props.onDismiss, ttl);
    return () => clearTimeout(timer);
  }, [ttl, props.onDismiss]);

  return (
    <div className="rise pointer-events-auto flex items-start gap-2.5 rounded-panel border border-edge bg-panel p-3 shadow-pop">
      <span className={cn("mt-px shrink-0 [&_svg]:size-4", TONE[toast.tone])}>
        {ICON[toast.tone]}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-ink">{toast.message}</p>
        {toast.detail ? (
          <p className="mt-0.5 text-xs break-words text-ink-muted">{toast.detail}</p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={props.onDismiss}
        aria-label="Dismiss"
        className="shrink-0 rounded p-0.5 text-ink-faint transition-colors hover:text-ink"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return api;
}
