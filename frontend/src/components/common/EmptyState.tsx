import { Box, Button, Stack, Typography } from '@mui/material';
import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined';
import { Link as RouterLink } from 'react-router-dom';

interface EmptyStateProps {
  title: string;
  description?: string;
  actionLabel?: string;
  actionTo?: string;
  onAction?: () => void;
}

/** 空态提示与新建入口：被 /、/sections、/analysis 消费 */
export function EmptyState({
  title,
  description,
  actionLabel,
  actionTo,
  onAction,
}: EmptyStateProps) {
  return (
    <Box
      sx={{
        py: 7,
        px: 3,
        textAlign: 'center',
        border: '1px dashed',
        borderColor: 'divider',
        borderRadius: 3,
        bgcolor: 'rgba(0,0,0,0.015)',
      }}
    >
      <Stack spacing={1.5} alignItems="center">
        <InboxOutlinedIcon sx={{ fontSize: 44, color: 'text.disabled' }} />
        <Typography variant="h6">{title}</Typography>
        {description ? (
          <Typography variant="body2" color="text.secondary" maxWidth={520}>
            {description}
          </Typography>
        ) : null}
        {actionLabel && actionTo ? (
          <Button component={RouterLink} to={actionTo} variant="contained" sx={{ mt: 1 }}>
            {actionLabel}
          </Button>
        ) : null}
        {actionLabel && !actionTo && onAction ? (
          <Button variant="contained" onClick={onAction} sx={{ mt: 1 }}>
            {actionLabel}
          </Button>
        ) : null}
      </Stack>
    </Box>
  );
}

export default EmptyState;
