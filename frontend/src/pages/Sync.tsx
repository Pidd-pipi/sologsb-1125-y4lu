import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Grid,
  LinearProgress,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import DownloadIcon from '@mui/icons-material/Download';
import GppMaybeIcon from '@mui/icons-material/GppMaybe';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import SaveIcon from '@mui/icons-material/Save';
import {
  STORAGE_LABELS,
  STORAGE_LOCATIONS,
  type MeteoriteSample,
  type StorageLocation,
} from '../types/sample';
import {
  CapacityError,
  StaleConflictError,
  useSampleStore,
} from '../stores/sampleStore';
import { useToastStore } from '../stores/uiStore';
import { calcOccupancy } from '../utils/occupancy';
import { downloadJsonFile } from '../utils/sync';
import type { ConflictField, ConflictRecord, ImportBatch } from '../types/sync';
import { subscribeCatalog } from '../utils/station';
import { formatDate, formatWeight } from '../utils/format';
import type { FindEnvironment, FindRecord } from '../types/find';
import { FIND_ENVIRONMENT_LABELS } from '../types/find';
import { formatCoordinate } from '../utils/geo';
import type { ThinSection } from '../types/section';

/** `/sync` 离线样本包对账合并 */
export default function Sync() {
  const samples = useSampleStore((s) => s.samples);
  const finds = useSampleStore((s) => s.finds);
  const sections = useSampleStore((s) => s.sections);
  const analysis = useSampleStore((s) => s.analysis);
  const conflicts = useSampleStore((s) => s.conflicts);
  const batches = useSampleStore((s) => s.batches);
  const loadAll = useSampleStore((s) => s.loadAll);
  const importPackage = useSampleStore((s) => s.importPackage);
  const retryBatch = useSampleStore((s) => s.retryBatch);
  const removeBatch = useSampleStore((s) => s.removeBatch);
  const replaceBatchPayload = useSampleStore((s) => s.replaceBatchPayload);
  const resolveConflict = useSampleStore((s) => s.resolveConflict);
  const exportPackage = useSampleStore((s) => s.exportPackage);
  const notify = useToastStore((s) => s.notify);

  const [busy, setBusy] = useState(false);
  const [importErrors, setImportErrors] = useState<string[] | null>(null);
  const [staleNotice, setStaleNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // 失败包修正草稿：batchId -> 样本编号 -> 新柜位 / 新重量
  const [batchEdits, setBatchEdits] = useState<
    Record<string, Record<string, { storage: StorageLocation; totalWeight: number }>>
  >({});
  // 冲突裁决草稿：选择后若被别页抢先，本页草稿保留并提示重载
  const [conflictDrafts, setConflictDrafts] = useState<
    Record<string, 'keep-local' | 'keep-incoming'>
  >({});
  const draftsRef = useRef(conflictDrafts);
  draftsRef.current = conflictDrafts;
  const [busyConflictId, setBusyConflictId] = useState<string | null>(null);
  const [conflictErrors, setConflictErrors] = useState<Record<string, string>>({});

  const occupancy = useMemo(() => calcOccupancy(samples), [samples]);
  const pendingConflicts = conflicts.filter((c) => c.status === 'pending');
  const failedBatches = batches.filter((b) => b.status === 'failed');

  // 其他标签页完成裁决 / 导入后本页刷新；本页留有该冲突草稿时提示重载
  useEffect(() => {
    const unsub = subscribeCatalog((msg) => {
      if (msg.type === 'data-changed' || msg.type === 'import-completed') {
        void loadAll();
      }
      if (msg.type === 'conflict-resolved') {
        if (draftsRef.current[msg.conflictId]) {
          setStaleNotice(
            '另一标签页已先完成该冲突确认，你的裁决草稿已保留但不会覆盖先确认结果，请重载查看最新状态。',
          );
        }
        void loadAll();
      }
    });
    return unsub;
  }, [loadAll]);

  // 注：冲突被别页裁决后，本页 conflictDrafts 中的选择故意保留（“后确认页保留草稿”），
  // 仅提示重载，不做覆盖。

  const onFile = async (file: File) => {
    setBusy(true);
    setImportErrors(null);
    try {
      const raw = JSON.parse(await file.text()) as unknown;
      const res = await importPackage(file.name, raw);
      if (res.ok) {
        const p = res.plan;
        notify(
          `对账完成：单边新增 ${p?.directAddCount ?? 0} 份，跟进 ${p?.fastForwardCount ?? 0} 份，并子记录 ${p?.childMergeCount ?? 0} 条，待裁决 ${p?.conflictCount ?? 0} 条`,
          p?.conflictCount ? 'warning' : 'success',
        );
      } else {
        setImportErrors(res.errors);
      }
    } catch (err) {
      setImportErrors([err instanceof Error ? err.message : '文件解析失败']);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const onExport = () => {
    const pkg = exportPackage();
    downloadJsonFile(pkg, `gbmeteorite-package-${new Date().toISOString().slice(0, 10)}.json`);
    notify(`已导出 ${pkg.samples.length} 份样本（不含待裁决副本）`);
  };

  const editOf = (batchId: string, no: string, originalStorage: StorageLocation, originalWeight: number) =>
    batchEdits[batchId]?.[no] ?? { storage: originalStorage, totalWeight: originalWeight };

  const setEdit = (
    batchId: string,
    no: string,
    patch: Partial<{ storage: StorageLocation; totalWeight: number }>,
    originalStorage: StorageLocation,
    originalWeight: number,
  ) => {
    setBatchEdits((all) => {
      const cur = all[batchId]?.[no] ?? { storage: originalStorage, totalWeight: originalWeight };
      return {
        ...all,
        [batchId]: {
          ...all[batchId],
          [no]: {
            storage: patch.storage ?? cur.storage,
            totalWeight: patch.totalWeight ?? cur.totalWeight,
          },
        },
      };
    });
  };

  const doRetry = async (b: ImportBatch) => {
    setBusy(true);
    try {
      // 修正草稿随请求带上；被拒时草稿保留，可继续改后重试
      const res = await retryBatch(b.id, batchEdits[b.id] ?? {});
      if (res.ok) {
        setBatchEdits((all) => {
          const next = { ...all };
          delete next[b.id];
          return next;
        });
        setImportErrors(null);
        notify('失败包修正后重试成功，已并库');
      } else {
        setImportErrors(res.errors);
        notify('重试仍被拒绝，修正草稿已保留', 'warning');
      }
    } catch (err) {
      setImportErrors([err instanceof Error ? err.message : '重试失败']);
    } finally {
      setBusy(false);
    }
  };

  const reuploadForBatch = async (b: ImportBatch, file: File) => {
    try {
      const raw = JSON.parse(await file.text());
      const { errors } = replaceBatchPayload(b.id, raw);
      if (errors.length) {
        setImportErrors(errors);
      } else {
        setImportErrors(null);
        notify('失败包内容已替换，可重试');
      }
    } catch (err) {
      setImportErrors([err instanceof Error ? err.message : '文件解析失败']);
    }
  };

  const chooseResolution = (id: string, r: 'keep-local' | 'keep-incoming') => {
    setConflictDrafts((d) => ({ ...d, [id]: r }));
    setConflictErrors((e) => ({ ...e, [id]: '' }));
  };

  const confirmResolution = async (c: ConflictRecord) => {
    const resolution = conflictDrafts[c.id];
    if (!resolution) {
      setConflictErrors((e) => ({ ...e, [c.id]: '请先选择保留本机还是采用离线' }));
      return;
    }
    setBusyConflictId(c.id);
    setConflictErrors((e) => ({ ...e, [c.id]: '' }));
    try {
      await resolveConflict(c.id, resolution);
      setConflictDrafts((d) => {
        const next = { ...d };
        delete next[c.id];
        return next;
      });
      notify(`冲突 ${c.sampleNo} 已裁决（${resolution === 'keep-local' ? '保留本机' : '采用离线'}）`);
    } catch (err) {
      if (err instanceof StaleConflictError) {
        // 后确认页：保留草稿、不覆盖先确认结果，提示重载
        setStaleNotice(err.message);
        setConflictErrors((e) => ({ ...e, [c.id]: err.message }));
      } else if (err instanceof CapacityError) {
        setConflictErrors((e) => ({ ...e, [c.id]: err.message }));
        notify('裁决被拒：柜架容量不足，冲突维持待裁决', 'warning');
      } else {
        setConflictErrors((e) => ({
          ...e,
          [c.id]: err instanceof Error ? err.message : '裁决失败',
        }));
      }
    } finally {
      setBusyConflictId(null);
    }
  };

  return (
    <Stack spacing={2.5}>
      <Box>
        <Typography variant="h4">离线样本包对账</Typography>
        <Typography variant="body2" color="text.secondary">
          编目台离线带回的样本包按「样本编号 + 版本戳」对账：单边新增直接并库；同编号重量 / 发现地 /
          存放位置不一致时两条挂起待裁决，总览与发现地地图暂不显示；柜架超重整包拒绝、原柜位不动，失败包可改柜位 /
          重量后重试。
        </Typography>
      </Box>

      {staleNotice ? (
        <Alert
          severity="warning"
          onClose={() => setStaleNotice(null)}
          action={
            <Button color="inherit" size="small" onClick={() => window.location.reload()}>
              立即重载
            </Button>
          }
        >
          {staleNotice}
        </Alert>
      ) : null}
      {importErrors?.length ? (
        <Alert severity="error" onClose={() => setImportErrors(null)}>
          {importErrors.map((e) => (
            <div key={e}>{e}</div>
          ))}
        </Alert>
      ) : null}
      {busy ? <LinearProgress /> : null}

      <Grid container spacing={2.5}>
        <Grid item xs={12} md={7}>
          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <Stack spacing={2}>
              <Typography variant="h6">导入样本包并对账</Typography>
              <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                <Button
                  variant="contained"
                  startIcon={<UploadFileIcon />}
                  onClick={() => fileRef.current?.click()}
                  disabled={busy}
                >
                  选择 .json 样本包
                </Button>
                <Button variant="outlined" startIcon={<DownloadIcon />} onClick={onExport}>
                  导出本机样本包
                </Button>
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
              </Stack>
              <Typography variant="caption" color="text.secondary">
                包格式 kind=gbmeteorite-sample-package；旧数据没有版本戳的按初次入库补 v1；待裁决样本不会被导出。
              </Typography>
              <Typography variant="body2" color="text.secondary">
                当前库：{samples.filter((s) => !s.pendingConflict).length} 份可见样本 ·{' '}
                {pendingConflicts.length} 个冲突挂起 · {failedBatches.length} 个失败包。
              </Typography>
            </Stack>
          </Paper>

          <Paper variant="outlined" sx={{ p: 2.5, mt: 2.5 }}>
            <Typography variant="h6" sx={{ mb: 1.5 }}>
              失败包（{failedBatches.length}）
            </Typography>
            {failedBatches.length === 0 ? (
              <Alert severity="success">暂无失败包。容量不足时整包原样保留在此，原柜位不会被占用。</Alert>
            ) : (
              <Stack spacing={2}>
                {failedBatches.map((b) => (
                  <FailedBatchCard
                    key={b.id}
                    batch={b}
                    busy={busy}
                    editOf={(no, origStorage, origWeight) => editOf(b.id, no, origStorage, origWeight)}
                    onEdit={(no, patch, origStorage, origWeight) =>
                      setEdit(b.id, no, patch, origStorage, origWeight)
                    }
                    onRetry={() => void doRetry(b)}
                    onRemove={() => void removeBatch(b.id)}
                    onReupload={(f) => void reuploadForBatch(b, f)}
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
            <Stack spacing={1.25}>
              {occupancy.map((o) => {
                const pct = o.capacityGrams ? Math.min(100, (o.usedGrams / o.capacityGrams) * 100) : 0;
                const over = o.capacityGrams !== null && o.usedGrams > o.capacityGrams;
                return (
                  <Box key={o.storage}>
                    <Stack direction="row" justifyContent="space-between">
                      <Typography variant="subtitle2">{STORAGE_LABELS[o.storage]}</Typography>
                      <Typography variant="caption" color={over ? 'error.main' : 'text.secondary'}>
                        {formatWeight(o.usedGrams)} /{' '}
                        {o.capacityGrams === null ? '不限' : formatWeight(o.capacityGrams)}（{o.sampleCount} 份）
                      </Typography>
                    </Stack>
                    <LinearProgress
                      variant="determinate"
                      value={o.capacityGrams === null ? 0 : Math.min(100, pct)}
                      color={over ? 'error' : pct > 85 ? 'warning' : 'success'}
                      sx={{ height: 8, borderRadius: 4, mt: 0.5 }}
                    />
                  </Box>
                );
              })}
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              待裁决样本暂不计入；重量或柜位一变，占用立即重算。
            </Typography>
          </Paper>

          <Paper variant="outlined" sx={{ p: 2.5, mt: 2.5 }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <GppMaybeIcon color="warning" />
              <Typography variant="h6">待裁决冲突（{pendingConflicts.length}）</Typography>
            </Stack>
            {pendingConflicts.length === 0 ? (
              <Alert severity="success" sx={{ mt: 1.5 }}>
                没有待裁决冲突。冲突存在期间，两条样本都从总览与发现地地图隐藏。
              </Alert>
            ) : (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                两个标签页同时确认时，后确认页保留草稿并提示重载，不覆盖先确认结果。下方逐条裁决：
              </Typography>
            )}
          </Paper>
        </Grid>
      </Grid>

      {pendingConflicts.length ? (
        <Stack spacing={2}>
          {pendingConflicts.map((c) => (
            <ConflictCard
              key={c.id}
              conflict={c}
              localSample={samples.find((s) => s.id === c.localSampleId)}
              incomingSample={samples.find((s) => s.id === c.incomingSampleId)}
              localFind={finds.find((f) => f.sampleId === c.localSampleId) ?? null}
              incomingFind={finds.find((f) => f.sampleId === c.incomingSampleId) ?? null}
              localSections={sections.filter((s) => s.sampleId === c.localSampleId)}
              incomingSections={sections.filter((s) => s.sampleId === c.incomingSampleId)}
              localAnalysisCount={analysis.filter((a) => a.sampleId === c.localSampleId).length}
              incomingAnalysisCount={analysis.filter((a) => a.sampleId === c.incomingSampleId).length}
              draft={conflictDrafts[c.id]}
              busy={busyConflictId === c.id}
              error={conflictErrors[c.id]}
              onChoose={(r) => chooseResolution(c.id, r)}
              onConfirm={() => void confirmResolution(c)}
            />
          ))}
        </Stack>
      ) : null}
    </Stack>
  );
}

interface FailedBatchCardProps {
  batch: ImportBatch;
  busy: boolean;
  editOf: (sampleNo: string, origStorage: StorageLocation, origWeight: number) => {
    storage: StorageLocation;
    totalWeight: number;
  };
  onEdit: (
    sampleNo: string,
    patch: Partial<{ storage: StorageLocation; totalWeight: number }>,
    origStorage: StorageLocation,
    origWeight: number,
  ) => void;
  onRetry: () => void;
  onRemove: () => void;
  onReupload: (file: File) => void;
}

function FailedBatchCard({
  batch,
  busy,
  editOf,
  onEdit,
  onRetry,
  onRemove,
  onReupload,
}: FailedBatchCardProps) {
  const reRef = useRef<HTMLInputElement | null>(null);
  const payloadSamples = batch.payload?.samples ?? [];
  return (
    <Paper variant="outlined" sx={{ p: 2, borderColor: 'warning.main' }}>
      <Stack spacing={1.5}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
          <Box>
            <Typography variant="subtitle1" fontWeight={700}>
              {batch.fileName}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              来源 {batch.stationId} · 失败于 {formatDate(batch.updatedAt)} · {payloadSamples.length} 份样本
            </Typography>
          </Box>
          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              startIcon={<RestartAltIcon />}
              variant="contained"
              onClick={onRetry}
              disabled={busy || !batch.payload}
            >
              修正后重试
            </Button>
            <Button size="small" startIcon={<UploadFileIcon />} onClick={() => reRef.current?.click()}>
              重新上传
            </Button>
            <Button size="small" color="inherit" startIcon={<DeleteOutlineIcon />} onClick={onRemove}>
              删除
            </Button>
            <input
              ref={reRef}
              type="file"
              accept="application/json,.json"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onReupload(f);
                if (reRef.current) reRef.current.value = '';
              }}
            />
          </Stack>
        </Stack>

        <List dense disablePadding>
          {batch.reasons.map((r) => (
            <ListItem key={r} sx={{ px: 0 }}>
              <ListItemText primary={r} primaryTypographyProps={{ variant: 'body2', color: 'error.main' }} />
            </ListItem>
          ))}
        </List>

        {payloadSamples.length ? (
          <Stack spacing={1}>
            <Typography variant="subtitle2">逐份修正（改柜位 / 重量）：</Typography>
            {payloadSamples.map((s) => {
              const ed = editOf(s.sampleNo, s.storage, s.totalWeight);
              return (
                <Stack
                  key={s.id}
                  direction="row"
                  spacing={1.5}
                  alignItems="center"
                  flexWrap="wrap"
                  useFlexGap
                  sx={{ p: 1, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}
                >
                  <Typography variant="body2" sx={{ minWidth: 140 }}>
                    {s.sampleNo}（v{s.version}）
                  </Typography>
                  <Select
                    size="small"
                    value={ed.storage}
                    sx={{ minWidth: 170 }}
                    onChange={(e) => onEdit(s.sampleNo, { storage: e.target.value as StorageLocation }, s.storage, s.totalWeight)}
                  >
                    {STORAGE_LOCATIONS.map((loc) => (
                      <MenuItem key={loc} value={loc}>
                        {STORAGE_LABELS[loc]}
                      </MenuItem>
                    ))}
                  </Select>
                  <TextField
                    size="small"
                    type="number"
                    label="重量 g"
                    value={ed.totalWeight}
                    sx={{ width: 130 }}
                    onChange={(e) =>
                      onEdit(s.sampleNo, { totalWeight: Number(e.target.value) }, s.storage, s.totalWeight)
                    }
                  />
                </Stack>
              );
            })}
          </Stack>
        ) : (
          <Alert severity="warning">原始包结构损坏无法解析，请点「重新上传」选择修正后的文件。</Alert>
        )}
      </Stack>
    </Paper>
  );
}

interface ConflictCardProps {
  conflict: ConflictRecord;
  localSample?: MeteoriteSample;
  incomingSample?: MeteoriteSample;
  localFind: FindRecord | null;
  incomingFind: FindRecord | null;
  localSections: ThinSection[];
  incomingSections: ThinSection[];
  localAnalysisCount: number;
  incomingAnalysisCount: number;
  draft?: 'keep-local' | 'keep-incoming';
  busy: boolean;
  error?: string;
  onChoose: (r: 'keep-local' | 'keep-incoming') => void;
  onConfirm: () => void;
}

const FIELD_LABELS: Record<ConflictField, string> = {
  totalWeight: '重量',
  find: '发现地',
  storage: '存放位置',
};

function ConflictCard({
  conflict,
  localSample,
  incomingSample,
  localFind,
  incomingFind,
  localSections,
  incomingSections,
  localAnalysisCount,
  incomingAnalysisCount,
  draft,
  busy,
  error,
  onChoose,
  onConfirm,
}: ConflictCardProps) {
  return (
    <Paper variant="outlined" sx={{ p: 2.5, borderColor: 'warning.main' }}>
      <Stack spacing={2}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
          <Stack direction="row" spacing={1} alignItems="center">
            <GppMaybeIcon color="warning" />
            <Typography variant="h6">{conflict.sampleNo}</Typography>
            <Stack direction="row" spacing={0.5}>
              {conflict.fields.map((f) => (
                <Chip key={f} size="small" color="warning" label={`不一致：${FIELD_LABELS[f]}`} />
              ))}
            </Stack>
          </Stack>
          <Typography variant="caption" color="text.secondary">
            冲突建立 {formatDate(conflict.createdAt)} · 来源 {conflict.stationId}
          </Typography>
        </Stack>

        <Grid container spacing={2}>
          <Grid item xs={12} sm={6}>
            <ConflictSide
              title="本机记录"
              selected={draft === 'keep-local'}
              sample={localSample}
              find={localFind}
              sections={localSections}
              analysisCount={localAnalysisCount}
              onClick={() => onChoose('keep-local')}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <ConflictSide
              title="离线包记录"
              selected={draft === 'keep-incoming'}
              sample={incomingSample}
              find={incomingFind}
              sections={incomingSections}
              analysisCount={incomingAnalysisCount}
              onClick={() => onChoose('keep-incoming')}
            />
          </Grid>
        </Grid>

        {error ? <Alert severity="error">{error}</Alert> : null}
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Button variant="contained" startIcon={<SaveIcon />} disabled={!draft || busy} onClick={onConfirm}>
            {busy ? '提交中…' : '确认裁决'}
          </Button>
          <Typography variant="caption" color="text.secondary">
            未裁决前两条均不在总览 / 地图显示；裁决通过方重新计入柜架占用（超重会拒绝并维持待裁决）。
          </Typography>
        </Stack>
      </Stack>
    </Paper>
  );
}

function ConflictSide({
  title,
  selected,
  sample,
  find,
  sections,
  analysisCount,
  onClick,
}: {
  title: string;
  selected: boolean;
  sample?: MeteoriteSample;
  find: FindRecord | null;
  sections: ThinSection[];
  analysisCount: number;
  onClick: () => void;
}) {
  return (
    <Box
      onClick={onClick}
      sx={{
        p: 2,
        height: '100%',
        borderRadius: 2,
        border: '2px solid',
        borderColor: selected ? 'primary.main' : 'divider',
        bgcolor: selected ? 'rgba(75,63,47,0.06)' : 'background.paper',
        cursor: 'pointer',
      }}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="subtitle1" fontWeight={700}>
          {title}
        </Typography>
        <Chip size="small" color={selected ? 'primary' : 'default'} label={selected ? '已选择' : '点击选择'} />
      </Stack>
      {sample ? (
        <Stack spacing={0.5} sx={{ mt: 1 }}>
          <Typography variant="body2">版本戳：v{sample.version}</Typography>
          <Typography variant="body2">重量：{formatWeight(sample.totalWeight)}</Typography>
          <Typography variant="body2">存放：{STORAGE_LABELS[sample.storage]}</Typography>
          <Typography variant="body2">
            发现地：
            {find
              ? `${find.region} · ${find.placeName} · ${formatCoordinate(find.longitude, find.latitude)}（${FIND_ENVIRONMENT_LABELS[find.environment as FindEnvironment]}）`
              : '未登记'}
          </Typography>
          <Divider sx={{ my: 0.5 }} />
          <Typography variant="caption" color="text.secondary">
            切片 {sections.length} 张（{sections.map((s) => `${s.sectionNo}@v${s.sampleVersion}`).join('、') || '无'}）
          </Typography>
          <Typography variant="caption" color="text.secondary">
            分析记录 {analysisCount} 条
          </Typography>
        </Stack>
      ) : (
        <Alert severity="error" sx={{ mt: 1 }}>
          记录已丢失，请重载
        </Alert>
      )}
    </Box>
  );
}
