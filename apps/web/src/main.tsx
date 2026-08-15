import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { ApiError } from "./api";
import { ConfirmProvider } from "./components/ui/confirm";
import { ToastProvider, useToast } from "./components/ui/toast";
import { router } from "./router";
import "./styles.css";

/**
 * Turns an API failure into something an operator can act on.
 *
 * The raw message is `401 Unauthorized — {"statusCode":401,...}`, which tells
 * them nothing they can do anything about, so the common statuses get a
 * sentence that names the actual cause.
 */
function describe(error: unknown): { message: string; detail?: string } {
  if (error instanceof ApiError) {
    if (error.status === 0) {
      return {
        message: "The control plane is not answering",
        detail: "Nothing was saved. Check that the API is running, then try again.",
      };
    }
    if (error.status === 401 || error.status === 403) {
      return {
        message: "The control plane rejected that",
        detail: "Your operator token may no longer be valid.",
      };
    }
    if (error.status === 404) {
      return { message: "That no longer exists", detail: "It may have been removed already." };
    }
    if (error.status >= 500) {
      return {
        message: "The control plane failed",
        detail: "The request reached the server and it errored. Nothing was saved.",
      };
    }
    return { message: "That did not go through", detail: error.message };
  }
  return {
    message: "That did not go through",
    detail: error instanceof Error ? error.message : undefined,
  };
}

/**
 * Owns the query client so it can reach the toaster.
 *
 * Every mutation reports its own failure through one MutationCache handler:
 * roughly forty mutations were failing silently because each page would have
 * had to remember to render its own error, and most did not.
 */
function App(): React.JSX.Element {
  const toast = useToast();

  const [queryClient] = useState(
    () =>
      new QueryClient({
        mutationCache: new MutationCache({
          onError: (error) => {
            const { message, detail } = describe(error);
            toast.error(message, detail);
          },
        }),
        defaultOptions: {
          queries: {
            // A rejected token is not a transient failure — retrying it just delays
            // the message that tells the operator what is actually wrong.
            retry: (count, error) =>
              !(error instanceof ApiError && error.status >= 400) && count < 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ConfirmProvider>
        <RouterProvider router={router} />
      </ConfirmProvider>
    </QueryClientProvider>
  );
}

const container = document.getElementById("root");
if (!container) {
  throw new Error("#root is missing from index.html");
}

createRoot(container).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js");
  });
}
