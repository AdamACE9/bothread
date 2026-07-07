/**
 * The page-wide backdrop is now just a static CSS gradient — cheap, always on,
 * never animates. The one place that gets a *live* canvas is the hero section
 * itself (see HeroCanvas), scoped and paused when off-screen. Previously this
 * component mounted a fullscreen WebGL shader that ran forever regardless of
 * scroll position — that was the site's real performance problem.
 */
export default function Background() {
  return <div className="bg-fallback" aria-hidden="true" />;
}
