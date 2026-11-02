import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { ApprovalPolicy, ApprovalRequest } from "@honeybee-waggle/schema";
import { FOLDER_TOOLS, prepareCall, type ToolSpec } from "./folderTools";

interface SessionToolConfig {
  folder: string;
  approval: ApprovalPolicy;
}

interface Pending {
  sessionId: string;
  request: ApprovalRequest;
  resolve: (approve: boolean) => void;
}

/**
 * API 대화 세션의 폴더 도구 실행 창구. 모델은 도구를 "요청"만 하고, 실행은 항상 여기를 거친다.
 * 경로 검사 → (정책에 따라) 사용자 승인 대기 → 실행 순서를 한 곳에 모아서, 어댑터마다 보안 규칙이 갈라지지 않게 한다.
 * CLI 에이전트(구독)는 헤드리스라 승인을 받을 수 없지만, 여기서는 실행을 서버가 하므로 실행 직전에 멈춰 물어볼 수 있다.
 */
export class ToolGateway extends EventEmitter<{
  request: [sessionId: string, request: ApprovalRequest];
  resolved: [sessionId: string, approvalId: string];
}> {
  private lookup: (sessionId: string) => SessionToolConfig | undefined = () => undefined;
  private readonly pending = new Map<string, Pending>();

  /** 세션 정보는 SessionManager가 들고 있다. 생성 순서상 어댑터보다 늦게 만들어져서 나중에 연결한다 */
  bind(lookup: (sessionId: string) => SessionToolConfig | undefined): void {
    this.lookup = lookup;
  }

  /** 폴더가 연결된 세션에만 도구를 준다. 연결이 없으면 모델은 도구가 있다는 것조차 모른다 */
  toolsFor(sessionId: string): ToolSpec[] {
    return this.lookup(sessionId) ? FOLDER_TOOLS : [];
  }

  folderOf(sessionId: string): string | undefined {
    return this.lookup(sessionId)?.folder;
  }

  pendingFor(sessionId: string): ApprovalRequest[] {
    return [...this.pending.values()].filter((p) => p.sessionId === sessionId).map((p) => p.request);
  }

  respond(sessionId: string, approvalId: string, approve: boolean): void {
    const p = this.pending.get(approvalId);
    if (!p || p.sessionId !== sessionId) throw new Error("이미 처리됐거나 없는 승인 요청");
    p.resolve(approve);
  }

  /**
   * 도구 하나를 실행하고 모델에게 돌려줄 결과를 만든다. 실패·거절도 예외가 아니라 ok:false 결과로 돌려준다.
   * 모델이 결과를 보고 다른 방법을 찾거나 사용자에게 설명할 수 있어야 해서다.
   */
  async execute(
    sessionId: string,
    runId: string,
    toolCallId: string,
    name: string,
    input: unknown,
    signal: AbortSignal,
  ): Promise<{ ok: boolean; output: string }> {
    const config = this.lookup(sessionId);
    if (!config) return { ok: false, output: "이 세션에는 연결된 폴더가 없음" };

    let call;
    try {
      call = await prepareCall(config.folder, name, (input ?? {}) as Record<string, unknown>);
    } catch (err) {
      return { ok: false, output: errorText(err) };
    }

    const needsApproval = config.approval === "all" || (config.approval === "writes" && call.action === "write");
    if (needsApproval) {
      const approved = await this.ask(
        sessionId,
        { approvalId: randomUUID(), runId, toolCallId, tool: name, action: call.action, path: call.relPath, diff: call.diff },
        signal,
      );
      if (!approved) return { ok: false, output: "사용자가 이 작업을 거절함. 같은 작업을 다시 시도하지 말고, 필요하면 이유를 설명하거나 다른 방법을 물어봐." };
    }

    try {
      return { ok: true, output: await call.run() };
    } catch (err) {
      return { ok: false, output: errorText(err) };
    }
  }

  private ask(sessionId: string, request: ApprovalRequest, signal: AbortSignal): Promise<boolean> {
    return new Promise((resolve) => {
      const finish = (approve: boolean) => {
        if (!this.pending.delete(request.approvalId)) return;
        signal.removeEventListener("abort", onAbort);
        this.emit("resolved", sessionId, request.approvalId);
        resolve(approve);
      };
      // run이 중단되면 승인 대기도 거절로 끝내야 한다. 안 그러면 어댑터 루프가 영원히 기다린다.
      const onAbort = () => finish(false);
      if (signal.aborted) {
        resolve(false);
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
      this.pending.set(request.approvalId, { sessionId, request, resolve: finish });
      this.emit("request", sessionId, request);
    });
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
