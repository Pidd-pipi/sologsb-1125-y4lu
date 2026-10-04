import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { useNavigate } from 'react-router-dom';
import FieldGroup from '../components/common/FieldGroup';
import CoordinatePicker from '../components/common/CoordinatePicker';
import { useLocalDraft } from '../hooks/useLocalDraft';
import { useSampleStore } from '../stores/sampleStore';
import { useToastStore } from '../stores/uiStore';
import {
  CHEMICAL_GROUP_LABELS,
  CHEMICAL_GROUPS,
  FALL_OR_FIND_LABELS,
  FALL_OR_FINDS,
  SAMPLE_CATEGORIES,
  STORAGE_LABELS,
  STORAGE_LOCATIONS,
  WEATHERING_GRADES,
  WEATHERING_LABELS,
  generateSampleNo,
  type ChemicalGroup,
  type FallOrFind,
  type SampleCategory,
  type StorageLocation,
  type WeatheringGrade,
} from '../types/sample';
import {
  COORDINATE_SOURCE_LABELS,
  COORDINATE_SOURCES,
  FIND_ENVIRONMENT_LABELS,
  FIND_ENVIRONMENTS,
  isValidLatitude,
  isValidLongitude,
  type CoordinateSource,
  type FindEnvironment,
} from '../types/find';
import { validateCoordinate } from '../utils/geo';

interface FormDraft {
  sampleNo: string;
  totalWeight: number;
  category: SampleCategory;
  chemicalGroup: ChemicalGroup;
  weathering: WeatheringGrade;
  fallOrFind: FallOrFind;
  storage: StorageLocation;
  note: string;
  withFind: boolean;
  placeName: string;
  region: string;
  longitude: number;
  latitude: number;
  coordinateSource: CoordinateSource;
  environment: FindEnvironment;
  finder: string;
}

