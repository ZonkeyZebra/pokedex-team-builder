import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";

export default function ResetPasswordPage() {
  const { session, loading: sessionLoading } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [updated, setUpdated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !session) return;
    if (password !== confirmPassword) {
      setError("The passwords don’t match.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(updateError.message);
      } else {
        setUpdated(true);
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not update your password.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="simple-auth-page">
      <Link className="brand" to="/" aria-label="Pokédex home">
        <span className="brand-mark">P</span>
        <span>Pokédex<span className="brand-light"> / Builder</span></span>
      </Link>
      <section className="simple-auth-card">
        <p className="eyebrow">Account recovery</p>
        <h1>Choose a new password</h1>
        {sessionLoading ? (
          <p className="muted">Verifying your reset link…</p>
        ) : updated ? (
          <>
            <p className="notice success" role="status">Your password has been updated.</p>
            <Link className="button primary full button-link" to="/home">Continue to the app</Link>
          </>
        ) : !session ? (
          <>
            <p className="muted">This reset link is invalid or expired. Request a new one to continue.</p>
            <Link className="button primary full button-link" to="/forgot-password">Request another reset link</Link>
          </>
        ) : (
          <>
            <p className="muted">Choose a new password with at least 8 characters.</p>
            <form className="form-stack" onSubmit={handleSubmit}>
              <label htmlFor="new-password">New password</label>
              <input
                autoComplete="new-password"
                id="new-password"
                minLength={8}
                onChange={(event) => setPassword(event.target.value)}
                required
                type="password"
                value={password}
              />
              <label htmlFor="confirm-new-password">Confirm new password</label>
              <input
                autoComplete="new-password"
                id="confirm-new-password"
                minLength={8}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
                type="password"
                value={confirmPassword}
              />
              <button className="button primary full" disabled={saving} type="submit">
                {saving ? "Updating password…" : "Update password"}
              </button>
            </form>
          </>
        )}
        {error && <p className="notice error" role="alert">{error}</p>}
      </section>
    </main>
  );
}
