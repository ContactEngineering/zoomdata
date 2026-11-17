<!--
Style for this changelog (keep to it so entries stay uniform):

- Newest version first. Heading `vX.Y.Z (DDMonYY)`, underlined with dashes.
  A version not yet released is headed `vX.Y.Z (not yet released)`.
- One bullet per user-visible change, at most two lines (about 200
  characters). Say what changed for the user and, if useful, why or by how
  much. Omit internals: no function, class, file or variable names, no
  environment variables, no commit or PR references.
- Start every bullet with one of: `ENH:` (new feature), `BUG:` (fix),
  `API:` (interface change), `PERF:` (speed or memory), `MAINT:`, `TST:`,
  `DOC:`, `BUILD:`, `CI:`.
- Small related fixes may share one bullet. No trailing period on bullets.
-->

Change log for zoomdata
=======================

v0.2.0 (not yet released)
-------------------------

- ENH: Reads pyramids stored in a single zipped OME-Zarr file with HTTP range requests, so a
  presigned URL covers the whole pyramid instead of one URL per tile
- ENH: A URL ending in `.ozx` is opened as a zipped OME-Zarr pyramid; expiring URLs are replaced
  when storage rejects them
- BUILD: Depends on zarrita to read Zarr pyramids; runtime dependencies are not bundled into the
  library

v0.1.0 (15Nov26)
----------------

- ENH: First release: zoomable height maps in the browser, drawn with WebGL2 from the NetCDF tile
  pyramids that SurfaceTopography writes
- ENH: Maps show the stored values exactly instead of in 256 steps; colour range and palette change
  instantly, without reloading tiles
- ENH: Reads both NetCDF tile formats of SurfaceTopography; undefined points show in a configurable
  no-data colour
- ENH: Value under the pointer in physical units, read from the finest data in memory without
  further requests
- ENH: Horizontal and vertical cross-sections through a crosshair at the resolution in view, with
  gaps where data is undefined
- ENH: Tiles can come from any storage, including per-tile links that expire and are renewed when
  the server rejects them
- ENH: Tiles load from the centre of the view outwards after a coarse overview; requests for tiles
  that leave the view are cancelled, failed ones retried
- ENH: Memory for tiles is bounded by a configurable budget in bytes
- ENH: Optional mouse, touch and keyboard navigation with pinch zoom; applications can drive the
  view with their own gestures instead
- ENH: Sharp on high-resolution screens and follows changes of the canvas size
- ENH: Several viewers can share a page, and viewers fit into Vue, React or plain pages
- ENH: Relief shading lights the map from a chosen direction, with true slopes and optional vertical
  exaggeration, so that fine structure shows; it switches instantly
- ENH: The map can be turned and tilted and then shows as a surface, in an orthographic view with
  adjustable vertical exaggeration; zooming works as in the plain view
- ENH: In the tilted view the pointer reads the point of the surface under it, and cross-section
  lines follow the surface
- ENH: The turned or tilted view is anti-aliased, with four samples per pixel; it can be switched
  off, and the plain view always shows one value per pixel
- ENH: Twisting two fingers turns the map on touch screens
- ENH: Scale bar, colour bar, and a demo application with a generator for its data
- API: Colour ranges are given in the physical units of the data, and default to its full range
- API: Overlay and cross-section canvases are passed to the viewer instead of being found by id
- API: Scrolling down zooms out, and zooming in goes beyond one screen pixel per data point
- BUG: Tiles at the right and bottom edge of a map were stretched, and coarse tiles shown while
  finer ones loaded were misplaced
- BUG: Colour maps now match matplotlib's; the built-in tables differed from them after a few
  dozen colours
- BUG: Colour bar was off by up to one colour from the map
- DOC: The tile pyramid format and its versions are documented
- TST: Rendered images are compared pixel by pixel with reference data in a real browser
- CI: Test coverage is measured and must stay above 90% of the code
- BUILD: The package includes type declarations and loads as an ES module or with require
