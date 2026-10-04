import type { ReactNode } from 'react';
import { Box, InputAdornment, Stack, TextField, Typography } from '@mui/material';

interface FieldGroupProps {
  title: string;
  unit?: string;
  hint?: string;
  min?: number;
  max?: number;
  error?: string | null;
  children?: ReactNode;
  /** 便捷数值输入：给出即渲染带单位与合法区间的输入框 */
  value?: number;
  onChange?: (v: number) => void;
  label?: string;
  inputId?: string;
  required?: boolean;
}

/** 带单位与合法区间的数值录入区块：被 /samples/new、/analysis 消费 */
export function FieldGroup({
  title,
  unit,
  hint,
  min,
  max,
  error,
  children,
  value,
  onChange,
  label,
  inputId,
  required,
}: FieldGroupProps) {
  const rangeText =
    min !== undefined && max !== undefined
      ? `合法区间 ${min} ~ ${max}${unit ? ` ${unit}` : ''}`
      : hint;

  const outOfRange =
    value !== undefined && ((min !== undefined && value < min) || (max !== undefined && value > max));

  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: error || outOfRange ? 'error.main' : 'divider',
        borderRadius: 2,
        p: 1.75,
        bgcolor: 'background.paper',
      }}
    >
      <Stack spacing={1}>
        <Typography variant="subtitle2" fontWeight={700}>
          {title}
          {unit ? `（${unit}）` : ''}
        </Typography>
        {rangeText ? (
          <Typography variant="caption" color="text.secondary">
            {rangeText}
          </Typography>
        ) : null}
        {value !== undefined && onChange ? (
          <TextField
            id={inputId}
            size="small"
            type="number"
            label={label ?? title}
            required={required}
            value={Number.isFinite(value) ? value : 0}
            onChange={(e) => onChange(Number(e.target.value))}
            InputProps={
              unit
                ? { endAdornment: <InputAdornment position="end">{unit}</InputAdornment> }
                : undefined
            }
            error={Boolean(outOfRange)}
            helperText={outOfRange && !error ? `数值超出 ${min} ~ ${max}` : undefined}
            inputProps={{ min, max, step: 'any' }}
          />
        ) : null}
        {error ? (
          <Typography variant="caption" color="error">
            {error}
          </Typography>
        ) : null}
        {children}
      </Stack>
    </Box>
  );
}

export default FieldGroup;
