import { promises as fs } from "node:fs";
import path from "node:path";
import type { HistoryEntry, SessionMeta } from "@honeybee-waggle/schema";

// 세션 ID는 서버가 randomUUID로만 만든다. 그 외 형태가 들어오면 경로 조작 시도로 보고 막는다.
export const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * .data/sessions/<id>/meta.json   세션 정보 (통째로 덮어씀)
 * .data/sessions/<id>/events.jsonl 대화 기록 (append-only, 한 줄에 HistoryEntry 하나)
 *
 * 기록을 JSONL로 둔 이유: 이벤트가 스트림으로 들어오니 받는 대로 덧붙이면 되고,
 * 서버가 쓰는 도중 죽어도 마지막 한 줄만 깨진다 (읽을 때 그 줄만 버림).
 */
export class FileSessionStore {
  // 같은 세션 파일에 대한 쓰기는 순서대로 처리해야 한다. 특히 Windows는 rename이 겹치면 EPERM이 난다.
  private readonly queues = new Map<string, Promise<void>>();

  constructor(private readonly root: string) {}

  async loadAll(): Promise<SessionMeta[]> {
    const base = path.join(this.root, "sessions");
    await fs.mkdir(base, { recursive: true });
    const metas: SessionMeta[] = [];
    for (const id of await fs.readdir(base)) {
      if (!SESSION_ID.test(id)) continue;
      try {
        metas.push(JSON.parse(await fs.readFile(path.join(base, id, "meta.json"), "utf8")) as SessionMeta);
      } catch (err) {
        // 한 세션이 깨졌다고 서버 전체가 못 뜨면 안 된다. 폴더는 남겨둬서 나중에 직접 확인할 수 있게 한다.
        console.warn(`[store] 세션 ${id} meta.json 읽기 실패, 건너뜀:`, err);
      }
    }
    return metas;
  }

  saveMeta(meta: SessionMeta): Promise<void> {
    return this.enqueue(meta.id, async () => {
      const dir = this.dir(meta.id);
      await fs.mkdir(dir, { recursive: true });
      // 쓰다가 죽어도 meta.json이 반쯤 쓰인 상태로 남지 않게 임시 파일에 쓰고 교체한다.
      const tmp = path.join(dir, "meta.json.tmp");
      await fs.writeFile(tmp, JSON.stringify(meta, null, 2), "utf8");
      await fs.rename(tmp, path.join(dir, "meta.json"));
    });
  }

  append(sessionId: string, entry: HistoryEntry): Promise<void> {
    return this.enqueue(sessionId, () =>
      fs.appendFile(path.join(this.dir(sessionId), "events.jsonl"), JSON.stringify(entry) + "\n", "utf8"),
    );
  }

  /** 대기 중인 쓰기가 다 끝난 뒤 지운다. 같은 큐에 넣어야 앞선 append/saveMeta가 폴더를 다시 만들지 않는다 */
  deleteSession(sessionId: string): Promise<void> {
    return this.enqueue(sessionId, () => fs.rm(this.dir(sessionId), { recursive: true, force: true }));
  }

  async readHistory(sessionId: string): Promise<HistoryEntry[]> {
    // 아직 디스크에 안 내려간 append가 있으면 기록에서 빠지므로 대기열이 비기를 기다린다.
    await this.queues.get(sessionId)?.catch(() => {});
    let text: string;
    try {
      text = await fs.readFile(path.join(this.dir(sessionId), "events.jsonl"), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    const entries: HistoryEntry[] = [];
    for (const line of text.split("\n")) {
      if (!line) continue;
      try {
        entries.push(JSON.parse(line) as HistoryEntry);
      } catch {
        // 비정상 종료로 잘린 마지막 줄. 복구할 수 없으니 버린다.
      }
    }
    return entries;
  }

  /** API 대화에서 생성된 이미지 등을 두는 폴더. 세션 폴더 안에 둬서 세션 삭제 때 같이 지워진다 */
  filesDir(sessionId: string): string {
    return path.join(this.dir(sessionId), "files");
  }

  private dir(sessionId: string): string {
    if (!SESSION_ID.test(sessionId)) throw new Error(`잘못된 세션 ID: ${sessionId}`);
    return path.join(this.root, "sessions", sessionId);
  }

  private enqueue(sessionId: string, task: () => Promise<void>): Promise<void> {
    const prev = this.queues.get(sessionId) ?? Promise.resolve();
    // 앞선 쓰기가 실패해도 뒤 작업은 계속 진행돼야 하므로 prev의 실패는 여기서 끊는다.
    const next = prev.catch(() => {}).then(task);
    this.queues.set(sessionId, next);
    void next.finally(() => {
      if (this.queues.get(sessionId) === next) this.queues.delete(sessionId);
    }).catch(() => {});
    return next;
  }
}
