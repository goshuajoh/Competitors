import { Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { loadAllChipData } from './lib/chipData';
import Layout from './components/Layout';
import Dashboard from './components/Dashboard';
import ChipBrowser from './components/ChipBrowser';
import CompareView from './components/CompareView';
import RecommendView from './components/RecommendView';
import ChatView from './components/ChatView';
import LoginPage from './components/LoginPage';

export default function App() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [compareList, setCompareList] = useState([]);
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);

  // Check auth status on mount
  useEffect(() => {
    fetch('/api/auth/status')
      .then((r) => r.json())
      .then((status) => {
        if (!status.required || status.authenticated) {
          setAuthenticated(true);
        }
        setAuthChecked(true);
      })
      .catch(() => {
        // Server not running (local dev without server.js) — skip auth
        setAuthenticated(true);
        setAuthChecked(true);
      });
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    loadAllChipData()
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [authenticated]);

  if (!authChecked || (authenticated && loading)) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-950">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4" />
          <p className="text-gray-400 text-lg">{authenticated ? 'Loading knowledge graph...' : 'Checking access...'}</p>
          <p className="text-gray-600 text-sm mt-1">54 chips across 16 manufacturers</p>
        </div>
      </div>
    );
  }

  if (!authenticated) {
    return <LoginPage onLogin={() => setAuthenticated(true)} />;
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-950">
        <p className="text-red-400">Failed to load chip data.</p>
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/"
        element={<Layout data={data} compareCount={compareList.length} />}
      >
        <Route index element={<Dashboard data={data} />} />
        <Route
          path="browse"
          element={
            <ChipBrowser
              data={data}
              compareList={compareList}
              setCompareList={setCompareList}
            />
          }
        />
        <Route
          path="compare"
          element={
            <CompareView
              data={data}
              compareList={compareList}
              setCompareList={setCompareList}
            />
          }
        />
        <Route path="recommend" element={<RecommendView data={data} />} />
        <Route path="chat" element={<ChatView data={data} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
