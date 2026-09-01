import type { HelpTopic } from '../src/help/helpTopics';

export interface GuideArea { id: string; title: string; topics: string[] }
export interface UnavailableArea { id: string; title: string; reason: string; absentMarkers?: string[]; stillPresent?: string[] }

export const GUIDE_AREAS: GuideArea[];
export const UNAVAILABLE_AREAS: UnavailableArea[];
export const GENERATED_NOTE: string;
export function renderTopic(topic: HelpTopic, index: number): string;
export function renderGuide(area: GuideArea, byId: Map<string, HelpTopic>): string;
export function renderIndex(topics: HelpTopic[]): string;
export function guideFiles(topics: HelpTopic[]): Map<string, string>;
export function unpublishedTopics(topics: HelpTopic[]): string[];
export function unavailableFailures(sourceText: string): string[];
