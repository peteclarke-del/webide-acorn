# Operating the project store

The project store is the only thing this service holds that nobody else has a
copy of. Everything else in the image is rebuildable from this repository:
firmware belongs to the person who supplied it and never enters the store or the
image, and a build result is a function of its inputs. So this document is about
one thing — not losing somebody's work — and it is written to be performed
rather than read.

## What the store is

A directory tree on a mounted volume, at `PROJECT_STORE_ROOT`, defaulting to
`/var/lib/webide-acorn/store`. Two parts:

- `owners/<owner>/projects/<project>/revisions/*.json` — one immutable manifest
  per revision: filenames against SHA-256 digests, the revision it was written
  against, and when. Also `owners/<owner>/tombstones/*.json`, which record what
  was deleted so that a deletion is accountable rather than an absence.
- `blobs/<aa>/<bb>/<digest>` — the file contents, addressed by their SHA-256 and
  stored once however many revisions name them.

Two properties follow from that and both matter here. History over a project
that barely changes costs almost nothing, because a revision that changed one
file adds one blob. And **damage is detectable rather than merely suspectable**:
a blob that no longer hashes to the name it is filed under is corrupt, and
nothing else needs to be known to say so.

## Backing it up

A file-level copy of the store root. Nothing is required to be stopped.

```
tar --create --file store-$(date -u +%Y%m%dT%H%M%SZ).tar --directory /var/lib/webide-acorn store
```

That is safe while the service is running because of how blobs are written: a
blob goes to a temporary name beside its own and is renamed into place, so a
copy never catches a partial one, and an interrupted write leaves nothing
addressable behind. A revision manifest is written whole under a lock and is the
last thing a commit does, so a copy taken mid-commit either has the revision or
does not — it cannot have half of one.

**The recovery point objective is therefore the backup interval and nothing
else.** Work committed after the last copy is lost; work committed before it is
not. There is no replication and no write-ahead log, and saying otherwise would
be claiming a property this store does not have.

## Verifying a backup, and verifying the live store

A copy nobody has verified is a copy nobody knows the state of. A corrupt blob
copies into a backup exactly as readily as a sound one and looks identical —
same name, same length — until something reads it, and the file nobody has
opened since the disk went bad is precisely the file a restore is for.

```
PROJECT_STORE_ROOT=/path/to/store backend/bin/console store:verify
```

It walks every revision and re-hashes every blob, and reports:

- a revision file that is no longer readable JSON, which is what an interrupted
  write or a full disk leaves behind — the store's own reader skips such a file,
  so without this the revision would simply cease to exist with nothing said;
- a revision naming a digest no blob is stored under, so that revision can no
  longer be read;
- a revision whose parent is not in the same project, so its history is broken;
- a blob that no longer hashes to its own name;
- a tombstone that is no longer readable.

It also counts blobs no revision names. That is not damage: it is what the
collector removes, and a store that has not been collected recently is a normal
store.

It reads and never repairs — a store that quietly fixed itself would destroy the
evidence of what went wrong — and its exit code is the honest one, so it can
stand in a restore procedure and stop it rather than printing into a log nobody
reads.

## Restoring

1. Stop the service, so nothing writes while the tree is being replaced.
2. Move the damaged store aside rather than deleting it. It is the evidence, and
   a partial store may still hold revisions the backup predates.
3. Extract the backup into `PROJECT_STORE_ROOT`.
4. Run `store:verify` and require it to exit zero **before** starting the
   service. A restore that produced a store which merely opens is not a restore;
   the question is whether the content came back.
5. Start the service.

**The recovery time objective is the time to copy the tree plus the time to
verify it,** both of which scale with what the store holds rather than with how
long it has been running. Measure them on the deployment rather than assuming
this document's numbers: the exercise below is run on every build, and what it
establishes is that the procedure works, not how long it takes on your disk.

## The exercise

`backend/tests/Storage/StoreRecoveryTest.php` performs the whole of the above on
every run of the gate. It builds a store with two projects and two revisions
each over shared content, verifies it, copies it, **destroys the original
entirely**, restores from the copy, verifies again, and then reads every file of
every revision back and compares it byte for byte against what was written.

It also damages a store on purpose — three ways: a blob overwritten with
different bytes of the same length, a blob removed while a revision still names
it, and a revision file truncated — and requires the verifier to name each. A
verifier that passes everything is indistinguishable from no verifier at all,
and these are what stop it becoming one.

## What is not covered

- **Permission and audit restoration.** There is one owner, nothing proves who
  they are, and there are no roles to restore. When authentication arrives, this
  section has to say how its records are backed up and restored, and until then
  claiming they are would be describing something that does not exist.
- **Off-site copies, retention and rotation.** Where backups are kept and for how
  long is a deployment decision, and this repository does not make it.
- **A restore under load.** The exercise stops the writer, which is what step 1
  of the procedure says to do. Restoring into a running service is not supported
  and is not described as though it were.
