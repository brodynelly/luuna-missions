import { upgradeLegacyMarkers } from "./legacy-layout.ts";

export const START_MARKER = "<!-- missions:start -->";
export const END_MARKER = "<!-- missions:end -->";

export function hasMarkerSection(rawContent: string): boolean {
	const content = upgradeLegacyMarkers(rawContent);
	return content.includes(START_MARKER) && content.includes(END_MARKER);
}

export function replaceMarkerSection(rawContent: string, newSection: string): string | null {
	const content = upgradeLegacyMarkers(rawContent);
	const startIdx = content.indexOf(START_MARKER);
	const endIdx = content.indexOf(END_MARKER);
	if (startIdx === -1 || endIdx === -1) return null;
	// Markers present but out of order (END before START) means the file was
	// hand-edited into a broken state. Refuse rather than emit garbage.
	if (endIdx < startIdx) return null;
	const before = content.slice(0, startIdx);
	const after = content.slice(endIdx + END_MARKER.length);
	return before + wrapInMarkers(newSection) + after;
}

export function wrapInMarkers(section: string): string {
	return `${START_MARKER}\n${section}\n${END_MARKER}`;
}
