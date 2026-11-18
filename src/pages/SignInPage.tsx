import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { getAuthRedirectUrl } from "../lib/authUrls";
import { supabase } from "../lib/supabase";

type AuthMode = "sign-in" | "sign-up";

export default function SignInPage({ authError }: { authError: string | null }) {
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(authError);
  const [submitting, setSubmitting] = useState(false);

  function changeMode(nextMode: AuthMode) {
    setMode(nextMode);
    setMessage(null);
    setError(null);
    setPassword("");
    setConfirmPassword("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    if (mode === "sign-up" && password !== confirmPassword) {
      setError("The passwords don’t match.");
      return;
    }

    setSubmitting(true);
    setMessage(null);
    setError(null);

    try {
      if (mode === "sign-up") {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: getAuthRedirectUrl() },
        });
        if (signUpError) {
          setError(signUpError.message);
        } else if (data.session) {
          setMessage("Your account is ready. You can continue to the app.");
        } else {
          setMessage("Check your email for a confirmation link, then return here to sign in.");
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (signInError) {
          setError(signInError.message);
        } else {
          setMessage("Signed in successfully.");
        }
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Authentication failed. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const isSignUp = mode === "sign-up";

  return (
    <main className="signin-layout">
      <section className="signin-story">
        <Link className="brand brand-on-dark" to="/" aria-label="Pokédex">
          <span className="brand-mark">P</span>
          <span>Pokédex<span className="brand-light"> / Builder</span></span>
        </Link>
        <div>
          <p className="eyebrow">Your next great team starts here</p>
          <h1>Explore every Pokémon.<br />Build your team.</h1>
          <p className="story-copy">
            Search the Pokédex and put together a roster that feels like yours.
          </p>
        </div>
        <div className="orbit" aria-hidden="true"><span /><i /></div>
      </section>
      <section className="signin-panel">
        <div className="signin-form-wrap">
          <p className="eyebrow">{isSignUp ? "Join the adventure" : "Welcome back"}</p>
          <h2>{isSignUp ? "Create your account" : "Sign in to continue"}</h2>
          <p className="muted">
            {isSignUp
              ? "Use your email and a password to save your teams."
              : "Sign in with the email and password for your account."}
          </p>
          <div className="auth-mode-switch" aria-label="Account options">
            <button
              aria-pressed={!isSignUp}
              className={!isSignUp ? "active" : ""}
              onClick={() => changeMode("sign-in")}
              type="button"
            >Sign in</button>
            <button
              aria-pressed={isSignUp}
              className={isSignUp ? "active" : ""}
              onClick={() => changeMode("sign-up")}
              type="button"
            >Create account</button>
          </div>
          <form aria-label="Authentication form" onSubmit={handleSubmit} className="form-stack">
            <label htmlFor="email">Email address</label>
            <input
              autoComplete="email"
              id="email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              required
              type="email"
              value={email}
            />
            <label htmlFor="password">Password</label>
            <input
              autoComplete={isSignUp ? "new-password" : "current-password"}
              id="password"
              minLength={8}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={isSignUp ? "At least 8 characters" : "Your password"}
              required
              type="password"
              value={password}
            />
            {isSignUp && (
              <>
                <label htmlFor="confirm-password">Confirm password</label>
                <input
                  autoComplete="new-password"
                  id="confirm-password"
                  minLength={8}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="Re-enter your password"
                  required
                  type="password"
                  value={confirmPassword}
                />
              </>
            )}
            <button className="button primary full" disabled={submitting} type="submit">
              {submitting
                ? (isSignUp ? "Creating account…" : "Signing in…")
                : (isSignUp ? "Create account" : "Sign in")}
            </button>
          </form>
          {!isSignUp && (
            <Link className="auth-secondary-link" to="/forgot-password">Forgot password?</Link>
          )}
          {message && <p className="notice success" role="status">{message}</p>}
          {error && <p className="notice error" role="alert">{error}</p>}
          {isSignUp && <p className="form-footnote">We’ll email you a link to confirm your address.</p>}
        </div>
      </section>
    </main>
  );
}
