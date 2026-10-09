// App-wide actions any component can call (set by App): files, code with its changes, web pages in the viewer.
import type { Edit } from "./turns";
export const actions = { openFile: (_path: string) => {}, openCode: (_path: string, _edits?: Edit[]) => {}, openWeb: (_url: string) => {} };

/** Files the viewer can show (the main process decides for sure; this only decides whether to offer it). */
export const VIEWABLE = /\.(pdf|png|jpe?g|gif|webp|svg|bmp|avif|md|markdown|csv|tsv|json|jsonl|html?|txt|log|ts|tsx|js|mjs|cjs|jsx|py|rb|go|rs|java|kt|cs|c|h|cpp|css|scss|sql|sh|ya?ml|toml|xml|vue|svelte|php)$/i;
