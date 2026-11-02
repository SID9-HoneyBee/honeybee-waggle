import { Entry } from "@napi-rs/keyring";
import type { KeyProvider } from "@honeybee-waggle/schema";

const SERVICE = "honeybee-waggle";

/**
 * API 키는 Windows 자격 증명 관리자에 둔다. 파일로 두면 백업·동기화 폴더를 타고 새어 나갈 수 있고,
 * 자격 증명 관리자는 OS가 사용자 계정 기준으로 암호화해준다.
 * buildEnv의 resolveKey가 동기 함수라서 비동기 AsyncEntry가 아닌 동기 Entry를 쓴다.
 */
export class KeyStore {
  get(provider: KeyProvider): string | null {
    return new Entry(SERVICE, provider).getPassword();
  }

  set(provider: KeyProvider, key: string): void {
    new Entry(SERVICE, provider).setPassword(key);
  }

  delete(provider: KeyProvider): void {
    new Entry(SERVICE, provider).deletePassword();
  }

  hint(provider: KeyProvider): string | undefined {
    const key = this.get(provider);
    return key ? `…${key.slice(-4)}` : undefined;
  }
}
