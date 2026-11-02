"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { emptyView, WaggleClient, type Snapshot } from "./waggleClient";

const WS_URL = process.env.NEXT_PUBLIC_WAGGLE_WS ?? "ws://127.0.0.1:4317";

const ClientContext = createContext<WaggleClient | null>(null);

// 서버 렌더 시점에는 연결이 없다. 고정된 빈 스냅샷을 줘야 hydration 불일치가 안 난다.
const SERVER_SNAPSHOT: Snapshot = { conn: "connecting", sessions: [], views: {} };

export function WaggleProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new WaggleClient(WS_URL));

  useEffect(() => {
    client.connect();
    return () => client.dispose();
  }, [client]);

  return <ClientContext.Provider value={client}>{children}</ClientContext.Provider>;
}

export function useWaggleClient(): WaggleClient {
  const client = useContext(ClientContext);
  if (!client) throw new Error("WaggleProvider 밖에서 사용됨");
  return client;
}

export function useWaggle<T>(select: (s: Snapshot) => T): T {
  const client = useWaggleClient();
  return select(useSyncExternalStore(client.subscribe, client.getSnapshot, () => SERVER_SNAPSHOT));
}

export function useSessionView(id: string) {
  return useWaggle((s) => s.views[id] ?? emptyView());
}
