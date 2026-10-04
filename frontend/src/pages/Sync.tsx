import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  FormControl,
  Grid,
  InputLabel,
  Link,
  MenuItem,
  Paper,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import DownloadIcon from '@mui/icons-material/Download';
import GavelIcon from '@mui/icons-material/Gavel';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import { Link as RouterLink } from 'react-router-dom';
import OccupancyPanel from '../components/common/OccupancyPanel';
import EmptyState from '../components/common/EmptyState';
import { useSampleStore } from '../stores/sampleStore';
import { useToastStore } from '../stores/uiStore';
import {
  IMPORT_FAILURE_LABELS,
  type ImportFailure,
  type MergeResult,
  type SamplePackage,
} from '../types/sync';
import { STORAGE_LABELS, STORAGE_LOCATIONS, type StorageLocation } from '../types/sample';
import { InvalidPackageError, buildPackage, parsePackage } from '../utils/package';
import { discardFailure, mergePackage, retryFailedEntry } from '../utils/reconcile';
import { dataChangeBus } from '../utils/syncBus';
import { getSessionId } from '../utils/session';
import { formatDate } from '../utils/format';
import { db, makeId } from '../db';

/** `/sync` 离线样本包对账台 */
export default function Sync() {
  const samples = useSampleStore((s) => s.samples);
  const finds = useSampleStore((s) => s.finds);
  const sections = useSampleStore((s) => s.sections);
  const analysis = useSampleStore((s) => s.analysis);
  const conflicts = useSampleStore((s) => s.conflicts);
  const failures = useSampleStore((s) => s.failures);
  const refreshSyncState = useSampleStore((s) => s.refreshSyncState);
  const notify = useToastStore((s) => s.notify);
  const fileRef = useRef<HTMLInputElement>(null);
  const [lastResult, setLastResult] = useState<MergeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [retryStorage, setRetryStorage] = useState<Record<string, StorageLocation>>({});

  const openConflicts = conflicts.filter((c) => c.status === 'open');

  // 其他标签页完成并库/裁决后刷新本页
  useEffect(() => {
    const unsub = dataChangeBus.subscribe(() => {
      void refreshSyncState();
    });
    return unsub;
  }, [refreshSyncState]);

  const onFile = async (file: File) => {
    setBusy(true);
    let parsed: SamplePackage | null = null;
    let parseError: string | null = null;
    try {
      parsed = parsePackage(JSON.parse(await file.text()));
    } catch (err) {
      parseError = err instanceof InvalidPackageError ? err.message : `文件解析失败：${String(err)}`;
    }

    if (parseError || !parsed) {
      // 整包非法：失败包原样保留，修正文件后重新导入
      await db.importFailures.add({
        id: makeId('failure'),
        packageName: file.name,
        reason: 'invalid-package',
        message: parseError ?? '未知错误',
        samples: [],
        finds: [],
        sections: [],
        analysis: [],
        createdAt: Date.now(),
      });
      await refreshSyncState();
      notify('样本包格式不合法，已记入失败清单', 'error');
      setBusy(false);
      return;
    }

    try {
      const result = await mergePackage(parsed, file.name);
      setLastResult(result);
      await refreshSyncState();
      dataChangeBus.post({ kind: 'merge', sessionId: getSessionId() });
      if (result.conflicts > 0) {
        notify(`并库完成：${result.conflicts} 条冲突待裁决，${result.rejected} 条被拒`, 'warning');
      } else if (result.rejected > 0) {
        notify(`并库完成：${result.rejected} 条入库被拒（容量/重复），已入失败清单`, 'warning');
      } else {
        notify(
          `并库完成：新增样本 ${result.mergedSamples}、切片 ${result.mergedSections}、分析 ${result.mergedAnalysis}`,
        );
      }
    } catch (err) {
      notify(`并库失败：${String(err)}`, 'error');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const onExport = () => {
    const pkg = buildPackage(samples, finds, sections, analysis);
    const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gbmeteorite-package-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    notify('已导出本机在档样本包（不含待裁决副本）');
  };

  const onRetry = async (failure: ImportFailure) => {
    setBusy(true);
    try {
      const override = retryStorage[failure.id];
      await retryFailedEntry(failure.id, override ? { storageOverride: override } : {});
      await refreshSyncState();
      dataChangeBus.post({ kind: 'retry-failure', sessionId: getSessionId() });
      notify('已按修正重新并库');
    } catch (err) {
      notify(String(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const onDiscard = async (failure: ImportFailure) => {
    await discardFailure(failure.id);
    await refreshSyncState();
    dataChangeBus.post({ kind: 'discard-failure', sessionId: getSessionId() });
    notify('已移除该失败记录', 'info');
  };

  return (
    <Stack spacing={2.5}>
      <Box>
        <Typography variant="h4">离线样本包对账</Typography>
        <Typography variant="body2" color="text.secondary">
          导入编目台离线带回的样本包，按样本编号 + 版本戳对账：单边新增直接并库；重量 /
          发现地 / 存放位置不一致时保留两条待裁决。容量不足拒绝入库并保留原柜位，失败包可修正后重试。
        </Typography>
      </Box>

      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onFile(f);
        }}
      />

      <Grid container spacing={2.5}>
        <Grid item xs={12} md={7}>
          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <Stack spacing={2}>
              <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                <Button
                  variant="contained"
                  startIcon={<UploadFileIcon />}
                  onClick={() => fileRef.current?.click()}
                  disabled={busy}
                  id="import-package"
                >
                  选择样本包并库
                </Button>
                <Button variant="outlined" startIcon={<DownloadIcon />} onClick={onExport}>
                  导出本机样本包
                </Button>
              </Stack>
              <Typography variant="caption" color="text.secondary">
                样本包为 JSON 文件（format = gbmeteorite-package）。旧数据没有版本戳的按初次入库补齐（v1）。
              </Typography>

              {lastResult ? (
                <Alert severity={lastResult.conflicts || lastResult.rejected ? 'warning' : 'success'}>
                  上次并库：新增样本 {lastResult.mergedSamples} · 发现地 {lastResult.mergedFinds} · 切片{' '}
                  {lastResult.mergedSections} · 分析 {lastResult.mergedAnalysis} · 冲突{' '}
                  {lastResult.conflicts} · 拒绝 {lastResult.rejected} · 旧版本 {lastResult.stale}
                </Alert>
              ) : null}
            </Stack>
          </Paper>

          <Paper variant="outlined" sx={{ p: 2.5, mt: 2.5 }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
              <GavelIcon color="action" />
              <Typography variant="h6">待裁决冲突（{openConflicts.length}）</Typography>
            </Stack>
            {openConflicts.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                暂无冲突。同编号重量 / 发现地 / 存放位置不一致时会在此列出，裁决前两条记录都不进总览与地图。
              </Typography>
            ) : (
              <Stack spacing={1.5}>
                {openConflicts.map((c) => (
                  <Paper
                    key={c.id}
                    variant="outlined"
                    sx={{ p: 1.5, borderColor: 'warning.light' }}
                  >
                    <Stack
                      direction="row"
                      justifyContent="space-between"
                      alignItems="center"
                      flexWrap="wrap"
                      gap={1}
                    >
                      <Typography variant="subtitle1" fontWeight={700}>
                        {c.sampleNo}
                      </Typography>
                      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                        {c.diffs.map((d) => (
                          <Chip key={d.field} size="small" color="warning" label={d.label} />
                        ))}
                      </Stack>
                      <Button
                        size="small"
                        variant="contained"
                        color="warning"
                        component={RouterLink}
                        to={`/sync/conflicts/${c.id}`}
                      >
                        去裁决
                      </Button>
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      {c.diffs.map((d) => `${d.label}：本机 ${d.local} ↔ 包内 ${d.incoming}`).join('；')}
                    </Typography>
                  </Paper>
                ))}
              </Stack>
            )}
          </Paper>

          <Paper variant="outlined" sx={{ p: 2.5, mt: 2.5 }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
              <ErrorOutlineIcon color="error" />
              <Typography variant="h6">失败包（{failures.length}）</Typography>
            </Stack>
            {failures.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                暂无失败记录。容量不足或重复冲突导致的拒绝会保留在此，修正后可重试。
              </Typography>
            ) : (
              <Stack spacing={1.5}>
                {failures.map((f) => (
                  <FailureRow
                    key={f.id}
                    failure={f}
                    busy={busy}
                    storage={retryStorage[f.id]}
                    onStorageChange={(v) => setRetryStorage((m) => ({ ...m, [f.id]: v }))}
                    onRetry={() => void onRetry(f)}
                    onDiscard={() => void onDiscard(f)}
                  />
                ))}
              </Stack>
            )}
          </Paper>
        </Grid>

        <Grid item xs={12} md={5}>
          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <Typography variant="h6" sx={{ mb: 1.5 }}>
              柜架占用
            </Typography>
            <OccupancyPanel samples={samples} />
            <Divider sx={{ my: 2 }} />
            <Typography variant="caption" color="text.secondary">
              容量只统计在档样本；待裁决副本不占柜。重量或柜位一变，占用立即重算；超重时入库被拒且原柜位保留。
            </Typography>
          </Paper>

          <Paper variant="outlined" sx={{ p: 2.5, mt: 2.5 }}>
            <Typography variant="h6" sx={{ mb: 1 }}>
              对账规则
            </Typography>
            <Box component="ul" sx={{ m: 0, pl: 2 }}>
              <li>
                <Typography variant="body2">单边新增直接并库（含本机刚补的切片与分析记录，按编号/自然键去重）。</Typography>
              </li>
              <li>
                <Typography variant="body2">同编号重量 / 发现地 / 存放位置不一致：保留两条 pending，总览与地图暂不显示。</Typography>
              </li>
              <li>
                <Typography variant="body2">切片与分析记录跟随所属样本版本戳；重量一变，分类建议与柜架占用立即失效重算。</Typography>
              </li>
              <li>
                <Typography variant="body2">两个标签页同时确认同一冲突：后确认页保留草稿并提示重载，不覆盖先确认结果。</Typography>
              </li>
            </Box>
          </Paper>
        </Grid>
      </Grid>

      {samples.length === 0 ? (
        <EmptyState title="本机档案为空" description="可先登记样本，或直接导入离线样本包。" />
      ) : null}
    </Stack>
  );
}

function FailureRow({
  failure,
  busy,
  storage,
  onStorageChange,
  onRetry,
  onDiscard,
}: {
  failure: ImportFailure;
  busy: boolean;
  storage?: StorageLocation;
  onStorageChange: (v: StorageLocation) => void;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  const canChangeStorage = failure.reason === 'capacity';
  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Stack spacing={1}>
        <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
          <Chip size="small" color="error" label={IMPORT_FAILURE_LABELS[failure.reason]} />
          <Typography variant="subtitle2">{failure.packageName}</Typography>
          <Typography variant="caption" color="text.secondary">
            {formatDate(failure.createdAt)}
          </Typography>
          {failure.samples.map((s) => (
            <Chip key={s.sampleNo} size="small" variant="outlined" label={s.sampleNo} />
          ))}
        </Stack>
        <Typography variant="body2" color="text.secondary">
          {failure.message}
        </Typography>
        {failure.reason === 'invalid-package' ? (
          <Typography variant="caption">整包结构不合法：请修正 JSON 文件后重新导入。</Typography>
        ) : (
          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
            {canChangeStorage ? (
              <FormControl size="small" sx={{ minWidth: 200 }}>
                <InputLabel>重试时改放柜位</InputLabel>
                <Select
                  label="重试时改放柜位"
                  value={storage ?? ''}
                  onChange={(e) => onStorageChange(e.target.value as StorageLocation)}
                >
                  <MenuItem value="">
                    <em>保持原柜位</em>
                  </MenuItem>
                  {STORAGE_LOCATIONS.map((loc) => (
                    <MenuItem key={loc} value={loc}>
                      {STORAGE_LABELS[loc]}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            ) : null}
            <Button size="small" variant="contained" disabled={busy} onClick={onRetry}>
              修正后重试
            </Button>
            <Button size="small" variant="text" color="inherit" onClick={onDiscard}>
              放弃
            </Button>
            {failure.reason === 'duplicate-conflict' && failure.conflictId ? (
              <Link
                component={RouterLink}
                to={`/sync/conflicts/${failure.conflictId}`}
                variant="caption"
              >
                前往裁决该冲突 →
              </Link>
            ) : null}
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}
