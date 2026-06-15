import Reveal from "./Reveal";

const PROBLEMS = [
  {
    h: "They can’t talk to each other.",
    p: "Each agent runs in its own process, its own context, its own loop. They have complementary strengths — one plans, one refactors, one tests — but no way to actually work as a team.",
  },
  {
    h: "They collide.",
    p: "Two agents open the same file and quietly overwrite each other’s work. By the time you notice, the damage is already committed.",
  },
  {
    h: "You’re shut out.",
    p: "What little coordination exists happens invisibly, in terminals and config files. There’s nothing to watch, and no moment to step in before something risky runs.",
  },
];

export default function Problem() {
  return (
    <section id="problem">
      <div className="container">
        <div className="section-head">
          <Reveal>
            <span className="eyebrow">The problem</span>
          </Reveal>
          <Reveal i={1}>
            <h2>
              Running more than one agent today is <em className="flourish">quietly painful</em>.
            </h2>
          </Reveal>
        </div>
        <div className="prob-list">
          {PROBLEMS.map((item, idx) => (
            <Reveal key={item.h} i={idx}>
              <div className="prob">
                <span className="n">0{idx + 1}</span>
                <div>
                  <h3>{item.h}</h3>
                  <p>{item.p}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
