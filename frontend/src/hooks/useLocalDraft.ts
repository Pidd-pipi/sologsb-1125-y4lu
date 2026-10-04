import { useCallback, useEffect, useRef, useState } from 'react';

const KEY_PREFIX = 'gbmeteorite:draft:';

/**
 * 表单草稿落 localStorage、切页恢复、提交后清理。
 * 被 /samples/new 与 /analysis 消费。
 */
export function useLocalDraft<T extends object>(draftKey: string, initialValue: T) {
  const storageKey = KEY_PREFIX + draftKey;
  const [value, setValue] = useState<T>(() => readDraft<T>(storageKey) ?? initialValue);
  const [restored, setRestored] = useState<boolean>(() => readDraft<T>(storageKey) !== null);
  const initialRef = useRef(initialValue);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      /* 隐私模式下写入失败时静默降级 */
    }
  }, [storageKey, value]);

  const patch = useCallback((p: Partial<T>) => {
    setValue((prev) => ({ ...prev, ...p }));
    setRestored(false);
  }, []);

  const reset = useCallback(() => {
    setValue(initialRef.current);
    setRestored(false);
    clearDraft(storageKey);
  }, [storageKey]);

  const clear = useCallback(() => {
    clearDraft(storageKey);
  }, [storageKey]);

  return { value, setValue, patch, reset, clear, restored, storageKey };
}

export function readDraft<T>(storageKey: string): T | null {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function clearDraft(storageKey: string): void {
  try {
    localStorage.removeItem(storageKey);
  } catch {
    /* ignore */
  }
}
