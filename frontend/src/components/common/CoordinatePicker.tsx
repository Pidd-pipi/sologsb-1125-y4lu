import { useMemo, useRef, useState } from 'react';
import { Box, Stack, TextField, Typography, Button } from '@mui/material';
import { graticuleLines, projectToGrid, unprojectFromGrid, validateCoordinate } from '../../utils/geo';

interface CoordinatePickerProps {
  longitude: number;
  latitude: number;
  onChange: (lng: number, lat: number) => void;
}

const SIZE = 100;

/** 经纬度录入 + SVG 网格点选（无外部地图依赖，离线可用） */
export function CoordinatePicker({ longitude, latitude, onChange }: CoordinatePickerProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [touched, setTouched] = useState(false);
  const grid = useMemo(() => graticuleLines(SIZE, 30), []);
  const point = projectToGrid({ longitude, latitude }, SIZE);
  const error = validateCoordinate(longitude, latitude);

  const pick = (evt: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = ((evt.clientX - rect.left) / rect.width) * SIZE;
    const y = ((evt.clientY - rect.top) / rect.height) * SIZE;
    const geo = unprojectFromGrid(x, y, SIZE);
    setTouched(true);
    onChange(geo.longitude, geo.latitude);
  };

  return (
    <Stack spacing={1.25}>
      <Stack direction="row" spacing={1.25}>
        <TextField
          id="coord-longitude"
          size="small"
          type="number"
          label="经度"
          value={longitude}
          onChange={(e) => {
            setTouched(true);
            onChange(Number(e.target.value), latitude);
          }}
          inputProps={{ min: -180, max: 180, step: 'any' }}
          error={Boolean(error)}
          sx={{ width: 150 }}
        />
        <TextField
          id="coord-latitude"
          size="small"
          type="number"
          label="纬度"
          value={latitude}
          onChange={(e) => {
            setTouched(true);
            onChange(longitude, Number(e.target.value));
          }}
          inputProps={{ min: -90, max: 90, step: 'any' }}
          error={Boolean(error)}
          sx={{ width: 150 }}
        />
        <Button
          size="small"
          variant="outlined"
          onClick={() => {
            setTouched(true);
            onChange(16.2, 27.4);
          }}
        >
          沙漠样例
        </Button>
      </Stack>
      {error && touched ? (
        <Typography variant="caption" color="error">
          {error}
        </Typography>
      ) : (
        <Typography variant="caption" color="text.secondary">
          点击网格可直接拾取坐标（等距圆柱投影，每 30° 一条参考线）
        </Typography>
      )}

      <Box
        sx={{
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 2,
          overflow: 'hidden',
          bgcolor: '#f7f5f0',
        }}
      >
        <svg
          ref={svgRef}
          data-testid="coordinate-picker-grid"
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          width="100%"
          height={220}
          preserveAspectRatio="none"
          onClick={pick}
          style={{ display: 'block', cursor: 'crosshair' }}
        >
          <rect x="0" y="0" width={SIZE} height={SIZE} fill="#fbf8f2" />
          {grid.vertical.map((x) => (
            <line key={`v${x}`} x1={x} y1={0} x2={x} y2={SIZE} stroke="#e0d8c8" strokeWidth="0.3" />
          ))}
          {grid.horizontal.map((y) => (
            <line key={`h${y}`} x1={0} y1={y} x2={SIZE} y2={y} stroke="#e0d8c8" strokeWidth="0.3" />
          ))}
          <line x1={0} y1={50} x2={SIZE} y2={50} stroke="#c9bfa8" strokeWidth="0.5" />
          <line x1={50} y1={0} x2={50} y2={SIZE} stroke="#c9bfa8" strokeWidth="0.5" />
          <circle cx={point.x} cy={point.y} r="2.4" fill="#c0392b" stroke="#fff" strokeWidth="0.6" />
        </svg>
      </Box>
    </Stack>
  );
}

export default CoordinatePicker;
