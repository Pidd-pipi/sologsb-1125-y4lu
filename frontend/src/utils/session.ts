/**
 * 本标签页会话 id：用于冲突裁决时记录“谁先确认”。
 * 每个标签页独立；localStorage 不用来跨页共享（多标签各自持有内存值）。
 */
export function getSessionId(): string {
  if (!sessionStorage.getItem('gbmeteorite:session')) {
    sessionStorage.setItem(
      'gbmeteorite:session',
      `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    );
  }
  return sessionStorage.getItem('gbmeteorite:session')!;
}
