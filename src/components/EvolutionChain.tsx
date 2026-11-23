import { Link } from "react-router-dom";
import {
  buildLineages,
  formTag,
  otherFormsByFamily,
  regionOf,
  type EvolutionForm,
  type EvolutionStep,
} from "../lib/evolutionForms";
import { formatIdentifier } from "../lib/format";

type Props = {
  evolutions: EvolutionStep[];
  formsBySpecies: Record<number, EvolutionForm[]>;
  current: { id: number; species_id: number; form_name: string | null };
  shiny: boolean;
};

function spriteFor(form: EvolutionForm | undefined, shiny: boolean) {
  if (!form) return null;
  return shiny ? form.shiny_sprite_url ?? form.sprite_url : form.sprite_url;
}

export default function EvolutionChain({ evolutions, formsBySpecies, current, shiny }: Props) {
  const currentRegion = regionOf(current.form_name);
  const lineages = buildLineages(evolutions, formsBySpecies, currentRegion, current.id);
  const currentLineage = lineages.find((lineage) => lineage.formIds.includes(current.id))
    ?? lineages.find((lineage) => lineage.region === currentRegion);
  const moreForms = otherFormsByFamily(formsBySpecies, lineages);
  const moreCount = moreForms.reduce((sum, group) => sum + group.forms.length, 0);
  const showHeadings = lineages.length > 1;

  return (
    <>
      {lineages.map((lineage) => {
        const isCurrentLineage = lineage === currentLineage;
        return (
          <div className={`pd-evo-lineage${isCurrentLineage ? " current" : ""}`} key={lineage.key}>
            {showHeadings && <h3 className="pd-evo-heading">{lineage.label}</h3>}
            {lineage.stages.length ? (
              <div className="pd-evo">
                {lineage.stages.map((stage, stageIndex) => (
                  <div className="pd-evo-group" key={stageIndex}>
                    {stageIndex > 0 && <span aria-hidden="true" className="pd-evo-arrow">→</span>}
                    <div className="pd-evo-stage">
                      {stage.map((card) => {
                        const { form } = card;
                        const name = formatIdentifier(card.speciesName);
                        const tag = form && !form.is_default ? formTag(form) : null;
                        const sprite = spriteFor(form, shiny);
                        const isCurrent = isCurrentLineage && form?.id === current.id;
                        const content = (
                          <>
                            {sprite
                              ? <img alt="" src={sprite} />
                              : <span aria-hidden="true" className="pd-evo-placeholder">?</span>}
                            <strong>{name}</strong>
                            {tag && <span className="pd-evo-form">{tag}</span>}
                            <small>#{String(card.speciesId).padStart(4, "0")}</small>
                            {stageIndex > 0 && card.evolution && (
                              <span className="pd-evo-method">
                                {card.evolutionDetails ?? card.evolution.details ?? formatIdentifier(card.evolution.trigger)}
                              </span>
                            )}
                          </>
                        );
                        const className = `pd-evo-card${isCurrent ? " current" : ""}`;
                        return form ? (
                          <Link
                            aria-current={form.id === current.id ? "page" : undefined}
                            aria-label={`View ${name}${tag ? ` (${tag})` : ""}`}
                            className={className}
                            key={card.speciesId}
                            to={`/pokedex/${form.id}`}
                          >{content}</Link>
                        ) : (
                          <div className={className} key={card.speciesId}>{content}</div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="detail-empty">This line does not evolve.</div>
            )}
          </div>
        );
      })}

      {moreForms.length > 0 && (
        <details className="pd-evo-more">
          <summary>Other forms in this family ({moreCount})</summary>
          <div className="pd-evo-more-body">
            {moreForms.map((group) => (
              <div key={group.speciesId}>
                <h3>{formatIdentifier(group.speciesName)}</h3>
                <nav aria-label={`${formatIdentifier(group.speciesName)} forms`} className="pd-forms">
                  {group.forms.map((form) => {
                    const sprite = spriteFor(form, shiny);
                    return (
                      <Link
                        aria-current={form.id === current.id ? "page" : undefined}
                        className={form.id === current.id ? "active" : ""}
                        key={form.id}
                        to={`/pokedex/${form.id}`}
                      >
                        {sprite && <img alt="" src={sprite} />}
                        <span>{formTag(form)}</span>
                      </Link>
                    );
                  })}
                </nav>
              </div>
            ))}
          </div>
        </details>
      )}
    </>
  );
}
