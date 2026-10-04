/**
 * 跨标签页数据变更广播。
 * 一个标签页完成并库 / 裁决 / 重试后，其他打开的标签页刷新本地内存视图，
 * 以保证“后确认的一页”能看到冲突已被先确认的一页处理掉，从而保留草稿并提示重载。
 */

export type DataChangeKind =
  | 'merge'
  | 'resolve-conflict'
  | 'retry-failure'
  | 'discard-failure'
  | 'sample-write';

export interface DataChangeMessage {
  kind: DataChangeKind;
  conflictId?: string;
  sessionId: string;
  at: number;
}

const CHANNEL_NAME = 'gbmeteorite-data';

function createChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  try {
    return new BroadcastChannel(CHANNEL_NAME);
  } catch {
    return null;
  }
}

class DataChangeBus {
  private channel: BroadcastChannel | null = null;
  private listeners = new Set<(msg: DataChangeMessage) => void>();

  constructor() {
    this.channel = createChannel();
    if (this.channel) {
      this.channel.onmessage = (event: MessageEvent<DataChangeMessage>) => {
        this.listeners.forEach((fn) => fn(event.data));
      };
    }
    // 兜底：隐私模式无 BroadcastChannel 时用 storage 事件
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('storage', (e) => {
        if (e.key !== 'gbmeteorite:change-tick' || !e.newValue) return;
        try {
          const msg = JSON.parse(e.newValue) as DataChangeMessage;
          this.listeners.forEach((fn) => fn(msg));
        } catch {
          /* ignore */
        }
      });
    }
  }

  post(msg: Omit<DataChangeMessage, 'at'>): void {
    const full: DataChangeMessage = { ...msg, at: Date.now() };
    if (this.channel) this.channel.postMessage(full);
    // storage 事件兜底（同页不触发，跨页触发）
    try {
      localStorage.setItem('gbmeteorite:change-tick', JSON.stringify(full));
    } catch {
      /* ignore */
    }
  }

  subscribe(fn: (msg: DataChangeMessage) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export const dataChangeBus = new DataChangeBus();
