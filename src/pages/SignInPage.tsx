import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function SignInPage({ authError }: { authError: string | null }) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(authError);
  const [sending, setSending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setSending(true);
    setMessage(null);
    setError(null);

    try {
      const { error: signInError } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: window.location.origin },
      });

      if (signInError) {
        setError(signInError.message);
      } else {
        setMessage("Check your inbox for a secure sign-in link.");
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not send your sign-in link.",
      );
    } finally {
      setSending(false);
    }
  }

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
          <p className="eyebrow">Welcome back</p>
          <h2>Sign in to continue</h2>
          <p className="muted">We’ll email you a secure, one-time sign-in link.</p>
          <form onSubmit={handleSubmit} className="form-stack">
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
            <button className="button primary full" disabled={sending} type="submit">
              {sending ? "Sending link…" : "Email me a sign-in link"}
            </button>
          </form>
          {message && <p className="notice success" role="status">{message}</p>}
          {error && <p className="notice error" role="alert">{error}</p>}
          <p className="form-footnote">New here? The link will create your account.</p>
        </div>
      </section>
    </main>
  );
}
