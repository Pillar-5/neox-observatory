import { NavLink, Route, Routes } from 'react-router-dom';
import OverviewPage from './pages/OverviewPage';
import BlocksPage from './pages/BlocksPage';
import BlockDetailPage from './pages/BlockDetailPage';
import TransactionPage from './pages/TransactionPage';
import AntiMevPage from './pages/AntiMevPage';
import BridgePage from './pages/BridgePage';
import AboutPage from './pages/AboutPage';

/**
 * Dashboard shell: sticky navigation plus routed pages.
 *
 * All data comes from the REST API. There is no wallet connection and no
 * transaction flow anywhere in this app.
 */
export default function App() {
  return (
    <div>
      <header className="nav">
        <div className="nav-content">
          <NavLink to="/" className="nav-brand">
            NeoX Observatory
          </NavLink>
          <nav className="nav-links" aria-label="Main navigation">
            <NavLink to="/" className="nav-link" end>
              Overview
            </NavLink>
            <NavLink to="/blocks" className="nav-link">
              Blocks
            </NavLink>
            <NavLink to="/transaction" className="nav-link">
              Transaction
            </NavLink>
            <NavLink to="/antimev" className="nav-link">
              Anti-MEV
            </NavLink>
            <NavLink to="/bridge" className="nav-link">
              Message Bridge
            </NavLink>
            <NavLink to="/about" className="nav-link">
              Data Sources
            </NavLink>
          </nav>
        </div>
      </header>

      <main className="container">
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/blocks" element={<BlocksPage />} />
          <Route path="/blocks/:number" element={<BlockDetailPage />} />
          <Route path="/transaction" element={<TransactionPage />} />
          <Route path="/antimev" element={<AntiMevPage />} />
          <Route path="/bridge" element={<BridgePage />} />
          <Route path="/about" element={<AboutPage />} />
        </Routes>
      </main>

      <footer className="container mb-4">
        <p className="page-description">
          Read-only Neo X observability tool. Source code and data sources are listed under Data
          Sources.
        </p>
      </footer>
    </div>
  );
}
