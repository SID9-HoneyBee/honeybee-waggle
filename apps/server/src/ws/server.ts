import { WebSocketServer, WebSocket, type RawData } from "ws";
import type { ClientMessage, ServerMessage } from "@honeybee-waggle/schema";
import type { ProfileService } from "../profiles/ProfileService";
import type { SessionManager } from "../session/SessionManager";

interface WsServerOptions {
  host: string;
  port: number;
  allowedOrigins: string[];
}

/**
 * 세션 목록 변경(session.updated)은 모든 연결에 뿌리고,
 * 대화 항목(session.entry)은 그 세션을 열어둔(session.open) 연결에만 보낸다.
 * 한 브라우저 탭이 세션 하나만 보더라도, 여러 탭이 서로 다른 세션을 볼 수 있게 연결별로 구독을 관리한다.
 */
export function startWsServer(
  manager: SessionManager,
  profiles: ProfileService,
  opts: WsServerOptions,
): WebSocketServer {
  const wss = new WebSocketServer({
    host: opts.host,
    port: opts.port,
    verifyClient: ({ origin }: { origin: string }) => opts.allowedOrigins.includes(origin),
  });
  const subscriptions = new Map<WebSocket, Set<string>>();

  manager.on("updated", (session) => {
    for (const ws of subscriptions.keys()) send(ws, { type: "session.updated", session });
  });
  // 키 등록·예산 변경·비용 누적은 열려 있는 모든 화면(설정, 새 세션 폼)에 바로 반영돼야 한다.
  profiles.on("changed", () => {
    const list = profiles.list();
    for (const ws of subscriptions.keys()) send(ws, { type: "profile.list", profiles: list });
  });
  manager.on("removed", (sessionId) => {
    for (const [ws, subs] of subscriptions) {
      subs.delete(sessionId);
      send(ws, { type: "session.removed", sessionId });
    }
  });
  manager.on("entry", (sessionId, entry) => {
    for (const [ws, subs] of subscriptions) {
      if (subs.has(sessionId)) send(ws, { type: "session.entry", sessionId, entry });
    }
  });

  wss.on("connection", (ws) => {
    subscriptions.set(ws, new Set());
    ws.on("close", () => subscriptions.delete(ws));
    ws.on("message", (data) => {
      void handle(ws, data).catch((err: unknown) => {
        const reqId = tryReqId(data);
        send(ws, { type: "error", reqId, message: err instanceof Error ? err.message : String(err) });
      });
    });
  });

  async function handle(ws: WebSocket, data: RawData): Promise<void> {
    const msg = JSON.parse(data.toString()) as ClientMessage;
    switch (msg.type) {
      case "session.list":
        send(ws, { type: "session.list", sessions: manager.list() });
        return;
      case "session.create": {
        const session = await manager.create(msg);
        send(ws, { type: "session.created", reqId: msg.reqId, session });
        return;
      }
      case "session.open": {
        // 구독을 먼저 걸고 기록을 보낸다. 반대 순서면 그 사이 항목을 놓치고,
        // 이 순서면 중복이 생길 수 있는데 그건 클라이언트가 seq로 걸러낸다.
        subscriptions.get(ws)?.add(msg.sessionId);
        const entries = await manager.history(msg.sessionId);
        send(ws, { type: "session.history", sessionId: msg.sessionId, entries });
        return;
      }
      case "session.close":
        subscriptions.get(ws)?.delete(msg.sessionId);
        return;
      case "session.delete":
        await manager.delete(msg.sessionId);
        send(ws, { type: "ack", reqId: msg.reqId });
        return;
      case "run.send":
        manager.send(msg.sessionId, msg.text);
        return;
      case "run.cancel":
        manager.cancel(msg.sessionId);
        return;
      case "profile.list":
        send(ws, { type: "profile.list", profiles: profiles.list() });
        return;
      case "settings.setKey":
        await profiles.setKey(msg.provider, msg.key);
        send(ws, { type: "ack", reqId: msg.reqId });
        return;
      case "settings.deleteKey":
        await profiles.deleteKey(msg.provider);
        send(ws, { type: "ack", reqId: msg.reqId });
        return;
      case "settings.setBudget":
        await profiles.setBudget(msg.profileId, msg.budgetUsd);
        send(ws, { type: "ack", reqId: msg.reqId });
        return;
      default:
        throw new Error(`알 수 없는 메시지 타입: ${(msg as { type?: string }).type}`);
    }
  }

  return wss;
}

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function tryReqId(data: RawData): string | undefined {
  try {
    return (JSON.parse(data.toString()) as { reqId?: string }).reqId;
  } catch {
    return undefined;
  }
}
