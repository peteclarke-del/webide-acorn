# Wording and conventions

This describes how the product talks, so that a new surface sounds like the
ones beside it. None of it was invented for this document: every rule below was
read off text already in the product, and where the text disagrees with itself
that is said rather than smoothed over.

## Voice

**Say what is true, then what it means for the reader.** The product refuses a
great deal. Unsupported machines, damaged discs, firmware it cannot verify,
and a refusal that only says "invalid" leaves somebody with nothing to do. So a
refusal names the thing, the measurement and the consequence:

> ADFS S free-space map checksum is invalid, so this disc has been damaged or is
> not the format its length says.

> Hex search must contain complete byte pairs, for example A9 41 or &A9,&41

**Never claim more than was measured.** This is the rule the rest of the product
is built on and it shows in the wording: a directory check byte is "recorded and
not verified" because the algorithm was never established, and a BeebSID's
filter is "approximated to the published range rather than to one chip" because
two real 6581s do not agree with each other either. Both sentences are longer
than "unsupported" and both save the reader a wasted afternoon.

The rule cuts the other way too, and the product has been caught by it. A Tube
processor was described for months as one whose "interface is fitted and
answers, but this core never hands the language over on a BBC-family host".
That sentence was careful, specific and wrong: the operating system finds the
Tube and stops because the language transfer is in a sideways ROM, which Acorn
shipped in DNFS. Put the ROM in a bank and the machine boots as a Tube. A
limitation is a claim like any other, and a claim nobody has measured recently
is a claim nobody has measured.

**Prefer the specific noun.** "The pinned Arculator build", not "the emulator".
"MOS 1.20 + BASIC II + DFS", not "the ROM set".

## Empty and waiting states

An empty state names the condition that applies, in a sentence, in the panel
where it applies. There are no spinners anywhere in the product and none should
be added: nothing turns indefinitely, and the only looping animation is the
machine's own blinking cursor, which is a picture of hardware rather than a
claim about progress. `src/theme/waitingStates.test.ts` holds that.

Where a next step exists, give it, "Open Settings and supply the selected ROM
files to activate real video, keyboard input and hardware execution." Where
nothing has happened yet and the controls that would change that are visible
beside the message, do not manufacture an instruction: "No breakpoint log events
in this debug session" is complete as it stands.

Generic placeholders (*No data*, *Nothing here*, *Loading...*, *Please wait*,
*N/A*, *Coming soon*) do not appear in the product and should not be added.

## Numbers and addresses

Acorn wrote hexadecimal with an ampersand and capital digits, and the people
reading this product have been reading `&` for forty years:

- **`&1900`**, in anything a person reads. Pad to the natural width of the
  thing (four digits for a 16-bit address, eight for a 32-bit one), unless the
  width genuinely varies, as it does for a BASIC token byte.
- Lower-case digits are wrong: `&1e00` reads as something else.
  `src/theme/acornConventions.test.ts` refuses them.
- **The sigil follows the dialect when the text is source code**, because an
  assembler has to accept it. `formatAddress` in
  `src/language/acornTargetReference.ts` writes `0x` into C and ARM and `$` into
  ca65 assembly. That is the one place that chooses, and new code should call it
  rather than deciding for itself.

Sizes and counts go through `toLocaleString`, so a reader sees their own
thousands separator. Byte sizes are written in the units the machine used: a
disc is 160 KiB, not 0.16 MB.

## Menus and controls

Menu entries read like a desktop application's: **a word or two**, with the
detail in a tooltip and a small icon where one helps. "Keyboard shortcuts", not
"Review and rebind every workbench chord". The long form belongs in the
`description`, which becomes the tooltip.

Controls are one of three declared heights and one consistent look throughout;
the release gate measures every control on screen and fails on a fourth size.

## Colour never carries meaning alone

A state that is shown in colour is also shown in words or shape. The capability
pills read SUPPORTED, PREVIEW and PLANNED rather than relying on their hue. The
gate emulates forced colours, the mode where the operating system replaces the
palette entirely, and requires every control to keep a visible boundary.

## Punctuation is ASCII

No em dash, no en dash, no ellipsis character, no curly quotes, no true minus
sign. Each of those has an ASCII spelling that says the same thing, so the
typographic one is only ever a mark of prose nobody typed, and a document full
of em dashes reads as generated whatever it actually says. The `writing` stage
of the release gate enforces this over every tracked text file, including the
characters written as `\uXXXX` escapes, since those reach the reader the same
way.

Replacing an em dash is not a substitution. A hyphen in its place reads exactly
as the dash did, so the sentence is repunctuated instead: a full stop where the
second half stands alone, a colon where it explains the first, brackets around
an aside, a comma where the phrase merely trails, or simply the word the dash
was standing in for. A range keeps a plain hyphen, `1-4,096 bytes`. An ellipsis
becomes three full stops, which is also what a menu entry leading to a dialog
takes: "Open a codebase...".

Where such a character is genuinely the subject of the code, the file is named
in the allowlist in `scripts/writingStyle.mjs` with the reason. There are seven:
five that decode or refuse those characters rather than write in them, and the
scanner and its own tests, which have to spell out what they look for.

## What is not settled

**The product is not ready to be translated.** Every string is inline English;
there is no message catalogue and no formatting boundary to put one behind.
Dates and sizes would follow a locale already, the words would not. This is real
work rather than a convention, and it is tracked as the open part of UX-126.
