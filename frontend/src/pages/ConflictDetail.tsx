import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Radio,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import RefreshIcon from '@mui/icons-material/Refresh';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import OccupancyPanel from '../components/common/OccupancyPanel';
import EmptyState from '../components/common/EmptyState';
import { useSampleStore } from '../stores/sampleStore';
import { useToastStore } from '../stores/uiStore';
import type { ConflictSide } from '../types/sync';
import {
  FALL_OR_FIND_LABELS,
  STORAGE_LABELS,
  STORAGE_LOCATIONS,
  WEATHERING_LABELS,
  type StorageLocation,
} from '../types/sample';
import { formatWeight } from '../utils/format';
import { formatCoordinate } from '../utils/geo';
import { FIND_ENVIRONMENT_LABELS } from '../types/find';
import { ConflictStaleError, resolveConflict } from '../utils/reconcile';
import { checkCapacity } from '../utils/capacity';
import { dataChangeBus } from '../utils/syncBus';
import { getSessionId } from '../utils/session';

const DRAFT_PREFIX = 'gbmeteorite:conflict-draft:';

/** `/sync/conflicts/:id` 冲突裁决 */
export default function ConflictDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const samples = useSampleStore((s) => s.samples);
  const finds = useSampleStore((s) => s.finds);
  const sections = useSampleStore((s) => s.sections);
  const analysis = useSampleStore((s) => s.analysis);
  const conflicts = useSampleStore((s) => s.conflicts);
  const refreshSyncState = useSampleStore((s) => s.refreshSyncState);
  const notify = useToastStore((s) => s.notify);

  const conflict = conflicts.find((c) => c.id === id);
  const local = conflict ? samples.find((s) => s.id === conflict.localSampleId) : undefined;
  const incoming = conflict ? samples.find((s) => s.id === conflict.incomingSampleId) : undefined;

  // 裁决选择草稿：先从 localStorage 恢复；并发失败时也保留此草稿
  const draftKey = DRAFT_PREFIX + id;
  const [winner, setWinner] = useState<ConflictSide>(() => {
    const saved = localStorage.getItem(draftKey);
    return saved === 'incoming' ? 'incoming' : 'local';
  });
  const [storageOverride, setStorageOverride] = useState<StorageLocation | ''>('');
  const [staleError, setStaleError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 其他标签页先确认了本冲突 → 本页进入“重载”态（草稿保留）
  useEffect(() => {
    const check = () => {
      void refreshSyncState();
    };
    const unsub = dataChangeBus.subscribe((msg) => {
      check();
      if (msg.kind === 'resolve-conflict' && msg.conflictId === id) setStaleError(true);
    });
    return unsub;
  }, [id, refreshSyncState]);

  const resolvedByOtherTab = conflict?.status === 'resolved' || !local || !incoming;
  useEffect(() => {
    if (resolvedByOtherTab && conflict) setStaleError(true);
  }, [resolvedByOtherTab, conflict]);

  const winnerSample = winner === 'local' ? local : incoming;
  const targetStorage: StorageLocation | '' = storageOverride || winnerSample?.storage || '';

  const capacityWarning = useMemo(() => {
    if (!winnerSample || !targetStorage) return null;
    return checkCapacity(
      samples.filter((s) => s.id !== local?.id && s.id !== incoming?.id),
      targetStorage as StorageLocation,
      winnerSample.totalWeight,
    );
  }, [samples, local, incoming, winnerSample, targetStorage]);

  if (!conflict) {
    return (
      <EmptyState
        title="未找到该冲突单"
        description="冲突可能已在另一个标签页被裁决，或链接失效。"
        actionLabel="返回对账台"
        actionTo="/sync"
      />
    );
  }

  const childrenOf = (sampleId: string) => ({
    find: finds.find((f) => f.sampleId === sampleId),
    sectionCount: sections.filter((s) => s.sampleId === sampleId).length,
    analysisCount: analysis.filter((a) => a.sampleId === sampleId).length,
  });

  const choose = (side: ConflictSide) => {
    setWinner(side);
    setStaleError(false);
    setError(null);
    // 草稿即时落盘：并发被拒后草稿仍在
    localStorage.setItem(draftKey, side);
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const winning = await resolveConflict(
        id,
        winner,
        getSessionId(),
        storageOverride || undefined,
      );
      localStorage.removeItem(draftKey);
      await refreshSyncState();
      dataChangeBus.post({
        kind: 'resolve-conflict',
        conflictId: id,
        sessionId: getSessionId(),
      });
      notify(`已按「${winner === 'local' ? '本机' : '样本包'}」裁决 ${conflict.sampleNo}`);
      navigate(`/samples/${winning.id}`);
    } catch (err) {
      if (err instanceof ConflictStaleError) {
        // 后确认的一页：保留草稿，提示重载，不覆盖先确认结果
        setStaleError(true);
        localStorage.setItem(draftKey, winner);
        await refreshSyncState();
        notify('该冲突已被另一个标签页先确认，本页选择已保留为草稿', 'error');
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Stack spacing={2.5}>
      <Stack direction="row" spacing={1.5} alignItems="center">
        <Button component={RouterLink} to="/sync" startIcon={<ArrowBackIcon />} variant="text">
          返回对账台
        </Button>
        <Typography variant="h4">冲突裁决</Typography>
        <Chip label={conflict.sampleNo} color="warning" />
      </Stack>

      {staleError && resolvedByOtherTab ? (
        <Alert
          severity="error"
          action={
            <Button
              color="inherit"
              size="small"
              startIcon={<RefreshIcon />}
              onClick={() => window.location.reload()}
            >
              重载
            </Button>
          }
        >
          该冲突已被另一个标签页先确认，本页的选择已保留为草稿（{winner === 'local' ? '本机' : '样本包'}
          ），不会覆盖先确认结果。请点重载查看最新数据。
        </Alert>
      ) : null}
      {error ? <Alert severity="error">{error}</Alert> : null}
      {capacityWarning && !resolvedByOtherTab ? (
        <Alert severity="warning">
          {capacityWarning}。可在下方改放其他柜位后再确认，否则两条记录将继续待裁决。
        </Alert>
      ) : null}

      {local && incoming ? (
        <Grid container spacing={2.5}>
          <Grid item xs={12} md={6}>
            <ConflictCard
              title="本机在档"
              sample={local}
              selected={winner === 'local'}
              disabled={!!resolvedByOtherTab}
              onSelect={() => choose('local')}
              diffFields={new Set(conflict.diffs.map((d) => d.field))}
              {...childrenOf(local.id)}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <ConflictCard
              title="离线样本包"
              sample={incoming}
              selected={winner === 'incoming'}
              disabled={!!resolvedByOtherTab}
              onSelect={() => choose('incoming')}
              diffFields={new Set(conflict.diffs.map((d) => d.field))}
              {...childrenOf(incoming.id)}
            />
          </Grid>
        </Grid>
      ) : (
        <Alert severity="info">冲突已解决，正在刷新……</Alert>
      )}

      {local && incoming && !resolvedByOtherTab ? (
        <Paper variant="outlined" sx={{ p: 2.5 }}>
          <Stack spacing={2}>
            <Typography variant="subtitle1" fontWeight={700}>
              确认裁决
            </Typography>
            <Typography variant="body2" color="text.secondary">
              选中的一条恢复在档（版本戳 +1，其切片与分析跟随新版本），另一条及其独有记录将被移除；
              两条记录在裁决前均不进入样本总览与发现地地图。
            </Typography>
            <FormControl size="small" sx={{ minWidth: 260 }}>
              <InputLabel id="conflict-storage-label">落位柜位（超重时可改放）</InputLabel>
              <Select
                labelId="conflict-storage-label"
                label="落位柜位（超重时可改放）"
                value={targetStorage}
                onChange={(e) => setStorageOverride(e.target.value as StorageLocation)}
              >
                {STORAGE_LOCATIONS.map((loc) => (
                  <MenuItem key={loc} value={loc}>
                    {STORAGE_LABELS[loc]}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Box>
              <Button
                variant="contained"
                color="primary"
                onClick={() => void submit()}
                disabled={submitting || !!capacityWarning}
                id="confirm-conflict"
              >
                确认保留「{winner === 'local' ? '本机' : '样本包'}」
              </Button>
            </Box>
          </Stack>
        </Paper>
      ) : null}

      <Paper variant="outlined" sx={{ p: 2.5, maxWidth: 520 }}>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          当前柜架占用
        </Typography>
        <OccupancyPanel samples={samples} highlightStorage={targetStorage || undefined} />
      </Paper>
    </Stack>
  );
}

function ConflictCard({
  title,
  sample,
  find,
  sectionCount,
  analysisCount,
  selected,
  disabled,
  onSelect,
  diffFields,
}: {
  title: string;
  sample: import('../types/sample').MeteoriteSample;
  find?: import('../types/find').FindRecord;
  sectionCount: number;
  analysisCount: number;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  diffFields: Set<string>;
}) {
  return (
    <Paper
      variant="outlined"
      onClick={disabled ? undefined : onSelect}
      sx={{
        p: 2.5,
        height: '100%',
        cursor: disabled ? 'default' : 'pointer',
        borderColor: selected ? 'primary.main' : 'divider',
        borderWidth: selected ? 2 : 1,
        bgcolor: selected ? 'rgba(75,63,47,0.05)' : 'background.paper',
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1}>
        <Radio checked={selected} onChange={onSelect} disabled={disabled} />
        <Typography variant="h6">{title}</Typography>
        <Chip size="small" label={`v${sample.version}`} variant="outlined" />
      </Stack>
      <Divider sx={{ my: 1.5 }} />
      <Stack spacing={1}>
        <Row
          label="重量"
          value={formatWeight(sample.totalWeight)}
          highlight={diffFields.has('totalWeight')}
        />
        <Row label="存放位置" value={STORAGE_LABELS[sample.storage]} highlight={diffFields.has('storage')} />
        <Row label="分类" value={`${sample.category} · ${sample.chemicalGroup}`} />
        <Row label="风化" value={WEATHERING_LABELS[sample.weathering]} />
        <Row label="发现/坠落" value={FALL_OR_FIND_LABELS[sample.fallOrFind]} />
        <Row
          label="发现地"
          value={
            find
              ? `${find.region} · ${find.placeName} · ${formatCoordinate(find.longitude, find.latitude)} · ${
                  FIND_ENVIRONMENT_LABELS[find.environment]
                }`
              : '未登记'
          }
          highlight={diffFields.has('findLocation')}
        />
        <Stack direction="row" spacing={1}>
          <Chip size="small" label={`切片 ${sectionCount}`} variant="outlined" />
          <Chip size="small" label={`分析 ${analysisCount}`} variant="outlined" />
        </Stack>
      </Stack>
    </Paper>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <Stack direction="row" spacing={1} alignItems="baseline">
      <Typography variant="caption" color="text.secondary" sx={{ width: 72, flexShrink: 0 }}>
        {label}
      </Typography>
      <Typography variant="body2" fontWeight={highlight ? 700 : 400} color={highlight ? 'warning.dark' : 'text.primary'}>
        {value}
      </Typography>
      {highlight ? <Chip size="small" color="warning" label="不一致" /> : null}
    </Stack>
  );
}
