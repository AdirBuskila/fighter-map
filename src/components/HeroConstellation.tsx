import Link from "next/link";

import {
  ISRAEL_OUTLINE,
  OUTLINE_HEIGHT,
  OUTLINE_WIDTH,
  isOnOutline,
  projectToOutline,
} from "@/lib/israel-outline";
import type { Place } from "@/lib/types";

/**
 * The landing page's hero: the country drawn by its own pins.
 *
 * Every dot is a real published place with real coordinates, projected through
 * the outline's own geoViewBox. That is the whole idea -- the page cannot be
 * reproduced by anyone without this dataset, and it needs no copy to say what
 * the site is.
 *
 * A server component on purpose. It emits static SVG: no client JavaScript, no
 * WebGL, no canvas, no animation library. It renders with JS off, it cannot
 * contend with MapLibre for the GPU, and it cannot fail in any of the three
 * ways this project's map already has -- a pane grown to 60,719px, a worker
 * that requested no tiles, a masthead that reported itself pinned and was not.
 * There is nothing here to go wrong at runtime because nothing here runs.
 *
 * The wave is CSS. Each dot carries an `animation-delay` computed here from
 * its latitude, so the ignition runs from the Negev northward without a single
 * timer.
 */

/** How long the wave takes to travel the length of the country, in seconds. */
const SWEEP_SECONDS = 1.9;

type Props = {
  /** Places with coordinates. Anything without them cannot be drawn. */
  places: Place[];
  /** Everything the site lists, pinned or not. See the note in the markup. */
  publishedTotal: number;
};

export default function HeroConstellation({ places, publishedTotal }: Props) {
  const dots = places
    .map((place) => {
      if (place.lat == null || place.lng == null) return null;
      const { x, y } = projectToOutline(place.lat, place.lng);
      // The same guard as BOUNDS in the seed scripts. A coordinate that is
      // quietly wrong draws a dot in the sea, looks deliberate, and survives
      // every eyeball check because nobody counts the dots.
      if (!isOnOutline(x, y)) return null;
      return {
        id: place.id,
        x,
        y,
        // Shape carries the benefit, exactly as on the map. A place that takes
        // both is drawn as a circle rather than the map's ringed circle: at
        // two pixels a ring is a smudge, and "takes the card" is the stronger
        // signal of the two.
        voucherOnly: place.benefit_vacation_voucher && !place.benefit_fighter_card,
        delay: ((OUTLINE_HEIGHT - y) / OUTLINE_HEIGHT) * SWEEP_SECONDS,
      };
    })
    .filter((dot) => dot !== null);

  const fighter = dots.filter((dot) => !dot.voucherOnly).length;
  const voucher = dots.length - fighter;

  return (
    <section className="hero-const" dir="rtl">
      <div className="hero-const__map" aria-hidden="true">
        <svg
          viewBox={`0 0 ${OUTLINE_WIDTH} ${OUTLINE_HEIGHT}`}
          preserveAspectRatio="xMidYMid meet"
        >
          {ISRAEL_OUTLINE.map((shape) => (
            <path key={shape.id} className="hero-const__land" d={shape.d} />
          ))}
          {dots.map((dot) =>
            dot.voucherOnly ? (
              <rect
                key={dot.id}
                className="hero-const__dot hero-const__dot--voucher"
                x={dot.x - 2.2}
                y={dot.y - 2.2}
                width={4.4}
                height={4.4}
                transform={`rotate(45 ${dot.x} ${dot.y})`}
                style={{ animationDelay: `${dot.delay.toFixed(2)}s` }}
              />
            ) : (
              <circle
                key={dot.id}
                className="hero-const__dot hero-const__dot--fighter"
                cx={dot.x}
                cy={dot.y}
                r={2.5}
                style={{ animationDelay: `${dot.delay.toFixed(2)}s` }}
              />
            ),
          )}
        </svg>
      </div>

      <div className="hero-const__copy">
        <p className="hero-const__kicker">מפת הטבות פייטר</p>
        <h1 className="hero-const__headline">
          איפה הכרטיס
          <br />
          <em>באמת עובד</em>.
        </h1>
        <p className="hero-const__sub">
          כל נקודה כאן היא מקום שמילואימניק שילם בו ודיווח. בלי פרסומות, בלי
          הבטחות.
        </p>
        <div className="hero-const__cta">
          <Link className="btn btn-primary tap px-5" href="/map">
            פתחו את המפה
          </Link>
          <Link className="btn tap px-5" href="/add">
            הוסיפו מקום
          </Link>
        </div>
      </div>

      {/*
        Three counts, all true at once, and the page says so rather than
        picking the flattering one. The map draws what has coordinates; the
        site lists a great deal more, because OpenStreetMap does not know most
        small Israeli businesses and those places are listed instead of mapped.
        Hiding the gap would make the smaller number look like the whole story.
      */}
      <dl className="hero-const__stats">
        <div>
          <dt>מקומות באתר</dt>
          <dd>{publishedTotal.toLocaleString("he-IL")}</dd>
        </div>
        <div>
          <dt>
            <span className="hero-const__key hero-const__key--fighter" />
            כרטיס פייטר
          </dt>
          <dd>{fighter.toLocaleString("he-IL")}</dd>
        </div>
        <div>
          <dt>
            <span className="hero-const__key hero-const__key--voucher" />
            שובר חופשה
          </dt>
          <dd>{voucher.toLocaleString("he-IL")}</dd>
        </div>
      </dl>
    </section>
  );
}
