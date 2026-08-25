# Basemap styles

Google's default basemap is the most generic surface in this app. It arrives
full of colour that is not our data: pink hospitals, yellow shops, green parks,
brown transit lines, and a POI pin for every business in Israel. Our own pins
have to compete with all of it, which is exactly backwards for a map whose
whole job is "where can I use this card".

These two styles strip it back to the three things a reader actually needs to
locate themselves: the coastline, the road network, and the names of towns.
Everything else is off. The result is that **the only colour on the map is our
dots**, which is what makes the fighter blue and the voucher amber readable at
10px.

| File | Applies to |
|---|---|
| `map-style-light.json` | the light Map ID style |
| `map-style-dark.json` | the dark Map ID style |

## Applying them

Advanced markers require a Map ID, and a Map ID means styling lives in the
cloud console rather than in code. The `styles` option on the JS map is ignored
the moment `mapId` is set, so this is a paste, not a deploy.

1. Google Maps Platform → **Map Styles** → Create style → Import JSON
2. Paste `map-style-light.json`, name it `Fighter Map light`, save
3. Repeat with `map-style-dark.json` as `Fighter Map dark`
4. Google Maps Platform → **Map Management** → your Map ID → associate both
   styles, light with light and dark with dark

The app already asks for the right one. `MapView.tsx` sets
`colorScheme={ColorScheme.FOLLOW_SYSTEM}`, so the basemap follows the same
light or dark choice as the page around it without any extra wiring.

Until you do this the map still works; it just looks like everyone else's.

## What each rule is doing

- `poi` and `transit` off, everywhere. Google's own business pins are not our
  data, and a reader tapping one gets a Google info window instead of ours.
- Road labels off. Street names are noise at the zoom levels this map lives at,
  and the last fifty metres is Waze's job anyway, which is why every place has
  a Waze deep link.
- Locality labels kept, at full ink. "Is that dot near Ashdod" is the question
  the basemap exists to answer.
- Landscape set to the page background, water one step darker. The coastline
  reads as a shape rather than as a blue field, so it orients you without
  pulling the eye.
- Country border kept as a hairline, provinces off.
