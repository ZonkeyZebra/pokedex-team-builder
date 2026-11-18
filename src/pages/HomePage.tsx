import { Link } from "react-router-dom";

export default function HomePage() {
  return (
    <main className="page home-page">
      <section className="welcome">
        <p className="eyebrow">Good to have you back</p>
        <h1>What are we doing today?</h1>
        <p className="muted">Pick a starting point. Your adventure is just getting warmed up.</p>
      </section>
      <section className="destination-grid" aria-label="Choose a destination">
        <Link className="destination-card pokedex-card" to="/pokedex">
          <div className="destination-icon">◎</div>
          <div className="destination-copy">
            <p className="eyebrow">Discover</p>
            <h2>Pokédex</h2>
            <p>Look up Pokémon, browse generations, and find your next favorite.</p>
            <span className="card-link">Explore the Pokédex <span aria-hidden="true">→</span></span>
          </div>
          <div className="card-watermark" aria-hidden="true">01</div>
        </Link>
        <Link className="destination-card builder-card" to="/team-builder">
          <div className="destination-icon">✳</div>
          <div className="destination-copy">
            <p className="eyebrow">Make a lineup</p>
            <h2>Team builder</h2>
            <p>Create a team, fill its six slots, and keep your lineup saved.</p>
            <span className="card-link">Build your team <span aria-hidden="true">→</span></span>
          </div>
          <div className="card-watermark" aria-hidden="true">02</div>
        </Link>
      </section>
      <p className="home-caption"><span className="status-dot" /> Your teams are saved to your account</p>
    </main>
  );
}
