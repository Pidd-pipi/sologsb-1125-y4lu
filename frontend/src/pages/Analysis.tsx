import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  FormControl,
  Grid,
  InputLabel,
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
import SaveIcon from '@mui/icons-material/Save';
import EmptyState from '../components/common/EmptyState';
import ClassificationBadge from '../components/common/Badge';
import FieldGroup from '../components/common/FieldGroup';
import { useLocalDraft } from '../hooks/useLocalDraft';
import { useSampleStore } from '../stores/sampleStore';
import { useToastStore } from '../stores/uiStore';
import {
  ANALYSIS_METHODS,
  ANALYSIS_METHOD_LABELS,
  ANALYSIS_TARGETS,
  ANALYSIS_TARGET_LABELS,
  type AnalysisMethod,
  type AnalysisTarget,
} from '../types/analysis';
import { classifyByAnalysis, evaluateThresholds } from '../utils/classify';
import { formatDate } from '../utils/format';

interface AnalysisDraft {
  sampleId: string;
  sectionId: string;
  target: AnalysisTarget;
  method: AnalysisMethod;
  fa: number;
  fs: number;
  ni: number;
  kamaciteBandwidth: number;
  testedAt: string;
}

/** `/analysis` 分析检测录入 */
export default function Analysis() {
  const samples = useSampleStore((s) => s.samples);
  const sections = useSampleStore((s) => s.sections);
  const analysis = useSampleStore((s) => s.analysis);
  const addAnalysis = useSampleStore((s) => s.addAnalysis);
  const notify = useToastStore((s) => s.notify);

  const initial = useMemo<AnalysisDraft>(
    () => ({
      sampleId: '',
      sectionId: '',
      target: 'sample',
      method: 'microprobe',
      fa: 18.5,
      fs: 16,
      ni: 0.8,
      kamaciteBandwidth: 0.05,
      testedAt: new Date().toISOString().slice(0, 10),
    }),
    [],
  );

  const { value, patch, reset, clear, restored } = useLocalDraft<AnalysisDraft>('analysis-entry', initial);
  const [error, setError] = useState<string | null>(null);

  const sampleSections = useMemo(
    () => sections.filter((s) => s.sampleId === value.sampleId),
    [sections, value.sampleId],
  );

  const hits = evaluateThresholds(value);
  const advice = classifyByAnalysis(value);
  const outOfRange = hits.filter((h) => !h.inRange);

  const submit = async () => {
    if (!value.sampleId) {
      setError('请先选择关联样本');
      return;
    }
    if (value.target === 'section' && !value.sectionId) {
      setError('检测对象为切片时必须选择一张切片');
      return;
    }
    setError(null);
    await addAnalysis({
      sampleId: value.sampleId,
      sectionId: value.target === 'section' ? value.sectionId : undefined,
      target: value.target,
      method: value.method,
      fa: Number(value.fa),
      fs: Number(value.fs),
      ni: Number(value.ni),
      kamaciteBandwidth: Number(value.kamaciteBandwidth),
      testedAt: value.testedAt,
    });
    clear();
    notify('检测记录已写入本地库');
    patch({ fa: 18.5, fs: 16, ni: 0.8, kamaciteBandwidth: 0.05 });
  };

  return (
    <Stack spacing={2.5}>
      <Box>
        <Typography variant="h4">分析检测</Typography>
        <Typography variant="body2" color="text.secondary">
          录入 Fa / Fs / Ni / 铁纹石带宽，右侧实时给出分类建议与阈值命中说明。
        </Typography>
      </Box>

      {restored ? (
        <Alert severity="info">已从本地草稿恢复上次未提交的检测录入（localStorage 草稿键 analysis-entry）。</Alert>
      ) : null}
      {error ? <Alert severity="error">{error}</Alert> : null}

      <Grid container spacing={2.5}>
        <Grid item xs={12} md={7}>
          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <Stack spacing={2}>
              <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                <FormControl size="small" sx={{ minWidth: 220 }}>
                  <InputLabel id="analysis-sample-label">关联样本</InputLabel>
                  <Select
                    labelId="analysis-sample-label"
                    label="关联样本"
                    value={value.sampleId}
                    onChange={(e) => patch({ sampleId: e.target.value, sectionId: '' })}
                  >
                    {samples.map((s) => (
                      <MenuItem key={s.id} value={s.id}>
                        {s.sampleNo}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl size="small" sx={{ minWidth: 150 }}>
                  <InputLabel id="analysis-target-label">检测对象</InputLabel>
                  <Select
                    labelId="analysis-target-label"
                    label="检测对象"
                    value={value.target}
                    onChange={(e) => patch({ target: e.target.value as AnalysisTarget })}
                  >
                    {ANALYSIS_TARGETS.map((t) => (
                      <MenuItem key={t} value={t}>
                        {ANALYSIS_TARGET_LABELS[t]}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                {value.target === 'section' ? (
                  <FormControl size="small" sx={{ minWidth: 180 }}>
                    <InputLabel id="analysis-section-label">关联切片</InputLabel>
                    <Select
                      labelId="analysis-section-label"
                      label="关联切片"
                      value={value.sectionId}
                      onChange={(e) => patch({ sectionId: e.target.value })}
                    >
                      {sampleSections.length === 0 ? (
                        <MenuItem value="" disabled>
                          该样本暂无切片
                        </MenuItem>
                      ) : null}
                      {sampleSections.map((s) => (
                        <MenuItem key={s.id} value={s.id}>
                          {s.sectionNo}（{s.thickness} μm）
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                ) : null}
                <FormControl size="small" sx={{ minWidth: 150 }}>
                  <InputLabel id="analysis-method-label">方法</InputLabel>
                  <Select
                    labelId="analysis-method-label"
                    label="方法"
                    value={value.method}
                    onChange={(e) => patch({ method: e.target.value as AnalysisMethod })}
                  >
                    {ANALYSIS_METHODS.map((m) => (
                      <MenuItem key={m} value={m}>
                        {ANALYSIS_METHOD_LABELS[m]}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <TextField
                  id="analysis-tested-at"
                  size="small"
                  type="date"
                  label="检测日期"
                  InputLabelProps={{ shrink: true }}
                  value={value.testedAt}
                  onChange={(e) => patch({ testedAt: e.target.value })}
                  sx={{ width: 180 }}
                />
              </Stack>

              <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                <FieldGroup
                  title="橄榄石 Fa"
                  unit="mol%"
                  min={0}
                  max={30}
                  value={value.fa}
                  onChange={(v) => patch({ fa: v })}
                  inputId="analysis-fa"
                  label="Fa"
                  required
                />
                <FieldGroup
                  title="辉石 Fs"
                  unit="mol%"
                  min={0}
                  max={30}
                  value={value.fs}
                  onChange={(v) => patch({ fs: v })}
                  inputId="analysis-fs"
                  label="Fs"
                  required
                />
                <FieldGroup
                  title="Ni 含量"
                  unit="wt%"
                  min={0}
                  max={20}
                  value={value.ni}
                  onChange={(v) => patch({ ni: v })}
                  inputId="analysis-ni"
                  label="Ni"
                  required
                />
                <FieldGroup
                  title="铁纹石带宽"
                  unit="mm"
                  min={0}
                  max={2}
                  value={value.kamaciteBandwidth}
                  onChange={(v) => patch({ kamaciteBandwidth: v })}
                  inputId="analysis-band"
                  label="带宽"
                />
              </Stack>

              <Stack direction="row" spacing={1.5}>
                <Button variant="contained" startIcon={<SaveIcon />} onClick={submit} id="save-analysis">
                  保存检测记录
                </Button>
                <Button variant="outlined" onClick={reset}>
                  清空并重置草稿
                </Button>
              </Stack>
            </Stack>
          </Paper>
        </Grid>

        <Grid item xs={12} md={5}>
          <Stack spacing={2.5}>
            <Paper variant="outlined" sx={{ p: 2.5 }}>
              <Typography variant="h6" sx={{ mb: 1 }}>
                分类建议
              </Typography>
              <Stack spacing={1.25}>
                <ClassificationBadge category={advice.category} showGroup={false} />
                <Typography variant="body2">{advice.summary}</Typography>
                <Chip
                  size="small"
                  color={advice.confidence === 'high' ? 'success' : advice.confidence === 'medium' ? 'warning' : 'default'}
                  label={`置信度：${advice.confidence === 'high' ? '高' : advice.confidence === 'medium' ? '中' : '低'}`}
                  sx={{ alignSelf: 'flex-start' }}
                />
                <Divider />
                <Typography variant="subtitle2">命中说明</Typography>
                <List dense disablePadding>
                  {advice.hits.map((h) => (
                    <ListItem key={h} disableGutters>
                      <ListItemText primary={h} primaryTypographyProps={{ variant: 'body2' }} />
                    </ListItem>
                  ))}
                </List>
              </Stack>
            </Paper>

            <Paper variant="outlined" sx={{ p: 2.5 }}>
              <Typography variant="h6" sx={{ mb: 1 }}>
                阈值命中
              </Typography>
              <Stack spacing={1}>
                {hits.map((h) => (
                  <Box
                    key={h.key}
                    sx={{
                      p: 1.25,
                      borderRadius: 1.5,
                      border: '1px solid',
                      borderColor: h.inRange ? 'divider' : 'warning.main',
                      bgcolor: h.inRange ? 'transparent' : 'rgba(237,108,2,0.06)',
                    }}
                  >
                    <Stack direction="row" justifyContent="space-between">
                      <Typography variant="subtitle2">{h.label}</Typography>
                      <Chip
                        size="small"
                        color={h.inRange ? 'success' : 'warning'}
                        label={`${h.value} ${h.unit}`}
                      />
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      {h.description}
                    </Typography>
                  </Box>
                ))}
                {outOfRange.length ? (
                  <Alert severity="warning">
                    {outOfRange.length} 项超出常规阈值，建议复核制样或补测。
                  </Alert>
                ) : (
                  <Alert severity="success">全部数值落在常规阈值内。</Alert>
                )}
              </Stack>
            </Paper>
          </Stack>
        </Grid>
      </Grid>

      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Typography variant="h6" sx={{ mb: 1.5 }}>
          已录入检测记录（{analysis.length}）
        </Typography>
        {analysis.length === 0 ? (
          <EmptyState
            title="还没有检测记录"
            description="在上方选择样本、填写 Fa / Fs / Ni 与铁纹石带宽后保存。"
            actionLabel="去登记样本"
            actionTo="/samples/new"
          />
        ) : (
          <Stack spacing={1}>
            {analysis.slice(0, 12).map((a) => {
              const s = samples.find((x) => x.id === a.sampleId);
              const ev = classifyByAnalysis(a);
              return (
                <Box
                  key={a.id}
                  sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1.5 }}
                >
                  <Stack direction="row" justifyContent="space-between" flexWrap="wrap" gap={1}>
                    <Typography variant="subtitle2">
                      {s ? s.sampleNo : '未知样本'} · {ANALYSIS_METHOD_LABELS[a.method]} ·{' '}
                      {formatDate(a.testedAt)}
                    </Typography>
                    <ClassificationBadge category={ev.category} showGroup={false} />
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    Fa {a.fa} mol% · Fs {a.fs} mol% · Ni {a.ni} wt% · 带宽 {a.kamaciteBandwidth} mm ——{' '}
                    {ev.summary}
                  </Typography>
                </Box>
              );
            })}
          </Stack>
        )}
      </Paper>
    </Stack>
  );
}
