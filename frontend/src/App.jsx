import { useCallback, useEffect, useState } from "react";
import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
} from "react-router-dom";
import Navbar from "./Componets/Navbar.jsx";
import { api } from "./api.js";
import { initializeAuth, signOut } from "./auth.js";
import { ToastProvider } from "./context/ToastContext.jsx";
import Auth from "./Pages/Auth.jsx";
import Dashboard from "./Pages/DashBoard.jsx";
import History from "./Pages/History.jsx";
import MyFiles from "./Pages/Myfiles.jsx";
import Verify from "./Pages/Verify.jsx";

function AppLayout({ user, onSignOut }) {
  const [alertCount, setAlertCount] = useState(0);
  const [alertError, setAlertError] = useState("");

  const refreshAlerts = useCallback(async () => {
    const logs = await api.getHistory();
    setAlertCount(logs.filter((log) => log.result === "modified" && !log.reviewed).length);
    setAlertError("");
  }, []);

  useEffect(() => {
    refreshAlerts().catch((error) => {
      setAlertError(error instanceof Error ? error.message : "Could not load alerts.");
    });
  }, [refreshAlerts]);

  return (
    <div className="app-shell">
      <Navbar alertCount={alertCount} user={user} onSignOut={onSignOut} />
      <main className="app-main">
        {alertError && <p role="alert" className="mb-4 text-bad">{alertError}</p>}
        <Outlet context={{ refreshAlerts }} />
      </main>
    </div>
  );
}

function Admin() {
  return (
    <>
      <h2 className="pt">Administration</h2>
      <p className="sub">Users, files and verification activity.</p>
      <section className="panel">
        <h3>Administration tools</h3>
        <p className="text-mute">Administration tools will be available here.</p>
      </section>
    </>
  );
}

function AppRoutes({ user, onAuthenticate, onSignOut }) {
  return (
    <Routes>
      <Route
        path="/login"
        element={user ? <Navigate to="/" replace /> : <Auth mode="login" onSuccess={onAuthenticate} />}
      />
      <Route
        path="/register"
        element={user ? <Navigate to="/" replace /> : <Auth mode="register" onSuccess={onAuthenticate} />}
      />
      <Route
        element={user ? <AppLayout user={user} onSignOut={onSignOut} /> : <Navigate to="/login" replace />}
      >
        <Route index element={<Dashboard />} />
        <Route path="files" element={<MyFiles />} />
        <Route path="verify" element={<Verify />} />
        <Route path="history" element={<History />} />
        <Route path="admin" element={user?.role === "admin" ? <Admin /> : <Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    initializeAuth()
      .then((savedUser) => {
        setUser(savedUser);
        setAuthReady(true);
      })
      .catch((error) => {
        setAuthError(error instanceof Error ? error.message : "Could not initialize FileGuard.");
        setAuthReady(true);
      });
  }, []);

  const handleSignOut = () => {
    signOut();
    setUser(null);
  };

  return (
    <BrowserRouter>
      <ToastProvider>
        {!authReady ? (
          <p className="startup-loading" role="status">Loading FileGuard…</p>
        ) : authError ? (
          <p className="startup-error" role="alert">{authError}</p>
        ) : (
          <AppRoutes user={user} onAuthenticate={setUser} onSignOut={handleSignOut} />
        )}
      </ToastProvider>
    </BrowserRouter>
  );
}
