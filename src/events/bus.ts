/**
 * アプリ内のイベント配信。
 *
 * 1プロセス構成（D: PLAN §1.2）なので、外部のメッセージブローカは要らない。
 * 書き込みが起きたらサービス層がここに流し、SSE の各接続へ配る。
 */

export type EventName = 'notices-changed' | 'settings-changed';

export interface SignboardEvent {
  name: EventName;
  /** 発生時刻。クライアントの重複排除に使える。 */
  at: number;
}

type Listener = (event: SignboardEvent) => void;

export class EventBus {
  #listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  emit(name: EventName, at = Date.now()): void {
    const event: SignboardEvent = { name, at };
    for (const listener of this.#listeners) {
      // 1つの接続で例外が出ても他の配信を止めない。
      try {
        listener(event);
      } catch {
        /* 切断直後などは無視してよい */
      }
    }
  }

  /** テスト用。接続数を確認する。 */
  get size(): number {
    return this.#listeners.size;
  }
}
