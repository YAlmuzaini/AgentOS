import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../api";

/** Push opt-in for the inbox PWA (SPEC §12). Best-effort: a denied permission
 * or missing VAPID key just leaves the button inert, never blocks the page. */
export function EnableNotifications(): React.JSX.Element {
  const publicKey = useQuery({ queryKey: ["push-public-key"], queryFn: api.pushPublicKey });

  const subscribe = useMutation({
    mutationFn: async () => {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey.data!.publicKey),
      });
      await api.pushSubscribe(subscription.toJSON() as Parameters<typeof api.pushSubscribe>[0]);
    },
  });

  if (!publicKey.data?.enabled) {
    return (
      <button
        className="rounded-sm bg-surface-raised px-3 py-1.5 text-xs text-ink-faint"
        disabled
        title="push is not configured"
      >
        push is not configured
      </button>
    );
  }

  return (
    <button
      className="rounded-sm bg-edge px-3 py-1.5 text-xs hover:bg-edge-strong disabled:opacity-40"
      disabled={subscribe.isPending || subscribe.isSuccess}
      onClick={() => subscribe.mutate()}
    >
      {subscribe.isSuccess ? "Notifications enabled" : "Enable notifications"}
    </button>
  );
}

function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    bytes[i] = raw.charCodeAt(i);
  }
  return bytes;
}
