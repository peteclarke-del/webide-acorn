/*
 * What is mounted in a running machine, and how to say where it is.
 *
 * There are three kinds and they are in three different places. A disc is in a
 * drive, a cassette is in the tape input, and a BeebSCSI LUN image is a file on
 * the board's card: nothing is inserted and nothing is ejected. Saying which is
 * which used to be a two-way test, `disc or else cassette`, which called a LUN
 * image a cassette the moment there was a third kind.
 *
 * So the wording lives here, once, and is tested. A fourth kind added to the
 * union without a case in these functions fails to compile rather than being
 * quietly described as a tape.
 */

export type MachineMedia =
  | { kind: 'disc'; name: string; size: number; drive: number; dirty?: boolean; revision?: number }
  | { kind: 'tape'; name: string; size: number; format: string }
  | { kind: 'scsi-lun'; name: string; size: number; lun: number; revision?: number };

/** Where a piece of media is, in as few words as a status chip can carry. */
export function mediaLocation(item: MachineMedia): string {
  switch (item.kind) {
    case 'disc': return `drive ${item.drive}`;
    case 'scsi-lun': return `LUN ${item.lun}`;
    case 'tape': return 'cassette';
  }
}

/** One sentence saying what is mounted, where, and how much of it the machine took. */
export function describeMountedMedia(item: MachineMedia): string {
  const bytes = item.size.toLocaleString();
  switch (item.kind) {
    case 'disc':
      return `${item.name} is mounted in the live drive ${item.drive}; the emulator acknowledged ${bytes} bytes.`;
    case 'tape':
      return `${item.name} is mounted in the live cassette input; the emulator acknowledged ${bytes} bytes.`;
    case 'scsi-lun':
      /* A LUN image is sparse, so its size is what has been written rather than
       * how big the drive is. Saying "acknowledged 0 bytes" of a blank one
       * would read as a failure when it is the normal state. */
      return `${item.name} is on the live BeebSCSI card as LUN ${item.lun}; it holds ${bytes} bytes and grows as the machine writes to it.`;
  }
}
