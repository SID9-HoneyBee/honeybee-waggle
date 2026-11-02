import { createReadStream, promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import type { ClientMessage, ServerMessage } from "@honeybee-waggle/schema";
import type { ProfileService } from "../profiles/ProfileService";
import type { SessionManager } from "../session/SessionManager";
import { SESSION_ID } from "../store/FileSessionStore";
import type { ToolGateway } from "../tools/ToolGateway";

interface WsServerOptions {
  host: string;
  port: number;
  allowedOrigins: string[];
  filesDir: (sessionId: string) => string;
}

// /files/<sessionId>/<파일명>. 두 부분 모두 엄격하게 제한해서 ../ 같은 경로 조작이 끼어들 틈을 없앤다.
// 세션 ID는 저장소와 같은 UUID 검사(SESSION_ID)를 다시 거친다. 형식이 느슨하면 저장소 쪽 검사에서 예외가 난다.
const FILE_ROUTE = /^\/files\/([^/]+)\/([A-Za-z0-9_-]+\.(png|jpg|webp))$/;
const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

/**
 * 세션 목록 변경(session.updated)은 모든 연결에 뿌리고,
 * 대화 항목(session.entry)은 그 세션을 열어둔(session.open) 연결에만 보낸다.
 * 한 브라우저 탭이 세션 하나만 보더라도, 여러 탭이 서로 다른 세션을 볼 수 있게 연결별로 구독을 관리한다.
 */
export function startWsServer(
  manager: SessionManager,
  profiles: ProfileService,
  tools: ToolGateway,
  opts: WsServerOptions,
): WebSocketServer {
  // API 대화에서 생성한 이미지를 <img>로 띄우려면 HTTP 경로가 필요해서, WS를 HTTP 서버 위에 얹는다.
  // 파일명이 API가 준 긴 ID라 추측할 수 없고 127.0.0.1에만 열려 있어서 별도 인증은 두지 않는다.
  // 이 핸들러에서 예외가 새면 서버 프로세스 전체가 죽는다(로컬의 아무 요청 하나로 서비스 중단). 모든 실패를 응답 코드로 끝낸다.
  const server = http.createServer((req, res) => {
    serveFile(req, res, opts.filesDir).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  const wss = new WebSocketServer({
    server,
    verifyClient: ({ origin }: { origin: string }) => opts.allowedOrigins.includes(origin),
  });
  // 외부 server를 쓰면 ws가 server의 listening을 그대로 다시 내보내므로 여기서 따로 emit하지 않는다.
  server.listen(opts.port, opts.host);
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
  // 승인 요청은 그 세션을 열어둔 화면에만 보낸다. 여러 탭에서 열어뒀으면 어느 탭에서 답해도 된다.
  const toSubscribers = (sessionId: string, msg: ServerMessage) => {
    for (const [ws, subs] of subscriptions) if (subs.has(sessionId)) send(ws, msg);
  };
  tools.on("request", (sessionId, request) => toSubscribers(sessionId, { type: "approval.request", sessionId, request }));
  tools.on("resolved", (sessionId, approvalId) => toSubscribers(sessionId, { type: "approval.resolved", sessionId, approvalId }));
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
        // 화면을 새로 열었을 때도 대기 중인 승인이 보여야 한다. 안 그러면 run이 승인 대기에서 멈춘 채로 남는다.
        for (const request of tools.pendingFor(msg.sessionId)) {
          send(ws, { type: "approval.request", sessionId: msg.sessionId, request });
        }
        return;
      }
      case "session.close":
        subscriptions.get(ws)?.delete(msg.sessionId);
        return;
      case "session.setFolder":
        await manager.setFolder(msg.sessionId, msg.folder, msg.approval);
        send(ws, { type: "ack", reqId: msg.reqId });
        return;
      case "approval.respond":
        tools.respond(msg.sessionId, msg.approvalId, msg.approve);
        return;
      case "session.rename":
        manager.rename(msg.sessionId, msg.title);
        send(ws, { type: "ack", reqId: msg.reqId });
        return;
      case "session.delete":
        await manager.delete(msg.sessionId);
        send(ws, { type: "ack", reqId: msg.reqId });
        return;
      case "run.send":
        manager.send(msg.sessionId, msg.text, msg.refs, msg.files);
        return;
      case "session.transcript": {
        const { text, chars } = await manager.transcript(msg.sessionId, msg.includeTools);
        send(ws, { type: "session.transcript", reqId: msg.reqId, sessionId: msg.sessionId, text, chars });
        return;
      }
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
      case "settings.setModel":
        await profiles.setModel(msg.profileId, msg.model);
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

async function serveFile(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  filesDir: (sessionId: string) => string,
): Promise<void> {
  // WebSocket과 달리 <img> 요청에는 Origin 검사를 걸 수 없다. 대신 브라우저가 붙이는 Sec-Fetch-Site로
  // 다른 사이트에서 이 서버의 파일을 끌어가는 요청을 막는다 (같은 PC의 웹 화면은 same-site로 온다).
  if (req.headers["sec-fetch-site"] === "cross-site") {
    res.writeHead(403).end();
    return;
  }
  const m = req.method === "GET" ? FILE_ROUTE.exec(req.url ?? "") : null;
  if (!m || !SESSION_ID.test(m[1]!)) {
    res.writeHead(404).end();
    return;
  }
  const file = path.join(filesDir(m[1]!), m[2]!);
  const stat = await fs.stat(file).catch(() => null);
  if (!stat?.isFile()) {
    res.writeHead(404).end();
    return;
  }
  const stream = createReadStream(file);
  // 읽는 도중 파일이 사라지는 등의 오류도 처리하지 않으면 프로세스가 죽는다.
  stream.on("error", () => {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
  res.writeHead(200, { "Content-Type": MIME[m[3]!]!, "Cache-Control": "private, max-age=31536000, immutable" });
  stream.pipe(res);
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
