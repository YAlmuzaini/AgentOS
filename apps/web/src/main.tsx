import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ApiError } from "./api";
import { router } from "./router";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A rejected token is not a transient failure — retrying it just delays
      // the message that tells the operator what is actually wrong.
      retry: (count, error) => !(error instanceof ApiError && error.status >= 400) && count < 1,
      refetchOnWindowFocus: false,
    },
  },
});

const container = document.getElementById("root");
if (!container) {
  throw new Error("#root is missing from index.html");
}

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js");
  });
}
