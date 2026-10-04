/**
 * 编目台本机标识：离线包来源标记，区分同编号记录来自哪台机器。
 * 持久化在 localStorage，清缓存即换台。
 */
const STATION_KEY = 'gbmeteorite:station-id';

export function getStationId(): string {
  try {
    let id = localStorage.getItem(STATION_KEY);
    if (!id) {
      id = `station-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
      localStorage.setItem(STATION_KEY, id);
    }
    return id;
  } catch {
    return 'station-unknown';
  }
}

/** 编目台跨标签页事件 */
export type CatalogChannelMessage =
  | { type: 'conflict-resolved'; conflictId: string; resolution: 'keep-local' | 'keep-incoming' }
  | { type: 'import-completed'; batchId: string }
  | { type: 'data-changed' };

const CHANNEL_NAME = 'gbmeteorite-catalog';

let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (!channel) channel = new BroadcastChannel(CHANNEL_NAME);
  return channel;
}

/** 广播一条编目事件（其他标签页接收，本页不回调） */
export function broadcast(msg: CatalogChannelMessage): void {
  try {
    getChannel()?.postMessage(msg);
  } catch {
    /* BroadcastChannel 不可用时静默降级 */
  }
}

/** 订阅其他标签页的编目事件 */
export function subscribeCatalog(handler: (msg: CatalogChannelMessage) => void): () => void {
  const ch = getChannel();
  if (!ch) return () => undefined;
  const listener = (ev: MessageEvent<CatalogChannelMessage>) => handler(ev.data);
  ch.addEventListener('message', listener);
  return () => ch.removeEventListener('message', listener);
}
