import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Chip,
  Grid,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import EmptyState from '../components/common/EmptyState';
import ClassificationBadge from '../components/common/Badge';
import { useRegionStats } from '../hooks/useRegionStats';
import { useSampleStore } from '../stores/sampleStore';
import { CATEGORY_LABELS, type SampleCategory } from '../types/sample';
import { categoryColor, formatWeight } from '../utils/format';
import { FIND_ENVIRONMENT_LABELS } from '../types/find';
import { formatCoordinate, graticuleLines, projectToGrid } from '../utils/geo';

const SIZE = 100;
const GRID = graticuleLines(SIZE, 30);

/** `/locations` 发现地分布（SVG 网格打点，无外部地图依赖） */
export default function Locations() {
  const { stats, totalSamples, totalWeight } = useRegionStats();
  const finds = useSampleStore((s) => s.finds);
  const samples = useSampleStore((s) => s.samples);
  const [activeRegion, setActiveRegion] = useState<string | null>(null);
  const [activePoint, setActivePoint] = useState<string | null>(null);

  const sampleMap = useMemo(() => new Map(samples.map((s) => [s.id, s])), [samples]);

  const points = useMemo(() => {
    const list = finds.filter((f) => (activeRegion ? f.region === activeRegion : true));
    return list
      .map((f) => {
        const sample = sampleMap.get(f.sampleId);
        const pos = projectToGrid({ longitude: f.longitude, latitude: f.latitude }, SIZE);
        return { find: f, sample, pos };
      })
      // 待裁决样本暂不在发现地地图显示
      .filter((p) => p.sample && !p.sample.pendingConflict);
  }, [finds, sampleMap, activeRegion]);

  const activeFind = points.find((p) => p.find.id === activePoint);

  const regionSampleList = useMemo(
    () => (activeRegion ? points : []),
    [activeRegion, points],
  );

  return (
    <Stack spacing={2.5}>
      <Box>
        <Typography variant="h4">发现地分布</Typography>
        <Typography variant="body2" color="text.secondary">
          SVG 网格按经纬度打点（等距圆柱投影，每 30° 参考线），按分类着色，点选查看样本清单。共{' '}
          {totalSamples} 条定位记录，合计 {formatWeight(totalWeight)}。
        </Typography>
      </Box>

      {finds.length === 0 ? (
        <EmptyState
          title="还没有登记任何发现地坐标"
          description="在样本登记页补录发现地名、经纬度与坐标来源后，这里会自动打点。"
          actionLabel="去登记样本"
          actionTo="/samples/new"
        />
      ) : (
        <Grid container spacing={2.5}>
          <Grid item xs={12} md={8}>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Stack direction="row" spacing={1} sx={{ mb: 1.5 }} flexWrap="wrap" useFlexGap>
                <Chip
                  size="small"
                  label="全部地区"
                  color={activeRegion === null ? 'primary' : 'default'}
                  onClick={() => setActiveRegion(null)}
                />
                {stats.map((s) => (
                  <Chip
                    key={s.region}
                    size="small"
                    label={`${s.region} · ${s.sampleCount}`}
                    color={activeRegion === s.region ? 'primary' : 'default'}
                    variant={activeRegion === s.region ? 'filled' : 'outlined'}
                    onClick={() => setActiveRegion(activeRegion === s.region ? null : s.region)}
                  />
                ))}
                <Box sx={{ flex: 1 }} />
                {(['chondrite', 'iron', 'stony-iron', 'achondrite'] as SampleCategory[]).map((c) => (
                  <Chip
                    key={c}
                    size="small"
                    label={CATEGORY_LABELS[c]}
                    sx={{ bgcolor: categoryColor(c), color: '#fff' }}
                  />
                ))}
              </Stack>

              <Box
                sx={{
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 2,
                  overflow: 'hidden',
                  bgcolor: '#f8f6f1',
                }}
              >
                <svg
                  data-testid="location-grid"
                  viewBox={`0 0 ${SIZE} ${SIZE}`}
                  width="100%"
                  height={420}
                  preserveAspectRatio="none"
                  style={{ display: 'block' }}
                >
                  <rect x="0" y="0" width={SIZE} height={SIZE} fill="#fbf9f4" />
                  {GRID.vertical.map((x) => (
                    <line key={`v${x}`} x1={x} y1={0} x2={x} y2={SIZE} stroke="#e3dccd" strokeWidth="0.25" />
                  ))}
                  {GRID.horizontal.map((y) => (
                    <line key={`h${y}`} x1={0} y1={y} x2={SIZE} y2={y} stroke="#e3dccd" strokeWidth="0.25" />
                  ))}
                  <line x1={0} y1={SIZE / 2} x2={SIZE} y2={SIZE / 2} stroke="#cbbfa4" strokeWidth="0.45" />
                  <line x1={SIZE / 2} y1={0} x2={SIZE / 2} y2={SIZE} stroke="#cbbfa4" strokeWidth="0.45" />
                  {points.map((p) => {
                    const color = p.sample ? categoryColor(p.sample.category) : '#9e9e9e';
                    const active = p.find.id === activePoint;
                    return (
                      <g key={p.find.id} onClick={() => setActivePoint(p.find.id)} style={{ cursor: 'pointer' }}>
                        <title>
                          {`${p.sample?.sampleNo ?? '未知样本'} · ${p.find.placeName} · ${formatCoordinate(
                            p.find.longitude,
                            p.find.latitude,
                          )}`}
                        </title>
                        {active ? (
                          <circle cx={p.pos.x} cy={p.pos.y} r="4.2" fill="none" stroke="#c0392b" strokeWidth="0.7" />
                        ) : null}
                        <circle
                          cx={p.pos.x}
                          cy={p.pos.y}
                          r={active ? 2.4 : 1.9}
                          fill={color}
                          stroke="#fff"
                          strokeWidth="0.5"
                        />
                      </g>
                    );
                  })}
                </svg>
              </Box>

              <Typography variant="caption" color="text.secondary">
                点击任意点位查看样本清单；上方地区标签可过滤打点范围。
              </Typography>
            </Paper>
          </Grid>

          <Grid item xs={12} md={4}>
            <Stack spacing={2.5}>
              {activeFind ? (
                <Paper variant="outlined" sx={{ p: 2.5 }}>
                  <Typography variant="h6" sx={{ mb: 1 }}>
                    点位详情
                  </Typography>
                  <Stack spacing={1}>
                    {activeFind.sample ? (
                      <>
                        <Typography
                          component={RouterLink}
                          to={`/samples/${activeFind.sample.id}`}
                          variant="subtitle1"
                          sx={{ color: 'primary.main', textDecoration: 'none', fontWeight: 700 }}
                        >
                          {activeFind.sample.sampleNo} ↗
                        </Typography>
                        <ClassificationBadge
                          category={activeFind.sample.category}
                          group={activeFind.sample.chemicalGroup}
                        />
                      </>
                    ) : (
                      <Alert severity="warning">关联样本已不存在</Alert>
                    )}
                    <Typography variant="body2">地名：{activeFind.find.placeName}</Typography>
                    <Typography variant="body2">地区：{activeFind.find.region}</Typography>
                    <Typography variant="body2">
                      坐标：{formatCoordinate(activeFind.find.longitude, activeFind.find.latitude)}
                    </Typography>
                    <Typography variant="body2">
                      环境：{FIND_ENVIRONMENT_LABELS[activeFind.find.environment]}
                    </Typography>
                    <Typography variant="body2">发现者：{activeFind.find.finder}</Typography>
                  </Stack>
                </Paper>
              ) : (
                <Alert severity="info">点击网格上的点位可查看对应样本与坐标明细。</Alert>
              )}

              <Paper variant="outlined" sx={{ p: 2.5 }}>
                <Typography variant="h6" sx={{ mb: 1 }}>
                  按地区统计{activeRegion ? `：${activeRegion}` : ''}
                </Typography>
                <List dense>
                  {stats.map((s) => (
                    <ListItemButton
                      key={s.region}
                      selected={activeRegion === s.region}
                      onClick={() => setActiveRegion(activeRegion === s.region ? null : s.region)}
                      sx={{ borderRadius: 1.5 }}
                    >
                      <ListItemText
                        primary={s.region}
                        secondary={`${s.sampleCount} 份 · ${formatWeight(s.totalWeight)}`}
                      />
                    </ListItemButton>
                  ))}
                </List>
                {activeRegion ? (
                  <>
                    <Typography variant="subtitle2" sx={{ mt: 1.5 }}>
                      {activeRegion} 样本清单
                    </Typography>
                    <Stack spacing={0.75} sx={{ mt: 0.75 }}>
                      {regionSampleList.map((p) => (
                        <Typography
                          key={p.find.id}
                          component={RouterLink}
                          to={p.sample ? `/samples/${p.sample.id}` : '/'}
                          variant="body2"
                          sx={{ color: 'primary.main', textDecoration: 'none' }}
                        >
                          {p.sample?.sampleNo ?? '未知样本'} · {p.find.placeName} ·{' '}
                          {formatWeight(p.sample?.totalWeight ?? 0)}
                        </Typography>
                      ))}
                    </Stack>
                  </>
                ) : null}
              </Paper>
            </Stack>
          </Grid>
        </Grid>
      )}
    </Stack>
  );
}
