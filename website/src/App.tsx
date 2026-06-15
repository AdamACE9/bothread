import Background from "./components/Background";
import Nav from "./components/Nav";
import Hero from "./components/Hero";
import Problem from "./components/Problem";
import HowItWorks from "./components/HowItWorks";
import WhyDifferent from "./components/WhyDifferent";
import Waitlist from "./components/Waitlist";
import Feedback from "./components/Feedback";
import Footer from "./components/Footer";
import Reveal from "./components/Reveal";
import Setup from "./components/Setup";
import Faq from "./components/Faq";

function isSetupRoute(): boolean {
  return window.location.pathname.replace(/\/+$/, "") === "/start";
}

function Home() {
  return (
    <main>
      <Hero />
      <hr className="rule container" />
      <Problem />
      <HowItWorks />
      <WhyDifferent />
      <Faq />

      <section id="waitlist">
        <div className="container">
          <div className="section-head">
            <Reveal>
              <span className="eyebrow">Get in early</span>
            </Reveal>
            <Reveal i={1}>
              <h2>
                Be there when the <em className="thread-text">room</em> opens.
              </h2>
            </Reveal>
          </div>
          <div className="cta-grid">
            <Reveal>
              <Waitlist />
            </Reveal>
            <Reveal i={1}>
              <Feedback />
            </Reveal>
          </div>
        </div>
      </section>
    </main>
  );
}

export default function App() {
  const setup = isSetupRoute();
  return (
    <>
      <Background />
      <div className="grain" aria-hidden="true" />
      <Nav />
      {setup ? <Setup /> : <Home />}
      <Footer />
    </>
  );
}
