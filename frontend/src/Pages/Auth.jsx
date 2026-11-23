import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { authenticate } from "../auth.js";
import { useToast } from "../context/ToastContext.jsx";

const samples = [
  ["Registered", "9f86d081884c7d659a2feaa0c55ad015…", "original"],
  ["Checked today", "2c26b46b68ffc68ff99b453c1d304134…", "changed"],
];

function PasswordVisibilityIcon({ visible }) {
  return visible ? (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.2A10.9 10.9 0 0112 5c5 0 8.3 4.5 9 7-.3 1.1-1 2.3-2.1 3.4M6.2 6.2C3.9 7.7 2.4 10 2 12c.7 2.5 4 7 10 7 1.2 0 2.3-.2 3.3-.6" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M2 12s3.3-7 10-7 10 7 10 7-3.3 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export default function Auth({ mode, onSuccess }) {
  const isRegister = mode === "register";
  const navigate = useNavigate();
  const toast = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [challengeToken, setChallengeToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setError("");

    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError("Enter a valid email address.");
      return;
    }
    if (isRegister && password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      const result = await authenticate({
        mode,
        name,
        email,
        password,
        challengeToken,
        code: mfaCode,
      });
      if (result?.mfaRequired) {
        setChallengeToken(result.challengeToken);
        setPassword("");
        return;
      }
      const user = result;
      onSuccess(user);
      toast(isRegister ? "Account created successfully." : "Welcome back! Login successful.", "success");
      navigate("/", { replace: true });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Could not sign in.";
      setError(message);
      if (!isRegister) {
        if (reason?.status === 401) {
          toast("Invalid email or password.", "error");
        } else if (reason?.status === 403) {
          toast("Your account is not active. Contact a FileGuard administrator.", "warning");
        } else {
          toast(message, "error");
        }
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <section className="auth-side">
        <div className="auth-brand"><span aria-hidden="true">◆</span> FileGuard</div>
        <h1>Know when a file has changed.</h1>
        <p>
          Register a file once. Check it any time. FileGuard compares SHA-256
          fingerprints and tells you if even one byte is different.
        </p>
        <div className="hashdemo mono">
          {samples.map(([label, hash, state]) => (
            <div key={label}>
              {label} &nbsp;
              <span className={state}>{hash}</span>
            </div>
          ))}
          <div className="hash-warning">File modified</div>
        </div>
      </section>
      <section className="auth-main">
        <div className="auth-card">
          <h2>{challengeToken ? "Two-step verification" : isRegister ? "Create your account" : "Sign in"}</h2>
          {!challengeToken && <div className="tabs" role="tablist" aria-label="Account access">
            <Link to="/login" role="tab" aria-selected={!isRegister} className={!isRegister ? "on" : ""}>Sign in</Link>
            <Link to="/register" role="tab" aria-selected={isRegister} className={isRegister ? "on" : ""}>Register</Link>
          </div>}
          <form onSubmit={submit}>
            {challengeToken ? (
              <>
                <p className="hint">Enter the current code from your authenticator app. This sign-in challenge expires in five minutes.</p>
                <label htmlFor="auth-mfa">Authenticator code</label>
                <input id="auth-mfa" inputMode="numeric" autoComplete="one-time-code" value={mfaCode} onChange={(event) => setMfaCode(event.target.value)} />
              </>
            ) : isRegister && (
              <>
                <label htmlFor="auth-name">Full name</label>
                <input id="auth-name" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} />
              </>
            )}
            {!challengeToken && <>
            <label htmlFor="auth-email">Email</label>
            <input id="auth-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
            <label htmlFor="auth-password">Password</label>
            <div className="password-field">
              <input id="auth-password" type={showPassword ? "text" : "password"} autoComplete={isRegister ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} />
              <button className="password-visibility" type="button" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} onClick={() => setShowPassword((visible) => !visible)}>
                <PasswordVisibilityIcon visible={showPassword} />
              </button>
            </div>
            {isRegister && (
              <>
                <label htmlFor="auth-confirm">Confirm password</label>
                <div className="password-field">
                  <input id="auth-confirm" type={showConfirmPassword ? "text" : "password"} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
                  <button className="password-visibility" type="button" aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"} aria-pressed={showConfirmPassword} onClick={() => setShowConfirmPassword((visible) => !visible)}>
                    <PasswordVisibilityIcon visible={showConfirmPassword} />
                  </button>
                </div>
                <p className="hint">Use the current password requirements configured by your administrator.</p>
              </>
            )}
            </>}
            <p className="auth-error" role="alert">{error}</p>
            <button className="btn auth-submit" type="submit" disabled={busy}>
              {busy ? "Please wait…" : challengeToken ? "Verify and sign in" : isRegister ? "Create account" : "Sign in"}
            </button>
          </form>
          {!challengeToken && !isRegister && (
            <p className="hint"><Link to="/forgot-password">Forgot your password?</Link></p>
          )}
          {!challengeToken && !isRegister && (
            <p className="hint">Admin access is provisioned by your FileGuard super admin.</p>
          )}
        </div>
      </section>
    </div>
  );
}
