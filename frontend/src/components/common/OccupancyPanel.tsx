import { Box, Chip, LinearProgress, Stack, Typography } from '@mui/material';
import { STORAGE_LABELS, type StorageLocation } from '../../types/sample';
import { formatWeight } from '../../utils/format';
import { storageLoad } from '../../utils/capacity';

/** 柜架占用面板：实时汇总 active 样本重量，超限时标红 */
export default function OccupancyPanel({
  samples,
  highlightStorage,
}: {
  samples: Parameters<typeof storageLoad>[0];
  highlightStorage?: StorageLocation;
}) {
  const loads = storageLoad(samples);
  return (
    <Stack spacing={1.25}>
      {loads.map((load) => {
        const pct = load.capacity === null ? 0 : Math.min(100, (load.used / load.capacity) * 100);
        const over = load.capacity !== null && load.used > load.capacity;
        const near = !over && load.capacity !== null && pct >= 80;
        return (
          <Box key={load.storage}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.25 }}>
              <Typography
                variant="body2"
                fontWeight={highlightStorage === load.storage ? 700 : 400}
              >
                {STORAGE_LABELS[load.storage]}
              </Typography>
              <Typography variant="caption" color={over ? 'error.main' : 'text.secondary'}>
                {formatWeight(load.used)}
                {load.capacity !== null ? ` / ${formatWeight(load.capacity)}` : ' · 不占柜'}
              </Typography>
            </Stack>
            {load.capacity !== null ? (
              <LinearProgress
                variant="determinate"
                value={Math.max(2, pct)}
                color={over ? 'error' : near ? 'warning' : 'success'}
                sx={{ height: 8, borderRadius: 4 }}
              />
            ) : (
              <Box sx={{ height: 8 }} />
            )}
            {over ? (
              <Chip size="small" color="error" label="超重，禁止再入库" sx={{ mt: 0.5 }} />
            ) : null}
          </Box>
        );
      })}
    </Stack>
  );
}
