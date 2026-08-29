export interface DocumentLifecycleState {
  openIds: string[];
  activeId?: string;
  recentlyClosed: string[];
}

const MAX_RECENTLY_CLOSED = 20;

export function initialDocuments(fileIds: string[], activeId = fileIds[0]): DocumentLifecycleState {
  const available = unique(fileIds);
  const active = activeId && available.includes(activeId) ? activeId : available[0];
  return { openIds: active ? [active] : [], activeId: active, recentlyClosed: [] };
}

export function openDocument(state: DocumentLifecycleState, id: string): DocumentLifecycleState {
  return { openIds: state.openIds.includes(id) ? state.openIds : [...state.openIds, id], activeId: id, recentlyClosed: state.recentlyClosed.filter((candidate) => candidate !== id) };
}

export function selectDocument(state: DocumentLifecycleState, id: string): DocumentLifecycleState {
  return state.openIds.includes(id) ? { ...state, activeId: id } : openDocument(state, id);
}

export function closeDocument(state: DocumentLifecycleState, id: string): DocumentLifecycleState {
  const index = state.openIds.indexOf(id);
  if (index < 0) return state;
  const openIds = state.openIds.filter((candidate) => candidate !== id);
  const activeId = state.activeId === id ? openIds[Math.min(index, openIds.length - 1)] : state.activeId;
  return { openIds, activeId, recentlyClosed: [...state.recentlyClosed.filter((candidate) => candidate !== id), id].slice(-MAX_RECENTLY_CLOSED) };
}

export function closeOtherDocuments(state: DocumentLifecycleState, id: string): DocumentLifecycleState {
  if (!state.openIds.includes(id)) return state;
  const closed = state.openIds.filter((candidate) => candidate !== id);
  return { openIds: [id], activeId: id, recentlyClosed: [...state.recentlyClosed.filter((candidate) => candidate === id || !closed.includes(candidate)), ...closed].slice(-MAX_RECENTLY_CLOSED) };
}

export function closeAllDocuments(state: DocumentLifecycleState): DocumentLifecycleState {
  return { openIds: [], activeId: undefined, recentlyClosed: [...state.recentlyClosed.filter((candidate) => !state.openIds.includes(candidate)), ...state.openIds].slice(-MAX_RECENTLY_CLOSED) };
}

export function reopenClosedDocument(state: DocumentLifecycleState, availableIds: string[]): DocumentLifecycleState {
  const available = new Set(availableIds);
  const recentlyClosed = [...state.recentlyClosed];
  while (recentlyClosed.length) {
    const id = recentlyClosed.pop()!;
    if (available.has(id)) return { openIds: state.openIds.includes(id) ? state.openIds : [...state.openIds, id], activeId: id, recentlyClosed };
  }
  return { ...state, recentlyClosed: [] };
}

export function removeDocument(state: DocumentLifecycleState, id: string, availableIds: string[]): DocumentLifecycleState {
  const closed = closeDocument(state, id);
  const available = new Set(availableIds);
  const openIds = closed.openIds.filter((candidate) => available.has(candidate));
  const activeId = closed.activeId && openIds.includes(closed.activeId) ? closed.activeId : openIds[0];
  return { openIds, activeId, recentlyClosed: closed.recentlyClosed.filter((candidate) => candidate !== id && available.has(candidate)) };
}

function unique(ids: string[]): string[] { return Array.from(new Set(ids)); }
