export class CommandSequence {
  private lastAccepted = 0;

  reset() { this.lastAccepted = 0; }

  accept(id: number | undefined): boolean {
    if (id === undefined) return true;
    if (!Number.isSafeInteger(id) || id <= this.lastAccepted) return false;
    this.lastAccepted = id;
    return true;
  }
}
