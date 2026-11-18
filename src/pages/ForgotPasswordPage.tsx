import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { getAuthRedirectUrl } from "../lib/authUrls";
import { supabase } from "../lib/supabase";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setSending(true);
    setSent(false);
    setError(null);

    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
        { redirectTo: getAuthRedirectUrl("reset-password") },
      );
      if (resetError) {
        setError(resetError.message);
      } else {
        setSent(true);
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not send a password reset email.",
      );
    } finally {
      setSending(false);
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
        <h1>Reset your password</h1>
        <p className="muted">Enter the email address on your account and we’ll send you a reset link.</p>
        <form className="form-stack" onSubmit={handleSubmit}>
          <label htmlFor="reset-email">Email address</label>
          <input
            autoComplete="email"
            id="reset-email"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            required
            type="email"
            value={email}
          />
          <button className="button primary full" disabled={sending} type="submit">
            {sending ? "Sending email…" : "Send reset link"}
          </button>
        </form>
        {sent && (
          <p className="notice success" role="status">
            If an account exists for that address, a password reset link is on its way.
          </p>
        )}
        {error && <p className="notice error" role="alert">{error}</p>}
        <Link className="auth-secondary-link" to="/">Back to sign in</Link>
      </section>
    </main>
  );
}
