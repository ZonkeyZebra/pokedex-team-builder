import { lazy, Suspense, useState, type ReactNode } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { isSupabaseConfigured } from "./lib/supabase";
import SignInPage from "./pages/SignInPage";

const ForgotPasswordPage = lazy(() => import("./pages/ForgotPasswordPage"));
const HomePage = lazy(() => import("./pages/HomePage"));
const PokedexPage = lazy(() => import("./pages/PokedexPage"));
const PokemonDetailPage = lazy(() => import("./pages/PokemonDetailPage"));
const ResetPasswordPage = lazy(() => import("./pages/ResetPasswordPage"));
const TeamBuilderPage = lazy(() => import("./pages/TeamBuilderPage"));

function PageLoading() {
  return <main className="center-screen"><p className="muted">Loading page…</p></main>;
}

function AppLayout({ children }: { children: ReactNode }) {
  const { signOut, session } = useAuth();
  const location = useLocation();
  const [signOutError, setSignOutError] = useState<string | null>(null);

  async function handleSignOut() {
    setSignOutError(null);
    try {
      await signOut();
    } catch (error) {
      setSignOutError(
        error instanceof Error ? error.message : "Could not sign out.",
      );
    }
  }

  return (
    <div className={`app-shell${location.pathname.startsWith("/pokedex/") ? " detail-mode" : ""}`}>
      <header className="topbar">
        <Link className="brand" to="/home" aria-label="Pokédex home">
          <span className="brand-mark">P</span>
          <span>Pokédex<span className="brand-light"> / Builder</span></span>
        </Link>
        <nav className="topnav" aria-label="Main navigation">
          <Link to="/pokedex">Pokédex</Link>
          <Link to="/team-builder">Team builder</Link>
        </nav>
        <div className="account">
          <span className="account-email">{session?.user.email}</span>
          <button className="text-button" onClick={handleSignOut}>Sign out</button>
        </div>
      </header>
      {signOutError && <p className="notice error">{signOutError}</p>}
      {children}
    </div>
  );
}

function ProtectedRoutes() {
  const { session, loading, error } = useAuth();
  const location = useLocation();

  if (!isSupabaseConfigured) {
    return (
      <main className="center-screen">
        <section className="auth-card">
          <p className="eyebrow">Setup needed</p>
          <h1>Connect your Supabase project</h1>
          <p className="muted">
            Copy <code>.env.example</code> to <code>.env.local</code>, then add
            your project URL and anon/publishable key.
          </p>
        </section>
      </main>
    );
  }

  if (loading) {
    return <main className="center-screen"><p className="muted">Checking your session…</p></main>;
  }

  if (location.pathname === "/forgot-password") {
    return <Suspense fallback={<PageLoading />}><ForgotPasswordPage /></Suspense>;
  }

  if (location.pathname === "/reset-password") {
    return <Suspense fallback={<PageLoading />}><ResetPasswordPage /></Suspense>;
  }

  if (!session) {
    if (location.pathname === "/") {
      return <SignInPage authError={error} />;
    }
    return <Navigate to="/" replace state={{ from: location.pathname }} />;
  }

  if (location.pathname === "/") return <Navigate to="/home" replace />;

  return (
    <AppLayout>
      <Routes>
        <Route path="/home" element={<Suspense fallback={<PageLoading />}><HomePage /></Suspense>} />
        <Route path="/pokedex" element={<Suspense fallback={<PageLoading />}><PokedexPage /></Suspense>} />
        <Route
          path="/pokedex/:pokemonId"
          element={
            <Suspense fallback={<PageLoading />}>
              <PokemonDetailPage />
            </Suspense>
          }
        />
        <Route path="/team-builder" element={<Suspense fallback={<PageLoading />}><TeamBuilderPage /></Suspense>} />
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Routes>
    </AppLayout>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/*" element={<ProtectedRoutes />} />
    </Routes>
  );
}
