# Independent PowerPoint inputs

These existing upstream files are independent of the PptxGenJS export path.
They exercise common content, not complete PowerPoint fidelity or live service operation.

- `shp-shapes.pptx`: python-pptx commit `278b47b1dedd5b46ee84c286e77cdfb0bf4594be`,
  `features/steps/test_files/shp-shapes.pptx`; SHA-256 `302dc642b791f49da6057b69a7ef2a0804f61d9469e7e49e9e734ae3305951cc`.
  4:3, two slides, rect/ellipse/triangle, PNG and GIF. Original human authorship is not established.
- `notes-slide-image.pptx`: pptx-ts commit `cccde169f207c6ed91993a7947eda370f1a2202c`,
  `test/read/fixtures/notes-slide-image.pptx`; SHA-256 `2f41c301147518686fb63e262ea1eb2ede6873fdc22d913dc869d8a924190fc7`.
  Its upstream fixture README records local desktop PowerPoint authorship. 16:9, one slide and speaker notes.
  The name refers to the notes print-layout placeholder; this file has no raster media.

Each repository's MIT license is included, with trailing whitespace normalized.

`shp-shapes.pptx` contains an embedded Excel workbook and is a negative admission oracle.
The positive 4:3 input is `shp-pos-and-size.pptx` from the same python-pptx commit/path;
SHA-256 `37190c51eaaac91ab7299dd2eddf794defb42af858e2c32b9e87d232751cc44d`.
It has three slides (text/rectangle, PNG, blank) and no embedded workbook or external resource.
