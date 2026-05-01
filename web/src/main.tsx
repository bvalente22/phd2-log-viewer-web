import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { ViewerPage } from './pages/ViewerPage';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ViewerPage />
  </StrictMode>
);
