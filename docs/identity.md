# Identity, and what it may and may not borrow

UX-004 asks for an original identity informed by Acorn hardware rather than
copied from it. This records what the identity is, what it deliberately takes
from that hardware, and what it will not take.

**This is the product's own position, not legal advice.** Whether it is
sufficient is a question for the licence and trademark review, which is a
separate item and deliberately last.

## What the identity is

**The mark** is two ellipses crossing at different angles around a single lit
dot, on a rounded square with a green gradient. It is drawn from primitives.
CSS borders in the workbench, four SVG shapes in `public/favicon.svg`, so there
is no imported artwork anywhere in it and nothing to trace back to a source.

Two orbits and a seed, because that is what this product does: several machines
turning around one piece of work.

**The wordmark** is `8BIT-NET DEV`, with `Acorn Workbench` beneath it and a
`LOCAL ALPHA` badge beside it. The badge is part of the identity for as long as
that is true.

**The icons** are a family of thirty-two, all drawn in `src/components/Icon.tsx`
and none imported: new, open, save, download, build, play, pause, stop, reset,
debug, search, settings, folder, file, chip, layers, book, image, music,
chevron, close, more, terminal, code, cloud, bookmark, breakpoint, lock, check,
screen, expand, power.

## What is taken from Acorn, and how

**The colours.** The palette is a green on near-black, which is what a BBC
Micro's own display looks like, with a cream ink that is the colour those
machines wrote in. That is a family resemblance to a class of hardware rather
than a copy of a logo, and it is the kind of borrowing UX-004 permits.

**The machine names.** `Acorn BBC Model B`, `Acorn Archimedes A300`,
`RISC OS 3.11` and the rest appear throughout, because they name the machine the
person selected and no other words would. Naming a thing to say what it is, is
not the same as using its owner's mark as your own.

## What is not taken, and will not be

- **Acorn's acorn.** The mark is not an acorn, an oak leaf, or anything shaped
  like one, and must not become one.
- **The BBC's marks.** No BBC logo, no owl, no BBC Micro badge artwork. The
  letters BBC appear only inside a machine's name.
- **RISC OS, Archimedes and Econet device marks**, and any styling that imitates
  them.
- **Any implication of endorsement.** Nothing here says approved, official,
  licensed, or compatible-with in a way that suggests a relationship. The
  product is a workbench that targets these machines; it is not from the people
  who made them.
- **Screenshots and manual artwork** as decoration. Firmware and publications
  belong to their owners; this build does not ship either, and its own pictures
  are of machines it is running, not of documents it has copied.

## Where this is checked

Nothing automated can decide whether a shape is too close to somebody's mark.
What is checked is narrower and worth having: the release gate's `hygiene` stage
fails if firmware, captures or credentials reach the repository or the image, so
the artwork that would most obviously be someone else's cannot arrive by
accident.

The rest is judgement, and it belongs with the licence and trademark review.