/** `/samples/new` 样本登记 */
export default function New() {
  const navigate = useNavigate();
  const nextSeq = useSampleStore((s) => s.nextSampleSeq);
  const addSample = useSampleStore((s) => s.addSample);
  const addFind = useSampleStore((s) => s.addFind);
  const notify = useToastStore((s) => s.notify);

  const initial = useMemo<FormDraft>(
    () => ({
      sampleNo: generateSampleNo(new Date().getFullYear(), nextSeq()),
      totalWeight: 0,
      category: 'chondrite',
      chemicalGroup: 'H',
      weathering: 'W1',
      fallOrFind: 'find',
      storage: 'cabinet-a',
      note: '',
      withFind: true,
      placeName: '',
      region: '',
      longitude: 0,
      latitude: 0,
      coordinateSource: 'gps',
      environment: 'desert',
      finder: '',
    }),
    [nextSeq],
  );

  const { value, patch, reset, clear, restored } = useLocalDraft<FormDraft>('sample-new', initial);
  const [errors, setErrors] = useState<string[]>([]);

  const coordError = value.withFind ? validateCoordinate(value.longitude, value.latitude) : null;

  const submit = async () => {
    const list: string[] = [];
    if (!value.sampleNo.trim()) list.push('样本编号不能为空');
    if (!(value.totalWeight > 0)) list.push('总重量需大于 0 g');
    if (value.withFind) {
      if (!value.placeName.trim()) list.push('发现地名不能为空');
      if (!value.region.trim()) list.push('国家地区不能为空');
      if (coordError) list.push(coordError);
      if (!isValidLongitude(value.longitude) || !isValidLatitude(value.latitude)) {
        list.push('经纬度超出合法范围');
      }
    }
    setErrors(list);
    if (list.length) return;

    try {
      const sampleId = await addSample({
        sampleNo: value.sampleNo.trim(),
        totalWeight: Number(value.totalWeight),
        category: value.category,
        chemicalGroup: value.chemicalGroup,
        weathering: value.weathering,
        fallOrFind: value.fallOrFind,
        storage: value.storage,
        note: value.note.trim() || undefined,
      });

      if (value.withFind) {
        await addFind({
          sampleId,
          placeName: value.placeName.trim(),
          region: value.region.trim(),
          longitude: Number(value.longitude),
          latitude: Number(value.latitude),
          coordinateSource: value.coordinateSource,
          environment: value.environment,
          finder: value.finder.trim() || '未署名',
        });
      }

      clear();
      notify(`已登记样本 ${value.sampleNo.trim()}`);
      navigate(`/samples/${sampleId}`);
    } catch (err) {
      // 容量不足：拒绝入库、表单（草稿）原样保留，改柜位或重量后可再次提交
      setErrors([err instanceof Error ? err.message : '入库失败，请检查柜架容量后重试']);
    }
  };

  return (
    <Stack spacing={2.5}>
      <Box>
        <Typography variant="h4">样本登记</Typography>
        <Typography variant="body2" color="text.secondary">
          分区录入编号、分类、化学群、重量与存放位置，可同时补录发现地坐标（即时校验范围）。
        </Typography>
      </Box>

      {restored ? (
        <Alert severity="info">
          已从本地草稿恢复上次未提交的录入内容（localStorage：gbmeteorite:draft:sample-new）。
        </Alert>
      ) : null}
      {errors.length ? (
        <Alert severity="error">
          {errors.map((e) => (
            <div key={e}>{e}</div>
          ))}
        </Alert>
      ) : null}

      <Grid container spacing={2.5}>
        <Grid item xs={12} md={7}>
          <Stack spacing={2}>
            <FieldGroup title="样本编号" hint="建议格式 MET-年份-三位序号，可手工修改">
              <TextField
                id="sample-no"
                size="small"
                label="样本编号"
                value={value.sampleNo}
                onChange={(e) => patch({ sampleNo: e.target.value })}
                required
              />
              <Button
                size="small"
                variant="outlined"
                onClick={() => patch({ sampleNo: generateSampleNo(new Date().getFullYear(), nextSeq()) })}
                sx={{ alignSelf: 'flex-start' }}
              >
                生成下一个编号
              </Button>
            </FieldGroup>

            <FieldGroup
              title="总重量"
              unit="g"
              min={0.1}
              max={200000}
              value={value.totalWeight}
              onChange={(v) => patch({ totalWeight: v })}
              inputId="total-weight"
              label="总重量"
              required
            />

            <FieldGroup title="分类与化学群" hint="分类决定徽标配色与总览筛选分组">
              <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                <FormControl size="small" sx={{ minWidth: 180 }}>
                  <InputLabel id="category-label">分类</InputLabel>
                  <Select
                    labelId="category-label"
                    label="分类"
                    value={value.category}
                    onChange={(e) => patch({ category: e.target.value as SampleCategory })}
                  >
                    {SAMPLE_CATEGORIES.map((c) => (
                      <MenuItem key={c} value={c}>
                        {c === 'chondrite'
                          ? '球粒陨石'
                          : c === 'iron'
                            ? '铁陨石'
                            : c === 'stony-iron'
                              ? '石铁陨石'
                              : '无球粒陨石'}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl size="small" sx={{ minWidth: 180 }}>
                  <InputLabel id="group-label">化学群</InputLabel>
                  <Select
                    labelId="group-label"
                    label="化学群"
                    value={value.chemicalGroup}
                    onChange={(e) => patch({ chemicalGroup: e.target.value as ChemicalGroup })}
                  >
                    {CHEMICAL_GROUPS.map((g) => (
                      <MenuItem key={g} value={g}>
                        {CHEMICAL_GROUP_LABELS[g]}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl size="small" sx={{ minWidth: 160 }}>
                  <InputLabel id="weathering-label">风化等级</InputLabel>
                  <Select
                    labelId="weathering-label"
                    label="风化等级"
                    value={value.weathering}
                    onChange={(e) => patch({ weathering: e.target.value as WeatheringGrade })}
                  >
                    {WEATHERING_GRADES.map((w) => (
                      <MenuItem key={w} value={w}>
                        {WEATHERING_LABELS[w]}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl size="small" sx={{ minWidth: 150 }}>
                  <InputLabel id="fallfind-label">发现/坠落</InputLabel>
                  <Select
                    labelId="fallfind-label"
                    label="发现/坠落"
                    value={value.fallOrFind}
                    onChange={(e) => patch({ fallOrFind: e.target.value as FallOrFind })}
                  >
                    {FALL_OR_FINDS.map((f) => (
                      <MenuItem key={f} value={f}>
                        {FALL_OR_FIND_LABELS[f]}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl size="small" sx={{ minWidth: 180 }}>
                  <InputLabel id="storage-label">存放位置</InputLabel>
                  <Select
                    labelId="storage-label"
                    label="存放位置"
                    value={value.storage}
                    onChange={(e) => patch({ storage: e.target.value as StorageLocation })}
                  >
                    {STORAGE_LOCATIONS.map((s) => (
                      <MenuItem key={s} value={s}>
                        {STORAGE_LABELS[s]}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Stack>
              <TextField
                size="small"
                label="备注"
                value={value.note}
                onChange={(e) => patch({ note: e.target.value })}
                multiline
                minRows={2}
              />
            </FieldGroup>
          </Stack>
        </Grid>

        <Grid item xs={12} md={5}>
          <FieldGroup
            title="发现地坐标"
            hint="勾选后随样本一并写入发现记录"
            error={coordError && value.withFind ? coordError : null}
          >
            <Stack direction="row" spacing={1} alignItems="center">
              <Button
                size="small"
                variant={value.withFind ? 'contained' : 'outlined'}
                onClick={() => patch({ withFind: !value.withFind })}
              >
                {value.withFind ? '已关联发现记录' : '暂不登记发现地'}
              </Button>
            </Stack>

            {value.withFind ? (
              <Stack spacing={1.5}>
                <TextField
                  id="place-name"
                  size="small"
                  label="发现地名"
                  value={value.placeName}
                  onChange={(e) => patch({ placeName: e.target.value })}
                />
                <TextField
                  id="region"
                  size="small"
                  label="国家 / 地区"
                  value={value.region}
                  onChange={(e) => patch({ region: e.target.value })}
                />
                <CoordinatePicker
                  longitude={value.longitude}
                  latitude={value.latitude}
                  onChange={(lng, lat) => patch({ longitude: lng, latitude: lat })}
                />
                <Stack direction="row" spacing={1.5}>
                  <FormControl size="small" sx={{ minWidth: 150 }}>
                    <InputLabel id="coord-src-label">坐标来源</InputLabel>
                    <Select
                      labelId="coord-src-label"
                      label="坐标来源"
                      value={value.coordinateSource}
                      onChange={(e) =>
                        patch({ coordinateSource: e.target.value as CoordinateSource })
                      }
                    >
                      {COORDINATE_SOURCES.map((c) => (
                        <MenuItem key={c} value={c}>
                          {COORDINATE_SOURCE_LABELS[c]}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <FormControl size="small" sx={{ minWidth: 150 }}>
                    <InputLabel id="env-label">发现环境</InputLabel>
                    <Select
                      labelId="env-label"
                      label="发现环境"
                      value={value.environment}
                      onChange={(e) => patch({ environment: e.target.value as FindEnvironment })}
                    >
                      {FIND_ENVIRONMENTS.map((f) => (
                        <MenuItem key={f} value={f}>
                          {FIND_ENVIRONMENT_LABELS[f]}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Stack>
                <TextField
                  id="finder"
                  size="small"
                  label="发现者"
                  value={value.finder}
                  onChange={(e) => patch({ finder: e.target.value })}
                />
                {coordError ? null : (
                  <Typography variant="caption" color="success.main">
                    经纬度范围校验通过（经度 -180~180，纬度 -90~90）
                  </Typography>
                )}
              </Stack>
            ) : null}
          </FieldGroup>
        </Grid>
      </Grid>

      <Stack direction="row" spacing={1.5}>
        <Button variant="contained" startIcon={<SaveIcon />} onClick={submit} id="save-sample">
          保存样本档案
        </Button>
        <Button variant="outlined" startIcon={<RestartAltIcon />} onClick={reset}>
          清空并重置草稿
        </Button>
      </Stack>
    </Stack>
  );
}
