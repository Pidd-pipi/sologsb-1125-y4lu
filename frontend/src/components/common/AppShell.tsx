import { useEffect, type ReactNode } from 'react';
import { NavLink as RouterLink, useLocation } from 'react-router-dom';
import {
  AppBar,
  Box,
  Container,
  CssBaseline,
  Divider,
  Drawer,
  List,
  ListItemButton,
  ListItemText,
  Snackbar,
  Alert,
  Stack,
  Toolbar,
  Typography,
  Chip,
} from '@mui/material';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import PublicIcon from '@mui/icons-material/Public';
import SyncIcon from '@mui/icons-material/Sync';
import { useSampleStore } from '../../stores/sampleStore';
import { useToastStore } from '../../stores/uiStore';
import { dataChangeBus } from '../../utils/syncBus';

const DRAWER_WIDTH = 232;

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#4b3f2f' },
    secondary: { main: '#8d6e63' },
    background: { default: '#f6f3ee', paper: '#ffffff' },
  },
  typography: {
    fontFamily:
      '"Inter", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif',
    h4: { fontWeight: 700, letterSpacing: '0.01em' },
  },
  shape: { borderRadius: 10 },
});

const NAV = [
  { to: '/', label: '样本总览' },
  { to: '/samples/new', label: '样本登记' },
  { to: '/sections', label: '切片库' },
  { to: '/analysis', label: '分析检测' },
  { to: '/locations', label: '发现地分布' },
  { to: '/sync', label: '样本包对账' },
];

export default function AppShell({ children }: { children: ReactNode }) {
  const loadAll = useSampleStore((s) => s.loadAll);
  const loaded = useSampleStore((s) => s.loaded);
  const sampleCount = useSampleStore((s) => s.samples.length);
  const conflicts = useSampleStore((s) => s.conflicts);
  const failures = useSampleStore((s) => s.failures);
  const refreshSyncState = useSampleStore((s) => s.refreshSyncState);
  const toast = useToastStore();
  const location = useLocation();

  const openConflictCount = conflicts.filter((c) => c.status === 'open').length;

  useEffect(() => {
    if (!loaded) void loadAll();
  }, [loaded, loadAll]);

  // 其他标签页并库 / 裁决后，本页同步刷新数据
  useEffect(() => {
    if (!loaded) return;
    const unsub = dataChangeBus.subscribe(() => {
      void refreshSyncState();
    });
    return unsub;
  }, [loaded, refreshSyncState]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ display: 'flex', minHeight: '100vh' }}>
        <AppBar
          position="fixed"
          elevation={0}
          sx={{ zIndex: (t) => t.zIndex.drawer + 1, bgcolor: '#3d3327', color: '#f5efe4' }}
        >
          <Toolbar sx={{ gap: 1.5 }}>
            <PublicIcon />
            <Typography variant="h6" fontWeight={700}>
              陨石样本编目台
            </Typography>
            <Chip
              size="small"
              label={`本地档案 ${sampleCount} 份样本`}
              sx={{ bgcolor: 'rgba(255,255,255,0.14)', color: '#f5efe4' }}
            />
            {openConflictCount > 0 ? (
              <Chip
                size="small"
                component={RouterLink}
                to="/sync"
                clickable
                color="warning"
                icon={<SyncIcon />}
                label={`${openConflictCount} 条冲突待裁决`}
              />
            ) : null}
            {failures.length > 0 ? (
              <Chip
                size="small"
                component={RouterLink}
                to="/sync"
                clickable
                color="error"
                label={`${failures.length} 个失败包`}
              />
            ) : null}
            <Box sx={{ flex: 1 }} />
            <Typography variant="caption" sx={{ opacity: 0.8 }}>
              数据仅存于本机浏览器 · IndexedDB
            </Typography>
          </Toolbar>
        </AppBar>

        <Drawer
          variant="permanent"
          sx={{
            width: DRAWER_WIDTH,
            flexShrink: 0,
            '& .MuiDrawer-paper': {
              width: DRAWER_WIDTH,
              boxSizing: 'border-box',
              bgcolor: '#f0ebe2',
              borderRight: '1px solid #ddd4c6',
            },
          }}
        >
          <Toolbar />
          <Box sx={{ overflow: 'auto', px: 1, py: 1.5 }}>
            <Typography variant="overline" sx={{ px: 1.5, color: 'text.secondary' }}>
              编目工作区
            </Typography>
            <List dense>
              {NAV.map((item) => (
                <ListItemButton
                  key={item.to}
                  component={RouterLink}
                  to={item.to}
                  selected={
                    item.to === '/'
                      ? location.pathname === '/'
                      : location.pathname.startsWith(item.to)
                  }
                  sx={{ borderRadius: 1.5, mb: 0.25 }}
                >
                  <ListItemText primary={item.label} />
                </ListItemButton>
              ))}
            </List>
            <Divider sx={{ my: 1.5 }} />
            <Stack spacing={0.5} sx={{ px: 1.5 }}>
              <Typography variant="caption" color="text.secondary">
                快捷入口
              </Typography>
              <Typography
                variant="caption"
                component={RouterLink}
                to="/samples/new"
                sx={{ color: 'primary.main', textDecoration: 'none' }}
              >
                + 登记新样本
              </Typography>
              <Typography
                variant="caption"
                component={RouterLink}
                to="/analysis"
                sx={{ color: 'primary.main', textDecoration: 'none' }}
              >
                + 录入检测数值
              </Typography>
            </Stack>
          </Box>
        </Drawer>

        <Box component="main" sx={{ flex: 1, minWidth: 0 }}>
          <Toolbar />
          <Container maxWidth="xl" sx={{ py: 3 }}>
            {children}
          </Container>
        </Box>
      </Box>

      <Snackbar
        open={toast.open}
        autoHideDuration={2600}
        onClose={toast.close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={toast.severity} onClose={toast.close} variant="filled">
          {toast.message}
        </Alert>
      </Snackbar>
    </ThemeProvider>
  );
}
