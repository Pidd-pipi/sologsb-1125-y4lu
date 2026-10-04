import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import EmptyState from '../components/common/EmptyState';
import ClassificationBadge from '../components/common/Badge';
import { useSampleFilter } from '../hooks/useSampleFilter';
import { useSampleStore } from '../stores/sampleStore';
import { useToastStore } from '../stores/uiStore';
import {
  MINERAL_KEYS,
  MINERAL_LABELS,
  PREPARATION_LABELS,
  SECTION_QUALITIES,
  SECTION_QUALITY_LABELS,
  mineralTotal,
  type SectionQuality,
} from '../types/section';
import { formatDate } from '../utils/format';

/** `/sections` 切片库 */
export default function Sections() {
  const sections = useSampleStore((s) => s.sections);
  const samples = useSampleStore((s) => s.samples);
  const updateSection = useSampleStore((s) => s.updateSection);
  const notify = useToastStore((s) => s.notify);
  const { results } = useSampleFilter();

  const [thicknessMin, setThicknessMin] = useState<number | null>(null);
  const [thicknessMax, setThicknessMax] = useState<number | null>(null);
  const [mineralKey, setMineralKey] = useState<(typeof MINERAL_KEYS)[number] | ''>('');
  const [mineralMin, setMineralMin] = useState<number | null>(null);
  const [selected, setSelected] = useState<string[]>([]);

  const sampleMap = useMemo(() => new Map(samples.map((s) => [s.id, s])), [samples]);
  const visibleSampleIds = useMemo(() => new Set(results.map((s) => s.id)), [results]);

  const filtered = useMemo(
    () =>
      sections.filter((s) => {
        if (!visibleSampleIds.has(s.sampleId)) return false;
        if (thicknessMin !== null && s.thickness < thicknessMin) return false;
        if (thicknessMax !== null && s.thickness > thicknessMax) return false;
        if (mineralKey && mineralMin !== null && s.minerals[mineralKey] < mineralMin) return false;
        return true;
      }),
    [sections, visibleSampleIds, thicknessMin, thicknessMax, mineralKey, mineralMin],
  );

  const toggle = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const bulkLabel = async (quality: SectionQuality) => {
    if (!selected.length) return;
    await Promise.all(selected.map((id) => updateSection(id, { quality })));
    notify(`已批量标注 ${selected.length} 张切片为「${SECTION_QUALITY_LABELS[quality]}」`);
    setSelected([]);
  };

  return (
    <Stack spacing={2.5}>
      <Box>
        <Typography variant="h4">切片库</Typography>
        <Typography variant="body2" color="text.secondary">
          按厚度与矿物占比检索切片，点击卡片回跳所属样本，支持勾选后批量标注质量。
        </Typography>
      </Box>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
          <TextField
            id="thickness-min"
            size="small"
            type="number"
            label="厚度 ≥ μm"
            value={thicknessMin ?? ''}
            onChange={(e) => setThicknessMin(e.target.value === '' ? null : Number(e.target.value))}
            sx={{ width: 140 }}
          />
          <TextField
            id="thickness-max"
            size="small"
            type="number"
            label="厚度 ≤ μm"
            value={thicknessMax ?? ''}
            onChange={(e) => setThicknessMax(e.target.value === '' ? null : Number(e.target.value))}
            sx={{ width: 140 }}
          />
          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel id="mineral-key-label">矿物占比</InputLabel>
            <Select
              labelId="mineral-key-label"
              label="矿物占比"
              value={mineralKey}
              onChange={(e) => setMineralKey(e.target.value as typeof mineralKey)}
            >
              <MenuItem value="">不限</MenuItem>
              {MINERAL_KEYS.map((k) => (
                <MenuItem key={k} value={k}>
                  {MINERAL_LABELS[k]}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            id="mineral-min"
            size="small"
            type="number"
            label="占比 ≥ %"
            value={mineralMin ?? ''}
            onChange={(e) => setMineralMin(e.target.value === '' ? null : Number(e.target.value))}
            sx={{ width: 130 }}
          />
          <Chip size="small" variant="outlined" label={`命中 ${filtered.length} / ${sections.length}`} />
          <Box sx={{ flex: 1 }} />
          {selected.length ? (
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="caption">已选 {selected.length} 张，批量标注：</Typography>
              {SECTION_QUALITIES.filter((q) => q !== 'unrated').map((q) => (
                <Button key={q} size="small" variant="outlined" onClick={() => void bulkLabel(q)}>
                  {SECTION_QUALITY_LABELS[q].split('（')[0]}
                </Button>
              ))}
            </Stack>
          ) : null}
        </Stack>
      </Paper>

      {filtered.length === 0 ? (
        <EmptyState
          title="没有符合条件的切片"
          description="可放宽厚度或矿物占比条件；切片需要在样本详情页就地新增。"
          actionLabel="去样本总览"
          actionTo="/"
        />
      ) : (
        <Grid container spacing={2}>
          {filtered.map((s) => {
            const sample = sampleMap.get(s.sampleId);
            const sum = mineralTotal(s.minerals);
            return (
              <Grid item xs={12} sm={6} md={4} key={s.id}>
                <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
                  <Stack spacing={1.25}>
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <Checkbox
                        size="small"
                        checked={selected.includes(s.id)}
                        onChange={() => toggle(s.id)}
                        inputProps={{ 'aria-label': `选择切片 ${s.sectionNo}` }}
                      />
                      <Typography variant="h6" fontWeight={700} sx={{ flex: 1 }}>
                        {s.sectionNo}
                      </Typography>
                      <Chip size="small" color="secondary" label={SECTION_QUALITY_LABELS[s.quality]} />
                    </Stack>

                    {sample ? (
                      <Stack spacing={0.5}>
                        <Typography
                          component={RouterLink}
                          to={`/samples/${sample.id}`}
                          variant="subtitle2"
                          sx={{ color: 'primary.main', textDecoration: 'none' }}
                        >
                          {sample.sampleNo} ↗
                        </Typography>
                        <ClassificationBadge
                          category={sample.category}
                          group={sample.chemicalGroup}
                        />
                      </Stack>
                    ) : (
                      <Alert severity="warning">关联样本已不存在</Alert>
                    )}

                    <Typography variant="body2" color="text.secondary">
                      厚度 {s.thickness} μm · {PREPARATION_LABELS[s.preparation]} · 登记 {formatDate(s.createdAt)}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      矿物：{MINERAL_KEYS.map((k) => `${MINERAL_LABELS[k]} ${s.minerals[k]}%`).join(' · ')}
                    </Typography>
                    <Typography variant="caption" color={sum === 100 ? 'success.main' : 'warning.main'}>
                      占比合计 {sum}%
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      显微照片：{s.micrographs.length ? s.micrographs.join('、') : '未上传'}
                    </Typography>
                  </Stack>
                </Paper>
              </Grid>
            );
          })}
        </Grid>
      )}
    </Stack>
  );
}
