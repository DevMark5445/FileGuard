import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { requestPasswordReset, resetPassword } from "../auth.js";

export default function Recover({ mode }) {
  const location = useLocation();
  const token = new URLSearchParams(location.search).get("token") || "";
  const isReset = mode === "reset";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setMessage("");
    setBusy(true);
    try {
      const result = isReset
        ? await resetPassword(token, password)
        : await requestPasswordReset(email);
      setMessage(result.message);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The recovery request failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <section className="auth-side">
        <div className="auth-brand"><span aria-hidden="true">◆</span> FileGuard</div>
        <h1>{isReset ? "Set a new password." : "Recover your account."}</h1>
        <p>Recovery links are single-use and expire after 30 minutes.</p>
      </section>
      <section className="auth-main">
        <div className="auth-card">
          <h2>{isReset ? "Reset password" : "Forgot password"}</h2>
          <form onSubmit={submit}>
            {isReset ? (
              <>
                <label htmlFor="reset-password">New password</label>
                <input id="reset-password" type="password" autoComplete="new-password" minLength="8" required value={password} onChange={(event) => setPassword(event.target.value)} />
                <p className="hint">Use the current system password policy.</p>
              </>
            ) : (
              <>
                <label htmlFor="recovery-email">Account email</label>
                <input id="recovery-email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
              </>
            )}
            {error && <p className="auth-error" role="alert">{error}</p>}
            {message && <p role="status">{message}</p>}
            <button type="submit" className="btn auth-submit" disabled={busy}>{busy ? "Please wait…" : isReset ? "Update password" : "Send recovery link"}</button>
          </form>
          <p className="hint"><Link to="/login">Return to sign in</Link></p>
        </div>
      </section>
    </div>
  );
}
