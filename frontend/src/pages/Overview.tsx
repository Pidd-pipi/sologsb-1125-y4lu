import { useMemo } from 'react';
import {
  Box,
  Button,
  Chip,
  FormControl,
  Grid,
  InputLabel,
  Link,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { Link as RouterLink } from 'react-router-dom';
import SampleCard from '../components/common/SampleCard';
import EmptyState from '../components/common/EmptyState';
import { useSampleFilter } from '../hooks/useSampleFilter';
import { useSampleStore } from '../stores/sampleStore';
import { useUiStore } from '../stores/uiStore';
import {
  CATEGORY_LABELS,
  CHEMICAL_GROUP_LABELS,
  SAMPLE_CATEGORIES,
  CHEMICAL_GROUPS,
} from '../types/sample';
import { formatWeight } from '../utils/format';

/** `/` 样本总览 */
export default function Overview() {
  const { results, total, activeCount } = useSampleFilter();
  const samples = useSampleStore((s) => s.samples);
  const finds = useSampleStore((s) => s.finds);
  const sections = useSampleStore((s) => s.sections);
  const analysis = useSampleStore((s) => s.analysis);
  const openConflicts = useSampleStore((s) => s.conflicts.filter((c) => c.status === 'open'));

  const ui = useUiStore();

  // 仅在档（active）样本参与总览统计与关联；待裁决副本暂不显示
  const activeSamples = useMemo(() => samples.filter((s) => s.status !== 'pending'), [samples]);
  const activeFinds = useMemo(
    () => finds.filter((f) => f.status !== 'pending' && activeSamples.some((s) => s.id === f.sampleId)),
    [finds, activeSamples],
  );
  const findBySample = useMemo(() => new Map(activeFinds.map((f) => [f.sampleId, f])), [activeFinds]);
  const sectionCount = useMemo(() => {
    const m = new Map<string, number>();
    sections.forEach((s) => m.set(s.sampleId, (m.get(s.sampleId) ?? 0) + 1));
    return m;
  }, [sections]);
  const analysisCount = useMemo(() => {
    const m = new Map<string, number>();
    analysis.forEach((a) => m.set(a.sampleId, (m.get(a.sampleId) ?? 0) + 1));
    return m;
  }, [analysis]);

  const totalWeight = results.reduce((n, s) => n + s.totalWeight, 0);

  return (
    <Stack spacing={2.5}>
      <Stack direction="row" alignItems="flex-end" justifyContent="space-between" flexWrap="wrap" gap={2}>
        <Box>
          <Typography variant="h4">样本总览</Typography>
          <Typography variant="body2" color="text.secondary">
            共 {total} 份样本，当前筛选命中 {results.length} 份，合计 {formatWeight(totalWeight)}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
          <Button component={RouterLink} to="/samples/new" variant="contained" startIcon={<AddIcon />}>
            登记新样本
          </Button>
          <Button component={RouterLink} to="/sync" variant="outlined">
            样本包对账
          </Button>
        </Stack>
      </Stack>

      {openConflicts.length > 0 ? (
        <Box sx={{ p: 1.5, pl: 2, borderRadius: 2, bgcolor: 'rgba(237,108,2,0.08)', border: '1px solid', borderColor: 'warning.light' }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Chip size="small" color="warning" label={`${openConflicts.length} 条冲突待裁决`} />
            <Typography variant="body2">
              冲突中的两条样本（含切片、分析与发现地）暂不在总览和发现地地图显示。
            </Typography>
            <Link component={RouterLink} to="/sync" variant="body2">
              前往对账台裁决 →
            </Link>
          </Stack>
        </Box>
      ) : null}

      <Box
        sx={{
          p: 2,
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 2.5,
          bgcolor: 'background.paper',
        }}
      >
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="subtitle2" sx={{ width: 72 }}>
              分类
            </Typography>
            {SAMPLE_CATEGORIES.map((c) => {
              const active = ui.categories.includes(c);
              return (
                <Chip
                  key={c}
                  label={CATEGORY_LABELS[c]}
                  color={active ? 'primary' : 'default'}
                  variant={active ? 'filled' : 'outlined'}
                  onClick={() =>
                    ui.setCategories(
                      active ? ui.categories.filter((x) => x !== c) : [...ui.categories, c],
                    )
                  }
                />
              );
            })}
          </Stack>

          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="subtitle2" sx={{ width: 72 }}>
              化学群
            </Typography>
            {CHEMICAL_GROUPS.map((g) => {
              const active = ui.groups.includes(g);
              return (
                <Chip
                  key={g}
                  label={CHEMICAL_GROUP_LABELS[g]}
                  color={active ? 'secondary' : 'default'}
                  variant={active ? 'filled' : 'outlined'}
                  onClick={() =>
                    ui.setGroups(active ? ui.groups.filter((x) => x !== g) : [...ui.groups, g])
                  }
                />
              );
            })}
          </Stack>

          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="subtitle2" sx={{ width: 72 }}>
              重量区间
            </Typography>
            <TextField
              id="filter-min-weight"
              size="small"
              type="number"
              label="最小 g"
              value={ui.minWeight ?? ''}
              onChange={(e) =>
                ui.setWeightRange(e.target.value === '' ? null : Number(e.target.value), ui.maxWeight)
              }
              sx={{ width: 130 }}
            />
            <Typography variant="body2">~</Typography>
            <TextField
              id="filter-max-weight"
              size="small"
              type="number"
              label="最大 g"
              value={ui.maxWeight ?? ''}
              onChange={(e) =>
                ui.setWeightRange(ui.minWeight, e.target.value === '' ? null : Number(e.target.value))
              }
              sx={{ width: 130 }}
            />
            <TextField
              id="filter-keyword"
              size="small"
              label="编号 / 备注关键词"
              value={ui.keyword}
              onChange={(e) => ui.setKeyword(e.target.value)}
              sx={{ width: 220 }}
            />
            <FormControl size="small" sx={{ width: 160 }}>
              <InputLabel id="sort-label">排序</InputLabel>
              <Select
                labelId="sort-label"
                label="排序"
                value={ui.sort}
                onChange={(e) => ui.setSort(e.target.value as typeof ui.sort)}
              >
                <MenuItem value="createdAt">按登记时间</MenuItem>
                <MenuItem value="totalWeight">按总重量</MenuItem>
                <MenuItem value="sampleNo">按样本编号</MenuItem>
              </Select>
            </FormControl>
            <Button variant="text" onClick={ui.reset} disabled={activeCount === 0}>
              清空筛选
            </Button>
            <Chip size="small" label={`生效条件 ${activeCount}`} variant="outlined" />
          </Stack>
        </Stack>
      </Box>

      {results.length === 0 ? (
        <EmptyState
          title={samples.length === 0 ? '还没有任何样本档案' : '没有符合筛选条件的样本'}
          description={
            samples.length === 0
              ? '先登记一份陨石样本，再补录发现地坐标与切片制样信息。'
              : '试着放宽分类、化学群或重量区间条件。'
          }
          actionLabel={samples.length === 0 ? '登记第一份样本' : '清空筛选条件'}
          actionTo={samples.length === 0 ? '/samples/new' : undefined}
          onAction={samples.length === 0 ? undefined : ui.reset}
        />
      ) : (
        <Grid container spacing={2}>
          {results.map((s) => (
            <Grid item xs={12} sm={6} md={4} lg={3} key={s.id}>
              <SampleCard
                sample={s}
                find={findBySample.get(s.id)}
                sectionCount={sectionCount.get(s.id) ?? 0}
                analysisCount={analysisCount.get(s.id) ?? 0}
              />
            </Grid>
          ))}
        </Grid>
      )}
    </Stack>
  );
}
