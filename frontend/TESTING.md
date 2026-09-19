# UI testing strategy

Three levels, because the interesting failures live at different ones.

**1. Pure functions in `src/lib/` — the biggest part of the suite.**
A Deck.gl canvas is opaque to DOM assertions. There is no element to query, no
text to read, and a screenshot only tells you that *something* changed. So the
map is not tested through the canvas at all: every layer is built by a pure
factory in `lib/layers.ts` that takes data and returns a configured layer, with
no React state, no GL context and no DOM. A test constructs one directly and
asserts on its `id`, its class, the length of its `data`, and what its
accessors return for a given row — `getPolygon(scene)`, `getColor(segment)`,
`getRadius(target)`, `onClick({object})`. That covers what actually breaks:
the wrong array bound to a layer, a colour keyed off the wrong field, a ground
track drawn straight across the map because the antimeridian split was lost, a
click that selects nothing. None of those are visible to a DOM query, and all
of them are one assertion away here. The same applies to the rest of `lib/`:
the timeline's bar geometry, the colour scale, the formatters and the filters
are all pure and tested the same way.

**2. The API client against a mocked `fetch`.** Success paths check the query
string the backend contract documents and the snake_case-to-camelCase mapping,
which makes `mapping.test.ts` the executable half of that contract. Failure
paths matter as much: a refused connection, a 503, and a body that is not JSON
each have to arrive at the UI as something an operator can act on.

**3. Components with @testing-library/react.** The product sheet, the filters,
the legend, the timeline SVG and the loading / empty / error states. The
timeline is drawn as React SVG elements with d3 supplying only the scale, so
its bars *are* queryable DOM — that was the reason for the split. `MapPanel`
has no component test on purpose: everything it decides lives in level 1, and
what is left is a `<DeckGL>` element and a tooltip. `App.test.tsx` mounts the
whole console twice over a mocked `fetch` - backend up, backend down - with
`@deck.gl/react` stubbed out, because the point of those two tests is the
wiring and the error state, not the canvas.

**The canvas is not the only way in, and that is a testing decision as much as
an accessibility one.** Selecting a scene by clicking a footprint happens inside
the WebGL canvas, where there is nothing to query, nothing to focus and nothing
for a screen reader to announce. So every footprint is also a row in the scene
list in the metadata panel, and every timeline bar is a focusable element with
its own accessible name. `App.test.tsx` reaches the product sheet through that
list with no canvas involved, and `AccessTimeline.test.tsx` tabs to a bar and
presses Enter. What an operator can do with a mouse, a keyboard can do too, and
the tests take the keyboard route.

Not covered here, and named rather than hidden: the assembled app in a real
browser. That is Playwright's job — DOM around the canvas, and `onAfterRender`
plus a fixed camera for screenshot regression — and it is on the repository's
build list, not done. There is no URL state to test either; the console keeps
all of its state in React.

One more thing the tests defend. Eight satellites is the whole categorical
palette, and while the hues separate cleanly side by side, two of the 28
possible pairs are close under deuteranopia. So satellite identity is never
carried by colour alone: `colors.test.ts` asserts no two satellites ever share
a hue, and `AccessTimeline.test.tsx` asserts that every bar carries a `<title>`
naming its satellite and that the legend can isolate one. A native `<title>`
only reaches a mouse, so the same sentence is also the bar's `aria-label`, and
the chart is `role="group"` rather than `role="img"` — an image is a leaf, and
`role="img"` would drop all 219 bars out of the accessibility tree. There is a
test for exactly that.

```sh
npm test -- --run     # once
npm test              # watch

# the one test that needs the real Go services running. VITE_API_BASE is
# required: in the browser the client uses the relative /api/v1 and Vite's dev
# server proxies it, but vitest has no proxy, so the client has to be pointed
# straight at scene-service.
LIVE_BACKEND=1 VITE_API_BASE=http://localhost:8080/api/v1 npm test -- --run src/live.integration.test.ts
```
