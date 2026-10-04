import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import AppShell from '../components/common/AppShell';
import Overview from '../pages/Overview';
import New from '../pages/New';
import Detail from '../pages/Detail';
import Sections from '../pages/Sections';
import Analysis from '../pages/Analysis';
import Locations from '../pages/Locations';

/** 路由表：6 条主路由，与提示词一一对应 */
export const ROUTES = [
  { path: '/', element: <Overview /> },
  { path: '/samples/new', element: <New /> },
  { path: '/samples/:id', element: <Detail /> },
  { path: '/sections', element: <Sections /> },
  { path: '/analysis', element: <Analysis /> },
  { path: '/locations', element: <Locations /> },
];

export default function AppRouter() {
  return (
    <BrowserRouter>
      <AppShell>
        <Routes>
          {ROUTES.map((r) => (
            <Route key={r.path} path={r.path} element={r.element} />
          ))}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
    </BrowserRouter>
  );
}
