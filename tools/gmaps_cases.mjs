// Every shape of Google Maps URL a contributor has actually pasted, against
// what the parser must make of it.
//
// Run with:  npm run gmaps
//
// Node 22 strips the types at load, so this imports src/lib/gmaps.ts directly
// rather than duplicating the regexes into a fixture, which is the way a table
// like this normally rots.
import { parseGoogleMapsUrl, isGoogleShortLink } from "../src/lib/gmaps.ts";

const DESKTOP =
  "https://www.google.com/maps/place/%D7%A2%D7%9E%D7%A0%D7%95%D7%90%D7%9C+%D7%A9%D7%9C%D7%9D/" +
  "@31.8005,35.3105,17z/data=!3m1!4b1!4m6!3m5!" +
  "1s0x1502b5c0e1f2a3b4:0x5d6e7f8091a2b3c4!8m2!3d31.8006!4d35.3107!16s%2Fg%2F11abc123";

const CASES = [
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
  } else if (got.kind === "outside_israel" && want.kind === "outside_israel") {
    check(`${testCase.name} / lat`, got.lat, want.lat);
    check(`${testCase.name} / lng`, got.lng, want.lng);
  }

  if (failed === before) console.log(`  ok    ${testCase.name}`);
}

// isGoogleShortLink gates the only outbound fetch in this feature, so it is
// checked on its own rather than inferred from the table above.
const SHORT = [
  ["https://maps.app.goo.gl/x", true],
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

console.log(failed === 0 ? `\nall ${CASES.length + SHORT.length} cases passed` : `\n${failed} failures`);
process.exit(failed === 0 ? 0 : 1);
