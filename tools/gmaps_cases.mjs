// Every shape of Google Maps URL a contributor has actually pasted, against
// what the parser must make of it.
//
// Run with:  npm run gmaps
//
// Node 22 strips the types at load, so this imports src/lib/gmaps.ts directly
// rather than duplicating the regexes into a fixture, which is the way a table
// like this normally rots.
import { parseGoogleMapsUrl, isGoogleShortLink, positionFromMapsPage } from "../src/lib/gmaps.ts";

const DESKTOP =
  "https://www.google.com/maps/place/%D7%A2%D7%9E%D7%A0%D7%95%D7%90%D7%9C+%D7%A9%D7%9C%D7%9D/" +
  "@31.8005,35.3105,17z/data=!3m1!4b1!4m6!3m5!" +
  "1s0x1502b5c0e1f2a3b4:0x5d6e7f8091a2b3c4!8m2!3d31.8006!4d35.3107!16s%2Fg%2F11abc123";

const CASES = [
  {
    name: "bare coordinates copied from a long-press",
    input: "32.0812, 34.7805",
    expect: { kind: "pin", lat: 32.0812, lng: 34.7805, providerRef: null, name: null },
  },
  {
    name: "bare coordinates outside Israel",
    input: "48.8584,2.2945",
    expect: { kind: "outside_israel", lat: 48.8584, lng: 2.2945 },
  },
  {
    // What a maps.app.goo.gl link from the Android Maps app expands to now.
    name: "phone share expansion with ftid= and no position keeps id and name",
    input:
      "https://maps.google.com/maps?q=%D7%90%D7%9C%D7%95%D7%9E%D7%94+%D7%A4%D7%99%D7%95%D7%A8+%D7%A1%D7%A7%D7%99%D7%9F" +
      "&ftid=0x151d4b1c2a3b4c5d:0x6e7f8091a2b3c4d5&entry=gps&g_ep=abc",
    expect: {
      kind: "no_position",
      providerRef: "gmaps:ftid/0x151d4b1c2a3b4c5d:0x6e7f8091a2b3c4d5",
      name: "אלומה פיור סקין",
    },
  },
  {
    name: "desktop copy-link prefers the marker over the viewport",
    input: DESKTOP,
    expect: {
      kind: "pin",
      lat: 31.8006,
      lng: 35.3107,
      providerRef: "gmaps:ftid/0x1502b5c0e1f2a3b4:0x5d6e7f8091a2b3c4",
      name: "עמנואל שלם",
    },
  },
  {
    name: "a link wrapped in a sentence is still found",
    input: "היי, זה המקום שלנו https://www.google.com/maps/place/x/@31.8005,35.3105,17z תודה!",
    expect: { kind: "pin", lat: 31.8005, lng: 35.3105, providerRef: null, name: "x" },
  },
  {
    name: "phone share link needs expanding",
    input: "https://maps.app.goo.gl/AbCdEf12345",
    expect: { kind: "needs_expanding", url: "https://maps.app.goo.gl/AbCdEf12345" },
  },
  {
    name: "old short link needs expanding too",
    input: "https://goo.gl/maps/AbCdEf",
    expect: { kind: "needs_expanding", url: "https://goo.gl/maps/AbCdEf" },
  },
  {
    name: "api=1 search link, comma-encoded",
    input: "https://www.google.com/maps/search/?api=1&query=31.8005%2C35.3105",
    expect: { kind: "pin", lat: 31.8005, lng: 35.3105, providerRef: null, name: null },
  },
  {
    name: "api=1 with a place id keeps the id",
    input: "https://www.google.com/maps/search/?api=1&query=31.8005,35.3105&query_place_id=ChIJN1t_tDeuEmsRUsoyG83frY4",
    expect: {
      kind: "pin",
      lat: 31.8005,
      lng: 35.3105,
      providerRef: "gmaps:place/ChIJN1t_tDeuEmsRUsoyG83frY4",
      name: null,
    },
  },
  {
    name: "cid link with no position is not a pin",
    input: "https://maps.google.com/?cid=6732789012345678901",
    expect: { kind: "no_position", providerRef: "gmaps:cid/6732789012345678901" },
  },
  {
    name: "bare q= coordinates",
    input: "https://maps.google.com/?q=31.8005,35.3105",
    expect: { kind: "pin", lat: 31.8005, lng: 35.3105, providerRef: null, name: null },
  },
  {
    name: "the Israeli domain works",
    input: "https://www.google.co.il/maps/place/%D7%92%D7%95%D7%A4%D7%A0%D7%90/@32.0550,35.2900,17z",
    expect: { kind: "pin", lat: 32.055, lng: 35.29, providerRef: null, name: "גופנא" },
  },
  {
    name: "a dropped pin has DMS in the name slot, which is not a name",
    input: "https://www.google.com/maps/place/31%C2%B048'01.8%22N+35%C2%B018'37.9%22E/@31.8005,35.3105,17z/data=!3m1!1e3",
    expect: { kind: "pin", lat: 31.8005, lng: 35.3105, providerRef: null, name: null },
  },
  {
    name: "a plus code is not a name either",
    input: "https://www.google.com/maps/place/8G3Q%2B7X+Shilo/@32.0550,35.2900,17z",
    expect: { kind: "pin", lat: 32.055, lng: 35.29, providerRef: null, name: null },
  },
  {
    name: "expanded share link with the id but no position",
    input: "https://www.google.com/maps/place//data=!4m2!3m1!1s0x1502b5c0e1f2a3b4:0x5d6e7f8091a2b3c4?utm_source=mstt_1",
    expect: { kind: "no_position", providerRef: "gmaps:ftid/0x1502b5c0e1f2a3b4:0x5d6e7f8091a2b3c4" },
  },
  {
    // share.google is what Chrome's own share sheet produces now, and it is
    // not a Maps link: it redirects to a Google *Search* page carrying a
    // knowledge-graph id and no coordinates at all.
    name: "the new share.google host needs expanding",
    input: "https://share.google/753bK56LgELaZkH4Q",
    expect: { kind: "needs_expanding", url: "https://share.google/753bK56LgELaZkH4Q" },
  },
  {
    // Where a share.google link actually lands. Told apart from the Maps link
    // above because the two need different instructions: "copy the address
    // bar" is advice about Maps, and somebody following this link is looking
    // at Search.
    name: "a search page with a knowledge-graph id identifies but does not locate",
    input: "https://www.google.com/search?kgmid=/g/11rsfh4hz9&q=%D7%92%D7%95%D7%A4%D7%A0%D7%94",
    expect: { kind: "search_share", providerRef: "gmaps:mid/g/11rsfh4hz9", name: "גופנה" },
  },
  {
    // Verbatim, from a report that Foot Locker at the Dead Sea could not be
    // added: this is what share.google/qAwcto5ypCyyyP3NL expands to. The name
    // is the only thing the page carries that is worth keeping, and it used to
    // be dropped on the floor.
    name: "the real Chrome share link keeps the business name",
    input:
      "https://www.google.com/search?sca_esv=f48afa79f283a7e3&kgmid=/g/11h64t_gs6" +
      "&q=%D7%A4%D7%95%D7%98+%D7%9C%D7%95%D7%A7%D7%A8&shem=dlvs1&source=sh/x/loc/uni/m1/1",
    expect: { kind: "search_share", providerRef: "gmaps:mid/g/11h64t_gs6", name: "פוט לוקר" },
  },
  {
    // The other half of the same report. This one always worked, and stays
    // here so that fixing the Search case cannot quietly break the Maps case.
    name: "the Maps share link for the same shop is a pin",
    input:
      "https://www.google.com/maps/place/Foot+Locker/@31.1987168,35.3613229,17z/data=" +
      "!3m1!4b1!4m6!3m5!1s0x1503a993ed4a29f3:0x29ec2387b06c22f6!8m2!3d31.1987122!4d35.3638978" +
      "!16s%2Fg%2F11h64t_gs6?entry=tts",
    expect: {
      kind: "pin",
      lat: 31.1987122,
      lng: 35.3638978,
      providerRef: "gmaps:ftid/0x1503a993ed4a29f3:0x29ec2387b06c22f6",
      name: "Foot Locker",
    },
  },
  {
    // Whether Google attached a listing id to a given share is invisible to
    // the person pasting it and changes nothing about what they must do next,
    // so a search page with no id gets the same answer, minus the id.
    name: "a search page with no knowledge-graph id is still a search share",
    input: "https://www.google.com/search?q=%D7%A4%D7%95%D7%98+%D7%9C%D7%95%D7%A7%D7%A8",
    expect: { kind: "search_share", providerRef: null, name: "פוט לוקר" },
  },
  {
    // /maps/search is Maps and must keep going down the position path; only a
    // bare /search is the Google Search page this branch is about.
    name: "a maps search link is not mistaken for a Google search page",
    input: "https://www.google.com/maps/search/?api=1&query=31.8005%2C35.3105",
    expect: { kind: "pin", lat: 31.8005, lng: 35.3105, providerRef: null, name: null },
  },
  {
    // The name slot on a search page gets the same scrubbing as the one in a
    // /maps/place path: a pasted coordinate pair is not a shop's name.
    name: "coordinates in the search box are not a business name",
    input: "https://www.google.com/search?kgmid=/g/11rsfh4hz9&q=31.8005%2C35.3105",
    expect: { kind: "search_share", providerRef: "gmaps:mid/g/11rsfh4hz9", name: null },
  },
  {
    // Google returns the listing name with a trailing U+202D. Invisible, and
    // it would be written to the database and rendered into an RTL page.
    name: "bidi control characters are stripped from the name",
    input: "https://www.google.com/maps/place/%D7%92%D7%95%D7%A4%D7%A0%D7%94+-+%D7%9E%D7%A1%D7%A2%D7%93%D7%AA+%D7%A9%D7%A3+%D7%94%D7%A8%D7%A8%D7%99%D7%AA-%E2%80%AD/@32.0512254,35.291046,17z/data=!3m1!4b1!4m6!3m5!1s0x151cd9988e4acb5d:0x3e1b948d6d63712!8m2!3d32.0512254!4d35.291046!16s%2Fg%2F11rsfh4hz9",
    expect: {
      kind: "pin",
      lat: 32.0512254,
      lng: 35.291046,
      providerRef: "gmaps:ftid/0x151cd9988e4acb5d:0x3e1b948d6d63712",
      name: "גופנה - מסעדת שף הררית-",
    },
  },
  {
    name: "Berlin is a mistake, not a contribution",
    input: "https://www.google.com/maps/place/Brandenburger+Tor/@52.5163,13.3777,17z",
    expect: { kind: "outside_israel", lat: 52.5163, lng: 13.3777 },
  },
  {
    name: "somebody else's map is refused",
    input: "https://www.waze.com/live-map/directions?to=ll.31.8005%2C35.3105",
    expect: { kind: "not_a_map_link" },
  },
  {
    name: "plain text is refused",
    input: "אופירה 6, מישור אדומים",
    expect: { kind: "not_a_map_link" },
  },
  {
    name: "an open redirect dressed as Google is refused",
    input: "https://google.com.evil.example/maps/place/x/@31.8,35.3,17z",
    expect: { kind: "not_a_map_link" },
  },
];

