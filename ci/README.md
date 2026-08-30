# Headless test inputs

Place a portable project export at `project.json`. Place ROM files under a
local ignored directory such as `roms/`, then create `roms.json`:

```json
{
  "roms": [
    { "key": "os12-basic2-dfs/os.rom", "file": "/workspace/roms/os.rom" },
    { "key": "os12-basic2-dfs/BASIC.ROM", "file": "/workspace/roms/BASIC.ROM" },
    { "key": "os12-basic2-dfs/b/DFS-0.9.rom", "file": "/workspace/roms/DFS-0.9.rom" }
  ]
}
```

Run `docker-compose --profile ci run --rm headless-tests`. Reports are written
to `results/test-report.json` and `results/test-report.junit.xml`. A failed test
returns exit status 1. Runner or manifest errors return exit status 2.

Standard output also includes bounded adapter result records. Failed assertions
show expected and actual values, including screen and sound digests, so CI logs
contain enough evidence to review a new golden value before editing a test plan.

## The conformance project

`ci/conformance-project.json` is generated, not kept here. Produce it with:

```
node scripts/conformanceProject.mjs --output ci/conformance-project.json --machine bbc-b
```

It is written from `src/testing/conformanceSuite.ts` rather than by hand, so the
cases that run on a real machine are the same objects the suite reports coverage
for. A copy committed beside the suite would be a second declaration of the same
fact, and the two would eventually disagree about what was actually proved —
which for a conformance suite is the whole game. That is why it is ignored here
rather than tracked.
