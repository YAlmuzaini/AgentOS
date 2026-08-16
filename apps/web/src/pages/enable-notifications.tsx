import { useMutation, useQuery } from "@tanstack/react-query";
import { Bell, BellOff, Check } from "lucide-react";
import { api } from "../api";
import { Button } from "../components/ui/button";

/** Push opt-in for the inbox PWA (SPEC §12). Best-effort: a denied permission
 * or missing VAPID key just leaves the button inert, never blocks the page. */
export function EnableNotifications(): React.JSX.Element {
  const publicKey = useQuery({ queryKey: ["push-public-key"], queryFn: api.pushPublicKey });

  const subscribe = useMutation({
    mutationFn: async () => {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        // Returning quietly here left the mutation successful, so the button
        // said "Notifications on" while nothing was subscribed — the one lie
        // this control can tell, on the one channel an agent has to reach a
        // human away from their desk.
        throw new Error("The browser refused permission to send notifications.");
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
      <Button
        size="sm"
        className="min-h-11 sm:min-h-0"
        variant="ghost"
        disabled
        title="Push is not configured on the server"
      >
        <BellOff />
        Push not configured
      </Button>
    );
  }

  // A failed opt-in stays on the button and stays clickable: the operator has
  // to be able to see that it did not take, and to grant permission and press
  // it again without reloading.
  if (subscribe.isError) {
    return (
      <Button
        size="sm"
        variant="danger"
        className="min-h-11 sm:min-h-0"
        title={subscribe.error.message}
        onClick={() => subscribe.mutate()}
      >
        <BellOff />
        Not enabled — retry
      </Button>
    );
  }

  return (
    <Button
      size="sm"
      // The Phone Rule: this sits in the Inbox header, which is read
      // one-handed, so it clears 44px there and stays compact elsewhere.
      className="min-h-11 sm:min-h-0"
      disabled={subscribe.isPending || subscribe.isSuccess}
      title={
        subscribe.isSuccess
          ? "This device will receive notifications for new agent questions."
          : "Notify this device when an agent requests input."
      }
      onClick={() => subscribe.mutate()}
    >
      {subscribe.isSuccess ? <Check /> : <Bell />}
      {subscribe.isPending
        ? "Enabling…"
        : subscribe.isSuccess
          ? "Notifications on"
          : "Enable notifications"}
    </Button>
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