let failed = 0;

function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) {
    failed += 1;
    console.log(`  FAIL  ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
  return ok;
}

for (const testCase of CASES) {
  const got = parseGoogleMapsUrl(testCase.input);
  const want = testCase.expect;
  const before = failed;

  check(`${testCase.name} / kind`, got.kind, want.kind);
  if (got.kind === "pin" && want.kind === "pin") {
    check(`${testCase.name} / lat`, got.pin.lat, want.lat);
    check(`${testCase.name} / lng`, got.pin.lng, want.lng);
    check(`${testCase.name} / ref`, got.pin.providerRef, want.providerRef);
    check(`${testCase.name} / name`, got.pin.name, want.name);
  } else if (got.kind === "needs_expanding" && want.kind === "needs_expanding") {
    check(`${testCase.name} / url`, got.url, want.url);
  } else if (got.kind === "no_position" && want.kind === "no_position") {
    check(`${testCase.name} / ref`, got.providerRef, want.providerRef);
    if ("name" in want) check(`${testCase.name} / name`, got.name, want.name);
  } else if (got.kind === "search_share" && want.kind === "search_share") {
    check(`${testCase.name} / ref`, got.providerRef, want.providerRef);
    check(`${testCase.name} / name`, got.name, want.name);
  } else if (got.kind === "outside_israel" && want.kind === "outside_israel") {
    check(`${testCase.name} / lat`, got.lat, want.lat);
    check(`${testCase.name} / lng`, got.lng, want.lng);
  }

  if (failed === before) console.log(`  ok    ${testCase.name}`);
}

// The page behind a no-position link: the marker is the answer, a region-wide
// camera is not.
const PAGES = [
  [
    "marker in the preview image",
    '<meta content="https://maps.google.com/maps/api/staticmap?center=32.08%2C34.78&amp;zoom=16&amp;size=900x900&amp;markers=32.0812%2C34.7805&amp;sensor=false" property="og:image">' +
      '<meta content="אלומה פיור סקין · רחוב 1, תל אביב" property="og:title">',
    { lat: 32.0812, lng: 34.7805, name: "אלומה פיור סקין" },
  ],
  [
    "close camera when there is no preview",
    "<script>window.APP_INITIALIZATION_STATE=[[[1234.5,34.7805,32.0812],[0,0,0]]]</script>",
    { lat: 32.0812, lng: 34.7805, name: null },
  ],
  [
    "a country-wide camera is not a place",
    "<script>window.APP_INITIALIZATION_STATE=[[[1500000,34.8,31.4],[0,0,0]]]</script>",
    null,
  ],
  [
    "a zoomed-out preview centre is not a place",
    '<meta content="https://maps.google.com/maps/api/staticmap?center=31.4%2C34.8&amp;zoom=7" property="og:image">',
    null,
  ],
];
for (const [label, html, want] of PAGES) {
  if (check(`page: ${label}`, JSON.stringify(positionFromMapsPage(html)), JSON.stringify(want))) {
    console.log(`  ok    page: ${label}`);
  }
}

// isGoogleShortLink gates the only outbound fetch in this feature, so it is
// checked on its own rather than inferred from the table above.
const SHORT = [
  ["https://maps.app.goo.gl/x", true],
  ["https://share.google/753bK56LgELaZkH4Q", true],
  ["https://share.google.evil.example/x", false],
  ["https://goo.gl/maps/x", true],
  ["https://www.google.com/maps/place/x/@31.8,35.3,17z", false],
  ["https://goo.gl.evil.example/x", false],
  ["not a url", false],
];
for (const [input, want] of SHORT) {
  if (check(`isGoogleShortLink(${input})`, isGoogleShortLink(input), want)) {
    console.log(`  ok    isGoogleShortLink(${input}) === ${want}`);
  }
}

console.log(failed === 0 ? `\nall ${CASES.length + SHORT.length + PAGES.length} cases passed` : `\n${failed} failures`);
process.exit(failed === 0 ? 0 : 1);
